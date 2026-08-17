import Link from 'next/link'
import { notFound } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { Card, CardHeader, Chip, EmptyState } from '@/components/ui'
import { canSeeSchedules, contractScope, requireUser } from '@/lib/access'
import { DEPARTMENT_NOTE, loadDepartmentFlow } from '@/lib/dashboard'
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
	// Видят его только те же роли, что и /production-schedule.
	const showConstructionSchedule = params.code === 'construction' && canSeeSchedules(user)
	const constructionContracts = showConstructionSchedule ? await prisma.contract.findMany({
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

	return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: `${department.label} отдел` }]} userName={user.name ?? user.email ?? 'Пользователь'} initials={initials(user.name ?? user.email ?? 'ПП')} notifications={result.attentionDangerCount} /><main className="px-[26px] py-[22px]"><section className="work-hero overflow-hidden px-5 py-5 sm:px-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><span className="inline-flex rounded-full bg-brand-soft px-2.5 py-1 text-2xs font-bold uppercase tracking-[.1em] text-brand-ink">Рабочая зона</span><h1 className="mt-3 text-2xl font-bold tracking-[-0.02em]">{department.label} отдел</h1><p className="mt-1 text-base text-muted">{department.description}</p></div><Link href="/" className="rounded-control border border-line bg-surface px-3 py-2 text-xs font-semibold hover:bg-raised">← Главная</Link></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-gradient-to-r from-brand to-[#a291ff]" style={{ width: `${department.percent}%` }} /></div><div className="mt-2 flex justify-between text-xs text-muted"><span>Готовность текущего потока</span><b className="text-brand-ink">{department.percent}%</b></div><div className="mt-5 grid gap-2 sm:grid-cols-4">{department.stats.map((stat) => <div key={stat.key} className="rounded-[12px] border border-line bg-surface/75 p-3"><div className="text-2xs text-muted">{stat.label}</div><b className="mt-1 block text-2xl leading-none">{stat.count}</b></div>)}</div></section><div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(310px,.75fr)]"><div className="space-y-4"><Card><CardHeader title="Этапы отдела" extra={<Chip tone="brand">{flow.queueCount} в потоке</Chip>} />{flow.stages.length ? <div className="p-3">{flow.stages.map((stage) => <Link key={stage.label} href={stage.href} className="flex items-center gap-3 rounded-control px-3 py-2.5 hover:bg-raised"><span className="grid h-7 w-7 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand-ink">{stage.count}</span><span className="min-w-0 flex-1 text-sm font-semibold">{stage.label}</span><span className="text-faint">→</span></Link>)}</div> : <EmptyState text="В очереди пока нет позиций." />}</Card><Card><CardHeader title="Договоры и позиции в фокусе" extra={flow.riskCount ? <Chip tone="warn">Риски {flow.riskCount}</Chip> : <Chip tone="ok">Без рисков</Chip>} />{flow.contracts.length ? <div className="p-3">{flow.contracts.map((contract) => <Link key={contract.id} href={contract.href} className="flex items-center gap-3 rounded-control px-3 py-2.5 hover:bg-raised"><i className={`h-2.5 w-2.5 flex-none rounded-full ${contract.attention ? 'bg-warn' : 'bg-ok'}`} /><span className="min-w-0 flex-1"><b className="block truncate text-sm">{contract.number}</b><span className="block truncate text-xs text-faint">{contract.stage} · {contract.responsible ?? contract.contractorName}</span></span><span className="text-faint">→</span></Link>)}</div> : <EmptyState text="Договоры появятся после передачи в отдел." />}</Card></div><aside className="space-y-4"><Card><CardHeader title="О разделе" /><div className="space-y-3 p-4"><div><div className="text-2xs font-bold uppercase tracking-[.1em] text-faint">На входе</div><p className="mt-1 text-sm leading-5 text-ink">{DEPARTMENT_NOTE[params.code as keyof typeof DEPARTMENT_NOTE].input}</p></div><div><div className="text-2xs font-bold uppercase tracking-[.1em] text-faint">В фокусе</div><p className="mt-1 text-sm leading-5 text-ink">{DEPARTMENT_NOTE[params.code as keyof typeof DEPARTMENT_NOTE].focus}</p></div><div><div className="text-2xs font-bold uppercase tracking-[.1em] text-ok">Результат</div><p className="mt-1 text-sm leading-5 text-ink">{DEPARTMENT_NOTE[params.code as keyof typeof DEPARTMENT_NOTE].result} → {DEPARTMENT_NOTE[params.code as keyof typeof DEPARTMENT_NOTE].output}</p></div></div></Card><Card><CardHeader title="Передача дальше" /><div className="p-4"><div className="rounded-[12px] border border-ok/20 bg-ok-bg/45 p-3"><div className="text-2xs font-bold uppercase tracking-[.1em] text-ok">{flow.handoff.label}</div><b className="mt-1 block text-2xl leading-none">{flow.handoff.count}</b><p className="mt-2 text-xs leading-4 text-muted">Готовые позиции, которые уже вышли из зоны отдела.</p></div></div></Card><Card><CardHeader title="Нагрузка сотрудников" />{flow.workload.length ? <div className="space-y-1 p-3">{flow.workload.map((person) => <div key={person.name} className="flex items-center justify-between rounded-tight px-2 py-2 text-sm"><span className="truncate text-muted">{person.name}</span><b className="rounded-full bg-raised px-2 py-0.5">{person.count}</b></div>)}</div> : <EmptyState text="Исполнители ещё не назначены." />}</Card>{user.role !== 'VIEWER' && <ChatPanel title="Чат отдела" endpoint={`/api/chats/department/${params.code}`} />}</aside></div>
			{showConstructionSchedule && <Card className="mt-4 overflow-hidden">
				<CardHeader title="График стройотдела" extra={<span className="flex items-center gap-2"><span>{constructionContracts.length} в работе</span><a href="/api/departments/construction/export" className="inline-flex h-[28px] items-center rounded-tight border border-line bg-surface px-2.5 text-xs font-semibold hover:bg-raised">Скачать XLSX</a></span>} />
				{constructionContracts.length === 0 ? <EmptyState text="Нет договоров в отгрузке или монтаже — таблица наполнится сама, когда они появятся." /> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-sm"><thead><tr className="bg-raised text-left text-xs font-semibold uppercase tracking-[0.05em] text-muted"><th className="px-4 py-2.5">Договор</th><th className="px-2.5 py-2.5">Контрагент</th><th className="px-2.5 py-2.5">Менеджер</th><th className="px-2.5 py-2.5">Площадка</th><th className="px-2.5 py-2.5">Монтаж КЖ</th><th className="px-2.5 py-2.5">Монтаж КМ</th><th className="px-4 py-2.5">Дедлайн</th></tr></thead><tbody>{constructionContracts.map((contract) => {
					const site = contract.sites[0]
					const lastKzhDate = site ? lastWorkDate.get(`${site.id}:KJ`) : null
					const lastKmDate = site ? lastWorkDate.get(`${site.id}:KM`) : null
					const siteStatus = site ? SITE_STATUS_LABEL[site.status] : null
					return <tr key={contract.id} className="interactive-row border-b border-line-soft last:border-b-0">
						<td className="px-4 py-2.5"><Link href={`/contracts/${contract.id}`} className="font-semibold text-brand-ink hover:underline">№ {contract.number}</Link><div className="mt-[2px] text-xs text-faint">{contract.cipher ?? 'Без шифра'} · {WORKFLOW_STAGE_LABEL[contract.workflowStage]}</div></td>
						<td className="px-2.5 py-2.5 text-muted">{contract.contractor.name}</td>
						<td className="px-2.5 py-2.5 text-muted">{contract.manager?.name ?? '—'}</td>
						<td className="px-2.5 py-2.5">{site ? <Link href={`/sites/${site.id}`} className="hover:underline">{siteStatus && <Chip tone={siteStatus.tone}>{siteStatus.label}</Chip>}</Link> : <span className="text-faint">Не создана</span>}</td>
						<td className="tnum px-2.5 py-2.5 text-muted">{lastKzhDate ? formatDate(lastKzhDate) : '—'}</td>
						<td className="tnum px-2.5 py-2.5 text-muted">{lastKmDate ? formatDate(lastKmDate) : '—'}</td>
						<td className="tnum px-4 py-2.5 text-muted">{contract.deadline ? formatDate(contract.deadline) : '—'}</td>
					</tr>
				})}</tbody></table></div>}
			</Card>}
			</main></>
}
