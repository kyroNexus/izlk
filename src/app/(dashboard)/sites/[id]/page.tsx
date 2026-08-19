import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { SiteStatus } from '@prisma/client'
import Topbar from '@/components/Topbar'
import { Card, CardHeader, Chip, EmptyState, KeyValue, StatTile } from '@/components/ui'
import { canWrite, contractScope, requireUser } from '@/lib/access'
import { formatDate, formatDateTime, formatMoney, initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { notify } from '@/lib/notifications'
import RenameFileButton from '@/components/RenameFileButton'

export const dynamic = 'force-dynamic'
const STATUS: Record<SiteStatus, { label: string; tone: 'ok' | 'warn' | 'off' | 'danger' }> = {
	PREPARING: { label: 'Подготовка', tone: 'off' }, ISSUE: { label: 'Проблема', tone: 'warn' }, READY: { label: 'Готова', tone: 'ok' }, BLOCKED: { label: 'Остановка', tone: 'danger' },
}
const EVENT_TONE: Record<string, 'ok' | 'warn' | 'off'> = { INFO: 'off', WARNING: 'warn', SUCCESS: 'ok' }

export default async function SitePage({ params }: { params: { id: string } }) {
	const user = await requireUser()
	const site = await prisma.site.findFirst({
		where: { id: params.id, deletedAt: null, contract: contractScope(user) },
		select: {
			id: true, address: true, status: true,
			contract: { select: { id: true, number: true, cipher: true, objectAddress: true, contractor: { select: { name: true } } } },
			events: { orderBy: { occurredAt: 'desc' }, select: { id: true, type: true, text: true, occurredAt: true }, take: 50 },
			works: { orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }], take: 100, include: { photos: { orderBy: { createdAt: 'asc' } }, crewEntries: { orderBy: { createdAt: 'asc' } }, costItems: { orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] } } },
		},
	})
	if (!site) redirect('/sites')

	async function updateStatus(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		if (!canWrite(actingUser) && actingUser.role !== 'BUILDER') redirect(`/sites/${params.id}`)
		const target = await prisma.site.findFirst({ where: { id: params.id, deletedAt: null, contract: contractScope(actingUser) }, select: { id: true, contract: { select: { id: true, number: true, managerId: true } } } })
		if (!target) redirect('/sites')
		const status = String(formData.get('status') ?? '') as SiteStatus
		const comment = String(formData.get('comment') ?? '').trim()
		if (!Object.keys(STATUS).includes(status)) redirect(`/sites/${params.id}`)
		if ((status === 'BLOCKED' || status === 'ISSUE') && !comment) redirect(`/sites/${params.id}?error=${encodeURIComponent('Для проблемы или остановки обязательно укажите причину')}`)
		await prisma.$transaction([
			prisma.site.update({ where: { id: target.id }, data: { status } }),
			prisma.siteEvent.create({ data: { siteId: target.id, type: status === 'READY' ? 'SUCCESS' : status === 'PREPARING' ? 'INFO' : 'WARNING', text: `${STATUS[status].label}${comment ? `: ${comment}` : ''}` } }),
		])
		if (status === 'BLOCKED' || status === 'ISSUE') await notify({ userId: target.contract.managerId, type: 'WARNING', title: status === 'BLOCKED' ? 'Площадка остановлена' : 'Проблема на площадке', message: `Договор № ${target.contract.number}: ${comment}`, href: `/sites/${target.id}`, dedupeKey: `site:${target.id}:${status}:${Date.now()}` })
		redirect(`/sites/${target.id}`)
	}

	async function deleteReport(formData: FormData) {
		'use server'
		const actingUser = await requireUser()
		if (!canWrite(actingUser) && actingUser.role !== 'BUILDER') redirect(`/sites/${params.id}`)
		const reportId = String(formData.get('reportId') ?? '')
		const report = await prisma.siteWork.findFirst({ where: { id: reportId, siteId: params.id, site: { contract: contractScope(actingUser) } }, select: { id: true, siteId: true, direction: true, workDate: true } })
		// Deleting an accidental report is maintenance, not a site issue. Do not create a WARNING here:
		// otherwise it replaces the actual reason for a stop/problem in the site's visible chronology.
		if (report) await prisma.siteWork.delete({ where: { id: report.id } })
		redirect(`/sites/${params.id}`)
	}

	const totals = site.works.reduce((sum, work) => ({ crew: sum.crew + Number(work.crewCost), equipment: sum.equipment + Number(work.equipmentCost), materials: sum.materials + Number(work.materialCost), other: sum.other + Number(work.otherCost) }), { crew: 0, equipment: 0, materials: 0, other: 0 })
	const grandTotal = totals.crew + totals.equipment + totals.materials + totals.other
	const kj = site.works.filter((work) => work.direction === 'KJ'), km = site.works.filter((work) => work.direction === 'KM')
	const name = user.name ?? user.email ?? ''

	return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Договоры', href: '/contracts' }, { label: `№ ${site.contract.number}`, href: `/contracts/${site.contract.id}#site` }, { label: site.address }]} userName={name.split(' ')[0]} initials={initials(name)} /><div className="workspace-content">
		<div className="mb-[18px] flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-[-0.02em]">{site.address}</h1><div className="mt-[6px] flex items-center gap-2"><Chip tone={STATUS[site.status].tone}>{STATUS[site.status].label}</Chip><span className="text-base text-muted">{site.contract.contractor.name}</span></div></div><div className="flex gap-2">{(canWrite(user) || user.role === 'BUILDER') && <Link href={`/sites/${site.id}/reports/new`} className="brand-gradient inline-flex min-h-[44px] items-center rounded-control px-3.5 text-base font-semibold text-white sm:min-h-control">Добавить фотоотчёт</Link>}<Link href={`/contracts/${site.contract.id}`} className="inline-flex min-h-[44px] items-center rounded-control border border-line bg-surface px-3.5 text-base font-semibold hover:bg-raised sm:min-h-control">← К договору №{site.contract.number}</Link></div></div>

		<div className="mb-[14px] grid grid-cols-2 gap-2.5 lg:grid-cols-5"><StatTile label="Всего затрат" value={formatMoney(grandTotal)} tone="brand" hint={`${site.works.length} дневных отчётов`} /><StatTile label="Зарплата" value={formatMoney(totals.crew)} /><StatTile label="Техника" value={formatMoney(totals.equipment)} /><StatTile label="Материалы" value={formatMoney(totals.materials)} /><StatTile label="Прочие" value={formatMoney(totals.other)} /></div>

		<div className="grid grid-cols-1 gap-3.5 xl:grid-cols-3"><Card><CardHeader title="Сведения" /><div className="px-4 py-2"><KeyValue label="Договор" value={`№ ${site.contract.number}`} /><KeyValue label="Шифр" value={site.contract.cipher ?? '—'} /><KeyValue label="Контрагент" value={site.contract.contractor.name} /><KeyValue label="Адрес объекта" value={site.contract.objectAddress ?? '—'} /><KeyValue label="Монтаж КЖ" value={`${kj.length} дн.`} /><KeyValue label="Монтаж КМ" value={`${km.length} дн.`} /></div></Card><Card className="xl:col-span-2"><CardHeader title="Статус площадки" extra="для остановки причина обязательна" />{(canWrite(user) || user.role === 'BUILDER') ? <form action={updateStatus} className="grid grid-cols-1 gap-2.5 p-4 md:grid-cols-[180px_1fr_auto]"><select name="status" defaultValue={site.status} className="h-control rounded-control border border-line bg-surface px-3 text-base"><option value="PREPARING">Подготовка</option><option value="ISSUE">Проблема</option><option value="BLOCKED">Остановка</option><option value="READY">Готова</option></select><input name="comment" placeholder="Причина проблемы/остановки или комментарий" className="h-control rounded-control border border-line bg-surface px-3 text-base" /><button className="h-control rounded-control border border-line bg-surface px-3.5 text-base font-semibold hover:bg-raised">Сохранить</button></form> : <EmptyState text="Статус доступен только для просмотра" />}</Card></div>

		<div className="mt-[14px] grid grid-cols-1 gap-3.5 xl:grid-cols-2">{(['KJ', 'KM'] as const).map((direction) => { const works = direction === 'KJ' ? kj : km; return <Card key={direction}><CardHeader title={`Монтаж ${direction === 'KJ' ? 'КЖ' : 'КМ'}`} extra={`${works.length} дн.`} />{works.length === 0 ? <EmptyState text={`Отчётов ${direction === 'KJ' ? 'КЖ' : 'КМ'} пока нет`} /> : <div>{works.map((work) => { const total = Number(work.crewCost) + Number(work.equipmentCost) + Number(work.materialCost) + Number(work.otherCost); return <div key={work.id} className="border-b border-line-soft p-4 last:border-b-0"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-semibold">{formatDate(work.workDate)} · {work.stage}</div><div className="mt-[3px] text-xs text-muted">Бригада: {work.crewCount} чел.{work.comment ? ` · ${work.comment}` : ''}</div></div><Chip tone={total ? 'warn' : 'off'}>{formatMoney(total)}</Chip></div><div className="mt-[10px] grid grid-cols-4 gap-1.5 text-center text-xs text-muted"><div className="rounded-tight bg-raised p-1.5">З/П<br/><b className="text-ink">{formatMoney(work.crewCost)}</b></div><div className="rounded-tight bg-raised p-1.5">Техника<br/><b className="text-ink">{formatMoney(work.equipmentCost)}</b></div><div className="rounded-tight bg-raised p-1.5">Материалы<br/><b className="text-ink">{formatMoney(work.materialCost)}</b></div><div className="rounded-tight bg-raised p-1.5">Прочие<br/><b className="text-ink">{formatMoney(work.otherCost)}</b></div></div>{work.crewEntries.length > 0 && <div className="mt-[9px] text-xs text-muted">Бригада: {work.crewEntries.map((row) => `${row.name} (${Number(row.workDays)} дн. × ${formatMoney(row.rate)})`).join(', ')}</div>}{work.costItems.length > 0 && <div className="mt-[7px] text-xs text-muted">Позиции: {work.costItems.map((row) => `${row.name} — ${Number(row.quantity)} ${row.unit ?? 'ед.'} × ${formatMoney(row.unitPrice)} (${row.paymentType === 'CASH' ? 'нал.' : 'б/н'})`).join('; ')}</div>}{work.photos.length > 0 && <div className="mt-[10px] grid grid-cols-3 gap-1.5 sm:grid-cols-5">{work.photos.map((photo) => <div key={photo.id} className="rounded-tight border border-line bg-raised"><a href={`/api/site-photos/${photo.id}`} target="_blank" className="site-photo-link group block overflow-hidden rounded-t-[inherit]"><img src={`/api/site-photos/${photo.id}`} alt={photo.fileName} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" /></a><div className="flex items-center gap-1 px-1.5 py-1"><span className="min-w-0 flex-1 truncate text-2xs" title={photo.fileName}>{photo.fileName}</span>{(canWrite(user) || user.role === 'BUILDER') && <RenameFileButton type="site-photo" id={photo.id} fileName={photo.fileName} />}</div></div>)}</div>}{(canWrite(user) || user.role === 'BUILDER') && <form action={deleteReport} className="mt-[10px] text-right"><input type="hidden" name="reportId" value={work.id} /><button className="text-xs text-danger hover:underline">Удалить ошибочный отчёт</button></form>}</div>})}</div>}</Card> })}</div>

		<Card className="mt-[14px]"><CardHeader title="Хронология площадки" extra={`Событий: ${site.events.length}`} />{site.events.length === 0 ? <EmptyState text="Событий пока нет" /> : <div>{site.events.map((event) => <div key={event.id} className="flex items-start gap-2.5 border-b border-line-soft px-4 py-2.5 last:border-b-0"><Chip tone={EVENT_TONE[event.type] ?? 'off'}>{formatDate(event.occurredAt)}</Chip><div><div className="text-base">{event.text}</div><div className="mt-[2px] text-xs text-faint">{formatDateTime(event.occurredAt)}</div></div></div>)}</div>}</Card>
	</div></>
}
