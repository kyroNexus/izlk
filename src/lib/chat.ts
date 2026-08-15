import { NextResponse } from 'next/server'
import type { ChatThread } from '@prisma/client'
import { canWrite, findContractInScope, type SessionUser } from '@/lib/access'
import { prisma } from '@/lib/prisma'
import { notify } from '@/lib/notifications'

const DEPARTMENTS = new Set(['commercial', 'engineering', 'production', 'construction'])
const DEPARTMENT_LABEL: Record<string, string> = { commercial: 'Коммерческий', engineering: 'Конструкторский', production: 'Производственный', construction: 'Строительный' }

export async function chatThread(user: SessionUser, scope: 'department' | 'contract', value: string) {
	if (scope === 'department') {
		if (!DEPARTMENTS.has(value) || user.role === 'VIEWER') return null
		return prisma.chatThread.upsert({ where: { key: `department:${value}` }, create: { key: `department:${value}`, scope: 'DEPARTMENT', department: value }, update: {} })
	}
	const contract = await findContractInScope(value, user)
	if (!contract) return null
	return prisma.chatThread.upsert({ where: { key: `contract:${contract.id}` }, create: { key: `contract:${contract.id}`, scope: 'CONTRACT', contractId: contract.id }, update: {} })
}

export async function requireChatWrite(user: SessionUser, scope: 'department' | 'contract', value: string) {
	if (!canWrite(user)) return false
	return Boolean(await chatThread(user, scope, value))
}

export function chatError() {
	return NextResponse.json({ error: 'Нет доступа к чату' }, { status: 403 })
}

/**
 * A real message notifies the thread's other participants — not everyone who
 * could theoretically read the chat. Contract chats also always reach the
 * contract's manager, even on their first message in that thread. One
 * notification per (user, thread): a flurry of messages updates and reopens
 * the same row instead of flooding the bell — the text itself is never
 * copied into the notification, only that something new arrived.
 */
export async function notifyChatParticipants(thread: ChatThread, authorId: string) {
	const priorAuthors = await prisma.chatMessage.findMany({
		where: { threadId: thread.id, authorId: { not: authorId } },
		distinct: ['authorId'],
		select: { authorId: true },
	})
	const recipients = new Set(priorAuthors.map((row) => row.authorId))

	let title: string
	let href: string
	if (thread.scope === 'CONTRACT' && thread.contractId) {
		const contract = await prisma.contract.findUnique({ where: { id: thread.contractId }, select: { number: true, managerId: true } })
		if (!contract) return
		if (contract.managerId) recipients.add(contract.managerId)
		recipients.delete(authorId)
		title = `Новое сообщение в чате договора № ${contract.number}`
		href = `/contracts/${thread.contractId}`
	} else if (thread.scope === 'DEPARTMENT' && thread.department) {
		title = `Новое сообщение в чате отдела «${DEPARTMENT_LABEL[thread.department] ?? thread.department}»`
		href = `/departments/${thread.department}`
	} else {
		return
	}

	await Promise.all([...recipients].map((userId) => notify({ userId, type: 'INFO', title, href, dedupeKey: `chat-thread:${thread.id}`, resetUnread: true })))
}
