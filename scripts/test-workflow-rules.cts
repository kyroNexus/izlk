/**
 * D3: the parts of the app that decide whether a contract CAN move to a
 * given stage, when its deadline falls, and how "done" it is had no tests
 * at all — only infrastructure (rate-limit, logger, chat-access) did.
 * Covers workflow-rules.ts, deadline.ts and contract-progress.ts: happy
 * path, forbidden transitions, and boundary dates, per the task.
 */
import assert from 'node:assert/strict'
import { canTransitionWorkflowStage, getNextWorkflowStages } from '../src/lib/workflow-rules'
import { addWorkingDays, calcContractDeadline, getDeadlineInfo, isWorkingDay, workingDaysBetween } from '../src/lib/deadline'
import { calcCostBreakdown, calcProgress } from '../src/lib/contract-progress'
import type { ContractWorkflowStage } from '@prisma/client'

// ---------- workflow-rules.ts ----------

// Happy path: the real chain end to end, one hop at a time.
const CHAIN: ContractWorkflowStage[] = ['CONTRACT_PREPARATION', 'AWAITING_CONTRACT_SIGNATURE', 'PR1_DEVELOPMENT', 'AWAITING_PR1_SIGNATURE', 'DESIGN', 'WAITING_PRODUCTION', 'PRODUCTION', 'AWAITING_SHIPMENT', 'SHIPPED']
for (let i = 0; i < CHAIN.length - 1; i++) {
	assert.ok(canTransitionWorkflowStage(CHAIN[i], CHAIN[i + 1]), `${CHAIN[i]} -> ${CHAIN[i + 1]} must be allowed`)
}
// SHIPPED forks into either install direction.
assert.ok(canTransitionWorkflowStage('SHIPPED', 'INSTALL_KZH'))
assert.ok(canTransitionWorkflowStage('SHIPPED', 'INSTALL_KM'))
assert.ok(canTransitionWorkflowStage('INSTALL_KZH', 'INSTALL_KM'))
assert.ok(canTransitionWorkflowStage('INSTALL_KM', 'CLOSED'))

// Staying put is always allowed (a no-op save must not be treated as an illegal transition).
assert.ok(canTransitionWorkflowStage('DESIGN', 'DESIGN'))

// Forbidden: skipping stages forward.
assert.ok(!canTransitionWorkflowStage('CONTRACT_PREPARATION', 'CLOSED'), 'must not skip straight to the end')
assert.ok(!canTransitionWorkflowStage('DESIGN', 'PRODUCTION'), 'must not skip WAITING_PRODUCTION')
// Forbidden: going backward.
assert.ok(!canTransitionWorkflowStage('PRODUCTION', 'DESIGN'), 'must not go back to an earlier stage')
assert.ok(!canTransitionWorkflowStage('CLOSED', 'INSTALL_KM'), 'a closed contract must not reopen by re-entering an earlier stage')

// CLOSED is terminal.
assert.deepEqual(getNextWorkflowStages('CLOSED'), [])
assert.deepEqual(getNextWorkflowStages('SHIPPED').sort(), ['INSTALL_KM', 'INSTALL_KZH'].sort())

// ---------- deadline.ts ----------

assert.equal(isWorkingDay(new Date('2026-01-05T12:00:00')), false, '2026-01-05 is a listed holiday')
assert.equal(isWorkingDay(new Date('2026-01-10T12:00:00')), false, '2026-01-10 is a Saturday')
assert.equal(isWorkingDay(new Date('2026-01-12T12:00:00')), true, '2026-01-12 is a plain Monday')

// addWorkingDays: 0 days is a no-op; skips the New Year holiday block entirely.
assert.equal(addWorkingDays(new Date('2026-01-12'), 0).toDateString(), new Date('2026-01-12').toDateString())
const afterOne = addWorkingDays(new Date('2026-01-12'), 1) // Monday -> Tuesday, no holiday in the way
assert.equal(afterOne.getDate(), 13)

// calcContractDeadline: null on missing signedAt or non-positive workingDays; a real date otherwise.
assert.equal(calcContractDeadline(null, 20), null)
assert.equal(calcContractDeadline(new Date('2026-01-12'), 0), null)
assert.equal(calcContractDeadline(new Date('2026-01-12'), -5), null)
assert.ok(calcContractDeadline(new Date('2026-01-12'), 20) instanceof Date)

// workingDaysBetween: sign flips depending on direction, and it round-trips with addWorkingDays.
const from = new Date('2026-01-12')
const to = addWorkingDays(from, 10)
assert.equal(workingDaysBetween(from, to), 10)
assert.equal(workingDaysBetween(to, from), -10)
assert.equal(workingDaysBetween(from, from), 0)

// getDeadlineInfo boundaries: the 5-working-day cutoff between "warn" and "ok", and overdue as "danger".
const now = new Date('2026-01-12T09:00:00')
assert.equal(getDeadlineInfo(null, now).tone, 'off')
assert.equal(getDeadlineInfo(addWorkingDays(now, 5), now).tone, 'warn', 'exactly 5 working days left must still read as warn, not ok')
assert.equal(getDeadlineInfo(addWorkingDays(now, 6), now).tone, 'ok', 'more than 5 working days left must read as ok')
const overdue = getDeadlineInfo(new Date('2026-01-05T09:00:00'), now)
assert.equal(overdue.tone, 'danger')
assert.equal(overdue.overdue, true)

// ---------- contract-progress.ts ----------

assert.equal(calcProgress({}).current, 'CREATED', 'a bare contract with nothing else set is just CREATED')
assert.equal(calcProgress({ pr1SignedAt: new Date() }).current, 'PR1_SIGNED')
assert.equal(calcProgress({ pr1SignedAt: new Date(), projectSections: [{ status: 'IN_PROGRESS' }] }).current, 'DESIGN', 'sections exist but are not all ready -- DESIGN, not DESIGN_DONE')
assert.equal(calcProgress({ pr1SignedAt: new Date(), projectSections: [{ status: 'READY' }, { status: 'READY' }] }).current, 'DESIGN_DONE')
assert.equal(calcProgress({ pr1SignedAt: new Date(), projectSections: [{ status: 'READY' }], productionDoneAt: new Date() }).current, 'PRODUCTION')
assert.equal(calcProgress({ site: { status: 'READY' } }).current, 'SITE_PREP', 'a site marked ready counts on its own even with nothing else filled in')
assert.equal(calcProgress({ site: { status: 'READY', installDoneAt: new Date() } }).current, 'INSTALL')
assert.equal(calcProgress({ executiveDocs: [{ status: 'READY' }] }).current, 'EXEC_DOCS')
// A closed status wins outright, even over an otherwise-empty contract -- a real, slightly
// surprising rule worth locking in with a test rather than leaving as tribal knowledge.
assert.equal(calcProgress({ status: 'CLOSED' }).current, 'CLOSED', 'status=CLOSED short-circuits to CLOSED regardless of what else is filled in')
assert.equal(calcProgress({}).percent, Math.round((1 / 9) * 100))
assert.equal(calcProgress({ status: 'CLOSED' }).percent, 100)

const breakdown = calcCostBreakdown([{ kind: 'SMR', planned: 100 }, { kind: 'MK', planned: 0 }], 100)
assert.equal(breakdown.balanced, true, 'planned total matches the contract amount exactly')
assert.equal(breakdown.items[1].share, 0, 'a zero-planned item must not divide by zero')
const unbalanced = calcCostBreakdown([{ kind: 'SMR', planned: 50 }], 100)
assert.equal(unbalanced.balanced, false)
assert.equal(unbalanced.diff, 50)

console.log('Workflow-rules / deadline / contract-progress checks passed: happy path, forbidden transitions, boundary dates.')
