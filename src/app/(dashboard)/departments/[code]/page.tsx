import Link from 'next/link'
import { notFound } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { Card, CardHeader, Chip, EmptyState } from '@/components/ui'
import { contractScope, requireUser } from '@/lib/access'
import { loadDepartmentFlow } from '@/lib/dashboard'
import { formatDate, initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import ChatPanel from '@/components/ChatPanel'
import { WORKFLOW_STAGE_LABEL } from '@/lib/contract-workflow'

export const dynamic = 'force-dynamic'

const DEPARTMENTS = ['commercial', 'engineering', 'production', 'construction'] as const
const SITE_STATUS_LABEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'off' | 'danger' }> = {
	PREPARING: { label: 'Подготовка', tone: 'off' },
	ISSUE: { label: 'Проблема', tone: 'warn' },
	READY: { label: 'Готова', tone: 'ok' },
	BLOCKED: { label: 'Остановка', tone: 'danger' },
}

export default async function DepartmentPage({ params }: { params: { code: string } }) {
	if (!DEPARTMENTS.includes(params.code as typeof DEPARTMENTS[number])) notFound()
	const user = await requireUser()
	const result = await loadDepartmentFlow(user, params.code as typeof DEPARTMENTS[number])
	if (!result) notFound()
	const { department, flow } = result

	// График стройотдела — не отдельная ручная таблица, а срез того, что уже есть
	// по договору: площадка, последние отчёты монтажа КЖ/КМ, дедлайн. Ничего не дублирует.
	const constructionContracts = params.code === 'construction' ? await prisma.contract.findMany({
		where: { ...contractScope(user), workflowStage: { in: ['AWAITING_SHIPMENT', 'SHIPPED', 'INSTALL_KZH', 'INSTALL_KM'] } },
		select: {
			id: true, number: true, cipher: true, deadline: true, workflowStage: true,
			contractor: { select: { name: true } },
			manager: { select: { name: true } },
			sites: { select: { id: true, address: true, status: true } },
		},
		orderBy: [{ workflowStage: 'asc' }, { deadline: 'asc' }],
		take: 200,
	}) : []
	// Последняя дата КЖ/КМ — реальный максимум по направлению, а не "среди последних
	// 20 записей": площадка с активным другим направлением иначе теряла свою дату.
	const siteIds = constructionContracts.flatMap((contract) => contract.sites.map((site) => site.id))
	const lastWorkByDirection = siteIds.length ? await prisma.siteWork.groupBy({ by: ['siteId', 'direction'], where: { siteId: { in: siteIds } }, _max: { workDate: true } }) : []
	const lastWorkDate = new Map(lastWorkByDirection.map((row) => [`${row.siteId}:${row.direction}`, row._max.workDate]))

	return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: `${department.label} отдел` }]} userName={user.name ?? user.email ?? 'Пользователь'} initials={initials(user.name ?? user.email ?? 'ПП')} notifications={result.attentionDangerCount} /><main className="px-[26px] py-[22px]"><section className="work-hero overflow-hidden px-5 py-5 sm:px-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><span className="inline-flex rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-brand-ink">Рабочая зона</span><h1 className="mt-3 text-[28px] font-bold tracking-[-.04em]">{department.label} отдел</h1><p className="mt-1 text-[13px] text-muted">{department.description}</p></div><Link href="/" className="rounded-[10px] border border-line bg-surface px-3 py-2 text-[11.5px] font-semibold hover:bg-raised">← Главная</Link></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-gradient-to-r from-brand to-[#a291ff]" style={{ width: `${department.percent}%` }} /></div><div className="mt-2 flex justify-between text-[11px] text-muted"><span>Готовность текущего потока</span><b className="text-brand-ink">{department.percent}%</b></div><div className="mt-5 grid gap-2 sm:grid-cols-4">{department.stats.map((stat) => <div key={stat.key} className="rounded-[12px] border border-line bg-surface/75 p-3"><div className="text-[10px] text-muted">{stat.label}</div><b className="mt-1 block text-[24px] leading-none">{stat.count}</b></div>)}</div></section><div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(310px,.75fr)]"><div className="space-y-4"><Card><CardHeader title="Этапы отдела" extra={<Chip tone="brand">{flow.queueCount} в потоке</Chip>} />{flow.stages.length ? <div className="p-3">{flow.stages.map((stage) => <Link key={stage.label} href={stage.href} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 hover:bg-raised"><span className="grid h-7 w-7 place-items-center rounded-full bg-brand-soft text-[11px] font-bold text-brand-ink">{stage.count}</span><span className="min-w-0 flex-1 text-[12.5px] font-semibold">{stage.label}</span><span className="text-faint">→</span></Link>)}</div> : <EmptyState text="В очереди пока нет позиций." />}</Card><Card><CardHeader title="Договоры и позиции в фокусе" extra={flow.riskCount ? <Chip tone="warn">Риски {flow.riskCount}</Chip> : <Chip tone="ok">Без рисков</Chip>} />{flow.contracts.length ? <div className="p-3">{flow.contracts.map((contract) => <Link key={contract.id} href={contract.href} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 hover:bg-raised"><i className={`h-2.5 w-2.5 flex-none rounded-full ${contract.attention ? 'bg-warn' : 'bg-ok'}`} /><span className="min-w-0 flex-1"><b className="block truncate text-[12.5px]">{contract.number}</b><span className="block truncate text-[10.5px] text-faint">{contract.stage} · {contract.responsible ?? contract.contractorName}</span></span><span className="text-faint">→</span></Link>)}</div> : <EmptyState text="Договоры появятся после передачи в отдел." />}</Card></div><aside className="space-y-4"><Card><CardHeader title="Передача дальше" /><div className="p-4"><div className="rounded-[12px] border border-ok/20 bg-ok-bg/45 p-3"><div className="text-[10px] font-bold uppercase tracking-[.1em] text-ok">{flow.handoff.label}</div><b className="mt-1 block text-[24px] leading-none">{flow.handoff.count}</b><p className="mt-2 text-[11px] leading-4 text-muted">Готовые позиции, которые уже вышли из зоны отдела.</p></div></div></Card><Card><CardHeader title="Нагрузка сотрудников" />{flow.workload.length ? <div className="space-y-1 p-3">{flow.workload.map((person) => <div key={person.name} className="flex items-center justify-between rounded-[9px] px-2 py-2 text-[12px]"><span className="truncate text-muted">{person.name}</span><b className="rounded-full bg-raised px-2 py-0.5">{person.count}</b></div>)}</div> : <EmptyState text="Исполнители ещё не назначены." />}</Card><ChatPanel title="Чат отдела" endpoint={`/api/chats/department/${params.code}`} /></aside></div>
			{params.code === 'construction' && <Card className="mt-4 overflow-hidden">
				<CardHeader title="График стройотдела" extra={`${constructionContracts.length} в работе`} />
				{constructionContracts.length === 0 ? <EmptyState text="Нет договоров в отгрузке или монтаже — таблица наполнится сама, когда они появятся." /> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-[12.5px]"><thead><tr className="bg-raised text-left text-[10.5px] font-semibold uppercase tracking-[0.05em] text-muted"><th className="px-[16px] py-[10px]">Договор</th><th className="px-[10px] py-[10px]">Контрагент</th><th className="px-[10px] py-[10px]">Менеджер</th><th className="px-[10px] py-[10px]">Площадка</th><th className="px-[10px] py-[10px]">Монтаж КЖ</th><th className="px-[10px] py-[10px]">Монтаж КМ</th><th className="px-[16px] py-[10px]">Дедлайн</th></tr></thead><tbody>{constructionContracts.map((contract) => {
					const site = contract.sites[0]
					const lastKzhDate = site ? lastWorkDate.get(`${site.id}:KJ`) : null
					const lastKmDate = site ? lastWorkDate.get(`${site.id}:KM`) : null
					const siteStatus = site ? SITE_STATUS_LABEL[site.status] : null
					return <tr key={contract.id} className="interactive-row border-b border-line-soft last:border-b-0">
						<td className="px-[16px] py-[11px]"><Link href={`/contracts/${contract.id}`} className="font-semibold text-brand-ink hover:underline">№ {contract.number}</Link><div className="mt-[2px] text-[11px] text-faint">{contract.cipher ?? 'Без шифра'} · {WORKFLOW_STAGE_LABEL[contract.workflowStage]}</div></td>
						<td className="px-[10px] py-[11px] text-muted">{contract.contractor.name}</td>
						<td className="px-[10px] py-[11px] text-muted">{contract.manager?.name ?? '—'}</td>
						<td className="px-[10px] py-[11px]">{site ? <Link href={`/sites/${site.id}`} className="hover:underline">{siteStatus && <Chip tone={siteStatus.tone}>{siteStatus.label}</Chip>}</Link> : <span className="text-faint">Не создана</span>}</td>
						<td className="tnum px-[10px] py-[11px] text-muted">{lastKzhDate ? formatDate(lastKzhDate) : '—'}</td>
						<td className="tnum px-[10px] py-[11px] text-muted">{lastKmDate ? formatDate(lastKmDate) : '—'}</td>
						<td className="tnum px-[16px] py-[11px] text-muted">{contract.deadline ? formatDate(contract.deadline) : '—'}</td>
					</tr>
				})}</tbody></table></div>}
			</Card>}
			</main></>
}
