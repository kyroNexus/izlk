import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../src/lib/prisma'
import { advanceAfterProjectSectionsReady, confirmSignedPr1Workflow, syncWorkflowAfterDocumentUpload } from '../src/lib/contract-workflow'
import { contractScope, grantDesignReadAccess } from '../src/lib/access'
import { scanInbox, selectInboxOcrCandidates } from '../src/lib/inbox-scanner'
import { importInboxFile, INBOX_PATH, saveContractFile } from '../src/lib/storage'
import { writeImportEvent } from '../src/lib/audit'
import { rollbackNewContractImport } from '../src/lib/contract-import-cleanup'
import { createVersionedDocument } from '../src/lib/document-versioning'

const run = `TEST-AUTO-${randomUUID().slice(0, 8)}`
const scans = Array.from({ length: 40 }, (_, index) => path.join(INBOX_PATH, `archive-${String(index).padStart(3, '0')}.pdf`))
const preferredScan = path.join(INBOX_PATH, 'Договор 765 подписанный.pdf')
const selectedScans = selectInboxOcrCandidates([...scans, preferredScan])
assert.equal(selectedScans.size, 16, 'OCR must be bounded even for a large archive')
assert.ok(selectedScans.has(path.resolve(preferredScan)), 'A likely contract scan must win OCR priority')

async function main() {
	if (!process.env.DATABASE_URL?.includes('izlk_test')) throw new Error('Integration tests may run only against a database whose URL contains "izlk_test".')
	const manager = await prisma.user.create({ data: { login: `${run}-manager`, email: `${run}@test.local`, passwordHash: 'test-only', name: 'Автотест Менеджер', role: 'MANAGER' } })
	const designer = await prisma.user.create({ data: { login: `${run}-designer`, email: `${run}@test.local`, passwordHash: 'test-only', name: 'Автотест Проектировщик', role: 'DESIGNER' } })
	const contractor = await prisma.contractor.create({ data: { name: `Контрагент ${run}`, inn: null } })
	let contractId = ''
	try {
		const contract = await prisma.contract.create({ data: { number: run, contractorId: contractor.id, managerId: manager.id, date: new Date('2026-08-07T12:00:00Z'), amount: '5600000.00', kind: 'SMR', objectAddress: 'Тестовый адрес' } })
		contractId = contract.id
		// A failure after an ID/file was allocated must leave no ghost contract.
		const interrupted = await prisma.contract.create({ data: { number: `${run}-ROLLBACK`, contractorId: contractor.id, managerId: manager.id, date: new Date('2026-08-07T12:00:00Z'), amount: '1.00', kind: 'SMR' } })
		const interruptedFile = await saveContractFile({ contractId: interrupted.id, fileName: 'interrupted.txt', buffer: Buffer.from('partial import') })
		await prisma.document.create({ data: { contractId: interrupted.id, kind: 'OTHER', state: 'SOURCE', fileName: 'interrupted.txt', storagePath: interruptedFile.storagePath, sizeBytes: BigInt(interruptedFile.sizeBytes), sha256: interruptedFile.sha256 } })
		await rollbackNewContractImport(interrupted.id)
		assert.equal(await prisma.contract.findUnique({ where: { id: interrupted.id } }), null, 'A failed import must not leave an empty contract card')
		// Storage may contain the original supplied file. Rolling back the database
		// must not remove it until the retention policy is explicitly agreed.
		assert.equal((await readFile(interruptedFile.storagePath)).toString(), 'partial import', 'A failed import must preserve the stored original')
		await grantDesignReadAccess(contract.id)
		const visible = await prisma.contract.findFirst({ where: { id: contract.id, ...contractScope({ id: designer.id, role: 'DESIGNER' }) } })
		assert.ok(visible, 'New contract must be visible to a designer')

		// A changed file with the same human-readable name is a new version,
		// while the old one is retained only in the archive.
		const versionOne = await createVersionedDocument({ contractId: contract.id, kind: 'OTHER', state: 'SOURCE', fileName: 'Смета.xlsx', storagePath: '/test/estimate-v1.xlsx', sizeBytes: BigInt(10), sha256: `estimate-v1-${run}` })
		const versionTwo = await createVersionedDocument({ contractId: contract.id, kind: 'OTHER', state: 'SOURCE', fileName: 'Смета.xlsx', storagePath: '/test/estimate-v2.xlsx', sizeBytes: BigInt(11), sha256: `estimate-v2-${run}` })
		assert.equal(versionOne.version, 1, 'The first variant must start at version 1')
		assert.equal(versionTwo.version, 2, 'A changed same-name file must become version 2')
		assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: versionOne.id } })).state, 'ARCHIVE', 'The replaced variant must leave the active file list')
		assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: versionTwo.id } })).state, 'SOURCE', 'The newest variant must remain active')

		await prisma.document.create({ data: { contractId: contract.id, kind: 'CONTRACT', state: 'SOURCE', fileName: `${run}-contract.pdf`, storagePath: '/test/contract.pdf', sizeBytes: BigInt(10), sha256: `source-${run}` } })
		// Shared templates/certificates are valid across contracts, but not twice in one.
		const sibling = await prisma.contract.create({ data: { number: `${run}-SECOND`, contractorId: contractor.id, managerId: manager.id, date: new Date('2026-08-07T12:00:00Z'), amount: '1.00', kind: 'SMR' } })
		await prisma.document.create({ data: { contractId: sibling.id, kind: 'CERTIFICATE', state: 'SOURCE', fileName: `${run}-certificate.pdf`, storagePath: '/test/certificate.pdf', sizeBytes: BigInt(10), sha256: `source-${run}` } })
		await assert.rejects(() => prisma.document.create({ data: { contractId: contract.id, kind: 'CERTIFICATE', state: 'SOURCE', fileName: `${run}-duplicate.pdf`, storagePath: '/test/duplicate.pdf', sizeBytes: BigInt(10), sha256: `source-${run}` } }))
		await prisma.document.deleteMany({ where: { contractId: sibling.id } })
		await prisma.contract.delete({ where: { id: sibling.id } })
		const inboxRoot = path.join(INBOX_PATH, run)
		const inboxA = path.join(inboxRoot, 'A', 'certificate.pdf')
		const inboxB = path.join(inboxRoot, 'B', 'certificate.pdf')
		await mkdir(path.dirname(inboxA), { recursive: true })
		await mkdir(path.dirname(inboxB), { recursive: true })
		await writeFile(inboxA, 'shared certificate test')
		await writeFile(inboxB, 'shared certificate test')
		await scanInbox()
		assert.equal(await prisma.inboxItem.count({ where: { sourcePath: { in: [inboxA, inboxB] } } }), 2, 'The same file from two folders must remain visible to the Inbox')
		// A changed file with the same network path is a new version, not a duplicate.
		await writeFile(inboxA, 'shared certificate test — revised')
		await scanInbox()
		assert.equal(await prisma.inboxItem.count({ where: { sourcePath: inboxA } }), 2, 'A changed file at the same path must be queued as a new version')
		await assert.rejects(() => importInboxFile({ contractId: contract.id, sourcePath: inboxA, fileName: 'certificate.pdf', expectedSha256: '0'.repeat(64) }), 'A source file changed after scanning must not be copied into the contract')
		const duplicateSource = path.join(inboxRoot, 'existing', `Договор ${run} — копия.txt`)
		const duplicateContent = Buffer.from(`Договор № ${run}\nКонтрагент: тест`)
		await mkdir(path.dirname(duplicateSource), { recursive: true })
		await writeFile(duplicateSource, duplicateContent)
		const duplicateHash = createHash('sha256').update(duplicateContent).digest('hex')
		await prisma.document.create({ data: { contractId: contract.id, kind: 'OTHER', state: 'SOURCE', fileName: 'already-attached.txt', storagePath: '/test/already-attached.txt', sizeBytes: BigInt(duplicateContent.length), sha256: duplicateHash } })
		await scanInbox()
		const ignoredDuplicate = await prisma.inboxItem.findFirstOrThrow({ where: { sourcePath: duplicateSource, sha256: duplicateHash } })
		assert.equal(ignoredDuplicate.status, 'IGNORED', 'A scanner duplicate must be retained as an ignored queue record')
		assert.equal(await prisma.importEvent.count({ where: { inboxItemId: ignoredDuplicate.id, outcome: 'IGNORED' } }), 1, 'A scanner duplicate must have an explainable journal event')
		const inboxItem = await prisma.inboxItem.findFirstOrThrow({ where: { sourcePath: inboxA }, orderBy: { createdAt: 'desc' } })
		await writeImportEvent({ inboxItemId: inboxItem.id, fileName: inboxItem.fileName, event: 'AUTO_IMPORT_FAILED', outcome: 'FAILED', actorId: manager.id, message: 'Synthetic import failure for audit-log verification.' })
		assert.equal(await prisma.importEvent.count({ where: { inboxItemId: inboxItem.id, actorId: manager.id, outcome: 'FAILED' } }), 1, 'The import journal must preserve the actor, result and failure reason')
		await prisma.inboxItem.deleteMany({ where: { sourcePath: { startsWith: inboxRoot } } })
		await rm(inboxRoot, { recursive: true, force: true })
		await syncWorkflowAfterDocumentUpload({ contractId: contract.id, actorId: manager.id, kind: 'CONTRACT', state: 'SOURCE' })
		assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).workflowStage, 'AWAITING_CONTRACT_SIGNATURE')

		await prisma.document.create({ data: { contractId: contract.id, kind: 'CONTRACT', state: 'SIGNED', fileName: `${run}-signed.pdf`, storagePath: '/test/signed.pdf', sizeBytes: BigInt(11), sha256: `signed-${run}` } })
		await syncWorkflowAfterDocumentUpload({ contractId: contract.id, actorId: manager.id, kind: 'CONTRACT', state: 'SIGNED' })
		await confirmSignedPr1Workflow({ contractId: contract.id, actorId: manager.id, signedAt: new Date('2026-08-08T12:00:00Z'), workingDays: 20 })
		const afterPr1 = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id }, include: { projectSections: true, sites: true } })
		assert.equal(afterPr1.workflowStage, 'DESIGN')
		assert.equal(afterPr1.projectSections.length, 2)
		assert.equal(afterPr1.sites.length, 1)

		const kmSection = afterPr1.projectSections.find((section) => section.code === 'KM')
		assert.ok(kmSection, 'PR1 must create the KM design section')
		await prisma.document.create({ data: { contractId: contract.id, projectSectionId: kmSection.id, kind: 'PROJECT_PDF', state: 'SOURCE', fileName: `${run}-km-final.pdf`, storagePath: '/test/km-final.pdf', sizeBytes: BigInt(11), sha256: `km-final-${run}` } })
		await prisma.projectSection.updateMany({ where: { contractId: contract.id }, data: { queueStatus: 'DONE' } })
		assert.equal(await advanceAfterProjectSectionsReady(contract.id, manager.id), true)
		assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).workflowStage, 'WAITING_PRODUCTION')
		console.log('Integration flow passed: contract → designer access → documents → PR1 → design → production queue.')
	} finally {
		if (contractId) {
			await prisma.contractAccess.deleteMany({ where: { contractId } })
			await prisma.document.deleteMany({ where: { contractId } })
			await prisma.task.deleteMany({ where: { contractId } })
			await prisma.projectSection.deleteMany({ where: { contractId } })
			await prisma.site.deleteMany({ where: { contractId } })
			await prisma.contractStageHistory.deleteMany({ where: { contractId } })
			await prisma.executiveDoc.deleteMany({ where: { contractId } })
			await prisma.contract.deleteMany({ where: { id: contractId } })
		}
		await prisma.notification.deleteMany({ where: { userId: { in: [manager.id, designer.id] } } })
		await prisma.contractor.delete({ where: { id: contractor.id } })
		await prisma.user.deleteMany({ where: { id: { in: [manager.id, designer.id] } } })
		await prisma.$disconnect()
	}
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
