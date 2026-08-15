import type { ContractWorkflowStage, InvoiceStatus, SectionCode, SiteStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { contractScope, isAdmin, type SessionUser } from '@/lib/access'
import { workingDaysBetween } from '@/lib/deadline'
import { WORKFLOW_STAGE_LABEL } from '@/lib/contract-workflow'
import { logger } from '@/lib/logger'

/**
 * Сборка данных для дашборда (Блок A).
 *
 * Важно: всё считается по ФАКТИЧЕСКИ СУЩЕСТВУЮЩИМ полям схемы,
 * без опоры на немигрированный schema-additions.prisma.
 *
 * Как выводятся этапы, пока в Contract нет поля stage:
 *  - ПР1 считается подписанным, если есть документ CONTRACT/SIGNED_SCAN с signedAt
 *  - раздел КМ/АР/КЖ считается готовым, если к нему приложен PROJECT_PDF
 *  - дальше используется уже написанный calcProgress() — логика не дублируется
 */

export const SECTION_LABEL: Record<SectionCode, string> = {
	KM: 'КМ',
	AR: 'АР',
	KZH: 'КЖ',
	OTHER: 'Прочее',
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
	UNPAID: 'Не оплачен',
	PARTIALLY_PAID: 'Частично оплачен',
	PAID: 'Оплачен',
	OVERDUE: 'Просрочен',
	CANCELLED: 'Отменён',
}

export type AttentionTone = 'danger' | 'warn' | 'off'

export type AttentionItem = {
	id: string
	tone: AttentionTone
	title: string
	detail: string
	href: string
	group: 'Проектирование' | 'Площадки' | 'Финансы' | 'Документы'
	/** Чем больше, тем выше в списке. */
	weight: number
}

export type FunnelStage = {
	key: ContractWorkflowStage
	label: string
	count: number
	amount: number
	share: number
}

export type DepartmentKey = 'commercial' | 'engineering' | 'production' | 'construction'
export type DepartmentTimelineDay = {
	date: string
	label: string
	values: Record<DepartmentKey, { working: number; attention: number; paused: number; done: number; total: number; recorded: boolean }>
}

export type DepartmentFlow = {
	key: DepartmentKey
	queueCount: number
	stages: Array<{ label: string; count: number; href: string }>
	contracts: Array<{ id: string; number: string; contractorName: string; stage: string; responsible: string | null; attention: boolean; href: string }>
	workload: Array<{ name: string; count: number }>
	riskCount: number
	handoff: { label: string; count: number }
}

/** What each department takes in, focuses on, and hands off — shown once, on the department's own page. */
export const DEPARTMENT_NOTE: Record<DepartmentKey, { input: string; focus: string; result: string; output: string }> = {
	commercial: { input: 'Запрос заказчика и исходные документы', focus: 'Подписи, исходные договоры и передача в проектирование.', result: 'Договор подтверждён и передан в следующий отдел.', output: 'Конструкторский отдел' },
	engineering: { input: 'Подписанное ПР1 и задача на проектирование', focus: 'Очередь КМ, КЖ и АР, сроки разделов и готовые PDF.', result: 'Готовые разделы переданы в производство.', output: 'Производственный отдел' },
	production: { input: 'Готовый КМ и подтверждённый запуск', focus: 'Буфер запуска, выпуск и готовность к отгрузке.', result: 'Изделия переданы на отгрузку или монтаж.', output: 'Строительный отдел' },
	construction: { input: 'Изделия, площадка и план монтажа', focus: 'Площадки, монтаж, комментарии и фотоотчёты.', result: 'Работы закрыты, комплект исполнительной документации собран.', output: 'Исполнительная документация' },
}

const WORKFLOW_FUNNEL_STAGES: ContractWorkflowStage[] = ['CONTRACT_PREPARATION', 'AWAITING_CONTRACT_SIGNATURE', 'PR1_DEVELOPMENT', 'AWAITING_PR1_SIGNATURE', 'DESIGN', 'WAITING_PRODUCTION', 'PRODUCTION', 'AWAITING_SHIPMENT', 'SHIPPED', 'INSTALL_KZH', 'INSTALL_KM', 'CLOSED']

export type DesignRow = {
	id: string
	contractId: string
	contractNumber: string
	code: SectionCode
	label: string
	responsible: string | null
	dateFrom: Date | null
	dateTo: Date | null
	ready: boolean
	/** Рабочих дней до плановой даты; отрицательное — просрочка. */
	daysLeft: number | null
	overdue: boolean
}

export type DebtorRow = {
	contractId: string
	contractNumber: string
	contractorName: string
	amount: number
	overdueAmount: number
}

export type DashboardData = {
	generatedAt: Date
	canSeeAmounts: boolean
	showInbox: boolean
	totals: {
			contracts: number
			activeContracts: number
			closedContracts: number
			createdToday: number
		activeAmount: number
		documents: number
		contractors: number
	}
	attention: AttentionItem[]
	attentionCounts: { danger: number; warn: number }
	funnel: FunnelStage[]
	design: {
		overdue: DesignRow[]
		upcoming: DesignRow[]
		readyCount: number
		totalCount: number
	}
	finance: {
		activeAmount: number
		invoicedAmount: number
		paidAmount: number
		awaitingAmount: number
		overdueAmount: number
		debtors: DebtorRow[]
	}
	sites: {
		byStatus: Array<{ status: SiteStatus; count: number }>
		total: number
	}
	inbox: {
		pending: number
		suggested: number
		failed: number
		totalOpen: number
	}
	myTasks: Array<{ id: string; title: string; status: string; priority: string; dueDate: Date | null; contractNumber: string | null }>
	recentActivity: Array<{ id: string; action: string; entityType: string; createdAt: Date }>
	activityTimeline: Array<{ date: string; label: string; created: number; uploaded: number; updated: number; total: number }>
	departmentTimeline: DepartmentTimelineDay[]
	departmentFlow: DepartmentFlow[]
	departmentProgress: Array<{
		key: DepartmentKey
		label: string
		description: string
		ready: number
		total: number
		percent: number
		href: string
		stats: Array<{ key: 'working' | 'attention' | 'paused' | 'done'; label: string; count: number; tone: 'brand' | 'warn' | 'danger' | 'ok' | 'muted' }>
	}>
}

const OPEN_INVOICE_STATUSES: InvoiceStatus[] = ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE']

function toNumber(value: unknown): number {
	const n = Number(value ?? 0)
	return Number.isFinite(n) ? n : 0
}

function startOfDay(date: Date): Date {
	const d = new Date(date.getTime())
	d.setHours(0, 0, 0, 0)
	return d
}

type DashboardComputeOptions = {
	/** Дневной снимок нагрузки отделов — нужен только реальной сводке на "/", не каждой странице отдела. */
	writeSnapshot: boolean
	/** 30-дневные истории (лента активности, снимок по дням) — тяжёлые запросы, которые страница отдела не показывает. */
	includeTimeline: boolean
	/** "Мои задачи" и "последняя активность" — тоже только сводка на "/". */
	includeTasks: boolean
}

/** Один проход по договорам в области видимости роли — общее ядро для loadDashboard() и loadDepartmentFlow(). */
async function computeDashboard(user: SessionUser, now: Date, options: DashboardComputeOptions): Promise<DashboardData> {
	const scope = contractScope(user)
	const showAmounts = user.role === 'ADMIN' || user.role === 'MANAGER'
	const showInbox = isAdmin(user)
	const today = startOfDay(now)
	const horizon = new Date(today.getTime())
	horizon.setDate(horizon.getDate() + 14)

	const [contracts, contractorsCount, inboxGroups, myTasks, recentActivity, timelineActivity, snapshotRows] = await Promise.all([
		prisma.contract.findMany({
			where: scope,
			select: {
				id: true,
				createdAt: true,
				number: true,
				cipher: true,
				date: true,
				amount: true,
				currency: true,
				status: true,
				workflowStage: true,
				managerId: true,
				manager: { select: { name: true } },
				contractor: { select: { id: true, name: true } },
				projectSections: {
					where: { deletedAt: null },
					select: {
					id: true,
					code: true,
					queueStatus: true,
					dateFrom: true,
						dateTo: true,
						responsible: { select: { name: true } },
						documents: {
							where: { deletedAt: null, kind: 'PROJECT_PDF' },
							select: { id: true },
							take: 1,
						},
					},
				},
				sites: {
					where: { deletedAt: null },
					select: { id: true, address: true, status: true },
				},
				executiveDocs: {
					where: { deletedAt: null },
					select: { id: true, name: true, status: true },
				},
				documents: {
					where: { deletedAt: null },
					select: { id: true, kind: true, signedAt: true },
				},
				invoices: {
					where: { deletedAt: null },
					select: { id: true, number: true, amount: true, status: true, dueDate: true },
				},
			},
			orderBy: { date: 'desc' },
			// The dashboard aggregates its whole visible portfolio. This is not a
			// paginated list: truncating it silently made the totals wrong after
			// the 500th contract. 2,000 safely covers the current operating range;
			// if that grows further, move these aggregates into SQL group-bys.
			take: 2000,
		}),
		prisma.contractor.count({
			where: { deletedAt: null, contracts: { some: scope } },
		}),
		showInbox
			? prisma.inboxItem.groupBy({ by: ['status'], _count: { _all: true } })
			: Promise.resolve([]),
		options.includeTasks
			? prisma.task.findMany({ where: { assigneeId: user.id, deletedAt: null, status: { not: 'DONE' } }, select: { id: true, title: true, status: true, priority: true, dueDate: true, contract: { select: { number: true } } }, orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }], take: 5 })
			: Promise.resolve([]),
		options.includeTasks
			? prisma.auditLog.findMany({ where: { userId: user.id }, select: { id: true, action: true, entityType: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 6 })
			: Promise.resolve([]),
		options.includeTimeline
			? prisma.auditLog.findMany({
				where: {
					createdAt: { gte: new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000) },
					...(user.role === 'ADMIN' ? {} : { userId: user.id }),
				},
				select: { action: true, createdAt: true },
				orderBy: { createdAt: 'asc' },
				take: 3000,
			})
			: Promise.resolve([]),
		options.includeTimeline
			? prisma.departmentDailySnapshot.findMany({
				where: { date: { gte: new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000) } },
				select: { date: true, department: true, working: true, attention: true, paused: true, done: true, total: true },
				orderBy: { date: 'asc' },
			})
			: Promise.resolve([]),
	])

	const attention: AttentionItem[] = []
	const funnelCounts = new Map<ContractWorkflowStage, { count: number; amount: number }>()
	const overdueDesign: DesignRow[] = []
	const upcomingDesign: DesignRow[] = []
	const siteStatusCount = new Map<SiteStatus, number>()
	const debtorMap = new Map<string, DebtorRow>()
	const departmentRows: Record<DepartmentKey, DepartmentFlow['contracts']> = { commercial: [], engineering: [], production: [], construction: [] }
	const departmentWorkload: Record<DepartmentKey, Map<string, number>> = { commercial: new Map(), engineering: new Map(), production: new Map(), construction: new Map() }
	const addWorkload = (department: DepartmentKey, name: string | null) => {
		const label = name || 'Не назначено'
		departmentWorkload[department].set(label, (departmentWorkload[department].get(label) ?? 0) + 1)
	}

	let activeContracts = 0
	let closedContracts = 0
	let createdToday = 0
	let activeAmount = 0
	let documentsCount = 0
	let sectionsReady = 0
	let sectionsTotal = 0
	let invoicedAmount = 0
	let paidAmount = 0
	let awaitingAmount = 0
	let overdueAmount = 0
	let commercialReady = 0
	let commercialTotal = 0
	let productionReady = 0
	let productionTotal = 0
	let constructionReady = 0
	let constructionTotal = 0
	let engineeringWorking = 0
	let engineeringPaused = 0

	for (const contract of contracts) {
		if (contract.createdAt >= today) createdToday += 1
		const amount = toNumber(contract.amount)
		const isActive = contract.status === 'ACTIVE'
		const hasContractFile = contract.documents.some((document) => document.kind === 'CONTRACT' || document.kind === 'SIGNED_SCAN')
		if (contract.status === 'CLOSED') closedContracts += 1
		if (isActive) {
			activeContracts += 1
			activeAmount += amount
			// Commercial department: every contract is ready for handoff when its
			// owner, object and base contract document are filled in.
			commercialTotal += 3
			if (contract.managerId) commercialReady += 1
			if (hasContractFile) commercialReady += 1
			if (contract.sites.length > 0 || contract.projectSections.length > 0) commercialReady += 1
		}
		documentsCount += contract.documents.length

		if (['CONTRACT_PREPARATION', 'AWAITING_CONTRACT_SIGNATURE', 'PR1_DEVELOPMENT', 'AWAITING_PR1_SIGNATURE'].includes(contract.workflowStage)) {
			const needsAttention = !contract.managerId || !hasContractFile || ['AWAITING_CONTRACT_SIGNATURE', 'AWAITING_PR1_SIGNATURE'].includes(contract.workflowStage)
			departmentRows.commercial.push({ id: contract.id, number: contract.number, contractorName: contract.contractor.name, stage: WORKFLOW_STAGE_LABEL[contract.workflowStage], responsible: contract.manager?.name ?? null, attention: needsAttention, href: `/contracts/${contract.id}` })
			addWorkload('commercial', contract.manager?.name ?? null)
		}
		if (['WAITING_PRODUCTION', 'PRODUCTION', 'AWAITING_SHIPMENT', 'SHIPPED'].includes(contract.workflowStage)) {
			departmentRows.production.push({ id: contract.id, number: contract.number, contractorName: contract.contractor.name, stage: WORKFLOW_STAGE_LABEL[contract.workflowStage], responsible: null, attention: contract.workflowStage !== 'PRODUCTION', href: `/contracts/${contract.id}` })
			addWorkload('production', 'Производственный участок')
		}

		/* ---------- Этап договора ---------- */
		const bucket = funnelCounts.get(contract.workflowStage) ?? { count: 0, amount: 0 }
		bucket.count += 1
		bucket.amount += amount
		funnelCounts.set(contract.workflowStage, bucket)

		/* ---------- Проектные разделы ---------- */
		for (const section of contract.projectSections) {
			sectionsTotal += 1
			const ready = section.documents.length > 0
			if (ready) sectionsReady += 1
			if (section.queueStatus === 'IN_PROGRESS') engineeringWorking += 1
			if (section.queueStatus === 'PAUSED') engineeringPaused += 1

			const dateTo = section.dateTo ?? null
			const daysLeft = dateTo ? workingDaysBetween(today, startOfDay(dateTo)) : null
			const overdue = !ready && dateTo != null && startOfDay(dateTo).getTime() < today.getTime()

			const row: DesignRow = {
				id: section.id,
				contractId: contract.id,
				contractNumber: contract.number,
				code: section.code,
				label: SECTION_LABEL[section.code] ?? section.code,
				responsible: section.responsible?.name ?? null,
				dateFrom: section.dateFrom ?? null,
				dateTo,
				ready,
				daysLeft,
				overdue,
			}
			const sectionAttention = overdue || (!ready && !row.responsible)
			departmentRows.engineering.push({ id: section.id, number: contract.number, contractorName: contract.contractor.name, stage: `${row.label} · ${ready ? 'готов' : section.queueStatus === 'PAUSED' ? 'на паузе' : 'в работе'}`, responsible: row.responsible, attention: sectionAttention, href: `/contracts/${contract.id}` })
			addWorkload('engineering', row.responsible)

			if (overdue) {
				overdueDesign.push(row)
				attention.push({
					id: `section-overdue-${section.id}`,
					tone: 'danger',
					group: 'Проектирование',
					title: `${contract.number} · раздел ${row.label} просрочен`,
					detail: row.responsible
						? `Ответственный: ${row.responsible}`
						: 'Ответственный не назначен',
					href: `/contracts/${contract.id}`,
					weight: 1000 + Math.abs(daysLeft ?? 0),
				})
			} else if (!ready && dateTo && startOfDay(dateTo).getTime() <= horizon.getTime()) {
				upcomingDesign.push(row)
				if ((daysLeft ?? 99) <= 5) {
					attention.push({
						id: `section-soon-${section.id}`,
						tone: 'warn',
						group: 'Проектирование',
						title: `${contract.number} · ${row.label} — срок близко`,
						detail: `Осталось рабочих дней: ${daysLeft ?? 0}`,
						href: `/contracts/${contract.id}`,
						weight: 500 - (daysLeft ?? 0),
					})
				}
			}

			if (!ready && !section.responsible && isActive) {
				attention.push({
					id: `section-noresp-${section.id}`,
					tone: 'off',
					group: 'Проектирование',
					title: `${contract.number} · ${row.label} без ответственного`,
					detail: 'Назначьте проектировщика по графику',
					href: `/projects?contract=${contract.id}`,
					weight: 80,
				})
			}
		}

		/* ---------- Площадки ---------- */
		for (const s of contract.sites) {
			constructionTotal += 1
			if (s.status === 'READY') constructionReady += 1
			siteStatusCount.set(s.status, (siteStatusCount.get(s.status) ?? 0) + 1)
			departmentRows.construction.push({ id: s.id, number: contract.number, contractorName: contract.contractor.name, stage: s.status === 'READY' ? 'Площадка готова' : s.status === 'BLOCKED' ? 'Площадка заблокирована' : s.status === 'ISSUE' ? 'Проблема на площадке' : 'Подготовка площадки', responsible: null, attention: s.status === 'BLOCKED' || s.status === 'ISSUE', href: `/sites/${s.id}` })
			addWorkload('construction', 'Монтажная площадка')
			if (s.status === 'BLOCKED' || s.status === 'ISSUE') {
				attention.push({
					id: `site-${s.id}`,
					tone: s.status === 'BLOCKED' ? 'danger' : 'warn',
					group: 'Площадки',
					title:
						s.status === 'BLOCKED'
							? `${contract.number} · площадка заблокирована`
							: `${contract.number} · проблема на площадке`,
					detail: s.address,
					href: `/sites/${s.id}`,
					weight: s.status === 'BLOCKED' ? 900 : 400,
				})
			}
		}

		if (isActive && ['WAITING_PRODUCTION', 'PRODUCTION', 'AWAITING_SHIPMENT', 'SHIPPED', 'INSTALL_KZH', 'INSTALL_KM', 'CLOSED'].includes(contract.workflowStage)) {
			productionTotal += 1
			if (['PRODUCTION', 'AWAITING_SHIPMENT', 'SHIPPED', 'INSTALL_KZH', 'INSTALL_KM', 'CLOSED'].includes(contract.workflowStage)) productionReady += 1
		}

		/* ---------- Финансы ---------- */
		if (showAmounts) {
			let contractDebt = 0
			let contractOverdue = 0

			for (const inv of contract.invoices) {
				const invAmount = toNumber(inv.amount)
				if (inv.status === 'CANCELLED') continue
				invoicedAmount += invAmount

				if (inv.status === 'PAID') {
					paidAmount += invAmount
					continue
				}

				const isOverdue =
					inv.status === 'OVERDUE' ||
					(inv.dueDate != null && startOfDay(inv.dueDate).getTime() < today.getTime())

				if (OPEN_INVOICE_STATUSES.includes(inv.status)) {
					contractDebt += invAmount
					awaitingAmount += invAmount
				}

				if (isOverdue) {
					overdueAmount += invAmount
					contractOverdue += invAmount
					attention.push({
						id: `invoice-${inv.id}`,
						tone: 'danger',
						group: 'Финансы',
						title: `${contract.number} · счёт ${inv.number} просрочен`,
						detail: contract.contractor.name,
						href: `/contracts/${contract.id}`,
						weight: 950,
					})
				}
			}

			if (contractDebt > 0) {
				debtorMap.set(contract.id, {
					contractId: contract.id,
					contractNumber: contract.number,
					contractorName: contract.contractor.name,
					amount: contractDebt,
					overdueAmount: contractOverdue,
				})
			}
		}

		/* ---------- Документы и полнота карточки ---------- */
		if (isActive && !hasContractFile) {
			attention.push({
				id: `nocontractfile-${contract.id}`,
				tone: 'warn',
				group: 'Документы',
				title: `${contract.number} · нет файла договора`,
				detail: contract.contractor.name,
				href: `/contracts/${contract.id}/upload`,
				weight: 300,
			})
		}

		if (isActive && !contract.managerId) {
			attention.push({
				id: `nomanager-${contract.id}`,
				tone: 'off',
				group: 'Документы',
				title: `${contract.number} · не назначен менеджер`,
				detail: contract.contractor.name,
				href: `/contracts/${contract.id}/edit`,
				weight: 120,
			})
		}

		const execUnfinished = contract.executiveDocs.filter((d) => d.status !== 'READY')
		const designAllReady =
			contract.projectSections.length > 0 &&
			contract.projectSections.every((s) => s.documents.length > 0)

		if (designAllReady && execUnfinished.length > 0) {
			attention.push({
				id: `exec-${contract.id}`,
				tone: 'warn',
				group: 'Документы',
				title: `${contract.number} · исполнительная не закрыта`,
				detail: `Не готово позиций: ${execUnfinished.length}`,
				href: `/executive?contract=${contract.id}`,
				weight: 350,
			})
		}
	}

	/* ---------- Воронка ---------- */
	const funnelTotal = contracts.length || 1
	const funnel: FunnelStage[] = WORKFLOW_FUNNEL_STAGES.map((stage) => {
		const data = funnelCounts.get(stage) ?? { count: 0, amount: 0 }
		return {
			key: stage,
			label: WORKFLOW_STAGE_LABEL[stage],
			count: data.count,
			amount: data.amount,
			share: Math.round((data.count / funnelTotal) * 100),
		}
	})

	/* ---------- Inbox ---------- */
	const inboxByStatus = new Map<string, number>()
	for (const row of inboxGroups as Array<{ status: string; _count: { _all: number } }>) {
		inboxByStatus.set(row.status, row._count._all)
	}
	const inboxPending = inboxByStatus.get('PENDING') ?? 0
	const inboxSuggested = inboxByStatus.get('SUGGESTED') ?? 0
	const inboxFailed = inboxByStatus.get('FAILED') ?? 0
	const dayKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
	const timelineMap = new Map<string, { created: number; uploaded: number; updated: number }>()
	for (let index = 29; index >= 0; index--) {
		const date = new Date(today.getTime() - index * 24 * 60 * 60 * 1000)
		timelineMap.set(dayKey(date), { created: 0, uploaded: 0, updated: 0 })
	}
	for (const item of timelineActivity) {
		const bucket = timelineMap.get(dayKey(item.createdAt))
		if (!bucket) continue
		if (item.action === 'CREATE') bucket.created += 1
		else if (item.action === 'UPLOAD') bucket.uploaded += 1
		else if (item.action === 'UPDATE') bucket.updated += 1
	}
	const activityTimeline = Array.from(timelineMap.entries()).map(([date, value]) => ({
		date,
		label: date.slice(8),
		...value,
		total: value.created + value.uploaded + value.updated,
	}))

	if (showInbox && inboxPending + inboxSuggested > 0) {
		attention.push({
			id: 'inbox-queue',
			tone: inboxPending > 0 ? 'warn' : 'off',
			group: 'Документы',
			title: `Очередь импорта: ${inboxPending + inboxSuggested} файлов`,
			detail: `Не распознано: ${inboxPending}, ждёт подтверждения: ${inboxSuggested}`,
			href: '/inbox',
			weight: 250,
		})
	}

	attention.sort((a, b) => b.weight - a.weight)

	const debtors = Array.from(debtorMap.values())
		.sort((a, b) => b.amount - a.amount)
		.slice(0, 6)

	overdueDesign.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
	upcomingDesign.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))

	const departmentProgress: DashboardData['departmentProgress'] = [
			{
				key: 'commercial', label: 'Коммерческий', description: 'Договоры, согласование и передача в работу', ready: commercialReady, total: commercialTotal, percent: commercialTotal ? Math.round(commercialReady / commercialTotal * 100) : 0, href: '/contracts?department=commercial',
				stats: [
					{ key: 'working', label: 'В работе', count: ['CONTRACT_PREPARATION', 'AWAITING_CONTRACT_SIGNATURE', 'PR1_DEVELOPMENT', 'AWAITING_PR1_SIGNATURE'].reduce((n, key) => n + (funnelCounts.get(key as ContractWorkflowStage)?.count ?? 0), 0), tone: 'brand' },
					{ key: 'attention', label: 'Требует внимания', count: departmentRows.commercial.filter((row) => row.attention).length, tone: 'warn' },
					{ key: 'paused', label: 'Приостановлено', count: contracts.filter((item) => item.status === 'ARCHIVED').length, tone: 'muted' },
					{ key: 'done', label: 'Передано дальше', count: contracts.filter((item) => ['DESIGN', 'WAITING_PRODUCTION', 'PRODUCTION', 'AWAITING_SHIPMENT', 'SHIPPED', 'INSTALL_KZH', 'INSTALL_KM', 'CLOSED'].includes(item.workflowStage)).length, tone: 'ok' },
				],
			},
			{
				key: 'engineering', label: 'Конструкторский', description: 'Очередь и готовность разделов КМ, КЖ и АР', ready: sectionsReady, total: sectionsTotal, percent: sectionsTotal ? Math.round(sectionsReady / sectionsTotal * 100) : 0, href: '/contracts?department=engineering',
				stats: [
					{ key: 'working', label: 'В работе', count: engineeringWorking, tone: 'brand' },
					{ key: 'attention', label: 'Требует внимания', count: departmentRows.engineering.filter((row) => row.attention).length, tone: 'warn' },
					{ key: 'paused', label: 'Приостановлено', count: engineeringPaused, tone: 'muted' },
					{ key: 'done', label: 'Готово', count: sectionsReady, tone: 'ok' },
				],
			},
			{
				key: 'production', label: 'Производственный', description: 'Передача в производство, выпуск и отгрузка', ready: productionReady, total: productionTotal, percent: productionTotal ? Math.round(productionReady / productionTotal * 100) : 0, href: '/contracts?department=production',
				stats: [
					{ key: 'working', label: 'В работе', count: funnelCounts.get('PRODUCTION')?.count ?? 0, tone: 'brand' },
					{ key: 'attention', label: 'Ожидает запуска', count: departmentRows.production.filter((row) => row.attention).length, tone: 'warn' },
					{ key: 'paused', label: 'Приостановлено', count: 0, tone: 'muted' },
					{ key: 'done', label: 'Передано на монтаж', count: ['AWAITING_SHIPMENT', 'SHIPPED', 'INSTALL_KZH', 'INSTALL_KM', 'CLOSED'].reduce((n, key) => n + (funnelCounts.get(key as ContractWorkflowStage)?.count ?? 0), 0), tone: 'ok' },
				],
			},
			{
				key: 'construction', label: 'Строительный', description: 'Подготовка площадок, монтаж и фотоотчёты', ready: constructionReady, total: constructionTotal, percent: constructionTotal ? Math.round(constructionReady / constructionTotal * 100) : 0, href: '/contracts?department=construction',
				stats: [
					{ key: 'working', label: 'В работе', count: siteStatusCount.get('PREPARING') ?? 0, tone: 'brand' },
					{ key: 'attention', label: 'Требует внимания', count: departmentRows.construction.filter((row) => row.attention).length, tone: 'warn' },
					{ key: 'paused', label: 'Приостановлено', count: siteStatusCount.get('BLOCKED') ?? 0, tone: 'danger' },
					{ key: 'done', label: 'Готово', count: siteStatusCount.get('READY') ?? 0, tone: 'ok' },
				],
		},
	]
	const departmentStageGroups: Record<DepartmentKey, ContractWorkflowStage[]> = {
		commercial: ['CONTRACT_PREPARATION', 'AWAITING_CONTRACT_SIGNATURE', 'PR1_DEVELOPMENT', 'AWAITING_PR1_SIGNATURE'],
		engineering: ['DESIGN'],
		production: ['WAITING_PRODUCTION', 'PRODUCTION', 'AWAITING_SHIPMENT', 'SHIPPED'],
		construction: ['INSTALL_KZH', 'INSTALL_KM', 'CLOSED'],
	}
	const handoffLabel: Record<DepartmentKey, string> = { commercial: 'Передано в проектирование', engineering: 'Передано в производство', production: 'Передано на монтаж', construction: 'Передано в исполнительную документацию' }
	const departmentFlow: DepartmentFlow[] = departmentProgress.map((department) => {
		const workload = Array.from(departmentWorkload[department.key].entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 4)
		const rows = departmentRows[department.key].slice().sort((a, b) => Number(b.attention) - Number(a.attention) || a.number.localeCompare(b.number)).slice(0, 7)
		const stages = department.key === 'engineering'
			? department.stats.map((stat) => ({ label: stat.label, count: stat.count, href: `${department.href}&focus=${stat.key === 'attention' ? 'attention' : 'working'}` })).filter((stage) => stage.count > 0)
			: departmentStageGroups[department.key].map((stage) => ({ label: WORKFLOW_STAGE_LABEL[stage], count: funnelCounts.get(stage)?.count ?? 0, href: `${department.href}&stage=${stage}` })).filter((stage) => stage.count > 0)
		return { key: department.key, queueCount: departmentRows[department.key].length, stages, contracts: rows, workload, riskCount: rows.filter((row) => row.attention).length, handoff: { label: handoffLabel[department.key], count: department.stats.find((stat) => stat.key === 'done')?.count ?? 0 } }
	})

	// Снимок сохраняется только из общей (администраторской) сводки.
	// Поэтому история не подменяется показателями отдельного менеджера.
	const currentSnapshot = departmentProgress.map((department) => ({
		department: department.key,
		working: department.stats.find((item) => item.key === 'working')?.count ?? 0,
		attention: department.stats.find((item) => item.key === 'attention')?.count ?? 0,
		paused: department.stats.find((item) => item.key === 'paused')?.count ?? 0,
		done: department.stats.find((item) => item.key === 'done')?.count ?? 0,
		total: department.stats.reduce((sum, item) => sum + item.count, 0),
	}))
	if (options.writeSnapshot && isAdmin(user)) {
		await prisma.$transaction(currentSnapshot.map((item) => prisma.departmentDailySnapshot.upsert({
			where: { date_department: { date: today, department: item.department } },
			create: { date: today, ...item },
			update: item,
		})))
	}

	const departmentKeys: DepartmentKey[] = ['commercial', 'engineering', 'production', 'construction']
	const emptySnapshot = () => ({ working: 0, attention: 0, paused: 0, done: 0, total: 0, recorded: false })
	const snapshotMap = new Map<string, { working: number; attention: number; paused: number; done: number; total: number }>()
	for (const row of snapshotRows) {
		snapshotMap.set(`${dayKey(row.date)}:${row.department}`, row)
	}
	// В сегодняшней точке используем только что рассчитанное реальное состояние,
	// чтобы пользователь видел его сразу, без обновления страницы.
	for (const row of currentSnapshot) snapshotMap.set(`${dayKey(today)}:${row.department}`, row)
	const departmentTimeline: DepartmentTimelineDay[] = []
	for (let index = 29; index >= 0; index--) {
		const date = new Date(today.getTime() - index * 24 * 60 * 60 * 1000)
		const dateKey = dayKey(date)
		const values = Object.fromEntries(departmentKeys.map((department) => {
			const stored = snapshotMap.get(`${dateKey}:${department}`)
			return [department, stored ? { ...stored, recorded: true } : emptySnapshot()]
		})) as DepartmentTimelineDay['values']
		departmentTimeline.push({ date: dateKey, label: dateKey.slice(8), values })
	}

	return {
		generatedAt: now,
		canSeeAmounts: showAmounts,
		showInbox,
		totals: { contracts: contracts.length, activeContracts, closedContracts, createdToday, activeAmount, documents: documentsCount, contractors: contractorsCount },
		attention: attention.slice(0, 12),
		attentionCounts: { danger: attention.filter((a) => a.tone === 'danger').length, warn: attention.filter((a) => a.tone === 'warn').length },
		funnel,
		design: { overdue: overdueDesign.slice(0, 8), upcoming: upcomingDesign.slice(0, 8), readyCount: sectionsReady, totalCount: sectionsTotal },
		finance: { activeAmount, invoicedAmount, paidAmount, awaitingAmount, overdueAmount, debtors },
		sites: { byStatus: Array.from(siteStatusCount.entries()).map(([status, count]) => ({ status, count })), total: Array.from(siteStatusCount.values()).reduce((s, n) => s + n, 0) },
		inbox: { pending: inboxPending, suggested: inboxSuggested, failed: inboxFailed, totalOpen: inboxPending + inboxSuggested },
		myTasks: myTasks.map((task) => ({ ...task, contractNumber: task.contract?.number ?? null })),
		recentActivity,
		activityTimeline,
		departmentTimeline,
		departmentFlow,
		departmentProgress,
	}
}

/** Главная загрузка данных дашборда. Один проход по договорам в области видимости роли. */
export async function loadDashboard(user: SessionUser, now: Date = new Date()): Promise<DashboardData> {
	const startedAt = Date.now()
	const data = await computeDashboard(user, now, { writeSnapshot: true, includeTimeline: true, includeTasks: true })
	// Heaviest query in the app — timed so real bottlenecks show up before anyone
	// guesses at an optimization. No data content logged, only how much of it there was.
	logger.info('dashboard.loaded', { durationMs: Date.now() - startedAt, entityType: 'Contract', count: data.totals.contracts, userId: user.id })
	return data
}

/**
 * Лёгкая версия для страницы отдела: та же выборка договоров и тот же проход
 * (attentionCounts.danger — глобальный бейдж в Topbar, его нельзя посчитать
 * по одному отделу), но без истории за 30 дней, без "моих задач" и без записи
 * дневного снимка — этого страница отдела не показывает и не должна писать.
 */
export async function loadDepartmentFlow(user: SessionUser, code: DepartmentKey, now: Date = new Date()) {
	const data = await computeDashboard(user, now, { writeSnapshot: false, includeTimeline: false, includeTasks: false })
	const department = data.departmentProgress.find((item) => item.key === code)
	const flow = data.departmentFlow.find((item) => item.key === code)
	if (!department || !flow) return null
	return { department, flow, attentionDangerCount: data.attentionCounts.danger }
}
