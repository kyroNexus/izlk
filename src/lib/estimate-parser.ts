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
		workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
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
