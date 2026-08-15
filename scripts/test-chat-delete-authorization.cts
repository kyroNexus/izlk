/**
 * A4: verify the actual authorization query, not just that a check exists.
 * A non-admin must only ever match their own message; an admin must match
 * any message in the thread. Mirrors exactly the where-clause in
 * src/app/api/chats/[scope]/[id]/route.ts's remove().
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'

// access.ts pulls in next/navigation (redirect), which this standalone script
// runner can't resolve outside the Next.js build — inline the one-line rule
// instead of importing isAdmin(). Same rule as src/lib/access.ts.
const isAdmin = (user: { role: string }) => user.role === 'ADMIN'

function canDeleteQuery(threadId: string, messageId: string, user: { id: string; role: string }) {
	return prisma.chatMessage.findFirst({
		where: { id: messageId, threadId, deletedAt: null, ...(isAdmin(user) ? {} : { authorId: user.id }) },
		select: { id: true },
	})
}

async function main() {
	const stamp = Date.now()
	const author = await prisma.user.create({ data: { login: `test-author-${stamp}`, email: `test-author-${stamp}@example.invalid`, passwordHash: 'x', name: 'Test Author', role: 'MANAGER' } })
	const otherManager = await prisma.user.create({ data: { login: `test-other-${stamp}`, email: `test-other-${stamp}@example.invalid`, passwordHash: 'x', name: 'Test Other', role: 'MANAGER' } })
	const admin = await prisma.user.create({ data: { login: `test-admin-${stamp}`, email: `test-admin-${stamp}@example.invalid`, passwordHash: 'x', name: 'Test Admin', role: 'ADMIN' } })
	const thread = await prisma.chatThread.create({ data: { key: `test-delete-auth-${stamp}`, scope: 'DEPARTMENT', department: 'production' } })

	try {
		const message = await prisma.chatMessage.create({ data: { threadId: thread.id, authorId: author.id, text: 'mine' } })

		const byOtherManager = await canDeleteQuery(thread.id, message.id, otherManager)
		assert.equal(byOtherManager, null, 'a different non-admin must not be able to match someone else\'s message')

		const byAuthor = await canDeleteQuery(thread.id, message.id, author)
		assert.ok(byAuthor, 'the author must be able to match their own message')

		const byAdmin = await canDeleteQuery(thread.id, message.id, admin)
		assert.ok(byAdmin, 'an admin must be able to match any message in the thread')

		console.log('Chat delete authorization checks passed: author-only for non-admins, admin overrides.')
	} finally {
		await prisma.chatMessage.deleteMany({ where: { threadId: thread.id } })
		await prisma.chatThread.delete({ where: { id: thread.id } })
		await prisma.user.deleteMany({ where: { id: { in: [author.id, otherManager.id, admin.id] } } })
	}
}

main().finally(() => prisma.$disconnect())
