'use client'

import Link from 'next/link'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DepartmentFlow } from '@/lib/dashboard'
import { plural } from '@/lib/format'

type DepartmentKey = 'commercial' | 'engineering' | 'production' | 'construction'
type Stat = { key: 'working' | 'attention' | 'paused' | 'done'; label: string; count: number; tone: 'brand' | 'warn' | 'danger' | 'ok' | 'muted' }
type Department = { key: DepartmentKey; label: string; description: string; ready: number; total: number; percent: number; href: string; stats: Stat[] }
type FunnelStage = { key: string; label: string; count: number; share: number }
type TimelineDay = { date: string; label: string; created: number; uploaded: number; updated: number; total: number }
type DepartmentTimelineDay = { date: string; label: string; values: Record<DepartmentKey, { working: number; attention: number; paused: number; done: number; total: number; recorded: boolean }> }
type AttentionItem = { id: string; tone: 'danger' | 'warn' | 'off'; group: string; title: string; detail: string; href: string }

const DOT: Record<Stat['tone'], string> = { brand: 'bg-brand', warn: 'bg-warn', danger: 'bg-danger', ok: 'bg-ok', muted: 'bg-faint' }
const STAT_SHORT_LABEL: Record<Stat['key'], string> = { working: 'В работе', attention: 'Внимание', paused: 'Пауза', done: 'Готово' }
const DEPARTMENT_NOTE: Record<DepartmentKey, { input: string; focus: string; result: string; output: string }> = {
	commercial: { input: 'Запрос заказчика и исходные документы', focus: 'Подписи, исходные договоры и передача в проектирование.', result: 'Договор подтверждён и передан в следующий отдел.', output: 'Конструкторский отдел' },
	engineering: { input: 'Подписанное ПР1 и задача на проектирование', focus: 'Очередь КМ, КЖ и АР, сроки разделов и готовые PDF.', result: 'Готовые разделы переданы в производство.', output: 'Производственный отдел' },
	production: { input: 'Готовый КМ и подтверждённый запуск', focus: 'Буфер запуска, выпуск и готовность к отгрузке.', result: 'Изделия переданы на отгрузку или монтаж.', output: 'Строительный отдел' },
	construction: { input: 'Изделия, площадка и план монтажа', focus: 'Площадки, монтаж, комментарии и фотоотчёты.', result: 'Работы закрыты, комплект исполнительной документации собран.', output: 'Исполнительная документация' },
}

function SmallMetric({ label, value, tone, href }: { label: string; value: number; tone: string; href: string }) {
	return <Link href={href} className={`group rounded-xl border border-line px-3 py-2.5 transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${tone}`}>
		<div className="text-[9px] font-bold uppercase tracking-[.09em] opacity-70">{label}</div>
		<div className="mt-1 flex items-end justify-between gap-2"><b className="text-[21px] leading-none">{value}</b><span className="text-[11px] opacity-0 transition group-hover:opacity-70">→</span></div>
	</Link>
}

/** A controlled disclosure prevents browser-native details from retaining an empty body height. */
function DashboardDisclosure({ title, subtitle, children, defaultOpen = true }: { title: string; subtitle: string; children: ReactNode; defaultOpen?: boolean }) {
	const [open, setOpen] = useState(defaultOpen)
	const contentId = useId()
	return <section className="dashboard-disclosure self-start overflow-hidden rounded-[20px] border border-line bg-surface shadow-sm">
		<button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={contentId} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-raised/55">
			<span><b className="block text-[14px]">{title}</b><span className="mt-0.5 block text-[11px] text-faint">{subtitle}</span></span>
			<span aria-hidden="true" className={`grid h-8 w-8 place-items-center rounded-lg border border-line bg-brand-soft text-[18px] font-normal leading-none text-brand-ink transition-transform duration-200 ${open ? 'rotate-0' : 'rotate-90'}`}>{open ? '−' : '+'}</span>
		</button>
		{open && <div id={contentId} className="border-t border-line-soft px-5 pb-4 pt-3 animate-[dashboard-content-in_.18s_cubic-bezier(.2,.8,.2,1)]">{children}</div>}
	</section>
}

function StatLine({ stat }: { stat: Stat }) {
	return <span className="flex min-w-0 items-center gap-1.5" title={stat.label}><i className={`h-1.5 w-1.5 flex-none rounded-full ${DOT[stat.tone]}`} /><span className="truncate text-[10px] text-muted">{STAT_SHORT_LABEL[stat.key]}</span><b className="ml-auto text-[10px] text-ink">{stat.count}</b></span>
}

export default function DepartmentBoard({ departments, flows, totalContracts, closedContracts, attentionCount, createdToday, funnel, timeline, departmentTimeline, attentionItems, userName, role }: {
	departments: Department[]; flows: DepartmentFlow[]; totalContracts: number; closedContracts: number; attentionCount: number; createdToday: number; funnel: FunnelStage[]; timeline: TimelineDay[]; departmentTimeline: DepartmentTimelineDay[]; attentionItems: AttentionItem[]; userName: string; role: string
}) {
	const [historyDepartment, setHistoryDepartment] = useState<DepartmentKey>('commercial')
	const [selectedDate, setSelectedDate] = useState<string | null>(null)
	const [selectedDepartmentKey, setSelectedDepartmentKey] = useState<DepartmentKey | null>(null)
	const [attentionOpen, setAttentionOpen] = useState(attentionItems.length > 0)
	const attentionContentId = useId()
	const stages = funnel.filter((stage) => stage.count > 0).slice(0, 7)
	const stageMax = Math.max(1, ...stages.map((stage) => stage.count))
	const history = useMemo(() => departmentTimeline.slice().reverse().map((day) => ({ ...day, value: day.values[historyDepartment] })), [departmentTimeline, historyDepartment])
	const recorded = history.filter((day) => day.value.recorded)
	// A freshly launched workspace only has one or two snapshots. Showing all 30
	// calendar slots in that case produced a huge empty graph that looked broken.
	// Keep the chart factual: render saved snapshots, and explain the remaining
	// history instead of pretending there is data for it.
	const visibleHistory = recorded.length > 0 ? recorded : history.slice(0, 7)
	const unsavedDays = Math.max(0, history.length - recorded.length)
	const historyMax = Math.max(1, ...recorded.map((day) => day.value.total))
	const selectedDay = visibleHistory.find((day) => day.date === selectedDate && day.value.recorded) ?? recorded[0] ?? null
	const activeNow = departments.reduce((sum, item) => sum + (item.stats.find((stat) => stat.key === 'working')?.count ?? 0), 0)
	const selectedDepartment = selectedDepartmentKey ? departments.find((department) => department.key === selectedDepartmentKey) : undefined
	const selectedFlow = selectedDepartmentKey ? flows.find((flow) => flow.key === selectedDepartmentKey) : undefined
	const departmentQueue = selectedFlow?.queueCount ?? 0
	const departmentWorking = selectedDepartment?.stats.find((stat) => stat.key === 'working')?.count ?? 0
	const departmentAttention = selectedDepartment?.stats.find((stat) => stat.key === 'attention')?.count ?? 0
	const departmentDone = selectedDepartment?.stats.find((stat) => stat.key === 'done')?.count ?? 0
	const roleInfo = role === 'DESIGNER'
		? { description: 'Ваша проектная очередь и ближайшие сроки — без лишних экранов.', primaryHref: '/projects', primaryLabel: 'Моя очередь', secondaryHref: '/documents', secondaryLabel: 'Мои файлы' }
		: role === 'MANAGER'
			? { description: 'Ваша рабочая зона по договорам: статусы, сроки и следующие действия.', primaryHref: '/contracts/new', primaryLabel: 'Новый договор', secondaryHref: '/contracts', secondaryLabel: 'Мои договоры' }
			: role === 'VIEWER'
				? { description: 'Актуальная картина по доступным договорам и рабочим этапам.', primaryHref: '/contracts', primaryLabel: 'Открыть договоры', secondaryHref: '/documents', secondaryLabel: 'Документы' }
				: { description: 'Главное по договорам, отделам и срокам — в одной рабочей сводке.', primaryHref: '/contracts/import', primaryLabel: 'Загрузить папку', secondaryHref: '/contracts', secondaryLabel: 'Все договоры' }

	useEffect(() => {
		if (!selectedDepartment) return
		const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedDepartmentKey(null) }
		document.body.style.overflow = 'hidden'
		window.addEventListener('keydown', close)
		return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', close) }
	}, [selectedDepartment])

	const quickNav = <aside className="fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 2xl:block">
			<nav aria-label="Навигация по сводке" className="rounded-2xl border border-line bg-surface/95 p-1.5 shadow-[0_14px_40px_rgba(27,20,76,.16)] backdrop-blur-xl">
				{[{ href: '#overview', label: 'Сводка' }, { href: '#stages', label: 'Этапы' }, { href: '#attention', label: 'Фокус' }, { href: '#daily-load', label: 'Динамика' }].map((item, index) => <a key={item.href} href={item.href} className="group flex items-center gap-2 rounded-xl px-2.5 py-2 text-[10px] font-semibold text-muted transition duration-200 hover:-translate-x-0.5 hover:bg-brand-soft hover:text-brand-ink"><span className="grid h-5 w-5 place-items-center rounded-full bg-raised text-[9px] transition group-hover:bg-brand group-hover:text-white">0{index + 1}</span><span className="whitespace-nowrap">{item.label}</span></a>)}
			</nav>
		</aside>

	return <>
		{typeof document !== 'undefined' && createPortal(quickNav, document.body)}

		<section id="overview" aria-labelledby="dashboard-title" className="relative scroll-mt-20 overflow-hidden rounded-[22px] border border-line bg-surface shadow-[0_14px_34px_rgba(35,24,85,.08)]">
			<div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand via-[#9f8bff] to-ok" />
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_92%_0%,rgba(125,91,255,.10),transparent_30%)]" />
			<div className="relative px-5 py-6 sm:px-6">
				<div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
					<div className="max-w-[690px]">
						<div className="inline-flex items-center gap-2 rounded-full border border-ok/25 bg-ok-bg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-ok"><i className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_8px_rgba(37,180,114,.8)]" /> Рабочий центр ИЗЛК</div>
						<h1 id="dashboard-title" className="mt-3 text-[28px] font-bold tracking-[-.04em] sm:text-[32px]">Добрый день, {userName}</h1>
						<p className="mt-1.5 text-[13px] leading-5 text-muted">{roleInfo.description} Выберите показатель или отдел, чтобы сразу открыть нужную выборку.</p>
						<div className="mt-4 flex flex-wrap gap-2"><Link href={roleInfo.primaryHref} className="brand-gradient inline-flex h-9 items-center rounded-[10px] px-3.5 text-[11.5px] font-semibold text-white shadow-sm transition hover:-translate-y-px hover:shadow-md">{roleInfo.primaryLabel} →</Link><Link href={roleInfo.secondaryHref} className="inline-flex h-9 items-center rounded-[10px] border border-line bg-surface/80 px-3.5 text-[11.5px] font-semibold text-ink transition hover:-translate-y-px hover:bg-raised">{roleInfo.secondaryLabel}</Link></div>
					</div>
					<div className="grid w-full grid-cols-3 gap-2 xl:w-[420px]">
						<SmallMetric label="В работе" value={activeNow} tone="bg-surface/80" href="/contracts?focus=working" />
						<SmallMetric label="Внимание" value={attentionCount} tone="bg-warn-bg/55 text-warn" href="/contracts?focus=attention" />
						<SmallMetric label="Создано сегодня" value={createdToday} tone="bg-brand-soft/75 text-brand-ink" href="/contracts?focus=today" />
					</div>
				</div>

				<div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
					{departments.map((department) => <button key={department.key} type="button" onClick={() => setSelectedDepartmentKey(department.key)} aria-label={`Открыть сводку: ${department.label} отдел`} aria-pressed={selectedDepartment?.key === department.key} className={`group relative overflow-hidden rounded-[18px] border bg-surface p-4 text-left transition duration-300 hover:-translate-y-1 hover:border-brand/35 hover:shadow-[0_16px_35px_rgba(74,48,148,.13)] focus:outline-none focus:ring-4 focus:ring-brand/15 ${selectedDepartment?.key === department.key ? 'border-brand/45 shadow-[0_10px_26px_rgba(74,48,148,.10)]' : 'border-line'}`}>
						<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-brand/0 via-brand/60 to-brand/0 opacity-0 transition group-hover:opacity-100" />
						<div className="flex items-start justify-between gap-3"><div><h2 className="text-[13px] font-bold">{department.label}</h2><p className="mt-1 min-h-[30px] text-[10.5px] leading-4 text-faint">{department.description}</p></div><span className="rounded-xl border border-brand/15 bg-brand-soft px-2.5 py-1 text-[12px] font-bold text-brand-ink">{department.percent}%</span></div>
						<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-gradient-to-r from-brand to-[#a291ff] transition-all duration-500" style={{ width: `${department.percent}%` }} /></div>
						<div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">{department.stats.map((stat) => <StatLine key={stat.key} stat={stat} />)}</div>
						<div className="mt-3 flex items-center justify-between border-t border-line-soft pt-2.5 text-[10px]"><span className="text-faint">Готово {department.ready} из {department.total}</span><span className="font-bold text-brand-ink">Открыть →</span></div>
					</button>)}
				</div>
			</div>
		</section>

		<section className="mt-4 overflow-hidden rounded-[20px] border border-line bg-surface shadow-sm">
			<div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-soft px-5 py-4"><div><h2 className="text-[15px] font-bold">Сквозной поток договоров</h2><p className="mt-0.5 text-[11px] text-faint">Нажмите на отдел — увидите этапы, договоры, риски и загрузку людей.</p></div><Link href="/contracts" className="text-[11px] font-semibold text-brand-ink hover:underline">Все договоры →</Link></div>
			<div className="grid gap-2 p-3 md:grid-cols-4">{departments.map((department, index) => <button key={department.key} type="button" onClick={() => setSelectedDepartmentKey(department.key)} className="group relative rounded-[14px] border border-line bg-raised/45 p-3 text-left transition hover:-translate-y-px hover:border-brand/30 hover:bg-brand-soft/35"><span className="text-[10px] font-bold uppercase tracking-[.1em] text-faint">0{index + 1}</span><b className="mt-1 block text-[12px] text-ink">{department.label}</b><span className="mt-1 flex items-center justify-between text-[10px] text-muted"><span>В потоке {flows.find((flow) => flow.key === department.key)?.queueCount ?? 0}</span><span className="text-brand-ink transition group-hover:translate-x-0.5">Открыть →</span></span></button>)}</div>
		</section>

		{selectedDepartment && createPortal(<div className="fixed inset-0 z-[100] flex items-end justify-center bg-[#151326]/45 p-3 backdrop-blur-[3px] sm:items-center sm:p-6" role="presentation" onMouseDown={() => setSelectedDepartmentKey(null)}>
			<section role="dialog" aria-modal="true" aria-labelledby="department-panel-title" onMouseDown={(event) => event.stopPropagation()} className="department-panel-scroll animate-[department-panel-in_.24s_cubic-bezier(.2,.8,.2,1)] max-h-[calc(100vh-24px)] w-full max-w-3xl overflow-y-auto rounded-[24px] border border-line bg-surface shadow-[0_28px_90px_rgba(16,12,48,.34)] sm:max-h-[calc(100vh-48px)]">
				<div className="relative overflow-hidden border-b border-line bg-gradient-to-br from-brand-soft via-surface to-surface px-5 pb-5 pt-6 sm:px-7"><div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand via-[#aa97ff] to-ok" /><div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand/10 blur-2xl" /><div className="relative flex items-start justify-between gap-4"><div><div className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-surface/80 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.12em] text-brand-ink"><i className="h-1.5 w-1.5 rounded-full bg-brand" />Рабочая сводка</div><h2 id="department-panel-title" className="mt-3 text-[25px] font-bold tracking-[-.04em] sm:text-[30px]">{selectedDepartment.label} отдел</h2><p className="mt-1.5 max-w-xl text-[13px] leading-5 text-muted">{selectedDepartment.description}</p></div><button type="button" onClick={() => setSelectedDepartmentKey(null)} className="grid h-9 w-9 flex-none place-items-center rounded-xl border border-line bg-surface/80 text-[20px] leading-none text-muted transition hover:rotate-90 hover:border-brand/30 hover:text-brand-ink" aria-label="Закрыть сводку">×</button></div><div className="relative mt-5 h-2 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-gradient-to-r from-brand to-[#a291ff] transition-all duration-700" style={{ width: `${selectedDepartment.percent}%` }} /></div><div className="relative mt-2 flex items-center justify-between text-[10.5px] text-muted"><span>Готовность текущего потока</span><b className="text-brand-ink">{selectedDepartment.percent}%</b></div></div>
				<div className="p-5 sm:p-7">
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{selectedDepartment.stats.map((stat) => <div key={stat.key} className="rounded-[14px] border border-line bg-raised/55 p-3"><div className="flex items-center gap-1.5 text-[10px] text-muted"><i className={`h-1.5 w-1.5 rounded-full ${DOT[stat.tone]}`} />{stat.label}</div><b className="mt-2 block text-[25px] leading-none text-ink">{stat.count}</b></div>)}</div>
					<div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-[15px] border border-line bg-surface p-4"><div className="text-[10px] font-bold uppercase tracking-[.1em] text-faint">Фокус отдела</div><p className="mt-2 text-[12.5px] leading-5 text-ink">{DEPARTMENT_NOTE[selectedDepartment.key].focus}</p></div><div className="rounded-[15px] border border-ok/20 bg-ok-bg/45 p-4"><div className="text-[10px] font-bold uppercase tracking-[.1em] text-ok">Результат работы</div><p className="mt-2 text-[12.5px] leading-5 text-ink">{DEPARTMENT_NOTE[selectedDepartment.key].result}</p></div></div>
					<div className="mt-5 rounded-[16px] border border-brand/20 bg-brand-soft/35 p-4"><div className="flex flex-wrap items-end justify-between gap-2"><div><div className="text-[10px] font-bold uppercase tracking-[.12em] text-brand-ink">Поток отдела</div><p className="mt-1 text-[11px] text-muted">Суммарная очередь всех договоров и рабочих позиций, а не одного договора.</p></div><Link href={selectedDepartment.href} className="text-[11px] font-semibold text-brand-ink transition hover:opacity-70">Вся очередь →</Link></div><div className="mt-3 grid gap-2 sm:grid-cols-3"><Link href={selectedDepartment.href} className="rounded-xl bg-surface/80 p-3 transition hover:-translate-y-px hover:shadow-sm"><span className="block text-[9px] font-bold uppercase tracking-[.1em] text-faint">В очереди</span><b className="mt-1 block text-[22px] leading-none text-ink">{departmentQueue}</b><span className="mt-1 block text-[10px] text-muted">активные позиции</span></Link><Link href={`${selectedDepartment.href}&focus=working`} className="rounded-xl border border-brand/20 bg-surface p-3 transition hover:-translate-y-px hover:shadow-sm"><span className="block text-[9px] font-bold uppercase tracking-[.1em] text-brand-ink">В работе</span><b className="mt-1 block text-[22px] leading-none text-ink">{departmentWorking}</b><span className="mt-1 block text-[10px] text-muted">выполняются сейчас</span></Link><Link href={`${selectedDepartment.href}&focus=attention`} className="rounded-xl border border-warn/25 bg-warn-bg/30 p-3 transition hover:-translate-y-px hover:shadow-sm"><span className="block text-[9px] font-bold uppercase tracking-[.1em] text-warn">Нужен шаг</span><b className="mt-1 block text-[22px] leading-none text-ink">{departmentAttention}</b><span className="mt-1 block text-[10px] text-muted">требуют решения · передано {departmentDone}</span></Link></div></div>
					{selectedFlow && <div className="mt-5 grid gap-3 lg:grid-cols-2"><div className="rounded-[16px] border border-line bg-surface p-4"><div className="flex items-center justify-between gap-2"><div><div className="text-[10px] font-bold uppercase tracking-[.12em] text-faint">Этапы отдела</div><p className="mt-1 text-[10.5px] text-muted">Где находятся договоры и позиции сейчас.</p></div><span className="rounded-full bg-brand-soft px-2 py-1 text-[10px] font-bold text-brand-ink">{selectedFlow.stages.reduce((sum, stage) => sum + stage.count, 0)}</span></div><div className="mt-3 space-y-1.5">{selectedFlow.stages.length ? selectedFlow.stages.map((stage) => <Link key={stage.label} href={stage.href} className="group flex items-center gap-2 rounded-xl px-2.5 py-2 transition hover:bg-raised"><span className="grid h-5 w-5 place-items-center rounded-full bg-brand-soft text-[9px] font-bold text-brand-ink">{stage.count}</span><span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink">{stage.label}</span><span className="text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-ink">→</span></Link>) : <p className="rounded-xl bg-raised px-3 py-3 text-[11px] text-faint">В очереди пока нет позиций.</p>}</div></div><div className="rounded-[16px] border border-line bg-surface p-4"><div className="flex items-center justify-between gap-2"><div><div className="text-[10px] font-bold uppercase tracking-[.12em] text-faint">Договоры и позиции в фокусе</div><p className="mt-1 text-[10.5px] text-muted">Сначала вопросы, которым нужен следующий шаг.</p></div><Link href={`${selectedDepartment.href}&focus=attention`} className="rounded-full bg-warn-bg px-2 py-1 text-[10px] font-bold text-warn">Риски {selectedFlow.riskCount}</Link></div><div className="mt-3 space-y-1.5">{selectedFlow.contracts.length ? selectedFlow.contracts.map((row) => <Link key={row.id} href={row.href} className="group flex items-center gap-2 rounded-xl px-2.5 py-2 transition hover:bg-raised"><i className={`h-2 w-2 flex-none rounded-full ${row.attention ? 'bg-warn' : 'bg-ok'}`} /><span className="min-w-0 flex-1"><b className="block truncate text-[11px]">{row.number}</b><span className="block truncate text-[10px] text-faint">{row.stage} · {row.responsible ?? row.contractorName}</span></span><span className="text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-ink">→</span></Link>) : <p className="rounded-xl bg-raised px-3 py-3 text-[11px] text-faint">Позиции появятся после передачи в отдел.</p>}</div></div></div>}
					{selectedFlow && <div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-[15px] border border-ok/20 bg-ok-bg/35 p-3.5"><span className="text-[10px] font-bold uppercase tracking-[.1em] text-ok">Передача дальше</span><b className="mt-1 block text-[13px] text-ink">{selectedFlow.handoff.label}: {selectedFlow.handoff.count}</b><p className="mt-1 text-[10.5px] text-muted">Готовые позиции, которые уже вышли из зоны отдела.</p></div><div className="rounded-[15px] border border-line bg-raised/45 p-3.5"><span className="text-[10px] font-bold uppercase tracking-[.1em] text-faint">Нагрузка сотрудников</span><div className="mt-2 space-y-1.5">{selectedFlow.workload.length ? selectedFlow.workload.map((person) => <div key={person.name} className="flex items-center justify-between text-[11px]"><span className="truncate text-muted">{person.name}</span><b className="rounded-full bg-surface px-2 py-0.5 text-ink">{person.count}</b></div>) : <span className="text-[10.5px] text-faint">Исполнители ещё не назначены.</span>}</div></div></div>}
					<div className="mt-5"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.12em] text-faint">Быстрые переходы</div><div className="grid gap-2 sm:grid-cols-2"><Link href={`${selectedDepartment.href}&focus=working`} className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[12px] font-semibold text-ink transition hover:-translate-y-px hover:border-brand/30 hover:bg-raised">Рабочая очередь <span className="ml-1 text-brand-ink">{selectedDepartment.stats.find((stat) => stat.key === 'working')?.count ?? 0}</span></Link><Link href={`${selectedDepartment.href}&focus=attention`} className="rounded-xl border border-warn/20 bg-warn-bg/35 px-3.5 py-3 text-[12px] font-semibold text-ink transition hover:-translate-y-px hover:border-warn/40">Требуют внимания <span className="ml-1 text-warn">{selectedDepartment.stats.find((stat) => stat.key === 'attention')?.count ?? 0}</span></Link></div></div>
					<div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setSelectedDepartmentKey(null)} className="h-10 rounded-[10px] px-4 text-[12px] font-semibold text-muted transition hover:bg-raised">Остаться на главной</button><Link href={selectedDepartment.href} className="brand-gradient inline-flex h-10 items-center justify-center rounded-[10px] px-4 text-[12px] font-semibold text-white shadow-sm transition hover:-translate-y-px hover:shadow-md">Открыть договоры отдела</Link></div>
				</div>
			</section>
		</div>, document.body)}

		<section id="stages" className="mt-4 grid scroll-mt-20 gap-4 2xl:grid-cols-2">
			<DashboardDisclosure title="Общая сводка" subtitle="Быстрый переход к нужной группе договоров"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><SmallMetric label="Всего в базе" value={totalContracts} tone="bg-raised" href="/contracts" /><SmallMetric label="В работе" value={activeNow} tone="bg-brand-soft/55 text-brand-ink" href="/contracts?focus=working" /><SmallMetric label="Внимание" value={attentionCount} tone="bg-warn-bg/55 text-warn" href="/contracts?focus=attention" /><SmallMetric label="Закрыто" value={closedContracts} tone="bg-ok-bg/55 text-ok" href="/contracts?tab=closed" /></div></DashboardDisclosure>
			<DashboardDisclosure title="Распределение по этапам" subtitle="Где сейчас находятся договоры">{stages.length ? <div className="space-y-2.5">{stages.map((stage) => <Link key={stage.key} href={`/contracts?stage=${stage.key}`} className="group flex items-center gap-2"><span className="w-[130px] truncate text-[10.5px] text-muted group-hover:text-brand-ink" title={stage.label}>{stage.label}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-gradient-to-r from-brand to-[#ad9bff] transition-all group-hover:brightness-110" style={{ width: `${Math.max(5, Math.round(stage.count / stageMax * 100))}%` }} /></div><b className="w-5 text-right text-[11px]">{stage.count}</b></Link>)}</div> : <p className="py-4 text-center text-[11px] text-faint">Договоров пока нет</p>}</DashboardDisclosure>
		</section>

		<section id="attention" aria-labelledby="attention-title" className="mt-4 scroll-mt-20">
			<section className="dashboard-disclosure overflow-hidden rounded-[20px] border border-line bg-surface shadow-sm">
				<button type="button" onClick={() => setAttentionOpen((value) => !value)} aria-expanded={attentionOpen} aria-controls={attentionContentId} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-raised/55">
					<span className="flex min-w-0 items-center gap-3">
						<span className={`grid h-9 w-9 flex-none place-items-center rounded-xl ${attentionItems.some((item) => item.tone === 'danger') ? 'bg-danger-bg text-danger' : attentionItems.length ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok'}`}>
							<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4m0 4h.01" /><path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
						</span>
						<span className="min-w-0"><b id="attention-title" className="block text-[14px]">Фокус дня</b><span className="mt-0.5 block truncate text-[11px] text-faint">{attentionItems.length === 0 ? 'Открытых вопросов нет' : `Открыто ${plural(attentionItems.length, 'вопрос', 'вопроса', 'вопросов')} — нужен следующий шаг`}</span></span>
					</span>
					<span className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${attentionItems.some((item) => item.tone === 'danger') ? 'bg-danger-bg text-danger' : attentionItems.length ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok'}`}>{attentionItems.length || 'ОК'}</span><span className={`grid h-8 w-8 place-items-center rounded-lg border border-line text-brand-ink transition-transform duration-200 ${attentionOpen ? 'rotate-180' : ''}`}>⌄</span></span>
				</button>
				<div id={attentionContentId} hidden={!attentionOpen} className="border-t border-line-soft px-3 pb-3 pt-2 animate-[dashboard-content-in_.18s_cubic-bezier(.2,.8,.2,1)]">
					{attentionItems.length ? <><div className="grid gap-1">{attentionItems.slice(0, 6).map((item) => <Link key={item.id} href={item.href} className="group flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-raised"><i className={`h-2 w-2 flex-none rounded-full ${item.tone === 'off' ? DOT.muted : DOT[item.tone]}`} /><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold group-hover:text-brand-ink">{item.title}</span><span className="mt-0.5 block truncate text-[10.5px] text-faint">{item.group} · {item.detail}</span></span><span className="text-[13px] text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-ink">→</span></Link>)}</div><Link href="/contracts?tab=active" className="mt-2 inline-flex rounded-lg px-3 py-2 text-[11px] font-semibold text-brand-ink hover:bg-brand-soft">Открыть все активные договоры →</Link></> : <div className="rounded-xl bg-ok-bg px-4 py-3 text-[11.5px] text-ok">Сроки, файлы и площадки не требуют отдельного действия.</div>}
				</div>
			</section>
		</section>

		<section id="daily-load" className="mt-4 scroll-mt-20 overflow-hidden rounded-[20px] border border-line bg-surface shadow-sm">
			<div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><h2 className="text-[14px] font-bold">Нагрузка отделов по дням</h2><p className="mt-0.5 text-[11px] text-faint">Текущий день — слева. Наведите или нажмите на столбец: расшифровка всегда остаётся на виду.</p></div><div className="flex flex-wrap gap-1.5">{departments.map((department) => <button key={department.key} type="button" onClick={() => { setHistoryDepartment(department.key); setSelectedDate(null) }} className={`rounded-lg px-2.5 py-1.5 text-[10.5px] font-semibold transition ${historyDepartment === department.key ? 'bg-brand text-white shadow-sm' : 'bg-raised text-muted hover:bg-brand-soft hover:text-brand-ink'}`}>{department.label}</button>)}</div></div>
			<div className="border-t border-line-soft px-5 pb-5 pt-4"><div className="mb-3 flex flex-wrap gap-3 text-[10px] font-semibold text-muted"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-brand" />В работе</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-warn" />Внимание</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-faint" />Пауза</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-ok" />Готово</span></div>
				{selectedDay ? <div className="mb-3 animate-[fade-in_.18s_ease-out] rounded-xl border border-brand/15 bg-gradient-to-r from-brand-soft/55 via-surface to-surface p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-[11.5px] font-bold text-ink">Нагрузка на {selectedDay.date}</span><span className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-semibold text-muted">{departments.find((item) => item.key === historyDepartment)?.label}: всего {selectedDay.value.total}</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><SmallMetric label="В работе" value={selectedDay.value.working} tone="bg-surface/85 text-brand-ink" href="/contracts?tab=active" /><SmallMetric label="Внимание" value={selectedDay.value.attention} tone="bg-warn-bg/55 text-warn" href="/contracts?tab=active" /><SmallMetric label="На паузе" value={selectedDay.value.paused} tone="bg-raised" href="/contracts?tab=active" /><SmallMetric label="Готово" value={selectedDay.value.done} tone="bg-ok-bg/55 text-ok" href="/contracts?tab=closed" /></div></div> : <div className="mb-3 rounded-xl border border-line bg-raised/45 px-3 py-3 text-center text-[11px] text-faint">За выбранный период ещё нет сохранённых снимков нагрузки.</div>}
				<div className="rounded-xl bg-raised/60 px-3 pb-8 pt-6 sm:flex sm:gap-5">
					<div className={`grid h-[196px] items-end justify-start gap-2 ${visibleHistory.length < 7 ? 'w-full max-w-[260px] flex-none' : 'min-w-[620px] flex-1'}`} style={{ gridTemplateColumns: visibleHistory.length < 7 ? `repeat(${visibleHistory.length}, minmax(34px, 42px))` : `repeat(${visibleHistory.length}, minmax(28px, 1fr))` }}>
						{visibleHistory.map((day, index) => { const value = day.value; const height = value.recorded ? Math.max(3, Math.round(value.total / historyMax * 100)) : 2; const selected = selectedDay?.date === day.date; return <button key={day.date} type="button" onMouseEnter={() => value.recorded && setSelectedDate(day.date)} onFocus={() => value.recorded && setSelectedDate(day.date)} onClick={() => value.recorded && setSelectedDate(day.date)} className="group relative flex h-full items-end justify-center focus:outline-none" aria-label={`${day.date}: всего ${value.total}`} aria-pressed={selected}><div className={`relative flex w-full max-w-[34px] flex-col overflow-hidden rounded-t-lg transition duration-200 group-hover:scale-x-105 group-hover:brightness-110 group-focus:scale-x-105 group-focus:brightness-110 ${selected ? 'ring-2 ring-brand/35 ring-offset-2 ring-offset-raised' : ''} ${value.recorded ? 'shadow-sm' : 'opacity-20'}`} style={{ height: `${height}%` }}><i className="block bg-brand" style={{ height: `${value.total ? value.working / value.total * 100 : 0}%` }} /><i className="block bg-warn" style={{ height: `${value.total ? value.attention / value.total * 100 : 0}%` }} /><i className="block bg-faint" style={{ height: `${value.total ? value.paused / value.total * 100 : 0}%` }} /><i className="block bg-ok" style={{ height: `${value.total ? value.done / value.total * 100 : 0}%` }} /></div>{value.recorded && <b className="absolute -top-5 text-[9px] text-ink">{value.total}</b>}<span className={`absolute -bottom-5 text-[9px] text-faint ${index % 2 ? 'hidden sm:block' : ''}`}>{day.label}</span></button> })}
					</div>
					{recorded.length > 0 && unsavedDays > 0 && <div className="mt-8 flex min-h-[98px] max-w-[250px] flex-1 items-center rounded-xl border border-dashed border-line bg-surface/45 px-4 sm:mt-0"><div><b className="block text-[11px] text-ink">История ещё собирается</b><p className="mt-1 text-[10.5px] leading-4 text-faint">Есть снимки за {recorded.length} {recorded.length === 1 ? 'день' : recorded.length < 5 ? 'дня' : 'дней'}. Новая нагрузка фиксируется ежедневно, пустые дни не искажают график.</p></div></div>}
				</div>
			</div>
		</section>
	</>
}
