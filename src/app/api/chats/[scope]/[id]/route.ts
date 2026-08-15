import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { chatError, chatThread, requireChatWrite } from '@/lib/chat'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'

const messageInput = z.object({ text: z.string().trim().min(1).max(4000) })
const scopeOf = (value: string): 'department' | 'contract' | null => value === 'department' || value === 'contract' ? value : null
const PAGE_SIZE = 50
const toDto = (user: SessionUser) => (message: { id: string; text: string; createdAt: Date; authorId: string; author: { id: string; name: string } }) => ({ id: message.id, text: message.text, createdAt: message.createdAt, author: message.author, own: message.authorId === user.id })

/** Cursor must belong to this thread — otherwise a client could probe timing across threads it can't read. */
async function ownCursor(threadId: string, id: string | null) {
	if (!id) return undefined
	const message = await prisma.chatMessage.findFirst({ where: { id, threadId }, select: { id: true } })
	return message?.id
}

async function get(request: Request, { user }: { user: SessionUser }, { params }: { params: { scope: string; id: string } }) {
	const scope = scopeOf(params.scope)
	if (!scope) return chatError()
	const thread = await chatThread(user, scope, params.id)
	if (!thread) return chatError()
	const canWrite = await requireChatWrite(user, scope, params.id)
	const url = new URL(request.url)
	const after = await ownCursor(thread.id, url.searchParams.get('after'))
	const before = await ownCursor(thread.id, url.searchParams.get('before'))

	if (after) {
		// Polling for new messages only — cheap, bounded, no page the client already has.
		const messages = await prisma.chatMessage.findMany({
			where: { threadId: thread.id, deletedAt: null },
			orderBy: { createdAt: 'asc' },
			cursor: { id: after },
			skip: 1,
			take: 200,
			include: { author: { select: { id: true, name: true } } },
		})
		return NextResponse.json({ canWrite, messages: messages.map(toDto(user)), hasMore: false })
	}

	const rows = await prisma.chatMessage.findMany({
		where: { threadId: thread.id, deletedAt: null },
		orderBy: { createdAt: 'desc' },
		take: PAGE_SIZE + 1,
		...(before ? { cursor: { id: before }, skip: 1 } : {}),
		include: { author: { select: { id: true, name: true } } },
	})
	const hasMore = rows.length > PAGE_SIZE
	const page = (hasMore ? rows.slice(0, PAGE_SIZE) : rows).reverse()
	return NextResponse.json({ canWrite, messages: page.map(toDto(user)), hasMore })
}

async function post(request: Request, { user }: { user: SessionUser }, { params }: { params: { scope: string; id: string } }) {
	const scope = scopeOf(params.scope)
	if (!scope || !await requireChatWrite(user, scope, params.id)) return chatError()
	const parsed = messageInput.safeParse(await request.json().catch(() => null))
	if (!parsed.success) return NextResponse.json({ error: 'Введите сообщение до 4000 символов' }, { status: 400 })
	const thread = await chatThread(user, scope, params.id)
	if (!thread) return chatError()
	const message = await prisma.chatMessage.create({ data: { threadId: thread.id, authorId: user.id, text: parsed.data.text }, include: { author: { select: { id: true, name: true } } } })
	await writeAudit({ userId: user.id, action: 'CREATE', entityType: 'ChatMessage', entityId: message.id })
	return NextResponse.json({ id: message.id, text: message.text, createdAt: message.createdAt, author: message.author, own: true }, { status: 201 })
}

async function remove(request: Request, { user }: { user: SessionUser }, { params }: { params: { scope: string; id: string } }) {
	const scope = scopeOf(params.scope)
	if (!scope || !await requireChatWrite(user, scope, params.id)) return chatError()
	const messageId = new URL(request.url).searchParams.get('messageId') ?? ''
	const thread = await chatThread(user, scope, params.id)
	if (!thread) return chatError()
	const message = await prisma.chatMessage.findFirst({ where: { id: messageId, threadId: thread.id, authorId: user.id, deletedAt: null }, select: { id: true } })
	if (!message) return NextResponse.json({ error: 'Сообщение не найдено' }, { status: 404 })
	await prisma.chatMessage.update({ where: { id: message.id }, data: { deletedAt: new Date() } })
	await writeAudit({ userId: user.id, action: 'DELETE', entityType: 'ChatMessage', entityId: message.id })
	return new NextResponse(null, { status: 204 })
}

export const GET = withApiAuth(get, { access: 'authenticated' })
export const POST = withApiAuth(post, { access: 'write', csrf: true, rateLimit: 'chat-message' })
export const DELETE = withApiAuth(remove, { access: 'write', csrf: true })
