/**
 * Расчёт сроков и дедлайнов по договору.
 * Дедлайн = дата подписания ПР1 + (рабочие дни + 1 день).
 */

/** Производственный календарь: праздничные дни в формате YYYY-MM-DD. */
export const HOLIDAYS = new Set<string>([
	'2026-01-01',
	'2026-01-02',
	'2026-01-05',
	'2026-01-06',
	'2026-01-07',
	'2026-01-08',
	'2026-02-23',
	'2026-03-09',
	'2026-05-01',
	'2026-05-11',
	'2026-06-12',
	'2026-11-04',
])

function key(d: Date): string {
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${y}-${m}-${day}`
}

/** Рабочий ли день: не выходной и не праздник. */
export function isWorkingDay(d: Date): boolean {
	const wd = d.getDay()
	if (wd === 0 || wd === 6) return false
	return !HOLIDAYS.has(key(d))
}

/** Прибавляет указанное число рабочих дней к дате. */
export function addWorkingDays(from: Date, days: number): Date {
	const d = new Date(from.getTime())
	let left = Math.max(0, Math.floor(days))
	while (left > 0) {
		d.setDate(d.getDate() + 1)
		if (isWorkingDay(d)) left--
	}
	return d
}

/** Число рабочих дней между датами (отрицательное — если дата в прошлом). */
export function workingDaysBetween(from: Date, to: Date): number {
	const sign = to.getTime() >= from.getTime() ? 1 : -1
	const start = sign > 0 ? new Date(from.getTime()) : new Date(to.getTime())
	const end = sign > 0 ? new Date(to.getTime()) : new Date(from.getTime())
	start.setHours(0, 0, 0, 0)
	end.setHours(0, 0, 0, 0)
	let count = 0
	const cur = new Date(start.getTime())
	while (cur.getTime() < end.getTime()) {
		cur.setDate(cur.getDate() + 1)
		if (isWorkingDay(cur)) count++
	}
	return count * sign
}

/** Дедлайн договора от даты подписания ПР1. */
export function calcContractDeadline(
	signedAt: Date | null | undefined,
	workingDays: number | null | undefined,
): Date | null {
	if (!signedAt || !workingDays || workingDays <= 0) return null
	return addWorkingDays(new Date(signedAt), workingDays + 1)
}

export type DeadlineTone = 'ok' | 'warn' | 'danger' | 'off'

export type DeadlineInfo = {
	deadline: Date | null
	daysLeft: number | null
	tone: DeadlineTone
	label: string
	overdue: boolean
}

/** Сводка по сроку для отрисовки цветного чипа. */
export function getDeadlineInfo(
	deadline: Date | null | undefined,
	now: Date = new Date(),
): DeadlineInfo {
	if (!deadline) {
		return {
			deadline: null,
			daysLeft: null,
			tone: 'off',
			label: '\u0421\u0440\u043e\u043a \u043d\u0435 \u0437\u0430\u0434\u0430\u043d',
			overdue: false,
		}
	}
	const daysLeft = workingDaysBetween(now, deadline)
	if (daysLeft < 0) {
		return {
			deadline,
			daysLeft,
			tone: 'danger',
			label: `\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d\u043e \u043d\u0430 ${Math.abs(daysLeft)} \u0434\u043d.`,
			overdue: true,
		}
	}
	if (daysLeft <= 5) {
		return {
			deadline,
			daysLeft,
			tone: 'warn',
			label: `\u041e\u0441\u0442\u0430\u043b\u043e\u0441\u044c ${daysLeft} \u0434\u043d.`,
			overdue: false,
		}
	}
	return {
		deadline,
		daysLeft,
		tone: 'ok',
		label: `\u041e\u0441\u0442\u0430\u043b\u043e\u0441\u044c ${daysLeft} \u0434\u043d.`,
		overdue: false,
	}
}
