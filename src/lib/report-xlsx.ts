import * as XLSX from 'xlsx'
import type { SessionUser } from '@/lib/access'
import { loadReportData, proposalStatusLabel, type ReportPeriod } from '@/lib/report-data'

const safeCell = (value: unknown) => typeof value === 'string' && /^[=+\-@]/.test(value) ? `'${value}` : value
const date = (value: Date | null | undefined) => value ? value.toLocaleDateString('ru-RU') : ''
const moneyFormat = '#,##0.00'

function appendSheet(book: XLSX.WorkBook, name: string, rows: unknown[][], widths: number[]) {
	const sheet = XLSX.utils.aoa_to_sheet(rows.map((row) => row.map(safeCell)))
	sheet['!cols'] = widths.map((wch) => ({ wch }))
	sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(Math.max(0, widths.length - 1))}${Math.max(1, rows.length)}` }
	sheet['!freeze'] = { xSplit: 0, ySplit: 1 }
	XLSX.utils.book_append_sheet(book, sheet, name)
	return sheet
}

export async function createReportWorkbook(user: SessionUser, period: ReportPeriod) {
	const report = await loadReportData(user, period)
	const book = XLSX.utils.book_new()
	const financial = report.dashboard.canSeeAmounts
	appendSheet(book, 'Сводка', [
		['Показатель', 'Значение'], ['Период с', date(period.from)], ['Период по', date(period.to)], ['Договоров в зоне доступа', report.dashboard.totals.contracts], ['Активных договоров', report.dashboard.totals.activeContracts], ['Документов', report.dashboard.totals.documents], ['Разделов готово', `${report.dashboard.design.readyCount} из ${report.dashboard.design.totalCount}`],
		...(financial ? [['Выставлено счетов', report.dashboard.finance.invoicedAmount], ['Оплачено', report.dashboard.finance.paidAmount], ['Просрочено', report.dashboard.finance.overdueAmount]] : []),
	], [32, 22])
	appendSheet(book, 'Договоры', [['Номер', 'Шифр', 'Контрагент', 'Дата', 'Статус', 'Стадия', ...(financial ? ['Сумма'] : [])], ...report.contracts.map((c) => [c.number, c.cipher ?? '', c.contractor.name, date(c.date), c.status, c.workflowStage, ...(financial ? [Number(c.amount ?? 0)] : [])])], [18, 18, 32, 14, 16, 28, 16])
	appendSheet(book, 'План-факт', financial
		? [['Договор', 'Шифр', 'План затрат', 'Факт за период', 'Отклонение', 'Валюта'], ...report.planFact.map((r) => [r.number, r.cipher ?? '', r.plan, r.actual, r.variance, r.currency])]
		: [['Договор', 'Шифр', 'Доступ к суммам'], ...report.planFact.map((r) => [r.number, r.cipher ?? '', 'Недоступно для роли'])], [18, 18, 18, 18, 18, 12])
	appendSheet(book, 'Просрочки', [['Договор', 'Контрагент', 'Раздел', 'Срок', 'Просрочка, раб. дней'], ...report.dashboard.design.overdue.map((r) => [r.contractNumber, '', r.label, date(r.dateTo), Math.abs(r.daysLeft ?? 0)])], [18, 28, 18, 14, 24])
	appendSheet(book, 'Коммерческие предложения', [['Файл', 'Договор', 'Контрагент', 'Статус', 'Отправлено', 'Ответ получен'], ...report.proposals.map((p) => [p.fileName, p.contract.number, p.contract.contractor.name, proposalStatusLabel[p.proposalStatus], date(p.proposalSentAt), date(p.proposalRespondedAt)])], [42, 18, 30, 20, 14, 16])
	for (const name of book.SheetNames) {
		const sheet = book.Sheets[name]
		for (const cell of Object.keys(sheet)) if (/^[A-Z]+[2-9]\d*$/.test(cell) && typeof sheet[cell].v === 'number') sheet[cell].z = moneyFormat
	}
	return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
