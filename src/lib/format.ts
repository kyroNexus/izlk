import type { DocumentKind } from '@prisma/client'

/** Все рабочие даты показываем в часовом поясе компании, а не в UTC сервера. */
const COMPANY_TIME_ZONE = 'Europe/Moscow'

/**
 * Суммы. В схеме amount — Decimal(15,2), Prisma отдаёт объект Decimal,
 * поэтому всегда прогоняем через Number().
 */
export function formatMoney(value: unknown, currency: string = 'RUB'): string {
	const n = Number(value ?? 0)
	return new Intl.NumberFormat('ru-RU', {
		style: 'currency',
		currency,
		minimumFractionDigits: 2,
	}).format(n)
}

export function formatDate(d: Date | string | null | undefined): string {
	if (!d) return '\u2014'
	return new Intl.DateTimeFormat('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		timeZone: COMPANY_TIME_ZONE,
	}).format(new Date(d))
}

export function formatDateTime(d: Date | string | null | undefined): string {
	if (!d) return '\u2014'
	return new Intl.DateTimeFormat('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: COMPANY_TIME_ZONE,
	}).format(new Date(d))
}

/** Размер файла. sizeBytes в схеме — BigInt. */
export function formatBytes(bytes: bigint | number | null | undefined): string {
	const b = Number(bytes ?? 0)
	if (!b) return '\u2014'
	const units = ['\u0411', '\u041a\u0411', '\u041c\u0411', '\u0413\u0411']
	const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), units.length - 1)
	const v = b / Math.pow(1024, i)
	return `${v.toFixed(i === 0 ? 0 : 1).replace('.', ',')} ${units[i]}`
}

/** Склонение: 1 договор / 2 договора / 5 договоров */
export function plural(n: number, one: string, few: string, many: string): string {
	const m10 = n % 10
	const m100 = n % 100
	if (m10 === 1 && m100 !== 11) return `${n} ${one}`
	if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`
	return `${n} ${many}`
}

/** Русские подписи для enum DocumentKind из schema.prisma */
export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
	CONTRACT: '\u0414\u043e\u0433\u043e\u0432\u043e\u0440',
	AGREEMENT: '\u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044f',
	ESTIMATE: '\u0421\u043c\u0435\u0442\u044b',
	INVOICE: '\u0421\u0447\u0435\u0442\u0430 \u043d\u0430 \u043e\u043f\u043b\u0430\u0442\u0443',
	COMMERCIAL_PROPOSAL: '\u041a\u043e\u043c\u043c\u0435\u0440\u0447\u0435\u0441\u043a\u0438\u0435 \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u044f',
	APPENDIX: '\u041f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u044f',
	PROJECT_PDF: '\u041f\u0440\u043e\u0435\u043a\u0442\u043d\u0430\u044f \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044f',
	PROJECT_DWG: '\u0427\u0435\u0440\u0442\u0435\u0436\u0438 DWG',
	EXECUTIVE: '\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446\u0438\u044f',
	ACT: '\u0410\u043a\u0442\u044b',
	CERTIFICATE: '\u0421\u0435\u0440\u0442\u0438\u0444\u0438\u043a\u0430\u0442\u044b',
	SIGNED_SCAN: '\u041f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u043d\u044b\u0435 \u0441\u043a\u0430\u043d\u044b',
	SOURCE_DATA: '\u0418\u0441\u0445\u043e\u0434\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u0437\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0430',
	OTHER: '\u041f\u0440\u043e\u0447\u0435\u0435',
}

/** Порядок групп документов на карточке договора и в глобальном списке */
export const DOCUMENT_KIND_ORDER: DocumentKind[] = [
	'CONTRACT',
	'AGREEMENT',
	'ESTIMATE',
	'INVOICE',
	'COMMERCIAL_PROPOSAL',
	'PROJECT_PDF',
	'PROJECT_DWG',
	'EXECUTIVE',
	'ACT',
	'CERTIFICATE',
	'SIGNED_SCAN',
	'SOURCE_DATA',
	'APPENDIX',
	'OTHER',
]

/** Русские подписи для enum ContractorType из schema.prisma */
export const CONTRACTOR_TYPE_LABELS: Record<string, string> = {
	LEGAL: 'Юр. лицо',
	INDIVIDUAL: 'Физ. лицо',
}

/** Русские подписи для enum Role из schema.prisma */
export const ROLE_LABELS: Record<string, string> = {
	ADMIN: '\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440',
	MANAGER: '\u041c\u0435\u043d\u0435\u0434\u0436\u0435\u0440',
	DESIGNER: '\u041f\u0440\u043e\u0435\u043a\u0442\u0438\u0440\u043e\u0432\u0449\u0438\u043a',
	VIEWER: '\u041d\u0430\u0431\u043b\u044e\u0434\u0430\u0442\u0435\u043b\u044c',
}

/** Инициалы для аватара */
export function initials(name?: string | null): string {
	if (!name) return '?'
	return name
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map((p) => p[0]?.toUpperCase() ?? '')
		.join('')
}
