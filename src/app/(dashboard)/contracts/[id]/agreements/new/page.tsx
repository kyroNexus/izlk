import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/Topbar'
import { Card } from '@/components/ui'
import { initials } from '@/lib/format'
import { agreementSchema, firstIssue, orNull, parseDate } from '@/lib/validation'
import { assertContractAccess, requireUser } from '@/lib/access'

const FIELD_CLASS =
	'h-control w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition-colors placeholder:text-faint focus:border-brand focus:ring-[3px] focus:ring-brand/20'

// В Next.js 14 params и searchParams — ОБЫЧНЫЕ объекты, не Promise. Не добавляйте await.
export default async function NewAgreementPage({
	params,
	searchParams,
}: {
	params: { id: string }
	searchParams: { error?: string }
}) {
	const session = await auth()
	const user = session!.user as { id: string; name?: string | null; email?: string | null; role: string }

	if (user.role === 'VIEWER') {
		return <div className="workspace-content text-base text-faint">{'Доступ ограничен'}</div>
	}

	const contractId = params.id

	const contract = await prisma.contract.findFirst({
		where: { id: contractId, deletedAt: null },
		select: {
			id: true,
			number: true,
			agreements: {
				where: { deletedAt: null },
				orderBy: { date: 'asc' },
				select: { id: true, number: true },
			},
		},
	})

	if (!contract) notFound()

	async function createAgreement(formData: FormData) {
		'use server'
		// Раньше проверялась только роль — MANAGER мог подставить в URL чужой contractId
		// и создать ДС в невидимом ему договоре. Теперь проверяется и доступ к договору.
		const actingUser = await requireUser()
		await assertContractAccess(contractId, actingUser, { write: true })

		const parsed = agreementSchema.safeParse({
			number: String(formData.get('number') ?? ''),
			date: String(formData.get('date') ?? ''),
			parentId: String(formData.get('parentId') ?? ''),
		})
		if (!parsed.success) {
			redirect(
				`/contracts/${contractId}/agreements/new?error=${encodeURIComponent(firstIssue(parsed.error))}`,
			)
		}
		const data = parsed.data

		const dateValue = parseDate(data.date)
		if (!dateValue) {
			redirect(
				`/contracts/${contractId}/agreements/new?error=${encodeURIComponent('Дата указана неверно')}`,
			)
		}

		// parentId приходит из формы и может указывать на ДС другого договора — проверяем.
		const parentId = orNull(data.parentId)
		if (parentId) {
			const parent = await prisma.agreement.findFirst({
				where: { id: parentId, contractId, deletedAt: null },
				select: { id: true },
			})
			if (!parent) {
				redirect(
					`/contracts/${contractId}/agreements/new?error=${encodeURIComponent('Выбранное ДС не относится к этому договору')}`,
				)
			}
		}

		await prisma.agreement.create({
			data: {
				contractId,
				number: data.number,
				date: dateValue,
				parentId,
			},
		})

		redirect(`/contracts/${contractId}`)
	}

	const name = user.name ?? user.email ?? ''

	return (
		<>
			<Topbar
				crumbs={[
					{ label: 'Главная', href: '/' },
					{ label: 'Договоры', href: '/contracts' },
					{ label: `№ ${contract.number}`, href: `/contracts/${contract.id}` },
					{ label: 'Новое доп. соглашение' },
				]}
				userName={name.split(' ')[0]}
				initials={initials(name)}
			/>

			<div className="workspace-content">
				<div className="mb-[20px]">
					<h1 className="text-2xl font-bold tracking-[-0.02em]">{'Новое доп. соглашение'}</h1>
					<div className="mt-[4px] text-base text-faint">{`К договору № ${contract.number}`}</div>
				</div>

				{searchParams.error && (
					<div className="mb-[16px] max-w-[560px] rounded-control border border-danger-bd bg-danger-bg px-3.5 py-2.5 text-base text-danger">
						{searchParams.error}
					</div>
				)}

				<Card className="max-w-[560px] p-[22px]">
					<form action={createAgreement} className="flex flex-col gap-4">
						<div className="grid grid-cols-2 gap-3.5">
							<div>
								<label className="mb-[6px] block text-sm font-medium text-muted">{'Номер *'}</label>
								<input name="number" required className={FIELD_CLASS} placeholder="ДС №1" />
							</div>
							<div>
								<label className="mb-[6px] block text-sm font-medium text-muted">{'Дата *'}</label>
								<input type="date" name="date" required className={FIELD_CLASS} />
							</div>
						</div>

						<div>
							<label className="mb-[6px] block text-sm font-medium text-muted">
								{'Предыдущее ДС в цепочке'}
							</label>
							<select name="parentId" defaultValue="" className={FIELD_CLASS}>
								<option value="">{'Нет — первое ДС к договору'}</option>
								{contract.agreements.map((a) => (
									<option key={a.id} value={a.id}>
										{a.number}
									</option>
								))}
							</select>
						</div>

						<div className="mt-[6px] flex gap-2.5">
							<button
								type="submit"
								className="brand-gradient inline-flex h-control items-center justify-center rounded-control px-4 text-base font-semibold text-white"
							>
								{'Создать ДС'}
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
