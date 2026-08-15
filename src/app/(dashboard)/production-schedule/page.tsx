import { redirect } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { canSeeSchedules, canWrite, contractScope, requireUser } from '@/lib/access'
import { prisma } from '@/lib/prisma'
import { initials } from '@/lib/format'
import { writeAudit } from '@/lib/audit'
import { advanceAfterShipmentRecorded } from '@/lib/contract-workflow'
import ProductionScheduleRow, { type ProductionRow } from '@/components/ProductionScheduleRow'
import Link from 'next/link'
import { ProductionPriority } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** Изготовление идёт по этой последовательности; первый шаг без даты — то, что цеху нужно сделать дальше. */
const PRODUCTION_STEPS = [
	{ key: 'pipeCutAt', label: 'Труборез' },
	{ key: 'assemblyWeldingAt', label: 'Сборка' },
	{ key: 'laserCutAt', label: 'Лазер' },
	{ key: 'rollingAt', label: 'Прокат' },
	{ key: 'paintingAt', label: 'Покраска' },
	{ key: 'columnsPouringAt', label: 'Заливка' },
] as const

function nextOperationLabel(plan: { pipeCutAt: Date | null; assemblyWeldingAt: Date | null; laserCutAt: Date | null; rollingAt: Date | null; paintingAt: Date | null; columnsPouringAt: Date | null; plannedShipmentAt: Date | null; actualShipmentAt: Date | null } | null | undefined) {
	if (plan?.actualShipmentAt) return 'Отгружено'
	const next = PRODUCTION_STEPS.find((step) => !plan?.[step.key])
	if (next) return next.label
	return plan?.plannedShipmentAt ? 'Ожидает отгрузки' : 'Готово к отгрузке'
}

export default async function ProductionSchedulePage() {
	const user = await requireUser()
	if (!canSeeSchedules(user)) redirect('/')
	const editable = canWrite(user) || user.role === 'PRODUCTION'
	const contracts = await prisma.contract.findMany({ where: { ...contractScope(user), workflowStage: { in: ['WAITING_PRODUCTION', 'PRODUCTION', 'AWAITING_SHIPMENT', 'SHIPPED'] } }, orderBy: { deadline: 'asc' }, include: { contractor: { select: { name: true } }, productionPlan: true, stageHistory: { where: { toStage: 'WAITING_PRODUCTION' }, orderBy: { createdAt: 'asc' }, take: 1 } } })
	const sorted = contracts.sort((a, b) => {
		const score = (priority?: ProductionPriority | null) => priority === 'CRITICAL' ? 4 : priority === 'HIGH' ? 3 : priority === 'NORMAL' ? 2 : 1
		return score(b.productionPlan?.priority) - score(a.productionPlan?.priority) || Number(a.deadline ?? Infinity) - Number(b.deadline ?? Infinity)
	})
	// Строка получает только простые сериализуемые значения (Decimal -> строка) —
	// клиентский остров ProductionScheduleRow не умеет принимать Decimal-объекты Prisma.
	const rows: ProductionRow[] = sorted.map((contract, index) => {
		const plan = contract.productionPlan
		return {
			id: contract.id,
			index: index + 1,
			number: contract.number,
			contractorName: contract.contractor.name,
			deadline: contract.deadline,
			objectAddress: contract.objectAddress,
			transfer: contract.stageHistory[0]?.createdAt ?? null,
			nextOperationLabel: nextOperationLabel(plan),
			buildingDimensions: plan?.buildingDimensions ?? '',
			requestNumber: plan?.requestNumber ?? '',
			locationOverride: plan?.locationOverride ?? '',
			frameMaterial: plan?.frameMaterial ?? '',
			columnsSpec: plan?.columnsSpec ?? '',
			roofSpec: plan?.roofSpec ?? '',
			ral: plan?.ral ?? '',
			frameWeight: plan?.frameWeight?.toString() ?? '',
			reinforcedConcreteWeight: plan?.reinforcedConcreteWeight?.toString() ?? '',
			galvanizedWeight: plan?.galvanizedWeight?.toString() ?? '',
			blackMetalWeight: plan?.blackMetalWeight?.toString() ?? '',
			pipeCutAt: plan?.pipeCutAt ?? null,
			assemblyWeldingAt: plan?.assemblyWeldingAt ?? null,
			laserCutAt: plan?.laserCutAt ?? null,
			rollingAt: plan?.rollingAt ?? null,
			paintingAt: plan?.paintingAt ?? null,
			columnsPouringAt: plan?.columnsPouringAt ?? null,
			plannedShipmentAt: plan?.plannedShipmentAt ?? null,
			actualShipmentAt: plan?.actualShipmentAt ?? null,
			note: plan?.note ?? '',
			priority: plan?.priority ?? 'NORMAL',
		}
	})
	async function save(formData: FormData) {
		'use server'
		const actor = await requireUser()
		if (!canWrite(actor) && actor.role !== 'PRODUCTION') return
		const contractId = String(formData.get('contractId') ?? '')
		const contract = await prisma.contract.findFirst({ where: { id: contractId, ...contractScope(actor) }, select: { id: true } })
		if (!contract) return
		const text = (name: string) => String(formData.get(name) ?? '').trim() || null
		const number = (name: string) => { const value = text(name); return value && Number.isFinite(Number(value)) ? Number(value) : null }
		const date = (name: string) => { const value = text(name); return value ? new Date(`${value}T12:00:00`) : null }
		const priority = String(formData.get('priority') ?? 'NORMAL') as ProductionPriority
		if (!Object.values(ProductionPriority).includes(priority)) return
		const actualShipmentAt = date('actualShipmentAt')
		const fields = { buildingDimensions: text('buildingDimensions'), requestNumber: text('requestNumber'), frameMaterial: text('frameMaterial'), columnsSpec: text('columnsSpec'), roofSpec: text('roofSpec'), ral: text('ral'), frameWeight: number('frameWeight'), reinforcedConcreteWeight: number('reinforcedConcreteWeight'), galvanizedWeight: number('galvanizedWeight'), blackMetalWeight: number('blackMetalWeight'), locationOverride: text('locationOverride'), note: text('note'), priority, pipeCutAt: date('pipeCutAt'), assemblyWeldingAt: date('assemblyWeldingAt'), laserCutAt: date('laserCutAt'), rollingAt: date('rollingAt'), paintingAt: date('paintingAt'), columnsPouringAt: date('columnsPouringAt'), plannedShipmentAt: date('plannedShipmentAt'), actualShipmentAt }
		await prisma.productionPlan.upsert({ where: { contractId }, create: { contractId, ...fields }, update: fields })
		await writeAudit({ userId: actor.id, action: 'UPDATE', entityType: 'ProductionPlan', entityId: contractId })
		if (actualShipmentAt) await advanceAfterShipmentRecorded({ contractId, actorId: actor.id })
	}
	return <>
		<Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Проектирование и графики', href: '/projects' }, { label: 'График производства' }]} userName={user.name ?? user.email ?? 'Пользователь'} initials={initials(user.name ?? user.email ?? 'ПП')} />
		<main className="workspace-content px-[26px] py-[22px]">
			<div className="work-hero mb-4 flex flex-wrap items-end justify-between gap-4 px-5 py-4">
				<div>
					<span className="text-[10px] font-bold uppercase tracking-[.1em] text-brand-ink">Цех и офис</span>
					<h1 className="mt-1 text-[27px] font-bold tracking-[-.04em]">График производства</h1>
					<p className="mt-1 text-[12px] text-muted">Очередь формируется по приоритету и сроку договора. Формулы плановых дат будут подключены после их утверждения. Остальные поля — по кнопке раскрытия строки.</p>
					<Link href="/projects" className="mt-2 inline-flex text-[11.5px] font-semibold text-brand-ink hover:underline">← Карта потока проектирования</Link>
				</div>
				<div className="flex items-center gap-2"><div className="rounded-full bg-brand-soft px-3 py-1.5 text-[11px] font-semibold text-brand-ink">В потоке: {rows.length}</div><a href="/api/production-schedule/export" className="inline-flex h-[34px] items-center rounded-[9px] border border-line bg-surface px-3 text-[11.5px] font-semibold hover:bg-raised">Скачать XLSX</a></div>
			</div>
			<div className="overflow-x-auto rounded-[14px] border border-line bg-surface">
				<table className="min-w-[820px] w-full border-collapse text-[11px]">
					<thead className="sticky top-0 z-10 bg-raised">
						<tr className="text-[10px] font-bold uppercase tracking-[.05em] text-muted">
							<th className="sticky left-0 z-20 border-b border-r border-line bg-raised px-2 py-3">№</th>
							<th className="border-b border-r border-line px-2 py-3 text-left">Договор</th>
							<th className="border-b border-r border-line px-2 py-3 text-left">Локация / срок</th>
							<th className="border-b border-r border-line px-2 py-3 text-left">Ближайшая операция</th>
							<th className="border-b border-r border-line px-2 py-3 text-left">План / факт отгрузки</th>
							<th className="border-b border-r border-line px-2 py-3 text-left">Приоритет</th>
							<th className="border-b border-line px-2 py-3">Ещё</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => <ProductionScheduleRow key={row.id} row={row} editable={editable} save={save} />)}
					</tbody>
				</table>
			</div>
		</main>
	</>
}
