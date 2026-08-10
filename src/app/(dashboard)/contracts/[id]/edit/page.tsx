import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/Topbar'
import { Card, Field, FormError, inputClass, selectClass } from '@/components/ui'
import { initials } from '@/lib/format'
import { assertContractAccess, canWrite, requireUser } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { contractSchema, firstIssue, orNull, parseAmount, parseDate } from '@/lib/validation'

export const dynamic = 'force-dynamic'

// В Next.js 14 params и searchParams — ОБЫЧНЫЕ объекты, не Promise. Не добавляйте await.
export default async function EditContractPage({
	params,
	searchParams,
}: {
	params: { id: string }
	searchParams: { error?: string }
}) {
	const user = await requireUser()
	const contractId = params.id
	await assertContractAccess(contractId, user, { write: true })

	const [contract, contractors, managers] = await Promise.all([
		prisma.contract.findFirst({
			where: { id: contractId, deletedAt: null },
			select: {
				id: true,
				number: true,
				cipher: true,
				contractorId: true,
				managerId: true,
				date: true,
				amount: true,
				smrAmount: true,
				mkAmount: true,
				deliveryAmount: true,
				currency: true,
				status: true,
				kind: true,
				objectAddress: true,
			},
		}),
		prisma.contractor.findMany({
			where: { deletedAt: null },
			select: { id: true, name: true },
			orderBy: { name: 'asc' },
			take: 500,
		}),
		prisma.user.findMany({
			where: { deletedAt: null, isActive: true, role: { in: ['ADMIN', 'MANAGER'] } },
			select: { id: true, name: true },
			orderBy: { name: 'asc' },
		}),
	])

	if (!contract) redirect('/contracts')

	async function updateContract(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		await assertContractAccess(contractId, actingUser, { write: true })

		// Явный тип never обязателен: без него TypeScript не понимает, что после fail()
		// код не выполняется, и ругается на «possibly undefined».
		const fail: (message: string) => never = (message) =>
			redirect(`/contracts/${contractId}/edit?error=${encodeURIComponent(message)}`)

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

		const contractor = await prisma.contractor.findFirst({
			where: { id: data.contractorId, deletedAt: null },
			select: { id: true },
		})
		if (!contractor) fail('Контрагент не найден')

		// Уникальность номера — без учёта текущего договора.
		const duplicate = await prisma.contract.findFirst({
			where: { number: data.number, NOT: { id: contractId } },
			select: { id: true },
		})
		if (duplicate) fail(`Договор с номером ${data.number} уже существует`)

		await prisma.contract.update({
			where: { id: contractId },
			data: {
				number: data.number,
				cipher: orNull(data.cipher),
				contractorId: data.contractorId,
				managerId: orNull(data.managerId),
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
		})

		await writeAudit({
			userId: actingUser.id,
			action: 'UPDATE',
			entityType: 'Contract',
			entityId: contractId,
		})

		redirect(`/contracts/${contractId}`)
	}

	const name = user.name ?? user.email ?? ''
	const dateValue = contract.date.toISOString().slice(0, 10)
	const amountValue = String(contract.amount)
	const smrAmountValue = contract.smrAmount == null ? '' : String(contract.smrAmount)
	const mkAmountValue = contract.mkAmount == null ? '' : String(contract.mkAmount)
	const deliveryAmountValue = contract.deliveryAmount == null ? '' : String(contract.deliveryAmount)
	const canEdit = canWrite(user)

	return (
		<>
			<Topbar
				crumbs={[
					{ label: 'Главная', href: '/' },
					{ label: 'Договоры', href: '/contracts' },
					{ label: `№ ${contract.number}`, href: `/contracts/${contract.id}` },
					{ label: 'Редактирование' },
				]}
				userName={name.split(' ')[0]}
				initials={initials(name)}
			/>

			<div className="px-[26px] py-[22px]">
				<div className="mb-[20px]">
					<h1 className="text-[26px] font-bold tracking-[-0.02em]">Редактирование договора</h1>
					<div className="mt-[4px] text-[13px] text-faint">№ {contract.number}</div>
				</div>

				<div className="max-w-[640px]">
					<div className="mb-[14px]">
						<FormError message={searchParams.error} />
					</div>

					<Card className="p-[22px]">
						<form action={updateContract} className="flex flex-col gap-[15px]">
							<div className="grid grid-cols-2 gap-[14px]">
								<Field label="Номер договора" required>
									<input name="number" required defaultValue={contract.number} className={inputClass} />
								</Field>
								<Field label="Шифр объекта">
									<input name="cipher" defaultValue={contract.cipher ?? ''} className={inputClass} />
								</Field>
							</div>

							<Field label="Контрагент" required>
								<select name="contractorId" required defaultValue={contract.contractorId} className={selectClass}>
									{contractors.map((c) => (
										<option key={c.id} value={c.id}>
											{c.name}
										</option>
									))}
								</select>
							</Field>

							<div className="grid grid-cols-2 gap-[14px]">
								<Field label="Дата договора" required>
									<input type="date" name="date" required defaultValue={dateValue} className={inputClass} />
								</Field>
								<Field label="Сумма" required>
									<input name="amount" required defaultValue={amountValue} className={inputClass} />
								</Field>
							</div>

							<div className="rounded-[11px] border border-line bg-raised/40 p-[12px]">
								<div className="mb-[9px] text-[12.5px] font-semibold">Структура суммы <span className="font-normal text-faint">(необязательно)</span></div>
								<div className="grid grid-cols-3 gap-[10px]">
									<Field label="СМР"><input name="smrAmount" inputMode="decimal" defaultValue={smrAmountValue} className={inputClass} placeholder="0" /></Field>
									<Field label="МК"><input name="mkAmount" inputMode="decimal" defaultValue={mkAmountValue} className={inputClass} placeholder="0" /></Field>
									<Field label="Доставка"><input name="deliveryAmount" inputMode="decimal" defaultValue={deliveryAmountValue} className={inputClass} placeholder="0" /></Field>
								</div>
							</div>

							<div className="grid grid-cols-4 gap-[14px]">
								<Field label="Тип договора"><select name="kind" defaultValue={contract.kind} className={selectClass}><option value="SMR">СМР</option><option value="MK">МК</option><option value="PROJECT">Проектный</option></select></Field>
								<Field label="Валюта">
									<select name="currency" defaultValue={contract.currency} className={selectClass}>
										<option value="RUB">RUB</option>
										<option value="USD">USD</option>
										<option value="EUR">EUR</option>
										<option value="CNY">CNY</option>
									</select>
								</Field>
								<Field label="Статус">
									<select name="status" defaultValue={contract.status} className={selectClass}>
										<option value="ACTIVE">В работе</option>
										<option value="CLOSED">Завершён</option>
										<option value="ARCHIVED">В архиве</option>
									</select>
								</Field>
								<Field label="Менеджер">
									<select name="managerId" defaultValue={contract.managerId ?? ''} className={selectClass}>
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
								<input name="objectAddress" defaultValue={contract.objectAddress ?? ''} className={inputClass} />
							</Field>

							<div className="mt-[6px] flex gap-[10px]">
								<button
									type="submit"
									disabled={!canEdit}
									className="brand-gradient inline-flex h-[40px] items-center justify-center rounded-[10px] px-[18px] text-[13.5px] font-semibold text-white disabled:opacity-60"
								>
									Сохранить
								</button>
								<Link
									href={`/contracts/${contract.id}`}
									className="inline-flex h-[40px] items-center justify-center rounded-[10px] border border-line bg-surface px-[18px] text-[13.5px] font-semibold hover:bg-raised"
								>
									Вернуться к договору
								</Link>
							</div>
						</form>
					</Card>
				</div>
			</div>
		</>
	)
}
