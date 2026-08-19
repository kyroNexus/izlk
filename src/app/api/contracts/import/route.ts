import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseContractFile, MAX_FOLDER_FILES, MAX_FOLDER_TOTAL_BYTES, MAX_PARSE_BYTES } from '@/lib/contract-parser'
import { assertSafeDocumentUpload, MAX_UPLOAD_BYTES, saveContractFile, sha256Buffer } from '@/lib/storage'
import { EXEC_TEMPLATES } from '@/lib/executive'
import { classifyDocumentPath, detectProjectSectionCode, documentStateForPath, isTransientSystemFile } from '@/lib/document-classifier'
import { tryConfirmSignedPr1Workflow, trySyncWorkflowAfterDocumentUpload } from '@/lib/contract-workflow'
import { contractImportSchema, firstIssue, orNull } from '@/lib/validation'
import { grantDesignReadAccess, type SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { writeAudit, writeImportEvent } from '@/lib/audit'
import { removeUnusedImportedContractor, rollbackNewContractImport } from '@/lib/contract-import-cleanup'
import { createVersionedDocument } from '@/lib/document-versioning'
import { findMatchingContractor, normalizeCompanyName } from '@/lib/contractor-match'
import { logger } from '@/lib/logger'
import { matchDocumentContract, routeDocument } from '@/lib/document-routing'
import type { DocumentRouteRuleInput } from '@/lib/document-route-rules'

export const runtime = 'nodejs'

const value = (form: FormData, name: string) => String(form.get(name) ?? '').trim()

type FolderUpload = { file: File; relativePath: string }
type ProjectSectionReference = { id: string; code: 'KM' | 'KZH' | 'AR' | 'OTHER' }

/** Project source files get their own section even before the PR1 workflow step. */
async function projectSectionForPath(contractId: string, filePath: string, sections: ProjectSectionReference[], routedCode = detectProjectSectionCode(filePath)) {
	const code = routedCode
	if (!code) return null
	const existing = sections.find((section) => section.code === code)
	if (existing) return existing
	const created = await prisma.projectSection.upsert({
		where: { contractId_code: { contractId, code } },
		create: { contractId, code },
		update: { deletedAt: null },
		select: { id: true, code: true },
	})
	sections.push(created)
	return created
}

async function removeUnlinkedUpload(storagePath: string) {
	const linked = await prisma.document.count({ where: { storagePath } }).catch(() => 1)
	if (linked === 0) logger.warn('contract_import.unlinked_upload', { entityType: 'StorageObject' })
}

async function attachFolderToContract(input: { contractId: string; uploads: FolderUpload[]; userId: string; routeRules: DocumentRouteRuleInput[] }) {
	const [projectSections, executiveDocs, contract] = await Promise.all([
		prisma.projectSection.findMany({ where: { contractId: input.contractId, deletedAt: null } }),
		prisma.executiveDoc.findMany({ where: { contractId: input.contractId, deletedAt: null } }),
		prisma.contract.findUnique({ where: { id: input.contractId }, select: { id: true, number: true, cipher: true, date: true, pr1ConfirmedAt: true, agreements: { where: { deletedAt: null }, select: { id: true, number: true } }, invoices: { where: { deletedAt: null }, select: { id: true, number: true } } } }),
	])
	if (!contract) throw new Error('Договор не найден')
	let attached = 0
	let skipped = 0
	let automaticPr1SignedAt: Date | null = null
	const issues: string[] = []
	const skip = (fileName: string, reason: string) => {
		skipped++
		if (issues.length < 20) issues.push(`${fileName}: ${reason}`)
		return writeImportEvent({ fileName, event: 'MANUAL_IMPORTED', outcome: 'IGNORED', contractId: input.contractId, actorId: input.userId, message: reason })
	}
	for (const { file, relativePath } of input.uploads) {
		if (isTransientSystemFile(relativePath || file.name)) { await skip(file.name, 'Служебный временный файл Office — не импортирован.'); continue }
		if (file.size > MAX_UPLOAD_BYTES) { await skip(file.name, 'Файл больше допустимого размера.'); continue }
		try { assertSafeDocumentUpload(file.name) } catch (error) { await skip(file.name, error instanceof Error ? error.message : 'Недопустимый формат.'); continue }
		let savedPath: string | null = null
		try {
		const buffer = Buffer.from(await file.arrayBuffer())
		const sha256 = sha256Buffer(buffer)
		if (await prisma.document.findFirst({ where: { contractId: input.contractId, sha256 }, select: { id: true } })) { await skip(file.name, 'Точная копия уже есть в этом договоре.'); continue }
		const route = routeDocument(relativePath, input.routeRules)
		const { kind, state } = route
		const searchable = relativePath.toLocaleLowerCase('ru-RU')
		const projectSection = await projectSectionForPath(input.contractId, relativePath, projectSections, route.sectionCode)
		const executiveDoc = ['EXECUTIVE', 'ACT', 'CERTIFICATE'].includes(kind)
			? executiveDocs.find((doc) => {
				const name = doc.name.toLocaleLowerCase('ru-RU')
				return (/акт|аоср/i.test(searchable) && /акт|скрыт/i.test(name)) || (/сертификат|паспорт.*материал/i.test(searchable) && /сертификат/i.test(name)) || (/ожр|журнал/i.test(searchable) && /журнал/i.test(name)) || (/схем/i.test(searchable) && /схем/i.test(name)) || (/паспорт/i.test(searchable) && /паспорт/i.test(name))
			})
			: null
		const saved = await saveContractFile({ contractId: input.contractId, fileName: file.name, buffer })
		savedPath = saved.storagePath
		const document = await createVersionedDocument({
			contractId: input.contractId, kind, state, fileName: file.name,
			storagePath: saved.storagePath, mimeType: saved.mimeType, sizeBytes: BigInt(saved.sizeBytes), sha256: saved.sha256,
			uploadedById: input.userId, projectSectionId: projectSection?.id, executiveDocId: executiveDoc?.id,
			sourceDataKind: route.sourceDataKind,
			agreementId: contract.agreements.find((item) => item.number === route.agreementNumber)?.id,
			invoiceId: contract.invoices.find((item) => item.number === route.invoiceNumber)?.id,
			signedAt: route.pr1SignedAt ? new Date(`${route.pr1SignedAt}T12:00:00.000Z`) : undefined,
		})
		if (executiveDoc) await prisma.executiveDoc.update({ where: { id: executiveDoc.id }, data: { status: 'IN_PROGRESS' } })
		await trySyncWorkflowAfterDocumentUpload({ contractId: input.contractId, actorId: input.userId, kind, state })
		await prisma.auditLog.create({ data: { userId: input.userId, action: 'UPLOAD', entityType: 'Document', entityId: document.id } })
		const contractMatch = matchDocumentContract(route, [contract])
		let warning = contractMatch.warning
		if (route.pr1SignedAt) {
			if (!contractMatch.contract) warning = `ПР1 не подтверждён: номер в имени не совпадает с договором № ${contract.number}.`
			else if (contract.pr1ConfirmedAt) warning = 'ПР1 уже подтверждён; повторный запуск пропущен.'
			else automaticPr1SignedAt ??= new Date(`${route.pr1SignedAt}T12:00:00.000Z`)
		}
		await writeImportEvent({ fileName: file.name, event: 'MANUAL_IMPORTED', outcome: 'SUCCESS', contractId: input.contractId, actorId: input.userId, message: `Прикреплён как ${kind}.${warning ? ` Предупреждение: ${warning}` : ''}` })
		attached++
		} catch (error) {
			if (savedPath) await removeUnlinkedUpload(savedPath)
			await skip(file.name, error instanceof Error ? error.message : 'Непредвиденная ошибка обработки файла.')
		}
	}
	if (automaticPr1SignedAt) {
		const workflow = await tryConfirmSignedPr1Workflow({ contractId: input.contractId, actorId: input.userId, signedAt: automaticPr1SignedAt })
		if (workflow.error) {
			if (issues.length < 20) issues.push(`Подписанное ПР1: файл сохранён, но автоматическое подтверждение не выполнено: ${workflow.error}`)
			await writeImportEvent({ fileName: 'Подписанное ПР1', event: 'MANUAL_IMPORTED', outcome: 'FAILED', contractId: input.contractId, actorId: input.userId, message: workflow.error })
		}
	}
	return { attached, skipped, issues }
}

function contractNumberInName(fileName: string, number: string) {
	const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	return new RegExp(`(^|[^0-9A-ZА-Я])${escaped}(?=$|[^0-9A-ZА-Я])`, 'i').test(fileName)
}

async function post(request: Request, { user, requestId }: { user: SessionUser; requestId: string }) {
	let createdContractId: string | null = null
	let createdContractorId: string | null = null
	let requestedFileName: string | null = null
	try {
		const form = await request.formData()
		const file = form.get('file')
		requestedFileName = file instanceof File ? file.name : null
		const folderFiles = form.getAll('files').filter((entry): entry is File => entry instanceof File && entry.size > 0)
		const relativePaths = form.getAll('relativePaths').map(String)
		const routeRules = await prisma.documentRouteRule.findMany({ where: { enabled: true }, orderBy: [{ target: 'asc' }, { sortOrder: 'asc' }] })
		const rejectImport = async (message: string, status: number, input: { fileName?: string; contractId?: string; outcome?: 'FAILED' | 'IGNORED'; event?: 'CONTRACT_CREATED' | 'MANUAL_IMPORTED' } = {}) => {
			await writeImportEvent({
				fileName: input.fileName ?? requestedFileName ?? folderFiles[0]?.name ?? 'Пакет импорта',
				event: input.event ?? 'CONTRACT_CREATED',
				outcome: input.outcome ?? 'FAILED',
				contractId: input.contractId,
				actorId: user.id,
				message,
			})
			return NextResponse.json({ error: message, ...(input.contractId ? { contractId: input.contractId } : {}) }, { status })
		}
		const isAttach = value(form, 'operation') === 'attach'
		const primaryFile = file instanceof File ? file : null
		if (folderFiles.length > MAX_FOLDER_FILES) return rejectImport(`За один раз можно загрузить до ${MAX_FOLDER_FILES} файлов.`, 400, { event: 'MANUAL_IMPORTED' })
		if (folderFiles.reduce((sum, item) => sum + item.size, 0) > MAX_FOLDER_TOTAL_BYTES) return rejectImport('Папка больше 750 МБ. Для такого архива используйте Inbox на сервере.', 400, { event: 'MANUAL_IMPORTED' })
		if (!isAttach && (!primaryFile || primaryFile.size === 0)) return rejectImport('Файл потерян — выберите его ещё раз', 400)
		if (!isAttach && primaryFile && isTransientSystemFile(primaryFile.name)) return rejectImport('Служебный временный файл Office нельзя использовать как основной договор.', 400, { fileName: primaryFile.name })
		if (!isAttach && primaryFile && primaryFile.size > MAX_UPLOAD_BYTES) return rejectImport('Файл больше допустимого размера 200 МБ', 400, { fileName: primaryFile.name })
		if (!isAttach && primaryFile) {
			try { assertSafeDocumentUpload(primaryFile.name) }
			catch (error) { return rejectImport(error instanceof Error ? error.message : 'Недопустимый формат файла', 400, { fileName: primaryFile.name }) }
		}
		const folderUploads = folderFiles.map((upload, index) => ({ file: upload, relativePath: relativePaths[index] || upload.name }))
		if (value(form, 'operation') === 'attach' && !folderUploads.length) return rejectImport('Выберите папку с документами', 400, { event: 'MANUAL_IMPORTED' })
		if (value(form, 'operation') === 'attach') {
			const accessibleContracts = await prisma.contract.findMany({
				where: { deletedAt: null, ...(user.role === 'MANAGER' ? { managerId: user.id } : {}) },
				select: { id: true, number: true, cipher: true, date: true }, take: 2000,
			})
			const explicitNumber = value(form, 'targetContractNumber')
			const matches = accessibleContracts.map((contract) => ({
				contract,
				score: explicitNumber && (explicitNumber === contract.number || contract.number.startsWith(`${explicitNumber}-`) || contract.number.startsWith(`${explicitNumber}_`))
					? 100_000
					: folderUploads.reduce((score, upload) => {
						const route = routeDocument(upload.relativePath, routeRules)
						const matched = matchDocumentContract(route, [contract]).contract
						return score + (matched ? route.cipher ? 100 : route.contractNumberFull ? 10 : 1 : contractNumberInName(upload.relativePath, contract.number) ? 1 : 0)
					}, 0),
			})).filter((item) => item.score > 0).sort((a, b) => b.score - a.score)
			if (!matches.length) return rejectImport('Номер существующего договора не найден в названиях файлов. Добавьте номер в формате «765 — смета.xlsx» или укажите его вручную.', 400, { event: 'MANUAL_IMPORTED' })
			if (matches.length > 1 && matches[0].score === matches[1].score) return rejectImport('Найдено несколько договоров с одинаковым совпадением. Укажите номер договора вручную.', 409, { event: 'MANUAL_IMPORTED' })
			const result = await attachFolderToContract({ contractId: matches[0].contract.id, uploads: folderUploads, userId: user.id, routeRules })
			return NextResponse.json({ contractId: matches[0].contract.id, importedFiles: result.attached, skippedFiles: result.skipped, issues: result.issues, matchedNumber: matches[0].contract.number })
		}
		if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Файл потерян — выберите его ещё раз' }, { status: 400 })
		if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'Файл больше допустимого размера 200 МБ' }, { status: 400 })
		try { assertSafeDocumentUpload(file.name) }
		catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Недопустимый формат файла' }, { status: 400 }) }
		const buffer = Buffer.from(await file.arrayBuffer())
		// Large signed scans are valid documents.  They are stored with manually
		// confirmed fields; automatic text/OCR extraction stays bounded to 25 MB.
		const parsingSkipped = file.size > MAX_PARSE_BYTES
		if (!parsingSkipped) await parseContractFile(file.name, buffer)

		const validation = contractImportSchema.safeParse({
			number: value(form, 'contractNumber'), date: value(form, 'contractDate'), amount: value(form, 'amount'),
			contractorName: value(form, 'contractorName'), inn: value(form, 'inn'), ogrn: value(form, 'ogrn'), cipher: value(form, 'cipher'),
			objectAddress: value(form, 'objectAddress'), foundationType: value(form, 'foundationType'), customerOwnSlab: value(form, 'customerOwnSlab'),
			currency: value(form, 'currency') || 'RUB', kind: value(form, 'kind') || 'SMR',
			type: value(form, 'type') || 'LEGAL',
			snils: value(form, 'snils'), passportSeries: value(form, 'passportSeries'), passportNumber: value(form, 'passportNumber'),
			passportIssuedBy: value(form, 'passportIssuedBy'), passportIssuedAt: value(form, 'passportIssuedAt'), passportDeptCode: value(form, 'passportDeptCode'),
			representativeName: value(form, 'representativeName'), representativeSnils: value(form, 'representativeSnils'),
			representativePassportSeries: value(form, 'representativePassportSeries'), representativePassportNumber: value(form, 'representativePassportNumber'),
			representativePassportIssuedBy: value(form, 'representativePassportIssuedBy'), representativePassportIssuedAt: value(form, 'representativePassportIssuedAt'),
			representativePassportDeptCode: value(form, 'representativePassportDeptCode'),
			representativeProxyNumber: value(form, 'representativeProxyNumber'), representativeProxyDate: value(form, 'representativeProxyDate'),
		})
		if (!validation.success) return rejectImport(firstIssue(validation.error), 400, { fileName: file.name })
		const {
			number, date, contractorName, inn, ogrn, cipher, objectAddress, foundationType, customerOwnSlab, currency, kind, type, snils, passportSeries, passportNumber, passportIssuedBy, passportIssuedAt, passportDeptCode,
			representativeName, representativeSnils, representativePassportSeries, representativePassportNumber, representativePassportIssuedBy, representativePassportIssuedAt, representativePassportDeptCode,
			representativeProxyNumber, representativeProxyDate,
		} = validation.data
		const amountText = value(form, 'amount').replace(/\s/g, '').replace(',', '.')
		const amount = Number(amountText)
		const duplicate = await prisma.contract.findUnique({ where: { number }, select: { id: true } })
		if (duplicate) await writeImportEvent({ fileName: file.name, event: 'CONTRACT_CREATED', outcome: 'IGNORED', contractId: duplicate.id, actorId: user.id, message: `Договор ${number} уже существует.` })
		if (duplicate) return NextResponse.json({ error: `Договор ${number} уже существует`, contractId: duplicate.id }, { status: 409 })
		const digest = sha256Buffer(buffer)
		const duplicateFile = await prisma.document.findFirst({ where: { sha256: digest }, select: { contractId: true } })
		if (duplicateFile) await writeImportEvent({ fileName: file.name, event: 'CONTRACT_CREATED', outcome: 'IGNORED', contractId: duplicateFile.contractId, actorId: user.id, message: 'Этот файл уже был загружен.' })
		if (duplicateFile) return NextResponse.json({ error: 'Этот файл уже загружен', contractId: duplicateFile.contractId }, { status: 409 })

		const contractorPhone = value(form, 'contractorPhone') || null
		const contractorEmail = value(form, 'contractorEmail') || null
		const match = await findMatchingContractor({ name: contractorName, inn, phone: contractorPhone, email: contractorEmail })
		let contractor = match ? { id: match.id, phone: match.phone, email: match.email, aliases: match.aliases, name: match.name } : null
		if (!contractor) {
			// type/паспортные данные — только для НОВОГО контрагента. Уже существующего
			// (найден по имени/ИНН/телефону/email выше) не трогаем: свежая догадка
			// парсера по одному документу не должна тихо переписывать реквизиты записи,
			// которая уже подтверждена раньше.
			contractor = await prisma.contractor.create({
				data: {
					name: contractorName || `Контрагент ИНН ${inn}`, inn: inn || null, ogrn: ogrn || null, phone: contractorPhone, email: contractorEmail, type,
					...(type === 'INDIVIDUAL' ? {
						snils: orNull(snils), passportSeries: orNull(passportSeries), passportNumber: orNull(passportNumber),
						passportIssuedBy: orNull(passportIssuedBy), passportIssuedAt: passportIssuedAt ? new Date(`${passportIssuedAt}T12:00:00`) : null, passportDeptCode: orNull(passportDeptCode),
						representativeName: orNull(representativeName), representativeSnils: orNull(representativeSnils),
						representativePassportSeries: orNull(representativePassportSeries), representativePassportNumber: orNull(representativePassportNumber),
						representativePassportIssuedBy: orNull(representativePassportIssuedBy),
						representativePassportIssuedAt: representativePassportIssuedAt ? new Date(`${representativePassportIssuedAt}T12:00:00`) : null,
						representativePassportDeptCode: orNull(representativePassportDeptCode),
						representativeProxyNumber: orNull(representativeProxyNumber),
						representativeProxyDate: representativeProxyDate ? new Date(`${representativeProxyDate}T12:00:00`) : null,
					} : {}),
				},
				select: { id: true, phone: true, email: true, aliases: true, name: true },
			})
			createdContractorId = contractor.id
		} else {
			const alias = contractorName.trim()
			const aliasIsNew = Boolean(alias) && normalizeCompanyName(alias) !== normalizeCompanyName(contractor.name) && !contractor.aliases.some((item) => normalizeCompanyName(item) === normalizeCompanyName(alias))
			if ((contractorPhone && !contractor.phone) || (contractorEmail && !contractor.email) || aliasIsNew) {
				await prisma.contractor.update({ where: { id: contractor.id }, data: { phone: contractor.phone ?? contractorPhone, email: contractor.email ?? contractorEmail, ...(aliasIsNew ? { aliases: { push: alias } } : {}) } })
			}
		}

		const contract = await prisma.contract.create({
			data: {
				number, date: new Date(`${date}T12:00:00.000Z`), amount: amount.toFixed(2), currency,
				kind, status: 'ACTIVE', contractorId: contractor.id, managerId: user.id,
				cipher: cipher || null, objectAddress: objectAddress || null,
				foundationType: foundationType || null, customerOwnSlab: customerOwnSlab === 'true',
			}, select: { id: true },
		})
		createdContractId = contract.id
		const saved = await saveContractFile({ contractId: contract.id, fileName: file.name, buffer })
		const primaryState = documentStateForPath(file.name)
		await createVersionedDocument({ contractId: contract.id, kind: 'CONTRACT', state: primaryState, fileName: file.name, storagePath: saved.storagePath, mimeType: saved.mimeType, sizeBytes: BigInt(saved.sizeBytes), sha256: saved.sha256, uploadedById: user.id })
		await writeImportEvent({ fileName: file.name, event: 'CONTRACT_CREATED', outcome: 'SUCCESS', contractId: contract.id, actorId: user.id, message: 'Основной файл договора сохранён.' })
		await trySyncWorkflowAfterDocumentUpload({ contractId: contract.id, actorId: user.id, kind: 'CONTRACT', state: primaryState })
		if (EXEC_TEMPLATES[kind].length) await prisma.executiveDoc.createMany({ data: EXEC_TEMPLATES[kind].map((name) => ({ contractId: contract.id, name })) })
		await grantDesignReadAccess(contract.id)

		let importedFiles = 1
		let skippedFiles = 0
		let automaticPr1SignedAt: Date | null = null
		const issues: string[] = []
		const skipAttachment = async (fileName: string, message: string) => {
			skippedFiles++
			if (issues.length < 20) issues.push(`${fileName}: ${message}`)
			await writeImportEvent({ fileName, event: 'MANUAL_IMPORTED', outcome: 'IGNORED', contractId: contract.id, actorId: user.id, message })
		}
		if (folderFiles.length > 0) {
			const [projectSections, executiveDocs] = await Promise.all([
				prisma.projectSection.findMany({ where: { contractId: contract.id, deletedAt: null } }),
				prisma.executiveDoc.findMany({ where: { contractId: contract.id, deletedAt: null } }),
			])
			for (let index = 0; index < folderFiles.length; index++) {
				const attachment = folderFiles[index]
				const relativePath = relativePaths[index] || attachment.name
				if (isTransientSystemFile(relativePath || attachment.name)) { await skipAttachment(attachment.name, 'Служебный временный файл Office — не импортирован.'); continue }
				if (attachment.size > MAX_UPLOAD_BYTES) { await skipAttachment(attachment.name, 'Файл больше допустимого размера.'); continue }
				try { assertSafeDocumentUpload(attachment.name) } catch (error) { await skipAttachment(attachment.name, error instanceof Error ? error.message : 'Недопустимый формат.'); continue }
				let savedPath: string | null = null
				try {
				const attachmentBuffer = Buffer.from(await attachment.arrayBuffer())
				const attachmentHash = sha256Buffer(attachmentBuffer)
				// File name and size are not a reliable identity. A distinct file with
				// the same name/size must not disappear from the imported package.
				if (attachmentHash === digest) continue
				if (await prisma.document.findFirst({ where: { contractId: contract.id, sha256: attachmentHash }, select: { id: true } })) { await skipAttachment(attachment.name, 'Точная копия уже есть в этом договоре.'); continue }
				const route = routeDocument(relativePath, routeRules)
				const documentKind = route.kind
				const documentState = route.state
				const searchable = relativePath.toLocaleLowerCase('ru-RU')
				const projectSection = await projectSectionForPath(contract.id, relativePath, projectSections, route.sectionCode)
				const executiveDoc = ['EXECUTIVE', 'ACT', 'CERTIFICATE'].includes(documentKind)
					? executiveDocs.find((doc) => {
						const name = doc.name.toLowerCase()
						return (/акт|аоср/i.test(searchable) && /акт|скрыт/i.test(name)) || (/сертификат|паспорт.*материал/i.test(searchable) && /сертификат/i.test(name)) || (/ожр|журнал/i.test(searchable) && /журнал/i.test(name)) || (/схем/i.test(searchable) && /схем/i.test(name)) || (/паспорт/i.test(searchable) && /паспорт/i.test(name))
					})
					: null
				const attachmentSaved = await saveContractFile({ contractId: contract.id, fileName: attachment.name, buffer: attachmentBuffer })
				savedPath = attachmentSaved.storagePath
				await createVersionedDocument({
					contractId: contract.id,
					kind: documentKind,
					state: documentState,
					fileName: attachment.name,
					storagePath: attachmentSaved.storagePath,
					mimeType: attachmentSaved.mimeType,
					sizeBytes: BigInt(attachmentSaved.sizeBytes),
					sha256: attachmentSaved.sha256,
					uploadedById: user.id,
					projectSectionId: projectSection?.id,
					executiveDocId: executiveDoc?.id,
					sourceDataKind: route.sourceDataKind,
					signedAt: route.pr1SignedAt ? new Date(`${route.pr1SignedAt}T12:00:00.000Z`) : undefined,
				})
				if (executiveDoc) await prisma.executiveDoc.update({ where: { id: executiveDoc.id }, data: { status: 'IN_PROGRESS' } })
				await trySyncWorkflowAfterDocumentUpload({ contractId: contract.id, actorId: user.id, kind: documentKind, state: documentState })
				const contractMatch = matchDocumentContract(route, [{ id: contract.id, number, cipher: cipher || null, date }])
				let warning = contractMatch.warning
				if (route.pr1SignedAt) {
					if (!contractMatch.contract) warning = `ПР1 не подтверждён: номер в имени не совпадает с договором № ${number}.`
					else automaticPr1SignedAt ??= new Date(`${route.pr1SignedAt}T12:00:00.000Z`)
				}
				await writeImportEvent({ fileName: attachment.name, event: 'MANUAL_IMPORTED', outcome: 'SUCCESS', contractId: contract.id, actorId: user.id, message: `Прикреплён как ${documentKind}.${warning ? ` Предупреждение: ${warning}` : ''}` })
				importedFiles++
					} catch (error) { if (savedPath) await removeUnlinkedUpload(savedPath); await skipAttachment(attachment.name, error instanceof Error ? error.message : 'Непредвиденная ошибка обработки файла.') }
			}
		}
		if (automaticPr1SignedAt) {
			const workflow = await tryConfirmSignedPr1Workflow({ contractId: contract.id, actorId: user.id, signedAt: automaticPr1SignedAt })
			if (workflow.error) {
				if (issues.length < 20) issues.push(`Подписанное ПР1: файл сохранён, но автоматическое подтверждение не выполнено: ${workflow.error}`)
				await writeImportEvent({ fileName: 'Подписанное ПР1', event: 'MANUAL_IMPORTED', outcome: 'FAILED', contractId: contract.id, actorId: user.id, message: workflow.error })
			}
		}
		await writeAudit({ userId: user.id, action: 'CREATE', entityType: 'ContractImport', entityId: contract.id })
		return NextResponse.json({ contractId: contract.id, importedFiles, skippedFiles, issues, parsingSkipped, contractorMatched: Boolean(match), contractorMatchReasons: match?.reasons ?? [] })
	} catch (error) {
		logger.error('contract_import.failed', { requestId, route: '/api/contracts/import', method: 'POST', userId: user.id, entityType: 'Contract', entityId: createdContractId ?? undefined, error })
		await writeImportEvent({ fileName: requestedFileName ?? 'Создание договора', event: 'CONTRACT_CREATED', outcome: 'FAILED', actorId: user.id, message: error instanceof Error ? error.message : 'Не удалось создать договор.' })
		if (createdContractId) await rollbackNewContractImport(createdContractId)
		await removeUnusedImportedContractor(createdContractorId)
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось создать договор' }, { status: 400 })
	}
}

export const POST = withApiAuth(post, { access: 'write', csrf: true, rateLimit: 'contract-import' })
