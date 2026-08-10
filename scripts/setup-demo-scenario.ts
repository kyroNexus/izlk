import bcrypt from 'bcryptjs'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'
import { PrismaClient, type DocumentKind, type DocumentState } from '@prisma/client'
import { saveContractFile, saveSitePhoto } from '../src/lib/storage'

const prisma = new PrismaClient()
const root = process.cwd()
const sourceRoot = path.join(root, 'ТЕСТОВЫЕ_ДОКУМЕНТЫ_ДЛЯ_ЗАГРУЗКИ')

async function main() {
  const managerPassword = 'Manager-Demo-2026!'
  const designerPassword = 'Designer-Demo-2026!'
  const [manager, designer] = await Promise.all([
    prisma.user.upsert({
      where: { login: 'manager.demo@izlk.ru' },
      update: { name: 'Максим Демо', role: 'MANAGER', isActive: true, deletedAt: null, passwordHash: await bcrypt.hash(managerPassword, 12) },
      create: { login: 'manager.demo@izlk.ru', email: 'manager.demo@izlk.ru', name: 'Максим Демо', role: 'MANAGER', isActive: true, passwordHash: await bcrypt.hash(managerPassword, 12) },
    }),
    prisma.user.upsert({
      where: { login: 'designer.demo@izlk.ru' },
      update: { name: 'Андрей Проектировщик', role: 'DESIGNER', isActive: true, deletedAt: null, passwordHash: await bcrypt.hash(designerPassword, 12) },
      create: { login: 'designer.demo@izlk.ru', email: 'designer.demo@izlk.ru', name: 'Андрей Проектировщик', role: 'DESIGNER', isActive: true, passwordHash: await bcrypt.hash(designerPassword, 12) },
    }),
  ])

  const contractor = await prisma.contractor.upsert({
    where: { id: 'demo-contractor-2026' },
    update: { name: 'ООО «Демонстрационный заказчик»', inn: '7707001001', phone: '+7 (495) 700-10-01', email: 'demo@customer.example', address: 'г. Москва, Проектный проезд, д. 12' },
    create: { id: 'demo-contractor-2026', name: 'ООО «Демонстрационный заказчик»', inn: '7707001001', phone: '+7 (495) 700-10-01', email: 'demo@customer.example', address: 'г. Москва, Проектный проезд, д. 12' },
  })

  const contract = await prisma.contract.upsert({
    where: { number: 'ДЕМО-2026-001' },
    update: { managerId: manager.id, contractorId: contractor.id, status: 'ACTIVE', amount: 18750000, objectAddress: 'г. Москва, Проектный проезд, д. 12', cipher: 'КБ-ДЕМО.26.01' },
    create: { number: 'ДЕМО-2026-001', cipher: 'КБ-ДЕМО.26.01', kind: 'SMR', contractorId: contractor.id, managerId: manager.id, date: new Date('2026-08-01'), amount: 18750000, currency: 'RUB', status: 'ACTIVE', objectAddress: 'г. Москва, Проектный проезд, д. 12' },
  })

  await prisma.document.deleteMany({ where: { contractId: contract.id } })
  await prisma.projectSection.deleteMany({ where: { contractId: contract.id } })
  const existingSite = await prisma.site.findUnique({ where: { contractId: contract.id }, select: { id: true } })
  if (existingSite) await prisma.site.delete({ where: { id: existingSite.id } })
  await prisma.executiveDoc.deleteMany({ where: { contractId: contract.id } })

  const km = await prisma.projectSection.create({ data: { contractId: contract.id, code: 'KM', responsibleId: designer.id, queueStatus: 'DONE', queuePosition: 10, durationDays: 5, dateFrom: new Date('2026-08-01'), dateTo: new Date('2026-08-04'), deadline: new Date('2026-08-07'), comment: 'Демонстрационный раздел завершён и передан менеджеру' } })
  const kzh = await prisma.projectSection.create({ data: { contractId: contract.id, code: 'KZH', responsibleId: designer.id, queueStatus: 'IN_PROGRESS', queuePosition: 20, durationDays: 4, dateFrom: new Date('2026-08-05'), deadline: new Date('2026-08-10'), comment: 'В работе: выпуск рабочей документации' } })

  const execPassport = await prisma.executiveDoc.create({ data: { contractId: contract.id, name: 'Паспорт на каркас', status: 'READY' } })
  const execActs = await prisma.executiveDoc.create({ data: { contractId: contract.id, name: 'Акты скрытых работ', status: 'IN_PROGRESS' } })
  await prisma.executiveDoc.create({ data: { contractId: contract.id, name: 'ОЖР', status: 'NOT_READY' } })

  async function addPdf(input: { source: string; fileName: string; kind: DocumentKind; state?: DocumentState; marker: string; signedAt?: Date; projectSectionId?: string; executiveDocId?: string }) {
    const original = await readFile(path.join(sourceRoot, input.source))
    const buffer = Buffer.concat([original, Buffer.from(`\n% IZLK DEMO ${input.marker}\n`)])
    const saved = await saveContractFile({ contractId: contract.id, fileName: input.fileName, buffer })
    await prisma.document.create({ data: { contractId: contract.id, fileName: input.fileName, kind: input.kind, state: input.state ?? 'SOURCE', signedAt: input.signedAt, projectSectionId: input.projectSectionId, executiveDocId: input.executiveDocId, uploadedById: input.projectSectionId ? designer.id : manager.id, storagePath: saved.storagePath, sha256: saved.sha256, sizeBytes: BigInt(saved.sizeBytes), mimeType: saved.mimeType } })
  }

  const contractPdf = '01_Парсер_договора/Договор_ТЕСТ-701-ИЗЛК-СМР-2026.pdf'
  const invoicePdf = '02_Хронология_договора/Счет_01_ТЕСТ-701-ИЗЛК-СМР-2026.pdf'
  await addPdf({ source: contractPdf, fileName: 'Договор_ДЕМО-2026-001_исходник.pdf', kind: 'CONTRACT', state: 'SOURCE', marker: 'contract-source' })
  await addPdf({ source: invoicePdf, fileName: 'Смета_ДЕМО-2026-001_актуальная.pdf', kind: 'ESTIMATE', state: 'SOURCE', marker: 'estimate-source' })
  await addPdf({ source: contractPdf, fileName: 'Договор_ДЕМО-2026-001_подписанный.pdf', kind: 'SIGNED_SCAN', state: 'SIGNED', signedAt: new Date('2026-08-02'), marker: 'contract-signed' })
  await addPdf({ source: '03_Проект/АР_КБ-701.26.10.01.01.pdf', fileName: 'Приложение_№1_подписанное.pdf', kind: 'APPENDIX', state: 'SIGNED', signedAt: new Date('2026-08-03'), marker: 'pr1-signed' })
  await addPdf({ source: contractPdf, fileName: 'Договор_редакция_переговоров_архив.pdf', kind: 'CONTRACT', state: 'ARCHIVE', marker: 'contract-archive' })
  await addPdf({ source: '03_Проект/КМ_КБ-701.26.10.01.01.pdf', fileName: 'КМ_КБ-ДЕМО.26.01.pdf', kind: 'PROJECT_PDF', projectSectionId: km.id, marker: 'km-pdf' })
  const dwgBuffer = Buffer.from('IZLK DEMO DWG\nSECTION KM\nCIPHER KB-DEMO.26.01\n')
  const dwg = await saveContractFile({ contractId: contract.id, fileName: 'КМ_КБ-ДЕМО.26.01.dwg', buffer: dwgBuffer })
  await prisma.document.create({ data: { contractId: contract.id, fileName: 'КМ_КБ-ДЕМО.26.01.dwg', kind: 'PROJECT_DWG', state: 'SOURCE', projectSectionId: km.id, uploadedById: designer.id, storagePath: dwg.storagePath, sha256: dwg.sha256, sizeBytes: BigInt(dwg.sizeBytes), mimeType: dwg.mimeType } })
  await addPdf({ source: '03_Проект/КЖ_КБ-701.26.10.01.01.pdf', fileName: 'КЖ_КБ-ДЕМО.26.01_в_работе.pdf', kind: 'PROJECT_PDF', projectSectionId: kzh.id, marker: 'kzh-pdf' })
  await addPdf({ source: '04_Исполнительная_документация/Сертификат_на_металл_ТЕСТ-701-ИЗЛК-СМР-2026.pdf', fileName: 'Паспорт_на_каркас_ДЕМО.pdf', kind: 'EXECUTIVE', executiveDocId: execPassport.id, marker: 'exec-passport' })
  await addPdf({ source: '04_Исполнительная_документация/Схема_расположения_ТЕСТ-701-ИЗЛК-СМР-2026.pdf', fileName: 'Акт_скрытых_работ_ДЕМО.pdf', kind: 'ACT', executiveDocId: execActs.id, marker: 'exec-act' })

  const demoDocuments = await prisma.document.findMany({ where: { contractId: contract.id }, select: { id: true, uploadedById: true }, orderBy: { createdAt: 'asc' } })
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityType: 'Contract', entityId: contract.id }, { entityId: { in: demoDocuments.map((document) => document.id) } }] } })
  await prisma.auditLog.create({ data: { userId: manager.id, action: 'CREATE', entityType: 'Contract', entityId: contract.id, createdAt: new Date('2026-08-01T09:00:00') } })
  await prisma.auditLog.createMany({ data: demoDocuments.map((document, index) => ({ userId: document.uploadedById ?? manager.id, action: 'UPLOAD' as const, entityType: 'Document', entityId: document.id, createdAt: new Date(Date.UTC(2026, 7, 2 + Math.min(index, 3), 9 + index, 15) ) })) })

  const site = await prisma.site.create({ data: { contractId: contract.id, address: 'г. Москва, Проектный проезд, д. 12', status: 'PREPARING' } })
  await prisma.siteEvent.createMany({ data: [
    { siteId: site.id, type: 'INFO', text: 'Площадка создана автоматически после подтверждения подписанного ПР1', occurredAt: new Date('2026-08-03T10:00:00') },
    { siteId: site.id, type: 'SUCCESS', text: 'Получен допуск на площадку, начата подготовка', occurredAt: new Date('2026-08-04T09:30:00') },
  ] })
  const workKj = await prisma.siteWork.create({ data: { siteId: site.id, direction: 'KJ', workDate: new Date('2026-08-04'), stage: 'Армирование и подготовка фундаментов', crewCount: 5, crewCost: 45000, equipmentCost: 28000, materialCost: 136500, otherCost: 4500, comment: 'Работы выполнены по графику', crewEntries: { create: [{ name: 'Бригада Иванова', workDays: 1, rate: 45000 }] }, costItems: { create: [{ category: 'MATERIAL', name: 'Арматура А500С', paymentType: 'CASHLESS', quantity: 2.5, unit: 'т', unitPrice: 54600 }, { category: 'EQUIPMENT', name: 'Автобетононасос', paymentType: 'CASHLESS', quantity: 4, unit: 'ч', unitPrice: 7000 }] } } })
  await prisma.siteWork.create({ data: { siteId: site.id, direction: 'KM', workDate: new Date('2026-08-05'), stage: 'Разгрузка и укрупнительная сборка КМ', crewCount: 4, crewCost: 38000, equipmentCost: 32000, materialCost: 12500, otherCost: 0, comment: 'Принято 12 монтажных марок' } })

  const photoPaths = [
    'C:/Users/Илья/Downloads/Telegram Desktop/photo_2026-07-31_18-15-56.jpg',
    'C:/Users/Илья/Downloads/Telegram Desktop/photo_2026-08-03_10-34-18.jpg',
    'C:/Users/Илья/Downloads/Telegram Desktop/photo_2026-08-03_10-34-22.jpg',
    'C:/Users/Илья/Downloads/Telegram Desktop/photo_2026-08-03_10-34-30.jpg',
  ]
  for (const [index, photoPath] of photoPaths.entries()) {
    if (!existsSync(photoPath)) continue
    const buffer = await readFile(photoPath)
    const saved = await saveSitePhoto({ siteId: site.id, workId: workKj.id, fileName: `Фото_отчёт_${index + 1}.jpg`, buffer })
    await prisma.sitePhoto.create({ data: { siteWorkId: workKj.id, ...saved, sizeBytes: BigInt(saved.sizeBytes) } })
  }

  await prisma.notification.deleteMany({ where: { OR: [{ userId: manager.id }, { userId: designer.id }] } })
  await prisma.notification.createMany({ data: [
    { userId: manager.id, type: 'INFO', title: 'ПР1 подписан заказчиком', message: 'Договор № ДЕМО-2026-001: площадка и очередь проектирования запущены', href: `/contracts/${contract.id}`, dedupeKey: `demo-pr1:${contract.id}` },
    { userId: manager.id, type: 'READY', title: 'Раздел КМ готов', message: 'Проектировщик завершил раздел по договору № ДЕМО-2026-001', href: `/contracts/${contract.id}`, dedupeKey: `demo-ready:${km.id}` },
    { userId: designer.id, type: 'ASSIGNMENT', title: 'Назначен раздел КЖ', message: 'Договор № ДЕМО-2026-001 добавлен в вашу очередь', href: '/projects?section=KZH', dedupeKey: `demo-assignment:${kzh.id}` },
    { userId: designer.id, type: 'DEADLINE', title: 'Срок раздела КЖ приближается', message: 'Завершить раздел по договору № ДЕМО-2026-001 до 10.08.2026', href: '/projects?section=KZH', dedupeKey: `deadline:${kzh.id}:2026-08-10` },
  ] })

  console.log(JSON.stringify({ contractId: contract.id, manager: { email: manager.email, password: managerPassword }, designer: { email: designer.email, password: designerPassword }, documents: 10, photos: photoPaths.filter(existsSync).length }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
