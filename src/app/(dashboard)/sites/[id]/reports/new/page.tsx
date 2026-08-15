import { redirect } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { FormError } from '@/components/ui'
import { assertContractAccess, canWrite, requireUser } from '@/lib/access'
import { initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import ReportForm from './ReportForm'

export default async function NewSiteReportPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
	const user = await requireUser()
	if (!canWrite(user) && user.role !== 'BUILDER') redirect(`/sites/${params.id}`)
	const site = await prisma.site.findFirst({ where: { id: params.id, deletedAt: null }, select: { id: true, address: true, contract: { select: { id: true, number: true } } } })
	if (!site) redirect('/sites')
	await assertContractAccess(site.contract.id, user, { write: true })

	const name = user.name ?? user.email ?? '', today = new Date().toISOString().slice(0, 10)
	return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Площадки', href: '/sites' }, { label: `Договор №${site.contract.number}`, href: `/sites/${site.id}` }, { label: 'Дневной отчёт' }]} userName={name.split(' ')[0]} initials={initials(name)} /><div className="px-[14px] py-[16px] sm:px-[26px] sm:py-[22px]"><h1 className="text-[26px] font-bold">Новый фотоотчёт</h1><p className="mb-[16px] mt-[5px] text-[13px] text-muted">{site.address} · договор №{site.contract.number}</p><div className="max-w-[1080px]"><FormError message={searchParams.error} /><div className="mt-[14px]"><ReportForm siteId={site.id} today={today} /></div></div></div></>
}
