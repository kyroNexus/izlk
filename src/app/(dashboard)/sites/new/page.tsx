import Link from 'next/link'
import { redirect } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { Card, Field, FormError, inputClass, selectClass } from '@/components/ui'
import { canWrite, contractScope, requireUser } from '@/lib/access'
import { initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'

export default async function NewSitePage({ searchParams }: { searchParams: { error?: string; contract?: string } }) {
	const user = await requireUser()
	if (!canWrite(user) && user.role !== 'BUILDER') redirect('/sites')
	const contracts = await prisma.contract.findMany({
		where: { ...contractScope(user), status: 'ACTIVE', sites: { none: { deletedAt: null } } },
		select: { id: true, number: true, cipher: true, objectAddress: true, contractor: { select: { name: true } } },
		orderBy: { date: 'desc' }, take: 1000,
	})

	async function createSite(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		if (!canWrite(actingUser) && actingUser.role !== 'BUILDER') redirect('/sites')
		const contractId = String(formData.get('contractId') ?? '')
		const address = String(formData.get('address') ?? '').trim()
		const contract = await prisma.contract.findFirst({ where: { id: contractId, ...contractScope(actingUser), sites: { none: { deletedAt: null } } }, select: { id: true } })
		if (!contract || !address) redirect(`/sites/new?error=${encodeURIComponent('Выберите договор и укажите адрес площадки')}`)
		const site = await prisma.site.create({ data: { contractId, address }, select: { id: true } })
		await prisma.siteEvent.create({ data: { siteId: site.id, type: 'INFO', text: 'Площадка создана' } })
		redirect(`/sites/${site.id}`)
	}

	const name = user.name ?? user.email ?? ''
	return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Площадки', href: '/sites' }, { label: 'Новая площадка' }]} userName={name.split(' ')[0]} initials={initials(name)} /><div className="workspace-content"><h1 className="text-2xl font-bold">Новая площадка</h1><p className="mb-[16px] mt-[5px] text-base text-muted">Выберите договор — шифр, заказчик и адрес будут связаны автоматически.</p><div className="max-w-[680px]"><FormError message={searchParams.error} /><Card className="mt-[14px] p-[22px]"><form action={createSite} className="flex flex-col gap-3.5"><Field label="Договор" required><select name="contractId" required defaultValue={searchParams.contract ?? ''} className={selectClass}><option value="" disabled>Выберите активный договор</option>{contracts.map((contract) => <option key={contract.id} value={contract.id}>№ {contract.number} · {contract.contractor.name}{contract.cipher ? ` · ${contract.cipher}` : ''}</option>)}</select></Field><Field label="Адрес площадки" required><input name="address" required className={inputClass} placeholder="Адрес объекта" /></Field><div className="flex gap-2.5"><button className="brand-gradient inline-flex h-control items-center rounded-control px-4 text-base font-semibold text-white">Создать площадку</button><Link href="/sites" className="inline-flex h-control items-center rounded-control border border-line px-4 text-base font-semibold">Отмена</Link></div></form></Card></div></div></>
}
