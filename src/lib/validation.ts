import { z } from 'zod'

/**
 * Общие zod-схемы для форм создания и редактирования.
 * Формы отправляют строки (FormData), поэтому схемы работают со строками,
 * а нормализацию в Date / Decimal делают хелперы ниже.
 */

/** Пустая строка -> null (для необязательных полей). */
export function orNull(value: string | undefined | null): string | null {
	const v = (value ?? '').trim()
	return v === '' ? null : v
}

/** Приводит "12 450 000,50" к "12450000.50". Decimal(15,2) в БД, не Float. */
export function normalizeAmount(raw: string): string {
	return raw.replace(/\s/g, '').replace(',', '.')
}

/** Проверяет сумму: положительное число, не более 13 знаков до запятой. */
export function parseAmount(raw: string): string | null {
	const normalized = normalizeAmount(raw)
	const n = Number(normalized)
	if (!Number.isFinite(n) || n <= 0) return null
	if (n > 9_999_999_999_999) return null
	return normalized
}

/** Проверяет дату из input[type=date]. */
export function parseDate(raw: string): Date | null {
	const d = new Date(raw)
	return Number.isNaN(d.getTime()) ? null : d
}

/** Checks the official control digits for Russian 10- and 12-digit INN values. */
export function isValidInn(value: string): boolean {
	if (!/^\d{10}$|^\d{12}$/.test(value)) return false
	const digits = value.split('').map(Number)
	const control = (weights: number[]) => weights.reduce((sum, weight, index) => sum + digits[index] * weight, 0) % 11 % 10
	if (digits.length === 10) return control([2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[9]
	return control([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[10] && control([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[11]
}

const importDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите дату договора.')
	.refine((value) => !Number.isNaN(Date.parse(`${value}T12:00:00Z`)), 'Дата договора некорректна.')

/** Strict server-side validation for data obtained from a parser or entered manually. */
export const contractImportSchema = z.object({
	number: z.string().trim().min(2, 'Укажите номер договора.').max(120, 'Слишком длинный номер договора.')
		.regex(/^[A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9._/ -]*$/iu, 'Номер договора содержит недопустимые символы.'),
	date: importDate,
	amount: z.string().trim().refine((value) => parseAmount(value) !== null, 'Сумма должна быть положительной и не превышать 9 999 999 999 999.'),
	contractorName: z.string().trim().max(300, 'Слишком длинное название контрагента.'),
	inn: z.string().trim().optional().refine((value) => !value || isValidInn(value), 'ИНН не прошёл контрольную проверку.'),
	cipher: z.string().trim().max(120, 'Слишком длинный шифр.').optional(),
	objectAddress: z.string().trim().max(500, 'Слишком длинный адрес.').optional(),
	currency: z.enum(['RUB', 'USD', 'EUR', 'CNY']),
	kind: z.enum(['SMR', 'MK', 'PROJECT']),
}).superRefine((data, context) => {
	if (!data.contractorName && !data.inn) context.addIssue({ code: 'custom', path: ['contractorName'], message: 'Укажите контрагента или ИНН.' })
})

export const contractSchema = z.object({
	number: z.string().trim().min(1, 'Укажите номер договора').max(120, 'Слишком длинный номер'),
	cipher: z.string().trim().max(120).optional(),
	contractorId: z.string().trim().min(1, 'Выберите контрагента'),
	managerId: z.string().trim().optional(),
	date: z.string().trim().min(1, 'Укажите дату договора'),
	amount: z.string().trim().min(1, 'Укажите сумму договора'),
	currency: z.string().trim().min(1),
	status: z.enum(['ACTIVE', 'CLOSED', 'ARCHIVED']),
	kind: z.enum(['SMR', 'MK', 'PROJECT']),
	objectAddress: z.string().trim().max(500).optional(),
})

export const contractorSchema = z.object({
	aliases: z.string().trim().max(1000).optional(),
	name: z.string().trim().min(1, 'Укажите название контрагента').max(300),
	inn: z
		.string()
		.trim()
		.max(12)
		.optional()
		.refine((v) => !v || /^\d{10}$|^\d{12}$/.test(v), 'ИНН должен содержать 10 или 12 цифр'),
	address: z.string().trim().max(500).optional(),
	phone: z.string().trim().max(50).optional(),
	email: z
		.string()
		.trim()
		.max(200)
		.optional()
		.refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Некорректный email'),
})

export const agreementSchema = z.object({
	number: z.string().trim().min(1, 'Укажите номер доп. соглашения').max(120),
	date: z.string().trim().min(1, 'Укажите дату доп. соглашения'),
	parentId: z.string().trim().optional(),
})

export const estimateSchema = z.object({
	number: z.string().trim().min(1, 'Укажите номер сметы').max(120),
	date: z.string().trim().min(1, 'Укажите дату сметы'),
	agreementId: z.string().trim().optional(),
	amount: z.string().trim().optional(),
})

/** Первое сообщение об ошибке из zod-результата. */
export function firstIssue(error: z.ZodError): string {
	return error.issues[0]?.message ?? 'Проверьте поля формы'
}
