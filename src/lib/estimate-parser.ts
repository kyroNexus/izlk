import * as XLSX from 'xlsx'

export type EstimateParseResult = {
	workingDays: number | null
	amount: number | null
	warnings: string[]
}

function asText(value: unknown): string {
	return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function toNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	const normalized = asText(value)
		.replace(/\s/g, '')
		.replace(/[^0-9,.-]/g, '')
		.replace(',', '.')
	const number = Number(normalized)
	return Number.isFinite(number) ? number : null
}

function validWorkingDays(value: number | null): value is number {
	return value != null && Number.isInteger(value) && value >= 1 && value <= 730
}

const ZIP_SIGNATURES = [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]]
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function startsWith(buffer: Buffer, bytes: number[]): boolean {
	return bytes.every((byte, index) => buffer[index] === byte)
}

/** .xlsx (zip) и старый .xls (OLE compound file) — бинарные форматы со своей
 *  сигнатурой; всё остальное, что сюда доходит (.csv), — обычный текст. */
function looksLikeBinaryWorkbook(buffer: Buffer): boolean {
	return ZIP_SIGNATURES.some((signature) => startsWith(buffer, signature)) || startsWith(buffer, OLE_SIGNATURE)
}

/**
 * XLSX.read без явной кодировки сам гадает codepage у CSV — на кириллице без
 * UTF-8 BOM гадает неверно и превращает текст в кашу (проверено: тот же файл
 * с BOM читается верно, без — нет), из-за чего срок/сумма молча не находятся.
 * Раз бинарной сигнатуры нет — декодируем сами: сначала как UTF-8 (это верно
 * для CSV из современных инструментов и "CSV UTF-8" экспорта Excel), а если
 * получилась каша (U+FFFD — признак невалидных UTF-8 байт) — как
 * Windows-1251, самую частую кириллическую кодировку у CSV из старых
 * экспортов 1С/Excel.
 */
function decodeCsvText(buffer: Buffer): string {
	const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
	if (!utf8.includes('�')) return utf8
	try {
		return new TextDecoder('windows-1251', { fatal: false }).decode(buffer)
	} catch {
		return utf8
	}
}

/**
 * Извлекает из типовой сметы итог и длительность работ. Формат у смет разный,
 * поэтому результат всегда можно перепроверить/исправить в карточке договора.
 */
export function parseEstimateWorkbook(buffer: Buffer): EstimateParseResult {
	const warnings: string[] = []
	let workingDays: number | null = null
	let amount: number | null = null
	let workbook: XLSX.WorkBook

	try {
		workbook = looksLikeBinaryWorkbook(buffer)
			? XLSX.read(buffer, { type: 'buffer', cellDates: true })
			: XLSX.read(decodeCsvText(buffer), { type: 'string', cellDates: true })
	} catch {
		return { workingDays, amount, warnings: ['Не удалось прочитать таблицу как Excel-файл'] }
	}

	for (const name of workbook.SheetNames) {
		const sheet = workbook.Sheets[name]
		const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
		for (const row of rows) {
			const cells = row.map(asText)
			for (let index = 0; index < cells.length; index += 1) {
				const cell = cells[index]
				const context = cells.slice(Math.max(0, index - 1), Math.min(cells.length, index + 3)).join(' ')

				if (!workingDays && /(рабоч|раб\.?\s*дн|срок\s*(выполнения|работ)|длительность)/i.test(context)) {
					const inline = context.match(/(\d{1,3})\s*(?:раб\.?\s*)?(?:дн(?:ей|я)?|рабоч)/i)
					const candidate = inline ? Number(inline[1]) : toNumber(cells[index + 1])
					if (validWorkingDays(candidate)) workingDays = candidate
				}

				if (amount == null && /(итого|всего|сумма\s*(сметы|работ)?|стоимость\s*(работ)?)/i.test(cell)) {
					const inline = toNumber(cell.replace(/[^0-9,.-]/g, ''))
					const candidate = inline && inline > 100 ? inline : toNumber(cells[index + 1])
					if (candidate != null && candidate > 100) amount = candidate
				}
			}
		}
	}

	if (workingDays == null) warnings.push('Срок в рабочих днях не найден — укажите его вручную при подтверждении ПР1')
	if (amount == null) warnings.push('Итоговая сумма не найдена — оставлена без изменений')
	return { workingDays, amount, warnings }
}
