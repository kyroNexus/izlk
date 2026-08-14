import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { canSeeAmounts as maySeeAmounts, canWrite, contractScope, requireUser } from '@/lib/access'
import Topbar from '@/components/Topbar'
import ContractFilters from '@/components/ContractFilters'
import StageCommentEditor from '@/components/StageCommentEditor'
import FilterSelect from '@/components/FilterSelect'
import { Card, RichEmptyState } from '@/components/ui'
import { Circle, Check, Folder, Minus } from 'lucide-react'
import Icon from '@/components/Icon'
import { FileText } from 'lucide-react'

const FolderIcon = () => <Icon icon={Folder} size={15} />
const DocumentsIcon = () => <Icon icon={FileText} size={15} />
import { formatDate, formatMoney, initials, plural } from '@/lib/format'
import type { ContractKind, ContractStatus, ContractWorkflowStage, Prisma, SectionCode } from '@prisma/client'
import { WORKFLOW_STAGE_LABEL } from '@/lib/contract-workflow'

const TABS: { key: string; label: string; status?: ContractStatus }[] = [
	{ key: 'all', label: 'Все' },
	{ key: 'active', label: 'Активные', status: 'ACTIVE' },
	{ key: 'closed', label: 'Закрытые', status: 'CLOSED' },
	{ key: 'archived', label: 'В архиве', status: 'ARCHIVED' },
]

const KIND_LABELS: Record<ContractKind, string> = { SMR: 'СМР', MK: 'МК', PROJECT: 'П' }
const KINDS: ContractKind[] = ['SMR', 'MK', 'PROJECT']
const WORKFLOW_STAGES: ContractWorkflowStage[] = ['CONTRACT_PREPARATION', 'AWAITING_CONTRACT_SIGNATURE', 'PR1_DEVELOPMENT', 'AWAITING_PR1_SIGNATURE', 'DESIGN', 'WAITING_PRODUCTION', 'PRODUCTION', 'AWAITING_SHIPMENT', 'INSTALL_KZH', 'INSTALL_KM', 'CLOSED']
const COMMENT_STAGES: Array<{ key: ContractWorkflowStage; label: string }> = [
	{ key: 'CONTRACT_PREPARATION', label: 'Договор' },
	{ key: 'AWAITING_CONTRACT_SIGNATURE', label: 'Подписание' },
	{ key: 'AWAITING_PR1_SIGNATURE', label: 'ПР1' },
	{ key: 'DESIGN', label: 'Проект' },
	{ key: 'WAITING_PRODUCTION', label: 'Производство' },
	{ key: 'AWAITING_SHIPMENT', label: 'Отгрузка' },
	{ key: 'SHIPPED', label: 'В пути' },
	{ key: 'INSTALL_KM', label: 'Монтаж' },
]
const SECTION_FILTERS: SectionCode[] = ['KM', 'KZH', 'AR']
const SECTION_FILTER_LABEL: Record<string, string> = { KM: 'КМ', KZH: 'КЖ', AR: 'АР' }
const DEPARTMENT_STAGES = {
	commercial: ['CONTRACT_PREPARATION', 'AWAITING_CONTRACT_SIGNATURE', 'PR1_DEVELOPMENT', 'AWAITING_PR1_SIGNATURE'],
	engineering: ['DESIGN'],
	production: ['WAITING_PRODUCTION', 'PRODUCTION', 'AWAITING_SHIPMENT', 'SHIPPED'],
	construction: ['INSTALL_KZH', 'INSTALL_KM'],
} as const satisfies Record<string, ContractWorkflowStage[]>
const DEPARTMENT_LABEL: Record<keyof typeof DEPARTMENT_STAGES, string> = { commercial: 'Коммерческий', engineering: 'Конструкторский', production: 'Производственный', construction: 'Строительный' }
const ATTENTION_STAGES: ContractWorkflowStage[] = ['AWAITING_CONTRACT_SIGNATURE', 'AWAITING_PR1_SIGNATURE', 'WAITING_PRODUCTION', 'AWAITING_SHIPMENT']
const FOCUS_LABEL = { working: 'В работе — показаны активные договоры', attention: 'Требуют внимания — показаны договоры, ожидающие решения или подтверждения', today: 'Создано сегодня — показаны новые договоры за текущий день' } as const

function WorkflowChip({ stage }: { stage: ContractWorkflowStage }) {
	const tone = stage === 'CLOSED' ? 'bg-ok-bg text-ok ring-ok/20' : ['AWAITING_CONTRACT_SIGNATURE', 'AWAITING_PR1_SIGNATURE', 'WAITING_PRODUCTION', 'AWAITING_SHIPMENT'].includes(stage) ? 'bg-warn-bg text-warn ring-warn/20' : ['INSTALL_KZH', 'INSTALL_KM', 'PRODUCTION'].includes(stage) ? 'bg-brand-soft text-brand-ink ring-brand/20' : 'bg-raised text-muted ring-line'
	return <span className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold ring-1 ${tone}`}><i className="h-1.5 w-1.5 flex-none rounded-full bg-current opacity-80" /><span className="truncate">{WORKFLOW_STAGE_LABEL[stage]}</span></span>
}
function ProjectBadges({ sections }: { sections: Array<{ code: SectionCode; queueStatus: string; documents: Array<{ id: string }> }> }) {
	if (sections.length === 0) return <span className="mt-1 block text-[9.5px] text-faint">Разделы ещё не созданы</span>
	return <span className="mt-1 flex flex-wrap gap-1">{sections.filter((item) => ['KM', 'KZH', 'AR'].includes(item.code)).map((item) => {
		const ready = item.queueStatus === 'DONE' || item.documents.length > 0
		const working = item.queueStatus === 'IN_PROGRESS'
		return <span key={item.code} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold ${ready ? 'bg-ok-bg text-ok' : working ? 'bg-warn-bg text-warn' : 'bg-off-bg text-faint'}`}>{SECTION_FILTER_LABEL[item.code]} <Icon icon={ready ? Check : working ? Circle : Minus} size={11} /></span>
	})}</span>
}

export default async function ContractsPage({ searchParams }: { searchParams: { q?: string; tab?: string; year?: string; kind?: string; stage?: string; section?: string; department?: string; focus?: string } }) {
	const user = await requireUser()
	const q = (searchParams.q ?? '').trim()
	const tabKey = searchParams.tab ?? 'all'
	const tab = TABS.find((item) => item.key === tabKey) ?? TABS[0]
	const selectedYear = /^\d{4}$/.test(searchParams.year ?? '') ? Number(searchParams.year) : null
	const selectedKinds = (searchParams.kind ?? '').split(',').filter((value): value is ContractKind => KINDS.includes(value as ContractKind))
	const selectedStage = WORKFLOW_STAGES.includes(searchParams.stage as ContractWorkflowStage) ? searchParams.stage as ContractWorkflowStage : null
	const selectedDepartment = searchParams.department && searchParams.department in DEPARTMENT_STAGES ? searchParams.department as keyof typeof DEPARTMENT_STAGES : null
	const focus = searchParams.focus === 'working' || searchParams.focus === 'attention' || searchParams.focus === 'today' ? searchParams.focus : null
	// Разделы проекта могут быть у СМР, МК и проектных договоров. Не сбрасываем
	// выбранные КМ/КЖ/АР при переключении типа — это позволяет комбинировать фильтры.
	const selectedSections = (searchParams.section ?? '').split(',').filter((value): value is SectionCode => SECTION_FILTERS.includes(value as SectionCode))
	const canSeeAmounts = maySeeAmounts(user)

	const today = new Date()
	today.setHours(0, 0, 0, 0)
	const workflowStages: ContractWorkflowStage[] | null = selectedStage
		? [selectedStage]
		: selectedDepartment && focus === 'attention'
			? DEPARTMENT_STAGES[selectedDepartment].filter((stage) => ATTENTION_STAGES.includes(stage))
			: focus === 'attention'
				? ATTENTION_STAGES
				: selectedDepartment
					? [...DEPARTMENT_STAGES[selectedDepartment]]
					: null
	const where: Prisma.ContractWhereInput = {
		...contractScope(user),
		...(tab.status ? { status: tab.status } : focus === 'working' || focus === 'attention' ? { status: 'ACTIVE' } : {}),
		...(workflowStages ? { workflowStage: { in: workflowStages } } : {}),
		...(focus === 'today' ? { createdAt: { gte: today } } : {}),
		...(q ? { OR: [{ number: { contains: q, mode: 'insensitive' } }, { cipher: { contains: q, mode: 'insensitive' } }, { contractor: { name: { contains: q, mode: 'insensitive' } } }] } : {}),
	}

	const contracts = await prisma.contract.findMany({
		where,
		include: {
			contractor: { select: { name: true, inn: true } },
			manager: { select: { name: true } },
			stageCommentLog: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true, stage: true, text: true, createdAt: true, author: { select: { name: true } } } },
			projectSections: { where: { deletedAt: null }, select: { code: true, queueStatus: true, documents: { where: { deletedAt: null, kind: 'PROJECT_PDF' }, select: { id: true }, take: 1 } } },
			_count: { select: { documents: true } },
		},
		orderBy: [{ date: 'desc' }, { number: 'asc' }],
		take: 1500,
	})

	const currentYear = new Date().getFullYear()
	const contractYears = contracts.map((contract) => contract.date.getFullYear())
	const oldestYear = Math.min(2022, ...contractYears, currentYear)
	const years = Array.from({ length: currentYear - oldestYear + 1 }, (_, index) => currentYear - index)
	const countFor = (year: number) => contracts.filter((contract) => contract.date.getFullYear() === year).length
	const folderContracts = contracts.filter((contract) => !selectedYear || contract.date.getFullYear() === selectedYear)
	const kindCount = (kind?: ContractKind) => folderContracts.filter((contract) => !kind || contract.kind === kind).length
	const sectionScope = selectedKinds.length ? folderContracts.filter((contract) => selectedKinds.includes(contract.kind)) : folderContracts
	const visibleContracts = sectionScope.filter((contract) => !selectedSections.length || contract.projectSections.some((section) => selectedSections.includes(section.code)))
	const name = user.name ?? user.email ?? ''

	function href(options: { tab?: string; year?: number | null; kind?: ContractKind | null; stage?: ContractWorkflowStage | null; section?: SectionCode | null; department?: keyof typeof DEPARTMENT_STAGES | null; focus?: keyof typeof FOCUS_LABEL | null; keepFolder?: boolean } = {}) {
		const params = new URLSearchParams()
		const nextTab = options.tab ?? tabKey
		if (q) params.set('q', q)
		if (nextTab !== 'all') params.set('tab', nextTab)
		if (options.keepFolder !== false) {
			const year = options.year === undefined ? selectedYear : options.year
			const kinds = options.kind === undefined ? selectedKinds : (options.kind ? [options.kind] : [])
			const stage = options.stage === undefined ? selectedStage : options.stage
			const sections = options.section === undefined ? selectedSections : (options.section ? [options.section] : [])
			const department = options.department === undefined ? selectedDepartment : options.department
			const nextFocus = options.focus === undefined ? focus : options.focus
			if (year) params.set('year', String(year))
			if (kinds.length) params.set('kind', kinds.join(','))
			if (stage) params.set('stage', stage)
			if (sections.length) params.set('section', sections.join(','))
			if (department) params.set('department', department)
			if (nextFocus) params.set('focus', nextFocus)
		}
		const query = params.toString()
		return query ? `/contracts?${query}` : '/contracts'
	}

	return <>
		<Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Договоры' }]} userName={name.split(' ')[0]} initials={initials(name)} notifications={0} />
		<div className="px-[26px] py-[22px]">
			<div className="mb-[18px] flex items-start gap-4">
				<div><h1 className="text-[26px] font-bold tracking-[-0.02em]">Договоры</h1><div className="mt-1 text-[13px] text-muted">{plural(visibleContracts.length, 'договор', 'договора', 'договоров')} в выбранном разделе</div></div>
				{canWrite(user) && <div className="ml-auto flex gap-2"><Link href="/contracts/import" className="inline-flex h-[38px] items-center rounded-[10px] px-[12px] text-[12px] font-semibold text-muted hover:bg-raised hover:text-ink">Загрузить</Link><Link href="/contracts/new" className="brand-gradient inline-flex h-[38px] items-center rounded-[10px] px-[15px] text-[13px] font-semibold text-white">+ Новый договор</Link></div>}
			</div>
			{(focus || selectedDepartment || selectedStage) && <div className="mb-[14px] flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/20 bg-brand-soft/55 px-4 py-3"><div><b className="block text-[12.5px] text-brand-ink">Показаны договоры: {focus ? FOCUS_LABEL[focus] : selectedDepartment ? `${DEPARTMENT_LABEL[selectedDepartment]} отдел` : `этап — ${WORKFLOW_STAGE_LABEL[selectedStage!]}`}</b><span className="mt-0.5 block text-[11px] text-muted">{focus || selectedDepartment ? 'Фильтр применён с главной страницы.' : 'Фильтр по этапу применён.'} Его можно изменить или сбросить ниже.</span></div><Link href="/contracts" className="rounded-lg border border-brand/20 bg-surface px-3 py-1.5 text-[11px] font-semibold text-brand-ink hover:bg-brand-soft">Сбросить</Link></div>}

			<div className="work-toolbar mb-[15px] flex flex-wrap items-center gap-3 p-2.5">
				<form method="get" className="relative w-[360px] max-w-full">
					{tabKey !== 'all' && <input type="hidden" name="tab" value={tabKey} />}{selectedYear && <input type="hidden" name="year" value={selectedYear} />}{selectedKinds.length > 0 && <input type="hidden" name="kind" value={selectedKinds.join(',')} />}{selectedStage && <input type="hidden" name="stage" value={selectedStage} />}{selectedSections.length > 0 && <input type="hidden" name="section" value={selectedSections.join(',')} />}{selectedDepartment && <input type="hidden" name="department" value={selectedDepartment} />}{focus && <input type="hidden" name="focus" value={focus} />}
					<svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
					<input name="q" defaultValue={q} placeholder="Номер, шифр или контрагент" className="h-[38px] w-full rounded-[10px] border border-line bg-surface pl-9 pr-3 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
				</form>
				<div className="inline-flex gap-1 rounded-[10px] border border-line bg-raised p-[3px]">{TABS.map((item) => <Link key={item.key} href={href({ tab: item.key })} className={`rounded-[7px] px-3 py-1.5 text-[12px] font-semibold ${item.key === tabKey ? 'brand-gradient text-white' : 'text-muted hover:text-ink'}`}>{item.label}</Link>)}</div>
				<details className="relative">
					<summary className={`flex h-[38px] cursor-pointer list-none items-center gap-1.5 rounded-[10px] border px-3 text-[12px] font-semibold ${selectedStage ? 'border-brand/40 bg-brand-soft text-brand-ink' : 'border-line bg-surface text-muted hover:bg-raised'}`}>Фильтры{selectedStage && <i className="h-[6px] w-[6px] rounded-full bg-brand" aria-hidden="true" />}</summary>
					<form method="get" className="absolute right-0 z-20 mt-2 flex min-w-[280px] items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface p-2 shadow-[var(--shadow-float)]">
					{q && <input type="hidden" name="q" value={q} />}{tabKey !== 'all' && <input type="hidden" name="tab" value={tabKey} />}{selectedYear && <input type="hidden" name="year" value={selectedYear} />}{selectedKinds.length > 0 && <input type="hidden" name="kind" value={selectedKinds.join(',')} />}{selectedSections.length > 0 && <input type="hidden" name="section" value={selectedSections.join(',')} />}{selectedDepartment && <input type="hidden" name="department" value={selectedDepartment} />}{focus && <input type="hidden" name="focus" value={focus} />}
					<FilterSelect name="stage" defaultValue={selectedStage ?? ''} placeholder="Все стадии работ" options={[{ value: '', label: 'Все стадии работ' }, ...WORKFLOW_STAGES.map((stage) => ({ value: stage, label: WORKFLOW_STAGE_LABEL[stage] }))]} />
					<button className="h-[38px] rounded-[10px] border border-line bg-surface px-3 text-[12px] font-semibold hover:bg-raised">Применить</button>
					</form>
				</details>
				{(selectedYear || selectedKinds.length || selectedSections.length || selectedStage || q) && <Link href={href({ year: null, kind: null, section: null, keepFolder: false })} className="text-[12px] font-medium text-brand-ink hover:underline">Сбросить</Link>}
			</div>

			<div className="grid items-start gap-[14px] 2xl:grid-cols-[220px_minmax(0,1fr)]">
				<Card className="overflow-hidden shadow-[0_10px_26px_rgba(25,22,45,.045)]">
					<div className="border-b border-line bg-gradient-to-br from-brand-soft/80 to-surface px-4 py-3.5"><div className="flex items-center gap-2 text-[13px] font-bold"><span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white"><FolderIcon /></span><span>Архив договоров</span></div><div className="ml-9 mt-0.5 text-[10.5px] text-faint">Все договоры по годам</div></div>
					<div className="max-h-[330px] overflow-y-auto p-2 2xl:max-h-[680px]">
						<Link href={href({ year: null, kind: null })} className={`mb-1 flex items-center justify-between rounded-lg px-2.5 py-2 text-[12px] ${!selectedYear ? 'bg-brand-soft font-bold text-brand-ink' : 'hover:bg-raised'}`}><span>Все годы</span><span className="text-faint">{contracts.length}</span></Link>
						{years.map((year) => <Link key={year} href={href({ year, kind: null })} className={`mb-1 flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-[12.5px] font-bold hover:bg-raised ${selectedYear === year ? 'bg-brand-soft text-brand-ink' : ''}`}><span className="text-faint"><FolderIcon /></span><span className="flex-1">{year}</span><span className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-semibold text-faint">{countFor(year)}</span></Link>)}
					</div>
				</Card>

				<Card className="overflow-hidden shadow-[0_10px_26px_rgba(25,22,45,.045)]">
					<div className="border-b border-line bg-raised/60 px-4 py-3">
						<div className="flex items-center gap-3"><div><div className="text-[14px] font-bold">{selectedYear ? `${selectedYear} год` : 'Все договоры'}{selectedKinds.length ? ` · ${selectedKinds.map((kind) => KIND_LABELS[kind]).join(', ')}` : ''}{selectedSections.length ? ` · ${selectedSections.map((section) => SECTION_FILTER_LABEL[section]).join(', ')}` : ''}</div><div className="mt-0.5 text-[10.5px] text-faint">Можно выбрать несколько типов и разделов одновременно</div></div><span className="ml-auto rounded-full bg-surface px-2.5 py-1 text-[10.5px] font-bold text-muted">{visibleContracts.length}</span></div>
						<ContractFilters kinds={KINDS.map((kind) => ({ key: kind, label: KIND_LABELS[kind], count: kindCount(kind) }))} sections={SECTION_FILTERS.map((section) => ({ key: section, label: SECTION_FILTER_LABEL[section], count: sectionScope.filter((contract) => contract.projectSections.some((item) => item.code === section)).length }))} />
					</div>
					{visibleContracts.length === 0 ? <RichEmptyState title={user.role === 'VIEWER' ? 'Нет назначенных договоров' : 'В этом разделе договоров нет'} description={user.role === 'VIEWER' ? 'Обратитесь к менеджеру или администратору, чтобы получить доступ к договору.' : 'Измените фильтры или создайте новый договор.'} icon={Folder} primaryAction={canWrite(user) ? <Link href="/contracts/new" className="brand-gradient rounded-lg px-3 py-2 text-[12px] font-semibold text-white">Создать договор</Link> : undefined} secondaryAction={<Link href="/contracts" className="rounded-lg border border-line px-3 py-2 text-[12px] font-semibold text-ink hover:bg-raised">Сбросить фильтры</Link>} /> : <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					<div className="min-w-[960px]"><div className="grid grid-cols-[170px_72px_minmax(150px,1fr)_minmax(170px,1.2fr)_92px_140px_55px] gap-3 border-b border-line-soft bg-raised px-4 py-2 text-[9.5px] font-bold uppercase tracking-wide text-faint"><span>Номер / шифр</span><span>Тип</span><span>Контрагент</span><span>Объект</span><span>Дата</span><span>Этап работ</span><span>Файлы</span></div>
						{visibleContracts.map((contract) => {
							const threadByStage: Record<string, { id: string; text: string; authorName: string | null; createdAt: string }[]> = {}
							for (const item of contract.stageCommentLog) (threadByStage[item.stage] ??= []).push({ id: item.id, text: item.text, authorName: item.author?.name ?? null, createdAt: item.createdAt.toISOString() })
							const stageThread = threadByStage[contract.workflowStage]
							const stageComment = stageThread?.[stageThread.length - 1]?.text
							return <div key={contract.id} className="interactive-row group grid grid-cols-[170px_72px_minmax(150px,1fr)_minmax(170px,1.2fr)_92px_140px_55px] items-center gap-3 border-b border-line-soft px-4 py-3 text-[11.5px] last:border-0">
							<Link href={`/contracts/${contract.id}`} className="min-w-0"><span className="block truncate text-[12.5px] font-bold group-hover:text-brand-ink">№ {contract.number}</span><span className="mt-0.5 block truncate text-[10.5px] text-faint">{contract.cipher ?? 'Без шифра'}</span><ProjectBadges sections={contract.projectSections} /></Link>
							<span><span className="rounded-md bg-raised px-2 py-1 text-[10.5px] font-bold">{KIND_LABELS[contract.kind]}</span></span>
							<Link href={`/contracts/${contract.id}`} className="min-w-0"><span className="block truncate font-semibold">{contract.contractor.name}</span><span className="block truncate text-[10px] text-faint">ИНН {contract.contractor.inn}</span></Link>
							<Link href={`/contracts/${contract.id}`} className="min-w-0"><span className="block truncate">{contract.objectAddress ?? 'Адрес не указан'}</span>{canSeeAmounts && <span className="mt-0.5 block truncate text-[10px] font-semibold text-muted">{formatMoney(contract.amount, contract.currency)}</span>}</Link>
							<Link href={`/contracts/${contract.id}`} className="tnum text-muted">{formatDate(contract.date)}</Link><span><WorkflowChip stage={contract.workflowStage} /><StageCommentEditor contractId={contract.id} stages={COMMENT_STAGES} comments={threadByStage} canWrite={canWrite(user)} />{stageComment ? <span title={stageComment} className="mt-1 block truncate text-[9.5px] text-muted">{stageComment}</span> : <span className="mt-1 block text-[9.5px] text-faint">Нажмите на этап для комментария</span>}</span>
							<span className="flex items-center gap-1.5 text-muted"><span className="text-faint"><DocumentsIcon /></span><span className="font-semibold">{contract._count.documents}</span></span>
						</div> })}</div>
					</div>}
				</Card>
			</div>
		</div>
	</>
}
