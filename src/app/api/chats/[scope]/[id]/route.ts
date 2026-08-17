import path from 'node:path'
import { NextResponse } from 'next/server'
import { isAdmin, type SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { chatError, chatThread, notifyChatParticipants, requireChatWrite } from '@/lib/chat'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { MAX_UPLOAD_BYTES, removeStoredFile, saveChatAttachment } from '@/lib/storage'

// fs/crypto в storage.ts работают только в Node-рантайме, не в Edge.
export const runtime = 'nodejs'

const scopeOf = (value: string): 'department' | 'contract' | null => value === 'department' || value === 'contract' ? value : null
const PAGE_SIZE = 50
// Задача C1: скрепка — это "приложить пару фото к сообщению", не массовая
// загрузка папки (для неё уже есть умный импорт/загрузка на карточку
// договора) — небольшой явный потолок вместо переиспользования лимита
// оттуда (100), который тут был бы избыточен.
const MAX_CHAT_ATTACHMENTS = 5
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
type AttachmentRow = { id: string; fileName: string; sizeBytes: bigint; isImage: boolean }
const attachmentDto = (attachment: AttachmentRow) => ({ id: attachment.id, fileName: attachment.fileName, sizeBytes: Number(attachment.sizeBytes), isImage: attachment.isImage, url: `/api/chats/attachments/${attachment.id}` })
const toDto = (user: SessionUser) => (message: { id: string; text: string | null; createdAt: Date; authorId: string; author: { id: string; name: string }; attachments?: AttachmentRow[] }) => ({
	id: message.id,
	text: message.text,
	createdAt: message.createdAt,
	author: message.author,
	own: message.authorId === user.id,
	canDelete: message.authorId === user.id || isAdmin(user),
	attachments: (message.attachments ?? []).map(attachmentDto),
})
const attachmentsSelect = { select: { id: true, fileName: true, sizeBytes: true, isImage: true } } as const

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
			include: { author: { select: { id: true, name: true } }, attachments: attachmentsSelect },
		})
		return NextResponse.json({ canWrite, messages: messages.map(toDto(user)), hasMore: false })
	}

	const rows = await prisma.chatMessage.findMany({
		where: { threadId: thread.id, deletedAt: null },
		orderBy: { createdAt: 'desc' },
		take: PAGE_SIZE + 1,
		...(before ? { cursor: { id: before }, skip: 1 } : {}),
		include: { author: { select: { id: true, name: true } }, attachments: attachmentsSelect },
	})
	const hasMore = rows.length > PAGE_SIZE
	const page = (hasMore ? rows.slice(0, PAGE_SIZE) : rows).reverse()
	return NextResponse.json({ canWrite, messages: page.map(toDto(user)), hasMore })
}

/**
 * Задача C1: скрепка рядом с полем ввода + вставка из буфера. Сообщение —
 * одно атомарное действие (текст и вложения уходят вместе, одной записью),
 * поэтому тело теперь multipart/form-data вместо JSON, а не отдельный
 * "сначала загрузить файлы, потом текст" запрос.
 */
async function post(request: Request, { user }: { user: SessionUser }, { params }: { params: { scope: string; id: string } }) {
	const scope = scopeOf(params.scope)
	if (!scope || !await requireChatWrite(user, scope, params.id)) return chatError()
	const form = await request.formData().catch(() => null)
	if (!form) return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
	const text = String(form.get('text') ?? '').trim()
	const uploads = form.getAll('files').filter((entry): entry is File => entry instanceof File && entry.size > 0)
	if (!text && uploads.length === 0) return NextResponse.json({ error: 'Введите сообщение или приложите файл' }, { status: 400 })
	if (text.length > 4000) return NextResponse.json({ error: 'Сообщение длиннее 4000 символов' }, { status: 400 })
	if (uploads.length > MAX_CHAT_ATTACHMENTS) return NextResponse.json({ error: `За одно сообщение можно приложить не больше ${MAX_CHAT_ATTACHMENTS} файлов` }, { status: 400 })
	const thread = await chatThread(user, scope, params.id)
	if (!thread) return chatError()

	// Сообщение — одна запись: если один из файлов не прошёл проверку, весь
	// набор отклоняется целиком (а не "текст ушёл, файл — нет"), а уже
	// сохранённые на диск файлы из этой же попытки подчищаются.
	const savedPaths: string[] = []
	const attachmentsData: { fileName: string; storagePath: string; mimeType: string | null; sizeBytes: bigint; sha256: string; isImage: boolean }[] = []
	try {
		for (const upload of uploads) {
			if (upload.size > MAX_UPLOAD_BYTES) throw new Error(`Файл ${upload.name} больше допустимых ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ`)
			const buffer = Buffer.from(await upload.arrayBuffer())
			const saved = await saveChatAttachment({ threadId: thread.id, fileName: upload.name, buffer })
			savedPaths.push(saved.storagePath)
			attachmentsData.push({ fileName: saved.fileName, storagePath: saved.storagePath, mimeType: saved.mimeType, sizeBytes: BigInt(saved.sizeBytes), sha256: saved.sha256, isImage: IMAGE_EXTENSIONS.has(path.extname(saved.fileName).toLowerCase()) })
		}
	} catch (error) {
		await Promise.all(savedPaths.map((storagePath) => removeStoredFile(storagePath).catch(() => undefined)))
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось сохранить вложение' }, { status: 400 })
	}

	const message = await prisma.chatMessage.create({
		data: {
			threadId: thread.id,
			authorId: user.id,
			text: text || null,
			...(attachmentsData.length ? { attachments: { create: attachmentsData } } : {}),
		},
		include: { author: { select: { id: true, name: true } }, attachments: attachmentsSelect },
	})
	await writeAudit({ userId: user.id, action: 'CREATE', entityType: 'ChatMessage', entityId: message.id })
	// Notifications are secondary to the message itself actually saving — notify() already
	// swallows its own errors, same as everywhere else notify() is called in this app.
	await notifyChatParticipants(thread, user.id)
	return NextResponse.json(toDto(user)(message), { status: 201 })
}

async function remove(request: Request, { user }: { user: SessionUser }, { params }: { params: { scope: string; id: string } }) {
	const scope = scopeOf(params.scope)
	if (!scope || !await requireChatWrite(user, scope, params.id)) return chatError()
	const messageId = new URL(request.url).searchParams.get('messageId') ?? ''
	const thread = await chatThread(user, scope, params.id)
	if (!thread) return chatError()
	// Client only shows "Удалить" for the author's own messages or to an admin,
	// but the server re-checks regardless — same rule, not just a hidden button.
	const message = await prisma.chatMessage.findFirst({ where: { id: messageId, threadId: thread.id, deletedAt: null, ...(isAdmin(user) ? {} : { authorId: user.id }) }, select: { id: true } })
	if (!message) return NextResponse.json({ error: 'Сообщение не найдено' }, { status: 404 })
	await prisma.chatMessage.update({ where: { id: message.id }, data: { deletedAt: new Date() } })
	await writeAudit({ userId: user.id, action: 'DELETE', entityType: 'ChatMessage', entityId: message.id })
	return new NextResponse(null, { status: 204 })
}

export const GET = withApiAuth(get, { access: 'authenticated' })
export const POST = withApiAuth(post, { access: 'write', csrf: true, rateLimit: 'chat-message' })
export const DELETE = withApiAuth(remove, { access: 'write', csrf: true })
