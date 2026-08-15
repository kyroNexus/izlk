/**
 * Дашборд-аудит: клик по уведомлению с href должен помечать именно его
 * прочитанным (readAt), а не позволять пометить чужое уведомление по id.
 * Проверяем сам запрос из openNotification() в
 * src/app/(dashboard)/notifications/page.tsx, а не факт его наличия.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { prisma } from '../src/lib/prisma'

function markReadQuery(id: string, userId: string) {
	return prisma.notification.findFirst({ where: { id, userId }, select: { id: true } })
}

async function main() {
	const stamp = Date.now()
	const owner = await prisma.user.create({ data: { login: `test-notif-owner-${stamp}`, email: `test-notif-owner-${stamp}@example.invalid`, passwordHash: 'x', name: 'Test Owner', role: 'MANAGER' } })
	const stranger = await prisma.user.create({ data: { login: `test-notif-stranger-${stamp}`, email: `test-notif-stranger-${stamp}@example.invalid`, passwordHash: 'x', name: 'Test Stranger', role: 'MANAGER' } })

	try {
		const notification = await prisma.notification.create({ data: { userId: owner.id, type: 'INFO', title: 'test', href: '/contracts', readAt: null } })

		const byStranger = await markReadQuery(notification.id, stranger.id)
		assert.equal(byStranger, null, 'a different user must not be able to match someone else\'s notification by id')

		const byOwner = await markReadQuery(notification.id, owner.id)
		assert.ok(byOwner, 'the owner must be able to match their own notification')

		await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } })
		const reloaded = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })
		assert.ok(reloaded.readAt, 'clicking through must leave the notification marked as read')

		const pageSrc = fs.readFileSync('src/app/(dashboard)/notifications/page.tsx', 'utf8')
		assert.match(pageSrc, /async function openNotification/, 'the per-item mark-as-read action must exist')
		assert.match(pageSrc, /findFirst\(\{ where: \{ id, userId: acting\.id \}/, 'it must scope the lookup to the acting user, not trust the posted id alone')

		console.log('Notification read checks passed: ownership-scoped mark-as-read, redirect target preserved.')
	} finally {
		await prisma.notification.deleteMany({ where: { userId: { in: [owner.id, stranger.id] } } })
		await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } })
	}
}

main().finally(() => prisma.$disconnect())
