import Link from 'next/link'
import Topbar from '@/components/Topbar'
import { Card, CardHeader, Chip, EmptyState, FileIcon, ProgressBar, StatTile } from '@/components/ui'
import { formatDate, formatMoney, initials, plural } from '@/lib/format'
import { requireUser } from '@/lib/access'
import { loadReportData, parseReportPeriod } from '@/lib/report-data'
import type { CommercialProposalStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

const PROPOSAL_STATUS: Record<CommercialProposalStatus, { label: string; tone: 'off' | 'brand' | 'warn' | 'ok' | 'danger' }> = {
	DRAFT: { label: 'Черновик', tone: 'off' },
	SENT: { label: 'Отправлено', tone: 'brand' },
	WAITING_RESPONSE: { label: 'Ждём ответ', tone: 'warn' },
	ACCEPTED: { label: 'Принято', tone: 'ok' },
	REJECTED: { label: 'Отклонено', tone: 'danger' },
}

/**
 * Сводный отчёт. Пункт меню «Отчёты» раньше вёл на 404.
 * Использует тот же агрегатор, что и дашборд — логика не дублируется.
 */
export default async function ReportsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
	const user = await requireUser()
	const period = parseReportPeriod(searchParams)
	const report = await loadReportData(user, period)
	const data = report.dashboard
	// The FigJam report catalogue is backed by the same scoped records as the
	// rest of the workspace.  A manager therefore never sees another manager's
	// commercial proposals merely by opening the reports screen.
	const commercialProposals = report.proposals
	const proposalCounts = (Object.keys(PROPOSAL_STATUS) as CommercialProposalStatus[]).reduce((acc, status) => {
		acc[status] = commercialProposals.filter((proposal) => proposal.proposalStatus === status).length
		return acc
	}, {} as Record<CommercialProposalStatus, number>)
	const responseTotal = proposalCounts.ACCEPTED + proposalCounts.REJECTED
	// План берётся из разбивки договора, факт — только из внесённых дневных
	// отчётов КЖ/КМ. Поэтому цифры не подменяют бухгалтерию, а показывают
	// оперативную картину по производству.
	const costSummary = report.planFact.reduce((acc, row) => ({ ...acc, plan: acc.plan + row.plan, actual: acc.actual + row.actual, withPlan: acc.withPlan + Number(row.plan > 0), risks: row.plan > 0 ? [...acc.risks, row] : acc.risks }), { plan: 0, actual: 0, withPlan: 0, risks: [] as typeof report.planFact })
	const costContracts = report.contracts
	const costPercent = costSummary.plan > 0 ? Math.round((costSummary.actual / costSummary.plan) * 100) : 0
	const works = report.contracts.flatMap((contract) => contract.sites.flatMap((site) => site.works))
	const kjActual = works.filter((work) => work.direction === 'KJ').reduce((sum, work) => sum + Number(work.crewCost) + Number(work.equipmentCost) + Number(work.materialCost) + Number(work.otherCost), 0)
	const kmActual = costSummary.actual - kjActual
	const budgetRisks = costSummary.risks
		.filter((row) => row.actual > 0 || row.plan > 0)
		.sort((a, b) => (b.plan > 0 ? b.actual / b.plan : 0) - (a.plan > 0 ? a.actual / a.plan : 0))
		.slice(0, 5)

	const name = user.name ?? user.email ?? ''
	const collected =
		data.finance.invoicedAmount > 0
			? Math.round((data.finance.paidAmount / data.finance.invoicedAmount) * 100)
			: 0
	const sectionsPercent =
		data.design.totalCount > 0
			? Math.round((data.design.readyCount / data.design.totalCount) * 100)
			: 0

	return (
		<>
			<Topbar
				crumbs={[{ label: 'Главная', href: '/' }, { label: 'Отчёты' }]}
				userName={name.split(' ')[0]}
				initials={initials(name)}
			/>

			<div className="workspace-content px-[26px] py-[22px]">
				<div className="mb-[18px]">
					<div className="flex flex-wrap items-end justify-between gap-3"><h1 className="text-[26px] font-bold tracking-[-0.02em]">Отчёты</h1><form className="flex flex-wrap items-end gap-2" method="get"><label className="text-[11px] text-muted">С <input name="from" type="date" defaultValue={period.from.toISOString().slice(0, 10)} className="ml-1 rounded border border-line bg-surface px-2 py-1 text-ink" /></label><label className="text-[11px] text-muted">По <input name="to" type="date" defaultValue={period.to.toISOString().slice(0, 10)} className="ml-1 rounded border border-line bg-surface px-2 py-1 text-ink" /></label><button className="h-[30px] rounded border border-line px-3 text-[12px] font-semibold">Показать</button><a href={`/api/reports/export?from=${period.from.toISOString().slice(0, 10)}&to=${period.to.toISOString().slice(0, 10)}`} className="brand-gradient inline-flex h-[30px] items-center rounded px-3 text-[12px] font-semibold text-white">Скачать Excel</a></form></div>
					<div className="mt-[5px] text-[13px] text-muted">
						Сводка по {data.totals.contracts}{' '}
						{plural(data.totals.contracts, 'договору', 'договорам', 'договорам')} в вашей зоне видимости
					</div>
				</div>

				<div className="mb-[18px] grid grid-cols-1 gap-[12px] md:grid-cols-3">
					<Link href="/projects" className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-[18px] shadow-[0_1px_2px_rgba(16,24,40,.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-[0_14px_30px_rgba(88,63,193,.11)]">
						<div className="absolute right-[-12px] top-[-14px] h-20 w-20 rounded-full bg-brand/10 blur-2xl transition-transform duration-300 group-hover:scale-150" />
						<div className="relative flex h-full flex-col">
							<span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand-ink"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 19V10M10 19V5M16 19v-7M22 19H2" /></svg></span>
							<b className="mt-5 text-[15px] text-ink">Проекты за месяц</b>
							<span className="mt-1 text-[12px] text-muted">Сводка по разделам КМ, КЖ и АР</span>
							<span className="mt-4 text-[12px] font-semibold text-brand-ink">Открыть графики <span aria-hidden>→</span></span>
						</div>
					</Link>
					<a href="#commercial-proposals" className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-[18px] shadow-[0_1px_2px_rgba(16,24,40,.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-[0_14px_30px_rgba(88,63,193,.11)]">
						<div className="absolute right-[-12px] top-[-14px] h-20 w-20 rounded-full bg-ok/10 blur-2xl transition-transform duration-300 group-hover:scale-150" />
						<div className="relative flex h-full flex-col">
							<span className="grid h-10 w-10 place-items-center rounded-xl bg-ok-bg text-ok"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v14H4zM8 9h8M8 13h5" /></svg></span>
							<b className="mt-5 text-[15px] text-ink">Отправленные КП</b>
							<span className="mt-1 text-[12px] text-muted">{commercialProposals.length ? `Ждут ответа: ${proposalCounts.WAITING_RESPONSE} · Ответы: ${responseTotal}` : 'Файлы с типом «Коммерческое предложение»'}</span>
							<span className="mt-4 text-[12px] font-semibold text-brand-ink">Посмотреть список <span aria-hidden>↓</span></span>
						</div>
					</a>
					<a href="#budget-control" className="group relative overflow-hidden rounded-2xl border border-dashed border-brand/30 bg-brand-soft/35 p-[18px] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/60 hover:bg-brand-soft">
						<div className="relative flex h-full flex-col">
							<span className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-brand-ink shadow-sm"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></span>
							<b className="mt-5 text-[15px] text-ink">Свой отчёт</b>
							<span className="mt-1 text-[12px] text-muted">Соберите оперативную сводку из бюджета и дневных отчётов</span>
							<span className="mt-4 text-[12px] font-semibold text-brand-ink">Открыть план / факт <span aria-hidden>→</span></span>
						</div>
					</a>
				</div>

				<div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 xl:grid-cols-4">
					<StatTile label="Всего договоров" value={data.totals.contracts} href="/contracts" />
					<StatTile label="Активных" value={data.totals.activeContracts} tone="brand" />
					<StatTile label="Контрагентов" value={data.totals.contractors} href="/contractors" />
					<StatTile label="Документов" value={data.totals.documents} href="/documents" />
				</div>

				<div className="mt-[14px] grid grid-cols-1 gap-[14px] xl:grid-cols-2">
					<Card>
						<CardHeader title="Распределение по этапам" />
						<div className="flex flex-col gap-[11px] px-[18px] py-[14px]">
							{data.funnel.map((s) => (
								<div key={s.key}>
									<div className="mb-[5px] flex items-baseline justify-between gap-[10px]">
										<span className="truncate text-[12.5px] text-muted">{s.label}</span>
										<span className="tnum flex-none text-[12.5px] font-semibold text-ink">
											{s.count}
											{data.canSeeAmounts && s.amount > 0 ? ` · ${formatMoney(s.amount)}` : ''}
										</span>
									</div>
									<ProgressBar percent={s.share} tone={s.count === 0 ? 'muted' : 'brand'} height={6} />
								</div>
							))}
						</div>
					</Card>

					<div className="flex flex-col gap-[14px]">
						<Card>
							<CardHeader title="Проектирование" />
							<div className="px-[18px] py-[14px]">
								<div className="mb-[8px] flex items-baseline justify-between">
									<span className="text-[12.5px] text-muted">
										Готово {data.design.readyCount} из {data.design.totalCount}
									</span>
									<span className="tnum text-[13px] font-semibold text-ink">{sectionsPercent}%</span>
								</div>
								<ProgressBar percent={sectionsPercent} tone={sectionsPercent >= 80 ? 'ok' : 'brand'} />
								<Link
									href="/projects"
									className="mt-[12px] inline-block text-[12px] text-brand-ink hover:underline"
								>
									Открыть график разделов
								</Link>
							</div>
						</Card>

						{data.canSeeAmounts ? (
							<Card>
								<CardHeader title="Финансы" />
								<div className="px-[18px] py-[14px]">
									<ProgressBar percent={collected} tone={data.finance.overdueAmount > 0 ? 'warn' : 'ok'} />
									<div className="mt-[13px] flex flex-col gap-[7px] text-[12.5px]">
										<div className="flex justify-between">
											<span className="text-muted">Сумма активных договоров</span>
											<span className="tnum font-semibold text-ink">
												{formatMoney(data.finance.activeAmount)}
											</span>
										</div>
										<div className="flex justify-between">
											<span className="text-muted">Выставлено счетов</span>
											<span className="tnum font-semibold text-ink">
												{formatMoney(data.finance.invoicedAmount)}
											</span>
										</div>
										<div className="flex justify-between">
											<span className="text-muted">Оплачено</span>
											<span className="tnum font-semibold text-ok">
												{formatMoney(data.finance.paidAmount)}
											</span>
										</div>
										<div className="flex justify-between">
											<span className="text-muted">Просрочено</span>
											<span
												className={`tnum font-semibold ${
													data.finance.overdueAmount > 0 ? 'text-danger' : 'text-ink'
												}`}
											>
												{formatMoney(data.finance.overdueAmount)}
											</span>
										</div>
									</div>
								</div>
							</Card>
						) : (
							<Card>
								<CardHeader title="Финансы" />
								<EmptyState text="Суммы доступны только менеджерам и администраторам" />
							</Card>
						)}
					</div>
				</div>

				<div id="commercial-proposals" className="mt-[14px] scroll-mt-6">
					<Card>
						<CardHeader title="Отправленные КП" extra={<Link href="/documents?kind=COMMERCIAL_PROPOSAL" className="font-semibold text-brand-ink hover:underline">Все КП →</Link>} />
						{commercialProposals.length === 0 ? <EmptyState text="КП появятся здесь автоматически после загрузки файла с типом «Коммерческое предложение»." /> : <><div className="grid grid-cols-2 gap-px border-b border-line-soft bg-line-soft sm:grid-cols-5">{(Object.keys(PROPOSAL_STATUS) as CommercialProposalStatus[]).map((status) => <div key={status} className="bg-surface px-4 py-3"><div className="text-[10.5px] text-faint">{PROPOSAL_STATUS[status].label}</div><div className="tnum mt-1 text-[18px] font-bold text-ink">{proposalCounts[status]}</div></div>)}</div><div>{commercialProposals.slice(0, 6).map((proposal) => { const status = PROPOSAL_STATUS[proposal.proposalStatus]; return <div key={proposal.id} className="flex items-center gap-3 border-b border-line-soft px-[18px] py-[11px] last:border-b-0 transition-colors hover:bg-raised"><FileIcon fileName={proposal.fileName} /><Link href={`/documents/${proposal.id}`} className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{proposal.fileName}</span><span className="mt-[2px] block truncate text-[11.5px] text-muted">№ {proposal.contract.number} · {proposal.contract.contractor.name}{proposal.proposalSentAt ? ` · отправлено ${formatDate(proposal.proposalSentAt)}` : ''}</span></Link><Chip tone={status.tone}>{status.label}</Chip></div>})}</div></>}
					</Card>
				</div>

				{data.canSeeAmounts && (
					<div className="mt-[14px] grid grid-cols-1 gap-[14px] xl:grid-cols-2">
						<Card id="budget-control">
							<CardHeader title="План / факт затрат" extra={`${costSummary.withPlan} из ${costContracts.length} с бюджетом`} />
							<div className="px-[18px] py-[15px]">
								<div className="grid grid-cols-2 gap-[8px] text-[12px]">
									<div className="rounded-[9px] bg-raised p-[10px] text-muted">План затрат<br/><b className="tnum mt-[3px] block text-[14px] text-ink">{formatMoney(costSummary.plan)}</b></div>
									<div className="rounded-[9px] bg-raised p-[10px] text-muted">Факт по отчётам<br/><b className="tnum mt-[3px] block text-[14px] text-warn">{formatMoney(costSummary.actual)}</b></div>
								</div>
								{costSummary.plan > 0 ? <>
									<div className="mt-[14px] flex items-center justify-between text-[12.5px]"><span className="text-muted">Освоение бюджета</span><span className={`tnum font-semibold ${costSummary.actual > costSummary.plan ? 'text-danger' : 'text-ink'}`}>{costPercent}%</span></div>
									<div className="mt-[6px]"><ProgressBar percent={costPercent} tone={costSummary.actual > costSummary.plan ? 'danger' : costPercent >= 80 ? 'warn' : 'brand'} height={7} /></div>
									<div className={`mt-[7px] text-[12px] ${costSummary.actual > costSummary.plan ? 'text-danger' : 'text-muted'}`}>{costSummary.actual > costSummary.plan ? `Перерасход: ${formatMoney(costSummary.actual - costSummary.plan)}` : `Остаток бюджета: ${formatMoney(costSummary.plan - costSummary.actual)}`}</div>
								</> : <div className="mt-[13px] rounded-[8px] bg-raised px-[10px] py-[9px] text-[12px] text-muted">Добавьте СМР, МК и доставку в карточках договоров — здесь появится контроль общего бюджета.</div>}
								<div className="mt-[13px] flex gap-[14px] border-t border-line-soft pt-[11px] text-[11.5px] text-muted"><span>КЖ: <b className="tnum text-ink">{formatMoney(kjActual)}</b></span><span>КМ: <b className="tnum text-ink">{formatMoney(kmActual)}</b></span></div>
							</div>
						</Card>

						<Card>
							<CardHeader title="Договоры под контролем бюджета" extra={budgetRisks.length ? `${budgetRisks.length} в списке` : 'нет данных'} />
							{budgetRisks.length === 0 ? <EmptyState text="Сначала заполните разбивку бюджета в договоре." /> : <div>{budgetRisks.map((row) => {
								const percent = row.plan > 0 ? Math.round((row.actual / row.plan) * 100) : 0
								return <Link key={row.id} href={`/contracts/${row.id}`} className="block border-b border-line-soft px-[18px] py-[11px] last:border-b-0 hover:bg-raised"><div className="flex items-center justify-between gap-[10px]"><span className="font-medium text-[13px]">{row.number}</span><span className={`tnum text-[12px] font-semibold ${percent > 100 ? 'text-danger' : percent >= 80 ? 'text-warn' : 'text-ink'}`}>{percent}%</span></div><div className="mt-[6px]"><ProgressBar percent={percent} tone={percent > 100 ? 'danger' : percent >= 80 ? 'warn' : 'brand'} height={5} /></div><div className="mt-[5px] flex justify-between text-[11.5px] text-muted"><span>факт {formatMoney(row.actual, row.currency)}</span><span>план {formatMoney(row.plan, row.currency)}</span></div></Link>
							})}</div>}
						</Card>
					</div>
				)}
			</div>
		</>
	)
}
