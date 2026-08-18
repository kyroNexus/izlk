import { NextResponse } from 'next/server'
import { canManageInvoices, canWrite, contractScope, taskScope, type SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { canReadChatThread } from '@/lib/chat'
import { renamedFileName } from '@/lib/file-name'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'

export const runtime = 'nodejs'

async function patch(request: Request, { user }: { user: SessionUser }, { params }: { params: { type: string; id: string } }) {
	const body = await request.json().catch(() => null)
	const requestedName = typeof body?.name === 'string' ? body.name : ''
	let currentName: string | null = null
	let update: ((fileName: string) => Promise<unknown>) | null = null

	if (params.type === 'document') {
		const file = await prisma.document.findFirst({ where: { id: params.id, deletedAt: null, contract: contractScope(user) }, select: { fileName: true, invoiceId: true, executiveDocId: true, projectSection: { select: { responsibleId: true } } } })
		const allowed = file && (canWrite(user) || (file.invoiceId && canManageInvoices(user)) || (user.role === 'BUILDER' && (file.projectSection || file.executiveDocId)) || (user.role === 'DESIGNER' && file.projectSection?.responsibleId === user.id))
		if (allowed) { currentName = file.fileName; update = (fileName) => prisma.document.update({ where: { id: params.id }, data: { fileName } }) }
	} else if (params.type === 'chat-attachment' && canWrite(user)) {
		const file = await prisma.chatAttachment.findUnique({ where: { id: params.id }, select: { fileName: true, message: { select: { deletedAt: true, thread: { select: { scope: true, department: true, contractId: true } } } } } })
		if (file && !file.message.deletedAt && await canReadChatThread(user, file.message.thread)) { currentName = file.fileName; update = (fileName) => prisma.chatAttachment.update({ where: { id: params.id }, data: { fileName } }) }
	} else if (params.type === 'stage-attachment' && canWrite(user)) {
		const file = await prisma.stageCommentAttachment.findFirst({ where: { id: params.id, comment: { contract: contractScope(user) } }, select: { fileName: true } })
		if (file) { currentName = file.fileName; update = (fileName) => prisma.stageCommentAttachment.update({ where: { id: params.id }, data: { fileName } }) }
	} else if (params.type === 'task-attachment' && canWrite(user)) {
		const file = await prisma.taskAttachment.findFirst({ where: { id: params.id, task: taskScope(user) }, select: { fileName: true } })
		if (file) { currentName = file.fileName; update = (fileName) => prisma.taskAttachment.update({ where: { id: params.id }, data: { fileName } }) }
	} else if (params.type === 'task-comment-attachment' && canWrite(user)) {
		const file = await prisma.taskCommentAttachment.findFirst({ where: { id: params.id, comment: { task: taskScope(user) } }, select: { fileName: true } })
		if (file) { currentName = file.fileName; update = (fileName) => prisma.taskCommentAttachment.update({ where: { id: params.id }, data: { fileName } }) }
	} else if (params.type === 'site-photo' && (canWrite(user) || user.role === 'BUILDER')) {
		const file = await prisma.sitePhoto.findFirst({ where: { id: params.id, siteWork: { site: { contract: contractScope(user) } } }, select: { fileName: true } })
		if (file) { currentName = file.fileName; update = (fileName) => prisma.sitePhoto.update({ where: { id: params.id }, data: { fileName } }) }
	}

	if (!currentName || !update) return NextResponse.json({ error: 'Файл не найден или недоступен' }, { status: 404 })
	const fileName = renamedFileName(currentName, requestedName)
	if (!fileName) return NextResponse.json({ error: 'Недопустимое имя файла' }, { status: 400 })
	await update(fileName)
	await writeAudit({ userId: user.id, action: 'UPDATE', entityType: 'FileName', entityId: params.id })
	return NextResponse.json({ fileName })
}

export const PATCH = withApiAuth(patch, { access: 'authenticated', csrf: true })
