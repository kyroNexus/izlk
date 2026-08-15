/**
 * A2: chat GET now pages instead of loading the whole thread. This exercises
 * the same three query shapes the route uses (initial page, before-cursor,
 * after-cursor) directly against Prisma, plus the cross-thread cursor guard.
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'

const PAGE_SIZE = 50

async function ownCursor(threadId: string, id: string | null) {
	if (!id) return undefined
	const message = await prisma.chatMessage.findFirst({ where: { id, threadId }, select: { id: true } })
	return message?.id
}

async function firstPage(threadId: string) {
	const rows = await prisma.chatMessage.findMany({ where: { threadId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: PAGE_SIZE + 1 })
	const hasMore = rows.length > PAGE_SIZE
	return { hasMore, page: (hasMore ? rows.slice(0, PAGE_SIZE) : rows).reverse() }
}

async function olderPage(threadId: string, before: string) {
	const rows = await prisma.chatMessage.findMany({ where: { threadId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: PAGE_SIZE + 1, cursor: { id: before }, skip: 1 })
	const hasMore = rows.length > PAGE_SIZE
	return { hasMore, page: (hasMore ? rows.slice(0, PAGE_SIZE) : rows).reverse() }
}

async function newerSince(threadId: string, after: string) {
	return prisma.chatMessage.findMany({ where: { threadId, deletedAt: null }, orderBy: { createdAt: 'asc' }, cursor: { id: after }, skip: 1, take: 200 })
}

async function main() {
	const user = await prisma.user.findFirst({ select: { id: true } })
	if (!user) { console.log('no fixture user on this db — skipping'); return }

	const thread = await prisma.chatThread.create({ data: { key: `test-pagination-${Date.now()}`, scope: 'DEPARTMENT', department: 'production' } })
	const otherThread = await prisma.chatThread.create({ data: { key: `test-pagination-other-${Date.now()}`, scope: 'DEPARTMENT', department: 'construction' } })

	try {
		const TOTAL = 62
		const base = Date.now() - TOTAL * 1000
		const created = []
		for (let i = 0; i < TOTAL; i++) {
			created.push(await prisma.chatMessage.create({ data: { threadId: thread.id, authorId: user.id, text: `msg-${i}`, createdAt: new Date(base + i * 1000) } }))
		}
		const foreignMessage = await prisma.chatMessage.create({ data: { threadId: otherThread.id, authorId: user.id, text: 'from another thread', createdAt: new Date(base) } })

		// Initial page: newest 50, ascending, hasMore true (62 > 50).
		const page1 = await firstPage(thread.id)
		assert.equal(page1.hasMore, true, 'first page must report hasMore when the thread has more than PAGE_SIZE messages')
		assert.equal(page1.page.length, PAGE_SIZE)
		assert.equal(page1.page[0].text, 'msg-12', 'first page must start at the 13th message (62 - 50), not the very first')
		assert.equal(page1.page[PAGE_SIZE - 1].text, `msg-${TOTAL - 1}`, 'first page must end at the newest message')
		assert.ok(page1.page.every((m, i) => i === 0 || m.createdAt >= page1.page[i - 1].createdAt), 'page must be in ascending order')

		// Older page: "Показать раньше" from the oldest message currently shown.
		const older = await olderPage(thread.id, page1.page[0].id)
		assert.equal(older.hasMore, false, 'only 12 messages remain before msg-12, must fit in one page with hasMore=false')
		assert.equal(older.page.length, 12)
		assert.equal(older.page[0].text, 'msg-0')
		assert.equal(older.page[older.page.length - 1].text, 'msg-11')

		// Polling: only messages strictly after the last one the client already has.
		const noNew = await newerSince(thread.id, page1.page[PAGE_SIZE - 1].id)
		assert.equal(noNew.length, 0, 'polling right after the newest message must return nothing yet')
		const freshMessage = await prisma.chatMessage.create({ data: { threadId: thread.id, authorId: user.id, text: 'msg-new', createdAt: new Date(base + TOTAL * 1000) } })
		const oneNew = await newerSince(thread.id, page1.page[PAGE_SIZE - 1].id)
		assert.equal(oneNew.length, 1)
		assert.equal(oneNew[0].id, freshMessage.id)

		// Cross-thread cursor guard: a message id from a different thread must not be usable as a cursor here.
		const guarded = await ownCursor(thread.id, foreignMessage.id)
		assert.equal(guarded, undefined, 'a cursor belonging to another thread must be rejected, not silently accepted')
		const guardedOwn = await ownCursor(thread.id, page1.page[0].id)
		assert.equal(guardedOwn, page1.page[0].id, 'a cursor belonging to this thread must pass through unchanged')

		console.log('Chat pagination checks passed: page size, ordering, older-page boundary, polling cursor, cross-thread guard.')
	} finally {
		await prisma.chatMessage.deleteMany({ where: { threadId: { in: [thread.id, otherThread.id] } } })
		await prisma.chatThread.deleteMany({ where: { id: { in: [thread.id, otherThread.id] } } })
	}
}

main().finally(() => prisma.$disconnect())
