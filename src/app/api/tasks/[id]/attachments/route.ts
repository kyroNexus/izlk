import path from 'node:path'
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { taskScope, type SessionUser } from '@/lib/access'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { MAX_UPLOAD_BYTES, removeStoredFile, saveTaskAttachment } from '@/lib/storage'

// fs/crypto в storage.ts работают только в Node-рантайме, не в Edge.
export const runtime = 'nodejs'

// Задача C4: файл прямо к задаче (не к комментарию) — та же скрепка, что и
// у чата/комментариев этапа. access: 'write' — тут не бывает узкой роли,
// это ADMIN/MANAGER-функция, как и редактирование самой задачи (canEdit
// на странице задачи).
const MAX_TASK_ATTACHMENTS = 5
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
type AttachmentRow = { id: string; fileName: string; sizeBytes: bigint; isImage: boolean }
const attachmentDto = (attachment: AttachmentRow) => ({ id: attachment.id, fileName: attachment.fileName, sizeBytes: Number(attachment.sizeBytes), isImage: attachment.isImage, url: `/api/tasks/attachments/${attachment.id}` })

async function post(request: Request, { user }: { user: SessionUser }, { params }: { params: { id: string } }) {
	const task = await prisma.task.findFirst({ where: { id: params.id, ...taskScope(user) }, select: { id: true } })
	if (!task) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })

	const form = await request.formData().catch(() => null)
	if (!form) return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
	const uploads = form.getAll('files').filter((entry): entry is File => entry instanceof File && entry.size > 0)
	if (!uploads.length) return NextResponse.json({ error: 'Выберите хотя бы один файл' }, { status: 400 })
	if (uploads.length > MAX_TASK_ATTACHMENTS) return NextResponse.json({ error: `Не больше ${MAX_TASK_ATTACHMENTS} файлов за раз` }, { status: 400 })

	// Один негодный файл отклоняет всю попытку, уже сохранённые файлы
	// подчищаются — та же логика, что и у вложений чата/комментариев (C1/C3).
	const savedPaths: string[] = []
	const attachmentsData: { fileName: string; storagePath: string; mimeType: string | null; sizeBytes: bigint; sha256: string; isImage: boolean }[] = []
	try {
		for (const upload of uploads) {
			if (upload.size > MAX_UPLOAD_BYTES) throw new Error(`Файл ${upload.name} больше допустимых ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ`)
			const buffer = Buffer.from(await upload.arrayBuffer())
			const saved = await saveTaskAttachment({ taskId: task.id, fileName: upload.name, buffer })
			savedPaths.push(saved.storagePath)
			attachmentsData.push({ fileName: saved.fileName, storagePath: saved.storagePath, mimeType: saved.mimeType, sizeBytes: BigInt(saved.sizeBytes), sha256: saved.sha256, isImage: IMAGE_EXTENSIONS.has(path.extname(saved.fileName).toLowerCase()) })
		}
	} catch (error) {
		await Promise.all(savedPaths.map((storagePath) => removeStoredFile(storagePath).catch(() => undefined)))
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось сохранить вложение' }, { status: 400 })
	}

	await prisma.taskAttachment.createMany({
		data: attachmentsData.map((attachment) => ({ ...attachment, taskId: task.id, uploadedById: user.id })),
	})
	const created = await prisma.taskAttachment.findMany({
		where: { taskId: task.id, storagePath: { in: attachmentsData.map((a) => a.storagePath) } },
		select: { id: true, fileName: true, sizeBytes: true, isImage: true },
	})
	await writeAudit({ userId: user.id, action: 'CREATE', entityType: 'TaskAttachment', entityId: task.id })
	return NextResponse.json({ attachments: created.map(attachmentDto) })
}

export const POST = withApiAuth(post, { access: 'write', csrf: true, rateLimit: 'task-attachment' })
