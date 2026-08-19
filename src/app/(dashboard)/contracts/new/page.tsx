import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/Topbar'
import { Card, Field, FormError, inputClass, selectClass } from '@/components/ui'
import { initials } from '@/lib/format'
import { canWrite, grantDesignReadAccess, requireUser } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { EXEC_TEMPLATES } from '@/lib/executive'
import { contractSchema, firstIssue, orNull, parseAmount, parseDate } from '@/lib/validation'
import { additionalCustomerIds } from '@/lib/contract-customers'

export const dynamic = 'force-dynamic'

// В Next.js 14 params и searchParams — ОБЫЧНЫЕ объекты, не Promise. Не добавляйте await.
export default async function NewContractPage({
	searchParams,
}: {
	searchParams: { error?: string; contractor?: string }
}) {
	const user = await requireUser()
	if (!canWrite(user)) redirect('/contracts')

	const [contractors, managers] = await Promise.all([
		prisma.contractor.findMany({
			where: { deletedAt: null },
			select: { id: true, name: true, inn: true },
			orderBy: { name: 'asc' },
			take: 1000,
		}),
		prisma.user.findMany({
			where: { deletedAt: null, isActive: true, role: { in: ['ADMIN', 'MANAGER'] } },
			select: { id: true, name: true },
			orderBy: { name: 'asc' },
		}),
	])

	async function createContract(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		if (!canWrite(actingUser)) redirect('/contracts')

		// Явный тип never обязателен: без него TypeScript не понимает, что после fail()
		// код не выполняется, и ругается на «possibly undefined».
		const fail: (message: string) => never = (message) =>
			redirect(`/contracts/new?error=${encodeURIComponent(message)}`)

		const parsed = contractSchema.safeParse({
			number: String(formData.get('number') ?? ''),
			cipher: String(formData.get('cipher') ?? ''),
			contractorId: String(formData.get('contractorId') ?? ''),
			managerId: String(formData.get('managerId') ?? ''),
			date: String(formData.get('date') ?? ''),
			amount: String(formData.get('amount') ?? ''),
			currency: String(formData.get('currency') ?? 'RUB'),
			status: String(formData.get('status') ?? 'ACTIVE'),
			kind: String(formData.get('kind') ?? 'SMR'),
			objectAddress: String(formData.get('objectAddress') ?? ''),
		})
		if (!parsed.success) fail(firstIssue(parsed.error))
		const data = parsed.data

		const amount = parseAmount(data.amount)
		if (!amount) fail('Сумма указана неверно')
		const parseBreakdown = (field: string, label: string) => {
			const raw = orNull(String(formData.get(field) ?? ''))
			if (!raw) return null
			const value = parseAmount(raw)
			if (!value) fail(`${label}: укажите корректную сумму`)
			return value
		}
		const smrAmount = parseBreakdown('smrAmount', 'СМР')
		const mkAmount = parseBreakdown('mkAmount', 'МК')
		const deliveryAmount = parseBreakdown('deliveryAmount', 'Доставка')
		const breakdownTotal = [smrAmount, mkAmount, deliveryAmount].reduce((sum, value) => sum + Number(value ?? 0), 0)
		if (breakdownTotal > Number(amount)) fail('Сумма СМР, МК и доставки не может быть больше общей суммы договора')

		const date = parseDate(data.date)
		if (!date) fail('Дата указана неверно')

		// Контрагент и менеджер приходят из формы — проверяем существование.
		const contractor = await prisma.contractor.findFirst({
			where: { id: data.contractorId, deletedAt: null },
			select: { id: true },
		})
		if (!contractor) fail('Контрагент не найден')
		const extraCustomerIds = additionalCustomerIds(formData.getAll('additionalContractorIds'), data.contractorId)
		if (extraCustomerIds.length) {
			const found = await prisma.contractor.count({ where: { id: { in: extraCustomerIds }, deletedAt: null } })
			if (found !== extraCustomerIds.length) fail('Один из дополнительных заказчиков не найден')
		}

		const managerId = orNull(data.managerId)
		if (managerId) {
			const manager = await prisma.user.findFirst({
				where: { id: managerId, deletedAt: null },
				select: { id: true },
			})
			if (!manager) fail('Менеджер не найден')
		}

		// Номер договора уникален в схеме — без этой проверки пользователь
		// увидел бы необработанную ошибку Prisma P2002.
		const duplicate = await prisma.contract.findFirst({
			where: { number: data.number },
			select: { id: true },
		})
		if (duplicate) fail(`Договор с номером ${data.number} уже существует`)

		const created = await prisma.contract.create({
			data: {
				number: data.number,
				cipher: orNull(data.cipher),
				contractorId: data.contractorId,
				additionalCustomers: { createMany: { data: extraCustomerIds.map((contractorId) => ({ contractorId })) } },
				// A contract must always have an owner. An administrator may reassign it
				// later, but an empty manager makes the card and import workflow ambiguous.
				managerId: managerId ?? actingUser.id,
				date: date as Date,
				amount: amount as string,
				smrAmount,
				mkAmount,
				deliveryAmount,
				currency: data.currency,
				status: data.status,
				kind: data.kind,
				objectAddress: orNull(data.objectAddress),
			},
			select: { id: true },
		})
		if (EXEC_TEMPLATES[data.kind].length) {
			await prisma.executiveDoc.createMany({ data: EXEC_TEMPLATES[data.kind].map((name) => ({ contractId: created.id, name })) })
		}
		await grantDesignReadAccess(created.id)

		await writeAudit({
			userId: actingUser.id,
			action: 'CREATE',
			entityType: 'Contract',
			entityId: created.id,
		})

		redirect(`/contracts/${created.id}`)
	}

	const name = user.name ?? user.email ?? ''
	const today = new Date().toISOString().slice(0, 10)

	return (
		<>
			<Topbar
				crumbs={[
					{ label: 'Главная', href: '/' },
					{ label: 'Договоры', href: '/contracts' },
					{ label: 'Новый договор' },
				]}
				userName={name.split(' ')[0]}
				initials={initials(name)}
			/>

			<div className="workspace-content">
				<div className="mb-[20px]">
					<h1 className="text-2xl font-bold tracking-[-0.02em]">Новый договор</h1>
					<div className="mt-[4px] text-base text-faint">
						После создания можно загрузить сканы, добавить ДС и сметы
					</div>
				</div>

				<div className="max-w-[640px]">
					<div className="mb-[14px]">
						<FormError message={searchParams.error} />
					</div>

					{contractors.length === 0 ? (
						<Card className="p-[22px]">
							<div className="text-base text-muted">
								Сначала добавьте контрагента — договор нельзя создать без него.
							</div>
							<Link
								href="/contractors"
								className="mt-[14px] inline-flex h-control items-center rounded-control border border-line bg-surface px-3.5 text-base font-semibold hover:bg-raised"
							>
								К контрагентам
							</Link>
						</Card>
					) : (
						<Card className="p-[22px]">
							<form action={createContract} className="flex flex-col gap-3.5">
								<div className="grid grid-cols-2 gap-3.5">
									<Field label="Номер договора" required>
										<input name="number" required className={inputClass} placeholder="555" />
									</Field>
									<Field label="Шифр объекта" hint="Например: КБ-300.24.60.76.60">
										<input name="cipher" className={inputClass} />
									</Field>
								</div>

								<Field label="Дополнительные заказчики" hint="Необязательно; основной выберите ниже">
									<select name="additionalContractorIds" multiple className={`${selectClass} h-auto py-2`}>
										{contractors.map((c) => <option key={c.id} value={c.id}>{c.name}{c.inn ? ` · ИНН ${c.inn}` : ''}</option>)}
									</select>
								</Field>

								<div className="flex items-end gap-2.5">
									<Field label="Контрагент" required>
									<select name="contractorId" required defaultValue={searchParams.contractor ?? ''} className={selectClass}>
										<option value="" disabled>
											Выберите контрагента
										</option>
										{contractors.map((c) => (
											<option key={c.id} value={c.id}>
												{c.name}
												{c.inn ? ` · ИНН ${c.inn}` : ''}
											</option>
										))}
									</select>
									</Field>
									<Link href="/contractors/new?returnTo=contract" className="inline-flex h-control flex-none items-center rounded-control border border-brand/30 bg-brand/10 px-3 text-sm font-semibold text-brand-ink hover:bg-brand/15">+ Новый контрагент</Link>
								</div>

								<div className="grid grid-cols-2 gap-3.5">
									<Field label="Дата договора" required>
										<input type="date" name="date" required defaultValue={today} className={inputClass} />
									</Field>
									<Field label="Сумма" required hint="Разрешены пробелы и запятая">
										<input name="amount" required className={inputClass} placeholder="12 450 000,00" />
									</Field>
								</div>

								<div className="rounded-control border border-line bg-raised/40 p-3">
									<div className="mb-[9px] text-sm font-semibold">Структура суммы <span className="font-normal text-faint">(необязательно)</span></div>
									<div className="grid grid-cols-3 gap-2.5">
										<Field label="СМР"><input name="smrAmount" inputMode="decimal" className={inputClass} placeholder="0" /></Field>
										<Field label="МК"><input name="mkAmount" inputMode="decimal" className={inputClass} placeholder="0" /></Field>
										<Field label="Доставка"><input name="deliveryAmount" inputMode="decimal" className={inputClass} placeholder="0" /></Field>
									</div>
								</div>

								<div className="grid grid-cols-3 gap-3.5">
									<Field label="Тип договора"><select name="kind" defaultValue="SMR" className={selectClass}><option value="SMR">СМР — ИД и паспорт</option><option value="MK">МК — только паспорт</option><option value="PROJECT">Проектный</option></select></Field>
									<Field label="Валюта">
										<select name="currency" defaultValue="RUB" className={selectClass}>
											<option value="RUB">RUB</option>
											<option value="USD">USD</option>
											<option value="EUR">EUR</option>
											<option value="CNY">CNY</option>
										</select>
									</Field>
									<Field label="Статус">
										<select name="status" defaultValue="ACTIVE" className={selectClass}>
											<option value="ACTIVE">В работе</option>
											<option value="CLOSED">Завершён</option>
											<option value="ARCHIVED">В архиве</option>
										</select>
									</Field>
									<Field label="Менеджер">
										<select
											name="managerId"
											defaultValue={user.role === 'MANAGER' ? user.id : ''}
											className={selectClass}
										>
											<option value="">Не назначен</option>
											{managers.map((m) => (
												<option key={m.id} value={m.id}>
													{m.name}
												</option>
											))}
										</select>
									</Field>
								</div>

								<Field label="Адрес объекта">
									<input name="objectAddress" className={inputClass} />
								</Field>

								<div className="mt-[6px] flex gap-2.5">
									<button
										type="submit"
										className="brand-gradient inline-flex h-control items-center justify-center rounded-control px-4 text-base font-semibold text-white"
									>
										Создать договор
									</button>
									<Link
										href="/contracts"
										className="inline-flex h-control items-center justify-center rounded-control border border-line bg-surface px-4 text-base font-semibold hover:bg-raised"
									>
										Отмена
									</Link>
								</div>
							</form>
						</Card>
					)}
				</div>
			</div>
		</>
	)
}
