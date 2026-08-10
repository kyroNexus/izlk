import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Шлюз для интеграции с 1С.
 *
 * Мы намеренно не подключаемся напрямую к базе 1С: доступ к чужой рабочей
 * базе, её таблицам и правам должен настраивать их IT. Вместо этого 1С может
 * по расписанию забирать согласованный JSON по HTTPS и сопоставлять поля в
 * своей обработке. Токен хранится только в окружении сервера.
 */
export async function GET(request: Request) {
	const token = process.env.ONE_C_API_TOKEN?.trim()
	if (!token) {
		return NextResponse.json(
			{ error: 'Интеграция 1С ещё не настроена', code: 'ONE_C_API_TOKEN_MISSING' },
			{ status: 503 },
		)
	}

	const authorization = request.headers.get('authorization')
	if (authorization !== `Bearer ${token}`) {
		return NextResponse.json({ error: 'Недействительный токен' }, { status: 401 })
	}

	const contracts = await prisma.contract.findMany({
		where: { deletedAt: null },
		select: {
			id: true,
			number: true,
			cipher: true,
			date: true,
			amount: true,
			currency: true,
			status: true,
			kind: true,
			workflowStage: true,
			workingDays: true,
			deadline: true,
			objectAddress: true,
			updatedAt: true,
			contractor: { select: { name: true, inn: true, address: true, phone: true, email: true } },
			manager: { select: { name: true, email: true } },
			projectSections: { where: { deletedAt: null }, select: { code: true, queueStatus: true, deadline: true } },
			invoices: { where: { deletedAt: null }, select: { number: true, amount: true, status: true, dueDate: true } },
		},
		orderBy: { updatedAt: 'desc' },
		take: 2000,
	})

	const payload = contracts.map((contract) => {
		const invoices = contract.invoices.filter((invoice) => invoice.status !== 'CANCELLED')
		const invoiced = invoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0)
		const paid = invoices.filter((invoice) => invoice.status === 'PAID').reduce((sum, invoice) => sum + Number(invoice.amount), 0)
		const overdue = invoices.filter((invoice) => invoice.status === 'OVERDUE').reduce((sum, invoice) => sum + Number(invoice.amount), 0)

		return {
			id: contract.id,
			number: contract.number,
			cipher: contract.cipher,
			date: contract.date.toISOString(),
			amount: Number(contract.amount),
			currency: contract.currency,
			status: contract.status,
			workflowStage: contract.workflowStage,
			kind: contract.kind,
			workingDays: contract.workingDays,
			deadline: contract.deadline?.toISOString() ?? null,
			objectAddress: contract.objectAddress,
			updatedAt: contract.updatedAt.toISOString(),
			contractor: contract.contractor,
			manager: contract.manager,
			projectSections: contract.projectSections.map((section) => ({ ...section, deadline: section.deadline?.toISOString() ?? null })),
			paymentSummary: { invoiced, paid, outstanding: invoiced - paid, overdue },
		}
	})

	return NextResponse.json({
		version: '1.0',
		generatedAt: new Date().toISOString(),
		count: payload.length,
		contracts: payload,
	})
}
