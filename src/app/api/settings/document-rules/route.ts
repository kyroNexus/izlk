import { NextResponse } from 'next/server'
import type { SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { writeAudit } from '@/lib/audit'
import { assertDocumentRulePattern, DOCUMENT_RULE_TARGETS } from '@/lib/document-route-rules'
import { prisma } from '@/lib/prisma'

function ruleData(body: unknown) {
	const value = body as Record<string, unknown> | null
	const target = typeof value?.target === 'string' ? value.target : ''
	const pattern = typeof value?.pattern === 'string' ? value.pattern.trim() : ''
	const note = typeof value?.note === 'string' ? value.note.trim() : ''
	const sortOrder = Number(value?.sortOrder)
	if (!(DOCUMENT_RULE_TARGETS as readonly string[]).includes(target)) throw new Error('Выберите назначение правила')
	assertDocumentRulePattern(pattern)
	if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100_000) throw new Error('Порядок должен быть целым числом от 0 до 100000')
	if (note.length > 300) throw new Error('Заметка не должна превышать 300 символов')
	return { target, pattern, note: note || null, sortOrder, enabled: value?.enabled !== false }
}

async function list() {
	const rules = await prisma.documentRouteRule.findMany({ orderBy: [{ target: 'asc' }, { sortOrder: 'asc' }] })
	return NextResponse.json(rules)
}

async function create(request: Request, { user }: { user: SessionUser }) {
	try {
		const rule = await prisma.documentRouteRule.create({ data: ruleData(await request.json()) })
		await writeAudit({ userId: user.id, action: 'CREATE', entityType: 'DocumentRouteRule', entityId: rule.id })
		return NextResponse.json(rule, { status: 201 })
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось создать правило' }, { status: 400 })
	}
}

async function update(request: Request, { user }: { user: SessionUser }) {
	try {
		const body = await request.json()
		const id = typeof body?.id === 'string' ? body.id : ''
		if (!id || !await prisma.documentRouteRule.findUnique({ where: { id }, select: { id: true } })) return NextResponse.json({ error: 'Правило не найдено' }, { status: 404 })
		const rule = await prisma.documentRouteRule.update({ where: { id }, data: ruleData(body) })
		await writeAudit({ userId: user.id, action: 'UPDATE', entityType: 'DocumentRouteRule', entityId: rule.id })
		return NextResponse.json(rule)
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось обновить правило' }, { status: 400 })
	}
}

async function remove(request: Request, { user }: { user: SessionUser }) {
	const id = new URL(request.url).searchParams.get('id') ?? ''
	const rule = id ? await prisma.documentRouteRule.findUnique({ where: { id }, select: { id: true } }) : null
	if (!rule) return NextResponse.json({ error: 'Правило не найдено' }, { status: 404 })
	await prisma.documentRouteRule.delete({ where: { id } })
	await writeAudit({ userId: user.id, action: 'DELETE', entityType: 'DocumentRouteRule', entityId: id })
	return NextResponse.json({ deleted: true })
}

const options = { access: 'admin', csrf: true, rateLimit: 'document-rule' } as const
export const GET = withApiAuth(list, options)
export const POST = withApiAuth(create, options)
export const PATCH = withApiAuth(update, options)
export const DELETE = withApiAuth(remove, options)
