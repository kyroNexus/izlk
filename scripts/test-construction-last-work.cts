/**
 * A5: reproduces the exact "lost KZH" scenario — a site with 25 KM reports
 * and one much older KJ report. The old take:20-most-recent heuristic would
 * never see the KJ row at all; groupBy's real per-direction max must.
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'

async function main() {
	const contractor = await prisma.contractor.findFirst({ select: { id: true } })
	if (!contractor) { console.log('no fixture data on this db — skipping'); return }

	const contract = await prisma.contract.create({ data: { number: `TMP-A5-${Date.now()}`, contractorId: contractor.id, date: new Date(), amount: 1000 } })
	const site = await prisma.site.create({ data: { contractId: contract.id, address: 'test site' } })

	try {
		const oldKjDate = new Date('2026-01-05')
		await prisma.siteWork.create({ data: { siteId: site.id, direction: 'KJ', workDate: oldKjDate, stage: 'КЖ старт' } })
		for (let i = 0; i < 25; i++) {
			await prisma.siteWork.create({ data: { siteId: site.id, direction: 'KM', workDate: new Date(`2026-02-${String(1 + (i % 28)).padStart(2, '0')}`), stage: `КМ ${i}` } })
		}
		const latestKmDate = new Date('2026-03-01')
		await prisma.siteWork.create({ data: { siteId: site.id, direction: 'KM', workDate: latestKmDate, stage: 'КМ последний' } })

		// What the old code did: take the 20 most recent works overall, then find() by direction.
		const last20 = await prisma.siteWork.findMany({ where: { siteId: site.id }, orderBy: { workDate: 'desc' }, take: 20, select: { direction: true, workDate: true } })
		const oldWayKzh = last20.find((w) => w.direction === 'KJ')
		assert.equal(oldWayKzh, undefined, 'sanity check: this is exactly the bug — 20 newest works are all KM, KJ falls out of the window')

		// What the fixed code does: a real per-direction max via groupBy.
		const grouped = await prisma.siteWork.groupBy({ by: ['siteId', 'direction'], where: { siteId: site.id }, _max: { workDate: true } })
		const map = new Map(grouped.map((row) => [`${row.siteId}:${row.direction}`, row._max.workDate]))
		assert.deepEqual(map.get(`${site.id}:KJ`), oldKjDate, 'groupBy must still find the KJ date even though it is not in the 20 most recent rows')
		assert.deepEqual(map.get(`${site.id}:KM`), latestKmDate, 'groupBy must return the true latest KM date')

		console.log('Construction last-work-date checks passed: groupBy finds KZH that the take:20 heuristic lost.')
	} finally {
		await prisma.siteWork.deleteMany({ where: { siteId: site.id } })
		await prisma.site.delete({ where: { id: site.id } })
		await prisma.contract.delete({ where: { id: contract.id } })
	}
}

main().finally(() => prisma.$disconnect())
