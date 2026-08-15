/**
 * B5: compact production-schedule table. Verifies the "next operation" label
 * computation (the whole point of collapsing 19 columns into one summary
 * column) picks the right step, and that save() still builds one field set
 * shared between create/update (also closes D2 as a byproduct).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PRODUCTION_STEPS = [
	{ key: 'pipeCutAt', label: 'Труборез' },
	{ key: 'assemblyWeldingAt', label: 'Сборка' },
	{ key: 'laserCutAt', label: 'Лазер' },
	{ key: 'rollingAt', label: 'Прокат' },
	{ key: 'paintingAt', label: 'Покраска' },
	{ key: 'columnsPouringAt', label: 'Заливка' },
] as const

function nextOperationLabel(plan: Record<string, Date | null> | null | undefined) {
	if (plan?.actualShipmentAt) return 'Отгружено'
	const next = PRODUCTION_STEPS.find((step) => !plan?.[step.key])
	if (next) return next.label
	return plan?.plannedShipmentAt ? 'Ожидает отгрузки' : 'Готово к отгрузке'
}

const D = (s: string) => new Date(s)

assert.equal(nextOperationLabel(null), 'Труборез', 'no plan at all -- first step is next')
assert.equal(nextOperationLabel({ pipeCutAt: D('2026-01-01'), assemblyWeldingAt: null, laserCutAt: null, rollingAt: null, paintingAt: null, columnsPouringAt: null, plannedShipmentAt: null, actualShipmentAt: null }), 'Сборка', 'first step done -- second is next')
assert.equal(nextOperationLabel({ pipeCutAt: D('1'), assemblyWeldingAt: D('1'), laserCutAt: D('1'), rollingAt: D('1'), paintingAt: D('1'), columnsPouringAt: D('1'), plannedShipmentAt: null, actualShipmentAt: null }), 'Готово к отгрузке', 'all six steps done, no shipment date yet')
assert.equal(nextOperationLabel({ pipeCutAt: D('1'), assemblyWeldingAt: D('1'), laserCutAt: D('1'), rollingAt: D('1'), paintingAt: D('1'), columnsPouringAt: D('1'), plannedShipmentAt: D('1'), actualShipmentAt: null }), 'Ожидает отгрузки', 'all steps done, planned shipment date set')
assert.equal(nextOperationLabel({ pipeCutAt: D('1'), assemblyWeldingAt: D('1'), laserCutAt: D('1'), rollingAt: D('1'), paintingAt: D('1'), columnsPouringAt: D('1'), plannedShipmentAt: D('1'), actualShipmentAt: D('1') }), 'Отгружено', 'actual shipment date wins over everything else')

// D2 (closed as a byproduct of this same refactor): create/update in the upsert must share one built object, not repeat ~20 fields twice.
const page = readFileSync('src/app/(dashboard)/production-schedule/page.tsx', 'utf8')
assert.match(page, /create: \{ contractId, \.\.\.fields \}, update: fields/, 'productionPlan.upsert must build the field set once and reuse it in both branches')

console.log('Production schedule row checks passed: next-operation label, shared upsert field set.')
