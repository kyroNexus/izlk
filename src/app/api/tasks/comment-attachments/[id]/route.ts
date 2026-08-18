import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { taskScope, type SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { readStoredFile } from '@/lib/storage'
import { logger } from '@/lib/logger'

// fs/crypto в storage.ts работают только в Node-рантайме, не в Edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Отдаёт вложение комментария задачи (задача C4) — тот же паттерн, что и у
 * /api/tasks/attachments/[id] выше, но доступ проверяется через задачу,
 * которой принадлежит комментарий.
 */
async function get(request: Request, { user, requestId }: { user: SessionUser; requestId: string }, { params }: { params: { id: string } }) {
	const attachment = await prisma.taskCommentAttachment.findFirst({
		where: { id: params.id, comment: { task: taskScope(user) } },
		select: { id: true, fileName: true, storagePath: true, mimeType: true, isImage: true },
	})
	if (!attachment) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })

	let file: Buffer
	try {
		file = await readStoredFile(attachment.storagePath)
	} catch (error) {
		logger.error('task_comment_attachment.read_failed', { requestId, route: '/api/tasks/comment-attachments/[id]', method: 'GET', userId: user.id, entityType: 'TaskCommentAttachment', entityId: attachment.id, error })
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
