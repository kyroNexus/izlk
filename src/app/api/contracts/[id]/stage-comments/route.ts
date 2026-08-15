import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ContractWorkflowStage } from '@prisma/client'
import { withApiAuth } from '@/lib/api-auth'
import { assertContractAccess, type SessionUser } from '@/lib/access'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'

const input = z.object({ stage: z.nativeEnum(ContractWorkflowStage), text: z.string().trim().min(1).max(1000) })

async function post(request: Request, { user }: { user: SessionUser }, { params }: { params: { id: string } }) {
	await assertContractAccess(params.id, user, { write: true })
	const parsed = input.safeParse(await request.json().catch(() => null))
	if (!parsed.success) return NextResponse.json({ error: 'Введите комментарий до 1000 символов' }, { status: 400 })
	const comment = await prisma.stageComment.create({
		data: { contractId: params.id, stage: parsed.data.stage, text: parsed.data.text, authorId: user.id },
	})
	await writeAudit({ userId: user.id, action: 'CREATE', entityType: 'StageComment', entityId: comment.id })
	return NextResponse.json({ id: comment.id, stage: comment.stage, text: comment.text, createdAt: comment.createdAt, authorName: user.name ?? null })
}

export const POST = withApiAuth(post, { access: 'write', csrf: true, rateLimit: 'stage-comment' })
