/**
 * C4: a chat message notifies the thread's other participants (and, for
 * contract chats, the manager even on a first message) — not the message
 * text itself, deduped to one row per (user, thread), reopened unread on a
 * new message even if the user had already read the previous one.
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { notifyChatParticipants } from '../src/lib/chat'

async function main() {
	const stamp = Date.now()
	const manager = await prisma.user.create({ data: { login: `test-mgr-${stamp}`, email: `test-mgr-${stamp}@example.invalid`, passwordHash: 'x', name: 'Test Manager', role: 'MANAGER' } })
	const author = await prisma.user.create({ data: { login: `test-author-${stamp}`, email: `test-author-${stamp}@example.invalid`, passwordHash: 'x', name: 'Test Author', role: 'MANAGER' } })
	const participant = await prisma.user.create({ data: { login: `test-participant-${stamp}`, email: `test-participant-${stamp}@example.invalid`, passwordHash: 'x', name: 'Test Participant', role: 'ADMIN' } })
	const contractor = await prisma.contractor.create({ data: { name: `Test Contractor ${stamp}` } })
	const contract = await prisma.contract.create({ data: { number: `TMP-C4-${stamp}`, contractorId: contractor.id, managerId: manager.id, date: new Date(), amount: 1000 } })
	const contractThread = await prisma.chatThread.create({ data: { key: `contract:${contract.id}`, scope: 'CONTRACT', contractId: contract.id } })
	const deptThread = await prisma.chatThread.create({ data: { key: `test-dept-${stamp}`, scope: 'DEPARTMENT', department: 'production' } })

	try {
		// Contract chat, first message ever, sent by the manager themself: no prior
		// participants, and the manager must not notify themself.
		await notifyChatParticipants(contractThread, manager.id)
		const afterFirst = await prisma.notification.findMany({ where: { dedupeKey: `chat-thread:${contractThread.id}` } })
		assert.equal(afterFirst.length, 0, 'author must never receive their own chat notification, even as the contract manager')

		// A different participant posts -> manager gets notified, text is not in the notification.
		await prisma.chatMessage.create({ data: { threadId: contractThread.id, authorId: participant.id, text: 'секретный текст сообщения' } })
		await notifyChatParticipants(contractThread, participant.id)
		const forManager = await prisma.notification.findUnique({ where: { userId_dedupeKey: { userId: manager.id, dedupeKey: `chat-thread:${contractThread.id}` } } })
		assert.ok(forManager, 'contract manager must be notified even on a message from someone else')
		assert.ok(!forManager!.title.includes('секретный') && !(forManager!.message ?? '').includes('секретный'), 'message text must never be copied into the notification')
		assert.match(forManager!.title, /№ TMP-C4-/, 'title must name the contract')
		assert.equal(forManager!.href, `/contracts/${contract.id}`)

		// Mark it read, then a second message from the same participant must reopen it unread -- not stay silently read.
		await prisma.notification.update({ where: { id: forManager!.id }, data: { readAt: new Date() } })
		await prisma.chatMessage.create({ data: { threadId: contractThread.id, authorId: participant.id, text: 'ещё сообщение' } })
		await notifyChatParticipants(contractThread, participant.id)
		const reopened = await prisma.notification.findUnique({ where: { userId_dedupeKey: { userId: manager.id, dedupeKey: `chat-thread:${contractThread.id}` } } })
		assert.equal(reopened!.readAt, null, 'a new message must reopen an already-read thread notification')

		// Still exactly one row for this user+thread, not one per message -- flood protection.
		const rowsForManager = await prisma.notification.findMany({ where: { userId: manager.id, dedupeKey: `chat-thread:${contractThread.id}` } })
		assert.equal(rowsForManager.length, 1, 'must stay one notification row per (user, thread) no matter how many messages arrive')

		// Department chat: no manager concept, only prior participants.
		await prisma.chatMessage.create({ data: { threadId: deptThread.id, authorId: participant.id, text: 'department message' } })
		await notifyChatParticipants(deptThread, author.id)
		const deptNotify = await prisma.notification.findUnique({ where: { userId_dedupeKey: { userId: participant.id, dedupeKey: `chat-thread:${deptThread.id}` } } })
		assert.ok(deptNotify, 'department chat must notify prior participants')
		assert.match(deptNotify!.title, /отдела/, 'department chat notification must name the department, not copy message text')
		assert.equal(deptNotify!.href, '/departments/production')

		console.log('Chat notification checks passed: manager + participants, no self-notify, no text leak, dedupe reopens unread.')
	} finally {
		await prisma.notification.deleteMany({ where: { userId: { in: [manager.id, author.id, participant.id] } } })
		await prisma.chatMessage.deleteMany({ where: { threadId: { in: [contractThread.id, deptThread.id] } } })
		await prisma.chatThread.deleteMany({ where: { id: { in: [contractThread.id, deptThread.id] } } })
		await prisma.contract.delete({ where: { id: contract.id } })
		await prisma.contractor.delete({ where: { id: contractor.id } })
		await prisma.user.deleteMany({ where: { id: { in: [manager.id, author.id, participant.id] } } })
	}
}

main().finally(() => prisma.$disconnect())
