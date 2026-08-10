import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { PrismaClient, type ContractKind, type ContractWorkflowStage, type ExecStatus, type ProjectQueueStatus, type SiteStatus } from '@prisma/client'
import { saveContractFile } from '../src/lib/storage'

const prisma = new PrismaClient()
const presentationRoot = path.join(process.cwd(), 'ДЕМО_ПРЕЗЕНТАЦИЯ')
const testRoot = path.join(process.cwd(), 'ТЕСТОВЫЕ_ДОКУМЕНТЫ_ДЛЯ_ЗАГРУЗКИ')

type Stage = {
	number: string
	title: string
	cipher: string
	amount: number
	date: Date
	kind: ContractKind
	sections: Array<{ code: 'KM' | 'KZH' | 'AR'; status: ProjectQueueStatus }>
	site?: SiteStatus
	exec?: Array<{ name: string; status: ExecStatus }>
	documents: Array<{ fileName: string; kind: 'CONTRACT' | 'SIGNED_SCAN' | 'PROJECT_PDF' | 'EXECUTIVE' | 'ACT'; signed?: boolean }>
}

const stages: Stage[] = [
	{ number: 'ДЕМО-НОВЫЙ-2026', title: '01_Новый_договор', cipher: 'КБ-ДЕМО.26.10', amount: 4200000, date: new Date('2026-08-04'), kind: 'SMR', sections: [], documents: [{ fileName: 'Договор_ДЕМО-НОВЫЙ-2026.pdf', kind: 'CONTRACT' }] },
	{ number: 'ДЕМО-ПОДПИСАН-2026', title: '02_Подписанный_ПР1', cipher: 'КБ-ДЕМО.26.20', amount: 7350000, date: new Date('2026-07-28'), kind: 'SMR', sections: [{ code: 'KM', status: 'QUEUED' }, { code: 'KZH', status: 'QUEUED' }], site: 'PREPARING', documents: [{ fileName: 'Договор_ДЕМО-ПОДПИСАН-2026.pdf', kind: 'SIGNED_SCAN', signed: true }, { fileName: 'Приложение_№1_подписанное.pdf', kind: 'SIGNED_SCAN', signed: true }] },
	{ number: 'ДЕМО-В-РАБОТЕ-2026', title: '03_Проект_в_работе', cipher: 'КБ-ДЕМО.26.30', amount: 11800000, date: new Date('2026-07-15'), kind: 'PROJECT', sections: [{ code: 'KM', status: 'DONE' }, { code: 'KZH', status: 'IN_PROGRESS' }, { code: 'AR', status: 'QUEUED' }], exec: [{ name: 'Паспорт на каркас', status: 'IN_PROGRESS' }, { name: 'Акты скрытых работ', status: 'NOT_READY' }, { name: 'ОЖР', status: 'NOT_READY' }], documents: [{ fileName: 'Договор_ДЕМО-В-РАБОТЕ-2026.pdf', kind: 'SIGNED_SCAN', signed: true }, { fileName: 'КМ_КБ-ДЕМО.26.30.pdf', kind: 'PROJECT_PDF' }] },
	{ number: 'ДЕМО-К-ЗАКРЫТИЮ-2026', title: '04_Почти_закрыт', cipher: 'КБ-ДЕМО.26.40', amount: 16400000, date: new Date('2026-06-20'), kind: 'SMR', sections: [{ code: 'KM', status: 'DONE' }, { code: 'KZH', status: 'DONE' }], site: 'READY', exec: [{ name: 'Паспорт на каркас', status: 'READY' }, { name: 'Акты скрытых работ', status: 'READY' }, { name: 'ОЖР', status: 'IN_PROGRESS' }], documents: [{ fileName: 'Договор_ДЕМО-К-ЗАКРЫТИЮ-2026.pdf', kind: 'SIGNED_SCAN', signed: true }, { fileName: 'КМ_КБ-ДЕМО.26.40.pdf', kind: 'PROJECT_PDF' }, { fileName: 'КЖ_КБ-ДЕМО.26.40.pdf', kind: 'PROJECT_PDF' }, { fileName: 'Паспорт_на_каркас.pdf', kind: 'EXECUTIVE' }, { fileName: 'Акт_скрытых_работ.pdf', kind: 'ACT' }] },
]

function createDemoPdf(label: string) {
	const printable = label.replace(/[()\\]/g, '\\$&').replace(/[^\x20-\x7E]/g, '?')
	const content = `BT\n/F1 18 Tf\n72 740 Td\n(IZLK presentation document) Tj\n0 -28 Td\n/F1 11 Tf\n(${printable}) Tj\nET`
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
	]
	let pdf = '%PDF-1.4\n'
	const offsets = [0]
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf, 'utf8'))
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
	}
	const xrefOffset = Buffer.byteLength(pdf, 'utf8')
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
	return Buffer.from(pdf, 'utf8')
}

async function resetRelations(contractId: string) {
	await prisma.task.deleteMany({ where: { contractId } })
	await prisma.document.deleteMany({ where: { contractId } })
	await prisma.site.deleteMany({ where: { contractId } })
	await prisma.projectSection.deleteMany({ where: { contractId } })
	await prisma.executiveDoc.deleteMany({ where: { contractId } })
	await prisma.contractStageHistory.deleteMany({ where: { contractId } })
}

async function createStage(stage: Stage, contractorId: string, managerId: string, designerId: string) {
	const smrAmount = Math.round(stage.amount * 0.55)
	const mkAmount = Math.round(stage.amount * 0.35)
	const deliveryAmount = stage.amount - smrAmount - mkAmount
	const workflowStage: ContractWorkflowStage = stage.sections.length === 0
		? 'CONTRACT_PREPARATION'
		: stage.site === 'READY' && stage.sections.every((section) => section.status === 'DONE')
			? 'INSTALL_KM'
			: 'DESIGN'
	const pr1SignedAt = stage.sections.length ? new Date('2026-08-01') : null
	const workingDays = stage.sections.length ? (stage.site === 'READY' ? 45 : stage.sections.some((section) => section.status === 'IN_PROGRESS') ? 30 : 20) : null
	const deadline = workingDays ? new Date('2026-09-30') : null
	const contract = await prisma.contract.upsert({
		where: { number: stage.number },
		update: { cipher: stage.cipher, contractorId, managerId, date: stage.date, amount: stage.amount, smrAmount, mkAmount, deliveryAmount, status: 'ACTIVE', kind: stage.kind, objectAddress: `г. Москва, Демонстрационный объект ${stage.cipher}`, deletedAt: null },
		create: { number: stage.number, cipher: stage.cipher, contractorId, managerId, date: stage.date, amount: stage.amount, smrAmount, mkAmount, deliveryAmount, status: 'ACTIVE', kind: stage.kind, objectAddress: `г. Москва, Демонстрационный объект ${stage.cipher}` },
	})
	await resetRelations(contract.id)
	await prisma.contract.update({ where: { id: contract.id }, data: { workflowStage, pr1SignedAt, pr1ConfirmedAt: pr1SignedAt, pr1ConfirmedById: pr1SignedAt ? managerId : null, workingDays, deadline } })
	await prisma.contractStageHistory.create({ data: { contractId: contract.id, toStage: workflowStage, changedById: managerId, isAutomatic: true, comment: 'Подготовлено для демонстрации' } })

	for (const [index, section] of stage.sections.entries()) await prisma.projectSection.create({ data: { contractId: contract.id, code: section.code, responsibleId: designerId, queueStatus: section.status, queuePosition: 100 + index * 10, durationDays: 5, dateFrom: section.status === 'QUEUED' ? null : new Date('2026-08-01'), dateTo: section.status === 'DONE' ? new Date('2026-08-04') : null, deadline: new Date('2026-08-10'), comment: section.status === 'QUEUED' ? 'Создано автоматически после подписания ПР1' : 'Демонстрационный этап' } })

	if (stage.site) {
		const site = await prisma.site.create({ data: { contractId: contract.id, address: contract.objectAddress!, status: stage.site } })
		await prisma.siteEvent.create({ data: { siteId: site.id, type: stage.site === 'READY' ? 'SUCCESS' : 'INFO', text: stage.site === 'READY' ? 'Монтаж завершён, площадка готова к сдаче' : 'Площадка создана автоматически после подтверждения ПР1' } })
		if (stage.number.includes('РАБОТЕ') || stage.site === 'READY') await prisma.siteWork.create({ data: { siteId: site.id, direction: 'KM', workDate: new Date('2026-08-04'), stage: stage.site === 'READY' ? 'Завершение монтажа' : 'Монтаж металлоконструкций', crewCount: 5, crewCost: 45000, equipmentCost: 28000, materialCost: 64000, comment: 'Демонстрационный автоматически рассчитанный отчёт' } })
	}

	// Для презентации на готовой площадке есть отдельный факт по КЖ —
	// благодаря этому план/факт показывает оба направления монтажа.
	if (stage.site === 'READY') {
		const readySite = await prisma.site.findFirst({ where: { contractId: contract.id }, select: { id: true } })
		if (readySite) await prisma.siteWork.create({ data: { siteId: readySite.id, direction: 'KJ', workDate: new Date('2026-08-03'), stage: 'Монтаж КЖ', crewCount: 4, crewCost: 38000, equipmentCost: 18000, materialCost: 52000, otherCost: 7000, comment: 'Демонстрационный отчёт по монтажу КЖ' } })
	}

	const execMap = new Map<string, string>()
	for (const item of stage.exec ?? []) {
		const created = await prisma.executiveDoc.create({ data: { contractId: contract.id, name: item.name, status: item.status } })
		execMap.set(item.name, created.id)
	}

	for (const [index, item] of stage.documents.entries()) {
		const buffer = createDemoPdf(`${stage.cipher} | file ${index + 1}`)
		const saved = await saveContractFile({ contractId: contract.id, fileName: item.fileName, buffer })
		const sectionCode = item.fileName.startsWith('КМ_') ? 'KM' : item.fileName.startsWith('КЖ_') ? 'KZH' : item.fileName.startsWith('АР_') ? 'AR' : null
		const section = sectionCode ? await prisma.projectSection.findUnique({ where: { contractId_code: { contractId: contract.id, code: sectionCode } }, select: { id: true } }) : null
		const executiveDocId = item.kind === 'ACT' ? execMap.get('Акты скрытых работ') : item.kind === 'EXECUTIVE' ? execMap.get('Паспорт на каркас') : undefined
		await prisma.document.create({ data: { contractId: contract.id, fileName: item.fileName, kind: item.kind, state: item.signed ? 'SIGNED' : 'SOURCE', signedAt: item.signed ? new Date('2026-08-01') : null, projectSectionId: section?.id, executiveDocId, uploadedById: managerId, storagePath: saved.storagePath, sha256: saved.sha256, sizeBytes: BigInt(saved.sizeBytes), mimeType: saved.mimeType, createdAt: new Date(Date.UTC(2026, 7, 1, 9 + index)) } })
	}

	if (stage.number.includes('ПОДПИСАН')) await prisma.task.createMany({ data: [{ title: 'Подготовить исходные данные для КМ', category: 'Проектирование', priority: 'HIGH', contractId: contract.id, assigneeId: designerId, creatorId: managerId, dueDate: new Date('2026-08-10') }, { title: 'Подтвердить готовность площадки', category: 'Площадка', priority: 'MEDIUM', contractId: contract.id, assigneeId: managerId, creatorId: managerId, dueDate: new Date('2026-08-08') }] })
	return contract
}

async function prepareFiles() {
	await mkdir(presentationRoot, { recursive: true })
	const sourceContract = path.join(testRoot, '01_Парсер_договора', 'Договор_ТЕСТ-701-ИЗЛК-СМР-2026.docx')
	for (const stage of stages) {
		const folder = path.join(presentationRoot, stage.title)
		await mkdir(folder, { recursive: true })
		await copyFile(sourceContract, path.join(folder, `${stage.number}.docx`)).catch(() => writeFile(path.join(folder, `${stage.number}.txt`), `Договор ${stage.number}\nШифр ${stage.cipher}`, 'utf8'))
	}
	await writeFile(path.join(presentationRoot, 'README_ПРЕЗЕНТАЦИЯ.txt'), '1. Откройте раздел «Договоры» и покажите четыре стадии.\r\n2. Для теста импорта скопируйте файл из 01_Новый_договор во входящую папку.\r\n3. Через 5 секунд файл появится в очереди импорта.\r\n4. Покажите автоматизацию подписанного ПР1, проектирование, площадку и контроль ИД.\r\n', 'utf8')
}

async function main() {
	const [manager, designer] = await Promise.all([
		prisma.user.upsert({
      where: { login: 'manager.demo@izlk.ru' },
			update: { name: 'Максим Демо', role: 'MANAGER', isActive: true, deletedAt: null },
      create: { login: 'manager.demo@izlk.ru', email: 'manager.demo@izlk.ru', name: 'Максим Демо', role: 'MANAGER', isActive: true, passwordHash: await bcrypt.hash('Manager-Demo-2026!', 12) },
		}),
		prisma.user.upsert({
      where: { login: 'designer.demo@izlk.ru' },
			update: { name: 'Андрей Проектировщик', role: 'DESIGNER', isActive: true, deletedAt: null },
      create: { login: 'designer.demo@izlk.ru', email: 'designer.demo@izlk.ru', name: 'Андрей Проектировщик', role: 'DESIGNER', isActive: true, passwordHash: await bcrypt.hash('Designer-Demo-2026!', 12) },
		}),
	])
	const contractor = await prisma.contractor.upsert({ where: { id: 'presentation-contractor-2026' }, update: { name: 'ООО «Заказчик презентации»', inn: '7707002026', deletedAt: null }, create: { id: 'presentation-contractor-2026', name: 'ООО «Заказчик презентации»', inn: '7707002026', phone: '+7 (495) 700-20-26', email: 'office@demo.example' } })
	const created = []
	for (const stage of stages) created.push(await createStage(stage, contractor.id, manager.id, designer.id))
	if (process.env.NODE_ENV !== 'production') await prepareFiles()
	console.log(`Подготовлено договоров: ${created.length}`)
	console.log(`Файлы презентации: ${presentationRoot}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
