/**
 * A6: loadDepartmentFlow must return numbers identical to the matching slice
 * of loadDashboard (same underlying computation, just fewer queries/no
 * write) — and it must not perform the daily-snapshot write that the real
 * dashboard does.
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { loadDashboard, loadDepartmentFlow, type DepartmentKey } from '../src/lib/dashboard'

async function main() {
	const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true, deletedAt: null }, select: { id: true, role: true, name: true, email: true } })
	if (!admin) { console.log('no admin fixture on this db — skipping'); return }
	const user = { id: admin.id, role: admin.role, name: admin.name, email: admin.email } as const

	// loadDashboard itself is expected to write today's snapshot — call it first
	// so the baseline below reflects "after the real dashboard already ran today",
	// which is what actually matters: does loadDepartmentFlow write anything MORE.
	const full = await loadDashboard(user, new Date())
	const before = await prisma.departmentDailySnapshot.count()

	const codes: DepartmentKey[] = ['commercial', 'engineering', 'production', 'construction']
	for (const code of codes) {
		const light = await loadDepartmentFlow(user, code, new Date())
		assert.ok(light, `loadDepartmentFlow must find a result for ${code}`)
		const expectedDepartment = full.departmentProgress.find((d) => d.key === code)
		const expectedFlow = full.departmentFlow.find((d) => d.key === code)
		assert.deepEqual(light!.department, expectedDepartment, `department stats for ${code} must match loadDashboard exactly`)
		assert.deepEqual(light!.flow, expectedFlow, `flow for ${code} must match loadDashboard exactly`)
		assert.equal(light!.attentionDangerCount, full.attentionCounts.danger, `danger badge count for ${code} must match the global figure`)
	}

	const after = await prisma.departmentDailySnapshot.count()
	assert.equal(after, before, 'loadDepartmentFlow must not write departmentDailySnapshot rows — that is loadDashboard\'s job')

	console.log('Department flow checks passed: matches loadDashboard exactly, does not write the daily snapshot.')
}

main().finally(() => prisma.$disconnect())
