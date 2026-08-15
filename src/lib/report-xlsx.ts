import * as XLSX from 'xlsx'
import { ProductionPriority } from '@prisma/client'
import { contractScope, type SessionUser } from '@/lib/access'
import { loadReportData, proposalStatusLabel, type ReportPeriod } from '@/lib/report-data'
import { prisma } from '@/lib/prisma'
import { WORKFLOW_STAGE_LABEL } from '@/lib/contract-workflow'

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

const priorityLabel: Record<ProductionPriority, string> = { LOW: 'Низкий', NORMAL: 'Обычный', HIGH: 'Высокий', CRITICAL: 'Критичный' }

/** Same scope and same query as /production-schedule — the export is the full 19-column
 *  detail behind that page's compact rows, not a re-derived summary. */
export async function createProductionScheduleWorkbook(user: SessionUser) {
	const contracts = await prisma.contract.findMany({
		where: { ...contractScope(user), workflowStage: { in: ['WAITING_PRODUCTION', 'PRODUCTION', 'AWAITING_SHIPMENT', 'SHIPPED'] } },
		orderBy: { deadline: 'asc' },
		include: { contractor: { select: { name: true } }, productionPlan: true, stageHistory: { where: { toStage: 'WAITING_PRODUCTION' }, orderBy: { createdAt: 'asc' }, take: 1 } },
	})
	const rows = contracts.sort((a, b) => {
		const score = (priority?: ProductionPriority | null) => priority === 'CRITICAL' ? 4 : priority === 'HIGH' ? 3 : priority === 'NORMAL' ? 2 : 1
		return score(b.productionPlan?.priority) - score(a.productionPlan?.priority) || Number(a.deadline ?? Infinity) - Number(b.deadline ?? Infinity)
	})
	const book = XLSX.utils.book_new()
	appendSheet(book, 'График производства', [
		['№', 'Договор', 'Контрагент', 'Габарит', 'Передан в производство', '№ заявки', 'Локация', 'Срок', 'Материал', 'Колонны', 'Кровля', 'RAL', 'Каркас, кг', 'ЖБ, кг', 'Цинк, кг', 'ЧМ, кг', 'Труборез', 'Сборка', 'Лазер', 'Прокат', 'Покраска', 'Заливка', 'План отгрузки', 'Факт отгрузки', 'Примечание', 'Приоритет'],
		...rows.map((contract, index) => {
			const plan = contract.productionPlan
			return [
				index + 1, contract.number, contract.contractor.name,
				plan?.buildingDimensions ?? '', date(contract.stageHistory[0]?.createdAt), plan?.requestNumber ?? '', plan?.locationOverride ?? contract.objectAddress ?? '', date(contract.deadline),
				plan?.frameMaterial ?? '', plan?.columnsSpec ?? '', plan?.roofSpec ?? '', plan?.ral ?? '',
				plan?.frameWeight != null ? Number(plan.frameWeight) : '', plan?.reinforcedConcreteWeight != null ? Number(plan.reinforcedConcreteWeight) : '', plan?.galvanizedWeight != null ? Number(plan.galvanizedWeight) : '', plan?.blackMetalWeight != null ? Number(plan.blackMetalWeight) : '',
				date(plan?.pipeCutAt), date(plan?.assemblyWeldingAt), date(plan?.laserCutAt), date(plan?.rollingAt), date(plan?.paintingAt), date(plan?.columnsPouringAt),
				date(plan?.plannedShipmentAt), date(plan?.actualShipmentAt), plan?.note ?? '', priorityLabel[plan?.priority ?? 'NORMAL'],
			]
		}),
	], [5, 18, 30, 14, 16, 14, 26, 12, 16, 12, 12, 8, 12, 10, 10, 10, 12, 12, 10, 10, 12, 12, 14, 14, 30, 12])
	return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

const siteStatusLabel: Record<string, string> = { PREPARING: 'Подготовка', ISSUE: 'Проблема', READY: 'Готова', BLOCKED: 'Остановка' }

/** Same scope, stage filter and per-direction last-work-date logic as departments/construction —
 *  see A5 for why that date comes from a groupBy rather than a take-N heuristic. */
export async function createConstructionScheduleWorkbook(user: SessionUser) {
	const contracts = await prisma.contract.findMany({
		where: { ...contractScope(user), workflowStage: { in: ['AWAITING_SHIPMENT', 'SHIPPED', 'INSTALL_KZH', 'INSTALL_KM'] } },
		select: {
			id: true, number: true, cipher: true, deadline: true, workflowStage: true,
			contractor: { select: { name: true } },
			manager: { select: { name: true } },
			sites: { select: { id: true, address: true, status: true } },
		},
		orderBy: [{ workflowStage: 'asc' }, { deadline: 'asc' }],
		take: 200,
	})
	const siteIds = contracts.flatMap((contract) => contract.sites.map((site) => site.id))
	const lastWorkByDirection = siteIds.length ? await prisma.siteWork.groupBy({ by: ['siteId', 'direction'], where: { siteId: { in: siteIds } }, _max: { workDate: true } }) : []
	const lastWorkDate = new Map(lastWorkByDirection.map((row) => [`${row.siteId}:${row.direction}`, row._max.workDate]))
	// Same table as the page: no money shown there either, so there is nothing for
	// canSeeAmounts to gate here — kept as a deliberate note, not silently dropped.
	const book = XLSX.utils.book_new()
	appendSheet(book, 'График стройотдела', [
		['Договор', 'Шифр', 'Стадия', 'Контрагент', 'Менеджер', 'Площадка', 'Статус площадки', 'Монтаж КЖ', 'Монтаж КМ', 'Дедлайн'],
		...contracts.map((contract) => {
			const site = contract.sites[0]
			return [
				contract.number, contract.cipher ?? '', WORKFLOW_STAGE_LABEL[contract.workflowStage], contract.contractor.name, contract.manager?.name ?? '',
				site?.address ?? '', site ? (siteStatusLabel[site.status] ?? site.status) : 'Не создана',
				date(site ? lastWorkDate.get(`${site.id}:KJ`) : null), date(site ? lastWorkDate.get(`${site.id}:KM`) : null),
				date(contract.deadline),
			]
		}),
	], [18, 18, 24, 30, 20, 34, 16, 14, 14, 14])
	return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
