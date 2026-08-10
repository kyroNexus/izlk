import { NextResponse } from 'next/server'
import { contractScope, type SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { advanceAfterInstallationCompleted, advanceAfterSiteReport } from '@/lib/contract-workflow'
import { prisma } from '@/lib/prisma'
import { siteReportPayloadSchema } from '@/lib/site-report-payload'

async function post(request: Request, { user }: { user: SessionUser }, { params }: { params: { id: string } }) {
	const parsed = siteReportPayloadSchema.safeParse(await request.json().catch(() => null))
	if (!parsed.success) return NextResponse.json({ error: 'Некорректные данные отчёта' }, { status: 400 })
	const data = parsed.data
	const site = await prisma.site.findFirst({ where: { id: params.id, deletedAt: null, contract: contractScope(user) }, select: { id: true, contractId: true } })
	if (!site) return NextResponse.json({ error: 'Площадка не найдена' }, { status: 404 })
	const existing = await prisma.siteWork.findUnique({ where: { clientSubmissionId: data.clientSubmissionId }, select: { id: true, siteId: true } })
	if (existing) return existing.siteId === site.id ? NextResponse.json({ reportId: existing.id, resumed: true }) : NextResponse.json({ error: 'Некорректный ключ отправки' }, { status: 409 })
	const crewCost = data.crew.reduce((sum, row) => sum + row.days * row.rate, 0)
	const total = (category: 'EQUIPMENT' | 'MATERIAL' | 'OTHER') => data.costs.filter((row) => row.category === category).reduce((sum, row) => sum + row.quantity * row.price, 0)
	try {
		const report = await prisma.siteWork.create({ data: { siteId: site.id, clientSubmissionId: data.clientSubmissionId, direction: data.direction, workDate: new Date(`${data.workDate}T12:00:00.000Z`), stage: data.stage, comment: data.comment || null, crewCount: data.crew.length, crewCost, equipmentCost: total('EQUIPMENT'), materialCost: total('MATERIAL'), otherCost: total('OTHER'), crewEntries: { create: data.crew.map((row) => ({ name: row.name, workDays: row.days, rate: row.rate })) }, costItems: { create: data.costs.map((row) => ({ category: row.category, name: row.name, paymentType: row.payment, quantity: row.quantity, unit: row.unit || null, unitPrice: row.price })) } }, select: { id: true } })
		await advanceAfterSiteReport({ contractId: site.contractId, actorId: user.id, direction: data.direction })
		if (data.finishDirection) await advanceAfterInstallationCompleted({ contractId: site.contractId, actorId: user.id, direction: data.direction })
		await prisma.siteEvent.create({ data: { siteId: site.id, type: 'INFO', text: `Дневной отчёт ${data.direction === 'KJ' ? 'КЖ' : 'КМ'}: ${data.stage}, бригада ${data.crew.length} чел., позиций затрат ${data.costs.length}` } })
		return NextResponse.json({ reportId: report.id }, { status: 201 })
	} catch (error: unknown) {
		if ((error as { code?: string }).code === 'P2002') {
			const report = await prisma.siteWork.findUnique({ where: { clientSubmissionId: data.clientSubmissionId }, select: { id: true, siteId: true } })
			if (report?.siteId === site.id) return NextResponse.json({ reportId: report.id, resumed: true })
		}
		throw error
	}
}

export const POST = withApiAuth(post, { access: 'write', csrf: true })
