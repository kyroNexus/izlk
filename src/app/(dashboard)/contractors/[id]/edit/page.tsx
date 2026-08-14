import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { assertContractorAccess, requireUser } from '@/lib/access'
import Topbar from '@/components/Topbar'
import { Card, textareaClass } from '@/components/ui'
import { initials } from '@/lib/format'
import { contractorSchema, firstIssue, orNull } from '@/lib/validation'
import { Prisma } from '@prisma/client'
import ContractorTypeFields from '@/components/ContractorTypeFields'

const FIELD_CLASS =
	'h-[40px] w-full rounded-[10px] border border-line bg-surface px-[13px] text-[13.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand focus:ring-[3px] focus:ring-brand/20'

// В Next.js 14 params и searchParams — ОБЫЧНЫЕ объекты, не Promise. Не добавляйте await.
export default async function EditContractorPage({
	params,
	searchParams,
}: {
	params: { id: string }
	searchParams: { error?: string }
}) {
	const user = await requireUser()
	const contractorId = params.id

	// Единая проверка доступа вместо ручной проверки роли.
	await assertContractorAccess(contractorId, user, { write: true })

	const contractor = await prisma.contractor.findFirst({
		where: { id: contractorId, deletedAt: null },
		select: { id: true, name: true, aliases: true, type: true, inn: true, address: true, phone: true, email: true, snils: true, passportSeries: true, passportNumber: true, passportIssuedBy: true, passportIssuedAt: true, passportDeptCode: true },
	})

	if (!contractor) redirect('/contractors')

	async function updateContractor(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		await assertContractorAccess(contractorId, actingUser, { write: true })

		const parsed = contractorSchema.safeParse({
			name: String(formData.get('name') ?? ''),
			aliases: String(formData.get('aliases') ?? ''),
			type: String(formData.get('type') ?? 'LEGAL'),
			inn: String(formData.get('inn') ?? ''),
			address: String(formData.get('address') ?? ''),
			phone: String(formData.get('phone') ?? ''),
			email: String(formData.get('email') ?? ''),
			snils: String(formData.get('snils') ?? ''),
			passportSeries: String(formData.get('passportSeries') ?? ''),
			passportNumber: String(formData.get('passportNumber') ?? ''),
			passportIssuedBy: String(formData.get('passportIssuedBy') ?? ''),
			passportIssuedAt: String(formData.get('passportIssuedAt') ?? ''),
			passportDeptCode: String(formData.get('passportDeptCode') ?? ''),
		})
		if (!parsed.success) {
			redirect(
				`/contractors/${contractorId}/edit?error=${encodeURIComponent(firstIssue(parsed.error))}`,
			)
		}
		const data = parsed.data

		// Проверка на дубль по ИНН — одна компания часто заводится дважды.
		const inn = orNull(data.inn)
		if (inn) {
			const duplicate = await prisma.contractor.findFirst({
				where: { inn, deletedAt: null, NOT: { id: contractorId } },
				select: { id: true },
			})
			if (duplicate) {
				redirect(
					`/contractors/${contractorId}/edit?error=${encodeURIComponent('Контрагент с таким ИНН уже есть в базе')}`,
				)
			}
		}

		try {
			await prisma.contractor.update({
				where: { id: contractorId },
				data: {
					name: data.name,
					aliases: [...new Set((data.aliases ?? '').split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))],
					type: data.type,
					inn,
					address: orNull(data.address),
					phone: orNull(data.phone),
					email: orNull(data.email),
					snils: orNull(data.snils),
					passportSeries: orNull(data.passportSeries),
					passportNumber: orNull(data.passportNumber),
					passportIssuedBy: orNull(data.passportIssuedBy),
					passportIssuedAt: data.passportIssuedAt ? new Date(`${data.passportIssuedAt}T12:00:00`) : null,
					passportDeptCode: orNull(data.passportDeptCode),
				},
			})
		} catch (e) {
			if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
				redirect(
					`/contractors/${contractorId}/edit?error=${encodeURIComponent('Контрагент с такими данными уже существует')}`,
				)
			}
			throw e
		}

		redirect(`/contractors/${contractorId}`)
	}

	const name = user.name ?? user.email ?? ''

	return (
		<>
			<Topbar
				crumbs={[
					{ label: 'Главная', href: '/' },
					{ label: 'Контрагенты', href: '/contractors' },
					{ label: 'Редактирование' },
				]}
				userName={name.split(' ')[0]}
				initials={initials(name)}
			/>

			<div className="px-[26px] py-[22px]">
				<div className="mb-[20px]">
					<h1 className="text-[26px] font-bold tracking-[-0.02em]">{'Редактирование контрагента'}</h1>
					<div className="mt-[4px] text-[13px] text-faint">{contractor.name}</div>
				</div>

				{searchParams.error && (
					<div className="mb-[16px] max-w-[560px] rounded-[10px] border border-danger-bd bg-danger-bg px-[15px] py-[11px] text-[13px] text-danger">
						{searchParams.error}
					</div>
				)}

				<Card className="max-w-[560px] p-[22px]">
					<form action={updateContractor} className="flex flex-col gap-[16px]">
						<div>
							<label className="mb-[6px] block text-[12.5px] font-medium text-muted">{'Название *'}</label>
							<input name="name" required defaultValue={contractor.name} className={FIELD_CLASS} />
						</div>
						<ContractorTypeFields
							defaultType={contractor.type}
							defaults={{
								snils: contractor.snils,
								passportSeries: contractor.passportSeries,
								passportNumber: contractor.passportNumber,
								passportIssuedBy: contractor.passportIssuedBy,
								passportIssuedAt: contractor.passportIssuedAt ? contractor.passportIssuedAt.toISOString().slice(0, 10) : null,
								passportDeptCode: contractor.passportDeptCode,
							}}
						/>
						<div>
							<label className="mb-[6px] block text-[12.5px] font-medium text-muted">Другие названия</label>
							<textarea name="aliases" defaultValue={contractor.aliases.join('\n')} className={textareaClass} placeholder="Каждое название с новой строки" />
						</div>
						<div>
							<label className="mb-[6px] block text-[12.5px] font-medium text-muted">{'ИНН'}</label>
							<input name="inn" defaultValue={contractor.inn ?? ''} className={FIELD_CLASS} placeholder="10 или 12 цифр" />
						</div>
						<div>
							<label className="mb-[6px] block text-[12.5px] font-medium text-muted">{'Адрес'}</label>
							<input name="address" defaultValue={contractor.address ?? ''} className={FIELD_CLASS} />
						</div>
						<div className="grid grid-cols-2 gap-[14px]">
							<div>
								<label className="mb-[6px] block text-[12.5px] font-medium text-muted">{'Телефон'}</label>
								<input name="phone" defaultValue={contractor.phone ?? ''} className={FIELD_CLASS} />
							</div>
							<div>
								<label className="mb-[6px] block text-[12.5px] font-medium text-muted">Email</label>
								<input name="email" type="email" defaultValue={contractor.email ?? ''} className={FIELD_CLASS} />
							</div>
						</div>

						<div className="mt-[6px] flex gap-[10px]">
							<button
								type="submit"
								className="brand-gradient inline-flex h-[40px] items-center justify-center rounded-[10px] px-[18px] text-[13.5px] font-semibold text-white"
							>
								{'Сохранить'}
							</button>
							<Link
								href={`/contractors/${contractorId}`}
								className="inline-flex h-[40px] items-center justify-center rounded-[10px] border border-line bg-surface px-[18px] text-[13.5px] font-semibold hover:bg-raised"
							>
								{'Отмена'}
							</Link>
						</div>
					</form>
				</Card>
			</div>
		</>
	)
}
