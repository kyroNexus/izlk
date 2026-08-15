/**
 * C5: the two new XLSX exports must use the exact same scope as their pages
 * (a MANAGER exporting must not see another manager's contracts in the
 * file) and must carry over the existing formula-injection escaping.
 */
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { prisma } from '../src/lib/prisma'
import { createProductionScheduleWorkbook, createConstructionScheduleWorkbook } from '../src/lib/report-xlsx'

function sheetRows(buffer: Buffer, sheetName: string) {
	const book = XLSX.read(buffer, { type: 'buffer' })
	const sheet = book.Sheets[sheetName]
	return XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][]
}

async function main() {
	const stamp = Date.now()
	const managerA = await prisma.user.create({ data: { login: `test-mgrA-${stamp}`, email: `test-mgrA-${stamp}@example.invalid`, passwordHash: 'x', name: 'Manager A', role: 'MANAGER' } })
	const managerB = await prisma.user.create({ data: { login: `test-mgrB-${stamp}`, email: `test-mgrB-${stamp}@example.invalid`, passwordHash: 'x', name: 'Manager B', role: 'MANAGER' } })
	const contractor = await prisma.contractor.create({ data: { name: `Test Contractor ${stamp}` } })
	const contractA = await prisma.contract.create({ data: { number: `TMP-C5A-${stamp}`, contractorId: contractor.id, managerId: managerA.id, date: new Date(), amount: 1000, workflowStage: 'WAITING_PRODUCTION' } })
	const contractB = await prisma.contract.create({ data: { number: `TMP-C5B-${stamp}`, contractorId: contractor.id, managerId: managerB.id, date: new Date(), amount: 1000, workflowStage: 'WAITING_PRODUCTION' } })
	await prisma.productionPlan.create({ data: { contractId: contractA.id, note: '=2+2 formula-looking note', priority: 'HIGH' } })

	const constructionA = await prisma.contract.create({ data: { number: `TMP-C5CA-${stamp}`, contractorId: contractor.id, managerId: managerA.id, date: new Date(), amount: 1000, workflowStage: 'INSTALL_KZH' } })
	const constructionB = await prisma.contract.create({ data: { number: `TMP-C5CB-${stamp}`, contractorId: contractor.id, managerId: managerB.id, date: new Date(), amount: 1000, workflowStage: 'INSTALL_KZH' } })
	const site = await prisma.site.create({ data: { contractId: constructionA.id, address: 'test site' } })
	const kzhDate = new Date('2026-02-01')
	await prisma.siteWork.create({ data: { siteId: site.id, direction: 'KJ', workDate: kzhDate, stage: 'test' } })

	try {
		// Production schedule: manager A's export must contain their own contract, not manager B's.
		const prodBuffer = await createProductionScheduleWorkbook(managerA)
		const prodRows = sheetRows(prodBuffer, 'График производства')
		const prodBodyText = JSON.stringify(prodRows)
		assert.ok(prodBodyText.includes(`TMP-C5A-${stamp}`), 'export must include the exporting manager\'s own contract')
		assert.ok(!prodBodyText.includes(`TMP-C5B-${stamp}`), 'export must not leak another manager\'s contract')
		assert.ok(prodBodyText.includes("'=2+2"), 'a note starting with = must be escaped with a leading apostrophe, not left as a live formula')
		assert.ok(prodBodyText.includes('Высокий'), 'priority must be shown as its Russian label, not the raw enum value')

		// Construction schedule: same scope rule, plus the real per-direction last-work date (A5's fix), not a heuristic.
		const buildBuffer = await createConstructionScheduleWorkbook(managerA)
		const buildRows = sheetRows(buildBuffer, 'График стройотдела')
		const buildBodyText = JSON.stringify(buildRows)
		assert.ok(buildBodyText.includes(`TMP-C5CA-${stamp}`), 'construction export must include the exporting manager\'s own contract')
		assert.ok(!buildBodyText.includes(`TMP-C5CB-${stamp}`), 'construction export must not leak another manager\'s contract')
		const dataRow = buildRows.find((row) => row[0] === `TMP-C5CA-${stamp}`)
		assert.ok(dataRow, 'the exported row for the construction contract must exist')
		assert.equal(dataRow![7], '01.02.2026', 'КЖ column must carry the real last work date for that direction')

		console.log('Schedule export checks passed: contractScope enforced on both exports, formula escaping, real KZH date carried through.')
	} finally {
		await prisma.siteWork.deleteMany({ where: { siteId: site.id } })
		await prisma.site.delete({ where: { id: site.id } })
		await prisma.productionPlan.deleteMany({ where: { contractId: contractA.id } })
		await prisma.contract.deleteMany({ where: { id: { in: [contractA.id, contractB.id, constructionA.id, constructionB.id] } } })
		await prisma.contractor.delete({ where: { id: contractor.id } })
		await prisma.user.deleteMany({ where: { id: { in: [managerA.id, managerB.id] } } })
	}
}

main().finally(() => prisma.$disconnect())
