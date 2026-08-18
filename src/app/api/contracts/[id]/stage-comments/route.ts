import path from 'node:path'
import { NextResponse } from 'next/server'
import { ContractWorkflowStage } from '@prisma/client'
import { withApiAuth } from '@/lib/api-auth'
import { assertContractAccess, type SessionUser } from '@/lib/access'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { MAX_UPLOAD_BYTES, removeStoredFile, saveStageCommentAttachment } from '@/lib/storage'

// fs/crypto в storage.ts работают только в Node-рантайме, не в Edge.
export const runtime = 'nodejs'

// Задача C3: та же скрепка, что и в чате (C1) — небольшой явный потолок,
// не переиспользуем лимит массовой загрузки (100).
const MAX_STAGE_COMMENT_ATTACHMENTS = 5
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
type AttachmentRow = { id: string; fileName: string; sizeBytes: bigint; isImage: boolean }
const attachmentDto = (attachment: AttachmentRow) => ({ id: attachment.id, fileName: attachment.fileName, sizeBytes: Number(attachment.sizeBytes), isImage: attachment.isImage, url: `/api/stage-comments/attachments/${attachment.id}` })

/**
 * Задача C3: подтверждение выполнения этапа фотографией — обычный сценарий,
 * поэтому тело теперь multipart/form-data вместо JSON (как и в чате, C1):
 * текст и вложения — одно атомарное сообщение, а не два запроса подряд.
 */
async function post(request: Request, { user }: { user: SessionUser }, { params }: { params: { id: string } }) {
	await assertContractAccess(params.id, user, { write: true })
	const form = await request.formData().catch(() => null)
	if (!form) return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
	const stageRaw = String(form.get('stage') ?? '')
	if (!Object.values(ContractWorkflowStage).includes(stageRaw as ContractWorkflowStage)) {
		return NextResponse.json({ error: 'Некорректный этап' }, { status: 400 })
	}
	const stage = stageRaw as ContractWorkflowStage
	const text = String(form.get('text') ?? '').trim()
	const uploads = form.getAll('files').filter((entry): entry is File => entry instanceof File && entry.size > 0)
	if (!text && uploads.length === 0) return NextResponse.json({ error: 'Введите комментарий или приложите файл' }, { status: 400 })
	if (text.length > 1000) return NextResponse.json({ error: 'Комментарий длиннее 1000 символов' }, { status: 400 })
	if (uploads.length > MAX_STAGE_COMMENT_ATTACHMENTS) return NextResponse.json({ error: `К одному комментарию можно приложить не больше ${MAX_STAGE_COMMENT_ATTACHMENTS} файлов` }, { status: 400 })

	// Комментарий — одна запись: один негодный файл отклоняет весь набор
	// целиком, а уже сохранённые на диск файлы этой попытки подчищаются
	// (та же логика, что и у вложений чата в C1).
	const savedPaths: string[] = []
	const attachmentsData: { fileName: string; storagePath: string; mimeType: string | null; sizeBytes: bigint; sha256: string; isImage: boolean }[] = []
	try {
		for (const upload of uploads) {
			if (upload.size > MAX_UPLOAD_BYTES) throw new Error(`Файл ${upload.name} больше допустимых ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ`)
			const buffer = Buffer.from(await upload.arrayBuffer())
			const saved = await saveStageCommentAttachment({ contractId: params.id, stage, fileName: upload.name, buffer })
			savedPaths.push(saved.storagePath)
			attachmentsData.push({ fileName: saved.fileName, storagePath: saved.storagePath, mimeType: saved.mimeType, sizeBytes: BigInt(saved.sizeBytes), sha256: saved.sha256, isImage: IMAGE_EXTENSIONS.has(path.extname(saved.fileName).toLowerCase()) })
		}
	} catch (error) {
		await Promise.all(savedPaths.map((storagePath) => removeStoredFile(storagePath).catch(() => undefined)))
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось сохранить вложение' }, { status: 400 })
	}

	const comment = await prisma.stageComment.create({
		data: {
			contractId: params.id,
			stage,
			text: text || null,
			authorId: user.id,
			...(attachmentsData.length ? { attachments: { create: attachmentsData } } : {}),
		},
		include: { attachments: { select: { id: true, fileName: true, sizeBytes: true, isImage: true } } },
	})
	await writeAudit({ userId: user.id, action: 'CREATE', entityType: 'StageComment', entityId: comment.id })
	return NextResponse.json({ id: comment.id, stage: comment.stage, text: comment.text, createdAt: comment.createdAt, authorName: user.name ?? null, attachments: comment.attachments.map(attachmentDto) })
}

export const POST = withApiAuth(post, { access: 'write', csrf: true, rateLimit: 'stage-comment' })
