'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ProductionPriority } from '@prisma/client'
import { ChevronDown } from 'lucide-react'
import Icon from '@/components/Icon'
import { formatDate } from '@/lib/format'
import ProductionRowSaveButton from '@/components/ProductionRowSaveButton'

const dateInput = (value: Date | null) => value ? value.toISOString().slice(0, 10) : ''
const priorityLabel: Record<ProductionPriority, string> = { LOW: 'Низкий', NORMAL: 'Обычный', HIGH: 'Высокий', CRITICAL: 'Критичный' }
const field = 'h-8 min-w-[92px] rounded border border-line bg-surface px-2 text-xs outline-none focus:border-brand/60 disabled:bg-raised'

export type ProductionRow = {
	id: string
	index: number
	number: string
	contractorName: string
	deadline: Date | null
	objectAddress: string | null
	transfer: Date | null
	nextOperationLabel: string
	buildingDimensions: string
	requestNumber: string
	locationOverride: string
	frameMaterial: string
	columnsSpec: string
	roofSpec: string
	ral: string
	frameWeight: string
	reinforcedConcreteWeight: string
	galvanizedWeight: string
	blackMetalWeight: string
	pipeCutAt: Date | null
	assemblyWeldingAt: Date | null
	laserCutAt: Date | null
	rollingAt: Date | null
	paintingAt: Date | null
	columnsPouringAt: Date | null
	plannedShipmentAt: Date | null
	actualShipmentAt: Date | null
	note: string
	priority: ProductionPriority
}

/** A labelled text field that lives inside the collapsed detail area but still posts to the row's form by id. */
function DetailField({ formId, name, label, defaultValue, type = 'text', editable, placeholder }: { formId: string; name: string; label: string; defaultValue: string; type?: string; editable: boolean; placeholder?: string }) {
	return <label className="block"><span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-faint">{label}</span><input form={formId} name={name} type={type} defaultValue={defaultValue} disabled={!editable} placeholder={placeholder} className={`${field} w-full`} /></label>
}

export default function ProductionScheduleRow({ row, editable, save }: { row: ProductionRow; editable: boolean; save: (formData: FormData) => void }) {
	const [open, setOpen] = useState(false)
	const formId = `plan-${row.id}`
	return <>
		<tr className="border-b border-line-soft align-top hover:bg-raised/45">
			<td className="sticky left-0 z-[1] border-r border-line bg-surface px-2 py-2 text-center font-bold">{row.index}</td>
			<td className="px-2 py-2"><Link href={`/contracts/${row.id}`} className="font-bold text-brand-ink hover:underline">{row.number}</Link><div className="mt-1 text-2xs text-faint">{row.contractorName}</div></td>
			<td className="px-1 py-1"><input form={formId} name="locationOverride" defaultValue={row.locationOverride || row.objectAddress || ''} disabled={!editable} className={field} /><div className="mt-1 text-2xs text-faint">срок: {formatDate(row.deadline)}</div></td>
			<td className="px-2 py-2 text-xs font-semibold">{row.nextOperationLabel}</td>
			<td className="px-1 py-1"><input form={formId} name="plannedShipmentAt" type="date" defaultValue={dateInput(row.plannedShipmentAt)} disabled={!editable} className={field} /><input form={formId} name="actualShipmentAt" type="date" defaultValue={dateInput(row.actualShipmentAt)} disabled={!editable} className={`${field} mt-1`} /></td>
			<td className="px-1 py-1"><form id={formId} action={save}><input type="hidden" name="contractId" value={row.id} /><select name="priority" defaultValue={row.priority} disabled={!editable} className={field}>{Object.entries(priorityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{editable && <ProductionRowSaveButton />}</form></td>
			<td className="px-1 py-2 text-center"><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? 'Свернуть остальные поля' : 'Показать остальные поля'} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted hover:bg-raised"><Icon icon={ChevronDown} size={15} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} /></button></td>
		</tr>
		{open && <tr className="border-b border-line-soft bg-raised/30">
			<td />
			<td colSpan={6} className="p-3">
				<div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 lg:grid-cols-6">
					<DetailField formId={formId} name="buildingDimensions" label="Габарит" defaultValue={row.buildingDimensions} editable={editable} />
					<DetailField formId={formId} name="requestNumber" label="№ заявки" defaultValue={row.requestNumber} editable={editable} />
					<DetailField formId={formId} name="frameMaterial" label="Материал" defaultValue={row.frameMaterial} editable={editable} />
					<DetailField formId={formId} name="columnsSpec" label="Колонны" defaultValue={row.columnsSpec} editable={editable} />
					<DetailField formId={formId} name="roofSpec" label="Кровля" defaultValue={row.roofSpec} editable={editable} />
					<DetailField formId={formId} name="ral" label="RAL" defaultValue={row.ral} editable={editable} />
					<DetailField formId={formId} name="frameWeight" label="Каркас, кг" type="number" defaultValue={row.frameWeight} editable={editable} />
					<DetailField formId={formId} name="reinforcedConcreteWeight" label="ЖБ, кг" type="number" defaultValue={row.reinforcedConcreteWeight} editable={editable} />
					<DetailField formId={formId} name="galvanizedWeight" label="Цинк, кг" type="number" defaultValue={row.galvanizedWeight} editable={editable} />
					<DetailField formId={formId} name="blackMetalWeight" label="ЧМ, кг" type="number" defaultValue={row.blackMetalWeight} editable={editable} />
					<DetailField formId={formId} name="pipeCutAt" label="Труборез" type="date" defaultValue={dateInput(row.pipeCutAt)} editable={editable} />
					<DetailField formId={formId} name="assemblyWeldingAt" label="Сборка" type="date" defaultValue={dateInput(row.assemblyWeldingAt)} editable={editable} />
					<DetailField formId={formId} name="laserCutAt" label="Лазер" type="date" defaultValue={dateInput(row.laserCutAt)} editable={editable} />
					<DetailField formId={formId} name="rollingAt" label="Прокат" type="date" defaultValue={dateInput(row.rollingAt)} editable={editable} />
					<DetailField formId={formId} name="paintingAt" label="Покраска" type="date" defaultValue={dateInput(row.paintingAt)} editable={editable} />
					<DetailField formId={formId} name="columnsPouringAt" label="Заливка" type="date" defaultValue={dateInput(row.columnsPouringAt)} editable={editable} />
					<label className="col-span-2 block sm:col-span-4 lg:col-span-6"><span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-faint">Примечание</span><textarea form={formId} name="note" defaultValue={row.note} disabled={!editable} className="h-[58px] w-full resize-none rounded border border-line bg-surface p-2 text-xs outline-none focus:border-brand/60 disabled:bg-raised" /></label>
				</div>
				<div className="mt-2 text-2xs text-faint">{row.transfer ? `Передан в производство: ${formatDate(row.transfer)}` : 'Ещё не передан в производство'}</div>
			</td>
		</tr>}
	</>
}
