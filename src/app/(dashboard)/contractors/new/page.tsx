import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import Topbar from '@/components/Topbar'
import { Card, Field, FormError, inputClass, textareaClass } from '@/components/ui'
import { canWrite, requireUser } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { contractorSchema, firstIssue, orNull } from '@/lib/validation'
import { findMatchingContractor } from '@/lib/contractor-match'
import ContractorTypeFields from '@/components/ContractorTypeFields'

function parseAliases(value: string) {
	return [...new Set(value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))]
}

export default async function NewContractorPage({ searchParams }: { searchParams: { error?: string; returnTo?: string } }) {
	const user = await requireUser()
	if (!canWrite(user)) redirect('/contractors')
	const returnToContract = searchParams.returnTo === 'contract'

	async function createContractor(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		if (!canWrite(actingUser)) redirect('/contractors')
		const parsed = contractorSchema.safeParse({
			name: String(formData.get('name') ?? ''), aliases: String(formData.get('aliases') ?? ''),
			type: String(formData.get('type') ?? 'LEGAL'),
			inn: String(formData.get('inn') ?? ''), address: String(formData.get('address') ?? ''),
			phone: String(formData.get('phone') ?? ''), email: String(formData.get('email') ?? ''),
			snils: String(formData.get('snils') ?? ''), passportSeries: String(formData.get('passportSeries') ?? ''),
			passportNumber: String(formData.get('passportNumber') ?? ''), passportIssuedBy: String(formData.get('passportIssuedBy') ?? ''),
			passportIssuedAt: String(formData.get('passportIssuedAt') ?? ''), passportDeptCode: String(formData.get('passportDeptCode') ?? ''),
			representativeName: String(formData.get('representativeName') ?? ''), representativeSnils: String(formData.get('representativeSnils') ?? ''),
			representativePassportSeries: String(formData.get('representativePassportSeries') ?? ''), representativePassportNumber: String(formData.get('representativePassportNumber') ?? ''),
			representativePassportIssuedBy: String(formData.get('representativePassportIssuedBy') ?? ''), representativePassportIssuedAt: String(formData.get('representativePassportIssuedAt') ?? ''),
			representativePassportDeptCode: String(formData.get('representativePassportDeptCode') ?? ''),
			representativeProxyNumber: String(formData.get('representativeProxyNumber') ?? ''), representativeProxyDate: String(formData.get('representativeProxyDate') ?? ''),
		})
		const suffix = returnToContract ? '&returnTo=contract' : ''
		if (!parsed.success) redirect(`/contractors/new?error=${encodeURIComponent(firstIssue(parsed.error))}${suffix}`)
		const data = parsed.data
		const inn = orNull(data.inn)
		const duplicate = await findMatchingContractor({ name: data.name, inn, phone: data.phone, email: data.email })
		// В мастере договора возвращаем сразу к уже существующему контрагенту.
		if (duplicate && returnToContract) redirect(`/contracts/new?contractor=${duplicate.id}`)
		if (duplicate) redirect(`/contractors/new?error=${encodeURIComponent(`Похожий контрагент уже существует: ${duplicate.name}`)}${suffix}`)

		let created: { id: string }
		try {
			created = await prisma.contractor.create({
				data: {
					name: data.name, aliases: parseAliases(data.aliases ?? ''), type: data.type, inn, address: orNull(data.address), phone: orNull(data.phone), email: orNull(data.email),
					snils: orNull(data.snils), passportSeries: orNull(data.passportSeries), passportNumber: orNull(data.passportNumber),
					passportIssuedBy: orNull(data.passportIssuedBy), passportIssuedAt: data.passportIssuedAt ? new Date(`${data.passportIssuedAt}T12:00:00`) : null, passportDeptCode: orNull(data.passportDeptCode),
					representativeName: orNull(data.representativeName), representativeSnils: orNull(data.representativeSnils),
					representativePassportSeries: orNull(data.representativePassportSeries), representativePassportNumber: orNull(data.representativePassportNumber),
					representativePassportIssuedBy: orNull(data.representativePassportIssuedBy),
					representativePassportIssuedAt: data.representativePassportIssuedAt ? new Date(`${data.representativePassportIssuedAt}T12:00:00`) : null,
					representativePassportDeptCode: orNull(data.representativePassportDeptCode),
					representativeProxyNumber: orNull(data.representativeProxyNumber),
					representativeProxyDate: data.representativeProxyDate ? new Date(`${data.representativeProxyDate}T12:00:00`) : null,
				},
				select: { id: true },
			})
		} catch (error) {
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') redirect(`/contractors/new?error=${encodeURIComponent('Контрагент с такими реквизитами уже существует')}${suffix}`)
			throw error
		}
		await writeAudit({ userId: actingUser.id, action: 'CREATE', entityType: 'Contractor', entityId: created.id })
		redirect(returnToContract ? `/contracts/new?contractor=${created.id}` : `/contractors/${created.id}`)
	}

	const name = user.name ?? user.email ?? ''
	return <>
		<Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Контрагенты', href: '/contractors' }, { label: 'Новый контрагент' }]} userName={name.split(' ')[0]} initials={initials(name)} />
		<div className="workspace-content">
			<div className="mb-[20px]"><h1 className="text-2xl font-bold tracking-[-0.02em]">Новый контрагент</h1><p className="mt-[5px] text-base text-muted">{returnToContract ? 'После сохранения вернёмся к созданию договора.' : 'Реквизиты и варианты названия для быстрого поиска.'}</p></div>
			<div className="max-w-[680px]"><FormError message={searchParams.error} /><Card className="mt-[14px] p-[22px]">
				<form action={createContractor} className="flex flex-col gap-3.5">
					<Field label="Название организации" required><input name="name" required className={inputClass} placeholder="ООО «Строймонтаж» или ФИО" /></Field>
					<ContractorTypeFields />
					<Field label="Другие названия" hint="Каждое с новой строки или через запятую — они будут участвовать в поиске"><textarea name="aliases" className={textareaClass} placeholder={'Строймонтаж\nООО СМ'} /></Field>
					<div className="grid grid-cols-1 gap-3.5 md:grid-cols-2"><Field label="ИНН"><input name="inn" inputMode="numeric" className={inputClass} placeholder="10 или 12 цифр" /></Field><Field label="Телефон"><input name="phone" className={inputClass} placeholder="+7 900 000-00-00" /></Field></div>
					<Field label="Email"><input name="email" type="email" className={inputClass} placeholder="office@company.ru" /></Field>
					<Field label="Адрес"><input name="address" className={inputClass} /></Field>
					<div className="mt-[5px] flex gap-2.5"><button className="brand-gradient inline-flex h-control items-center rounded-control px-4 text-base font-semibold text-white">Сохранить контрагента</button><Link href={returnToContract ? '/contracts/new' : '/contractors'} className="inline-flex h-control items-center rounded-control border border-line bg-surface px-4 text-base font-semibold hover:bg-raised">Отмена</Link></div>
				</form>
			</Card></div>
		</div>
	</>
}
