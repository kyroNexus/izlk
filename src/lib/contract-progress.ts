/**
 * Прогресс договора и разбивка суммы.
 * Чистые функции без Prisma — принимают уже загруженные данные.
 */

export type StageKey =
	| 'CREATED'
	| 'PR1_SIGNED'
	| 'DESIGN'
	| 'DESIGN_DONE'
	| 'PRODUCTION'
	| 'SITE_PREP'
	| 'INSTALL'
	| 'EXEC_DOCS'
	| 'CLOSED'

export const STAGES: Array<{ key: StageKey; label: string }> = [
	{ key: 'CREATED', label: '\u0414\u043e\u0433\u043e\u0432\u043e\u0440 \u0441\u043e\u0437\u0434\u0430\u043d' },
	{ key: 'PR1_SIGNED', label: '\u041f\u04201 \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d' },
	{ key: 'DESIGN', label: '\u041f\u0440\u043e\u0435\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435' },
	{ key: 'DESIGN_DONE', label: '\u0420\u0430\u0437\u0434\u0435\u043b\u044b \u0433\u043e\u0442\u043e\u0432\u044b' },
	{ key: 'PRODUCTION', label: '\u041f\u0440\u043e\u0438\u0437\u0432\u043e\u0434\u0441\u0442\u0432\u043e' },
	{ key: 'SITE_PREP', label: '\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u043f\u043b\u043e\u0449\u0430\u0434\u043a\u0438' },
	{ key: 'INSTALL', label: '\u041c\u043e\u043d\u0442\u0430\u0436' },
	{ key: 'EXEC_DOCS', label: '\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044f' },
	{ key: 'CLOSED', label: '\u0414\u043e\u0433\u043e\u0432\u043e\u0440 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d' },
]

export type ProgressInput = {
	status?: string | null
	pr1SignedAt?: Date | null
	projectSections?: Array<{ status?: string | null }> | null
	productionDoneAt?: Date | null
	site?: { status?: string | null; installDoneAt?: Date | null } | null
	executiveDocs?: Array<{ status?: string | null }> | null
}

export type ProgressResult = {
	current: StageKey
	currentLabel: string
	nextLabel: string | null
	percent: number
	done: StageKey[]
}

/** Определяет текущий этап и процент выполнения договора. */
export function calcProgress(input: ProgressInput): ProgressResult {
	const sections = input.projectSections ?? []
	const execDocs = input.executiveDocs ?? []

	const done: StageKey[] = ['CREATED']
	if (input.pr1SignedAt) done.push('PR1_SIGNED')
	if (sections.length > 0) done.push('DESIGN')
	if (sections.length > 0 && sections.every((s) => s.status === 'READY')) done.push('DESIGN_DONE')
	if (input.productionDoneAt) done.push('PRODUCTION')
	if (input.site && input.site.status === 'READY') done.push('SITE_PREP')
	if (input.site?.installDoneAt) done.push('INSTALL')
	if (execDocs.length > 0 && execDocs.every((d) => d.status === 'READY')) done.push('EXEC_DOCS')
	if (input.status === 'CLOSED') done.push('CLOSED')

	const current = done[done.length - 1]
	const idx = STAGES.findIndex((s) => s.key === current)
	const percent = Math.round(((idx + 1) / STAGES.length) * 100)

	return {
		current,
		currentLabel: STAGES[idx]?.label ?? '',
		nextLabel: STAGES[idx + 1]?.label ?? null,
		percent,
		done,
	}
}

/* ---------- Разбивка суммы ---------- */

export const COST_KIND_LABEL: Record<string, string> = {
	SMR: '\u0421\u041c\u0420',
	MK: '\u041c\u0435\u0442\u0430\u043b\u043b\u043e\u043a\u043e\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0438\u0438',
	DELIVERY: '\u0414\u043e\u0441\u0442\u0430\u0432\u043a\u0430',
	DESIGN: '\u041f\u0440\u043e\u0435\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435',
	MATERIALS: '\u041c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u044b',
	OTHER: '\u041f\u0440\u043e\u0447\u0435\u0435',
}

export const COST_KIND_COLOR: Record<string, string> = {
	SMR: 'bg-brand',
	MK: 'bg-ok',
	DELIVERY: 'bg-warn',
	DESIGN: 'bg-info',
	MATERIALS: 'bg-muted',
	OTHER: 'bg-faint',
}

export type CostItem = { kind: string; planned: number; actual?: number | null }

export type CostBreakdown = {
	items: Array<{ kind: string; label: string; color: string; planned: number; actual: number; share: number }>
	plannedTotal: number
	actualTotal: number
	/** Расхождение с общей суммой договора. */
	diff: number
	balanced: boolean
}

/** Считает доли видов работ и сверяет с общей суммой договора. */
export function calcCostBreakdown(items: CostItem[], contractAmount: number): CostBreakdown {
	const plannedTotal = items.reduce((s, i) => s + (i.planned || 0), 0)
	const actualTotal = items.reduce((s, i) => s + (i.actual ?? 0), 0)
	const diff = Math.round((contractAmount - plannedTotal) * 100) / 100
	return {
		items: items.map((i) => ({
			kind: i.kind,
			label: COST_KIND_LABEL[i.kind] ?? i.kind,
			color: COST_KIND_COLOR[i.kind] ?? 'bg-faint',
			planned: i.planned || 0,
			actual: i.actual ?? 0,
			share: plannedTotal > 0 ? Math.round(((i.planned || 0) / plannedTotal) * 100) : 0,
		})),
		plannedTotal,
		actualTotal,
		diff,
		balanced: Math.abs(diff) < 1,
	}
}
