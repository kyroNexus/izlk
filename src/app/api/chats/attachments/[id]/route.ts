import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { canReadChatThread } from '@/lib/chat'
import { readStoredFile } from '@/lib/storage'
import { logger } from '@/lib/logger'

// fs/crypto в storage.ts работают только в Node-рантайме, не в Edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Отдаёт вложение чата (задача C1) — тот же паттерн, что и у
 * /api/documents/[id]: проверка доступа к треду, а не публичная раздача по
 * одному только id. Изображения — inline (превью-миниатюра в чате), всё
 * остальное — как вложение для скачивания.
 */
async function get(request: Request, { user, requestId }: { user: SessionUser; requestId: string }, { params }: { params: { id: string } }) {
	const attachment = await prisma.chatAttachment.findFirst({
		where: { id: params.id, message: { deletedAt: null } },
		select: {
			id: true, fileName: true, storagePath: true, mimeType: true, isImage: true,
			message: { select: { thread: { select: { scope: true, department: true, contractId: true } } } },
		},
	})
	if (!attachment) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
	if (!await canReadChatThread(user, attachment.message.thread)) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })

	let file: Buffer
	try {
		file = await readStoredFile(attachment.storagePath)
	} catch (error) {
		logger.error('chat_attachment.read_failed', { requestId, route: '/api/chats/attachments/[id]', method: 'GET', userId: user.id, entityType: 'ChatAttachment', entityId: attachment.id, error })
		return NextResponse.json({ error: 'Файл недоступен на диске' }, { status: 410 })
	}

	const fileName = encodeURIComponent(attachment.fileName)
	const contentType = attachment.mimeType ?? 'application/octet-stream'
	return new NextResponse(new Uint8Array(file), {
		headers: {
			'Content-Type': contentType,
			'Content-Length': String(file.length),
			'Content-Disposition': `${attachment.isImage ? 'inline' : 'attachment'}; filename*=UTF-8''${fileName}`,
			'X-Content-Type-Options': 'nosniff',
			'X-Frame-Options': 'SAMEORIGIN',
			'Content-Security-Policy': "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'",
			'Cache-Control': 'private, no-store',
		},
	})
}

export const GET = withApiAuth(get, { access: 'authenticated' })
