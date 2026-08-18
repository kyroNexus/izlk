import path from 'node:path'
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { taskScope, type SessionUser } from '@/lib/access'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { notify } from '@/lib/notifications'
import { MAX_UPLOAD_BYTES, removeStoredFile, saveTaskCommentAttachment } from '@/lib/storage'

// fs/crypto в storage.ts работают только в Node-рантайме, не в Edge.
export const runtime = 'nodejs'

/**
 * Задача C4: комментарий задачи с вложением — тот же паттерн, что и у
 * комментария этапа (C3): текст и файлы — одно атомарное сообщение. Доступ —
 * не canWrite, а видимость задачи (taskScope): комментировать может и
 * простой исполнитель, как было и раньше у текстовых комментариев.
 */
const MAX_TASK_COMMENT_ATTACHMENTS = 5
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
type AttachmentRow = { id: string; fileName: string; sizeBytes: bigint; isImage: boolean }
const attachmentDto = (attachment: AttachmentRow) => ({ id: attachment.id, fileName: attachment.fileName, sizeBytes: Number(attachment.sizeBytes), isImage: attachment.isImage, url: `/api/tasks/comment-attachments/${attachment.id}` })

async function post(request: Request, { user }: { user: SessionUser }, { params }: { params: { id: string } }) {
	const visible = await prisma.task.findFirst({
		where: { id: params.id, ...taskScope(user) },
		select: { id: true, assigneeId: true, creatorId: true, title: true },
	})
	if (!visible) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })

	const form = await request.formData().catch(() => null)
	if (!form) return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
	const text = String(form.get('text') ?? '').trim()
	const uploads = form.getAll('files').filter((entry): entry is File => entry instanceof File && entry.size > 0)
	if (!text && uploads.length === 0) return NextResponse.json({ error: 'Введите комментарий или приложите файл' }, { status: 400 })
	if (text.length > 1000) return NextResponse.json({ error: 'Комментарий длиннее 1000 символов' }, { status: 400 })
	if (uploads.length > MAX_TASK_COMMENT_ATTACHMENTS) return NextResponse.json({ error: `К одному комментарию можно приложить не больше ${MAX_TASK_COMMENT_ATTACHMENTS} файлов` }, { status: 400 })

	// Один негодный файл отклоняет весь комментарий целиком, уже сохранённые
	// файлы этой попытки подчищаются (та же логика, что и в C1/C3).
	const savedPaths: string[] = []
	const attachmentsData: { fileName: string; storagePath: string; mimeType: string | null; sizeBytes: bigint; sha256: string; isImage: boolean }[] = []
	try {
		for (const upload of uploads) {
			if (upload.size > MAX_UPLOAD_BYTES) throw new Error(`Файл ${upload.name} больше допустимых ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ`)
			const buffer = Buffer.from(await upload.arrayBuffer())
			const saved = await saveTaskCommentAttachment({ taskId: visible.id, fileName: upload.name, buffer })
			savedPaths.push(saved.storagePath)
			attachmentsData.push({ fileName: saved.fileName, storagePath: saved.storagePath, mimeType: saved.mimeType, sizeBytes: BigInt(saved.sizeBytes), sha256: saved.sha256, isImage: IMAGE_EXTENSIONS.has(path.extname(saved.fileName).toLowerCase()) })
		}
	} catch (error) {
		await Promise.all(savedPaths.map((storagePath) => removeStoredFile(storagePath).catch(() => undefined)))
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось сохранить вложение' }, { status: 400 })
	}

	const comment = await prisma.taskComment.create({
		data: {
			taskId: visible.id,
			authorId: user.id,
			text: text || null,
			...(attachmentsData.length ? { attachments: { create: attachmentsData } } : {}),
		},
		include: { attachments: { select: { id: true, fileName: true, sizeBytes: true, isImage: true } } },
	})
	await writeAudit({ userId: user.id, action: 'CREATE', entityType: 'TaskComment', entityId: comment.id })
	if (visible.assigneeId !== user.id) await notify({ userId: visible.assigneeId, type: 'INFO', title: 'Новый комментарий к задаче', message: visible.title, href: `/tasks/${visible.id}`, dedupeKey: `task-comment:${comment.id}:assignee` })
	if (visible.creatorId !== user.id && visible.creatorId !== visible.assigneeId) await notify({ userId: visible.creatorId, type: 'INFO', title: 'Новый комментарий к задаче', message: visible.title, href: `/tasks/${visible.id}`, dedupeKey: `task-comment:${comment.id}:creator` })

	return NextResponse.json({ id: comment.id, text: comment.text, createdAt: comment.createdAt, authorName: user.name ?? null, attachments: comment.attachments.map(attachmentDto) })
}

export const POST = withApiAuth(post, { access: 'authenticated', csrf: true, rateLimit: 'task-attachment' })
