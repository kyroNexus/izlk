import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/Topbar'
import { Card } from '@/components/ui'
import { initials } from '@/lib/format'
import { invoiceSchema, firstIssue, orNull, parseAmount, parseDate } from '@/lib/validation'
import { canManageInvoices, requireUser } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

const FIELD_CLASS =
	'h-control w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition-colors placeholder:text-faint focus:border-brand focus:ring-[3px] focus:ring-brand/20'

// В Next.js 14 params и searchParams — ОБЫЧНЫЕ объекты, не Promise. Не добавляйте await.
export default async function NewInvoicePage({
	params,
	searchParams,
}: {
	params: { id: string }
	searchParams: { error?: string }
}) {
	const session = await auth()
	const user = session!.user as { id: string; name?: string | null; email?: string | null; role: string }

	// Задача C2: узкая проверка ИМЕННО для счетов, не общий canWrite — у
	// ACCOUNTING нигде больше в приложении прав на запись нет и не появляется.
	if (user.role !== 'ADMIN' && user.role !== 'MANAGER' && user.role !== 'ACCOUNTING') {
		return <div className="workspace-content text-base text-faint">{'Доступ ограничен'}</div>
	}

	const contractId = params.id

	const contract = await prisma.contract.findFirst({
		where: { id: contractId, deletedAt: null },
		select: { id: true, number: true },
	})

	if (!contract) notFound()

	async function createInvoice(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		if (!canManageInvoices(actingUser)) redirect(`/contracts/${contractId}`)

		const parsed = invoiceSchema.safeParse({
			number: String(formData.get('number') ?? ''),
			date: String(formData.get('date') ?? ''),
			amount: String(formData.get('amount') ?? ''),
			dueDate: String(formData.get('dueDate') ?? ''),
		})
		if (!parsed.success) {
			redirect(`/contracts/${contractId}/invoices/new?error=${encodeURIComponent(firstIssue(parsed.error))}`)
		}
		const data = parsed.data

		const dateValue = parseDate(data.date)
		if (!dateValue) {
			redirect(`/contracts/${contractId}/invoices/new?error=${encodeURIComponent('Дата указана неверно')}`)
		}

		const amount = parseAmount(data.amount)
		if (!amount) {
			redirect(`/contracts/${contractId}/invoices/new?error=${encodeURIComponent('Сумма указана неверно')}`)
		}

		const dueDateRaw = orNull(data.dueDate)
		const dueDate = dueDateRaw ? parseDate(dueDateRaw) : null
		if (dueDateRaw && !dueDate) {
			redirect(`/contracts/${contractId}/invoices/new?error=${encodeURIComponent('Срок оплаты указан неверно')}`)
		}

		const invoice = await prisma.invoice.create({
			data: { contractId, number: data.number, date: dateValue!, amount: amount!, dueDate },
			select: { id: true },
		})
		await writeAudit({ userId: actingUser.id, action: 'CREATE', entityType: 'Invoice', entityId: invoice.id })

		redirect(`/contracts/${contractId}/upload?invoice=${invoice.id}`)
	}

	const name = user.name ?? user.email ?? ''

	return (
		<>
			<Topbar
				crumbs={[
					{ label: 'Главная', href: '/' },
					{ label: 'Договоры', href: '/contracts' },
					{ label: `№ ${contract.number}`, href: `/contracts/${contract.id}` },
					{ label: 'Новый счёт' },
				]}
				userName={name.split(' ')[0]}
				initials={initials(name)}
			/>

			<div className="workspace-content">
				<div className="mb-[20px]">
					<h1 className="text-2xl font-bold tracking-[-0.02em]">{'Новый счёт'}</h1>
					<div className="mt-[4px] text-base text-faint">{`К договору № ${contract.number}`}</div>
				</div>

				{searchParams.error && (
					<div className="mb-[16px] max-w-[560px] rounded-control border border-danger-bd bg-danger-bg px-3.5 py-2.5 text-base text-danger">
						{searchParams.error}
					</div>
				)}

				<Card className="max-w-[560px] p-[22px]">
					<form action={createInvoice} className="flex flex-col gap-4">
						<div className="grid grid-cols-2 gap-3.5">
							<div>
								<label className="mb-[6px] block text-sm font-medium text-muted">{'Номер *'}</label>
								<input name="number" required className={FIELD_CLASS} placeholder="Счёт №1" />
							</div>
							<div>
								<label className="mb-[6px] block text-sm font-medium text-muted">{'Дата *'}</label>
								<input type="date" name="date" required className={FIELD_CLASS} />
							</div>
						</div>

						<div className="grid grid-cols-2 gap-3.5">
							<div>
								<label className="mb-[6px] block text-sm font-medium text-muted">{'Сумма *'}</label>
								<input name="amount" required inputMode="decimal" className={FIELD_CLASS} placeholder="0.00" />
							</div>
							<div>
								<label className="mb-[6px] block text-sm font-medium text-muted">{'Срок оплаты'}</label>
								<input type="date" name="dueDate" className={FIELD_CLASS} />
							</div>
						</div>

						<div className="mt-[6px] flex gap-2.5">
							<button
								type="submit"
								className="brand-gradient inline-flex h-control items-center justify-center rounded-control px-4 text-base font-semibold text-white"
							>
								{'Создать счёт'}
							</button>
							<Link
								href={`/contracts/${contract.id}`}
								className="inline-flex h-control items-center justify-center rounded-control border border-line bg-surface px-4 text-base font-semibold hover:bg-raised"
							>
								{'Вернуться к договору'}
							</Link>
						</div>
					</form>
				</Card>
			</div>
		</>
	)
}
