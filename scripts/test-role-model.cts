import assert from 'node:assert/strict'
import fs from 'node:fs'
import { canManageInvoices, canSeeAmounts, canSeeSchedules, canWrite, contractScope, isAdmin, taskScope } from '../src/lib/access'

type Role = 'ADMIN' | 'MANAGER' | 'DESIGNER' | 'BUILDER' | 'PRODUCTION' | 'ACCOUNTING' | 'VIEWER_DESIGN' | 'VIEWER'
const asUser = (role: Role) => ({ id: `user-${role}`, name: role, email: `${role}@izlk.test`, role })

// «Просмотр всего» (включая суммы) подтверждено для всех ролей, кроме старой VIEWER.
const seesAmounts: Role[] = ['ADMIN', 'MANAGER', 'DESIGNER', 'BUILDER', 'PRODUCTION', 'ACCOUNTING', 'VIEWER_DESIGN']
for (const role of seesAmounts) assert.equal(canSeeAmounts(asUser(role)), true, `${role} должен видеть суммы`)
assert.equal(canSeeAmounts(asUser('VIEWER')), false, 'старая VIEWER суммы видеть не должна')

// contractScope: MANAGER остаётся только «свои», DESIGNER/VIEWER — без изменений,
// новые роли видят все договоры без дополнительного фильтра (как ADMIN).
assert.deepEqual(contractScope(asUser('MANAGER')), { deletedAt: null, managerId: 'user-MANAGER' }, 'MANAGER должен остаться только на своих договорах')
for (const role of ['BUILDER', 'PRODUCTION', 'ACCOUNTING', 'VIEWER_DESIGN'] as Role[]) {
	assert.deepEqual(contractScope(asUser(role)), { deletedAt: null }, `${role} должен видеть все договоры без дополнительного фильтра`)
}
assert.deepEqual(contractScope(asUser('ADMIN')), { deletedAt: null })

// canSeeSchedules: только эти три роли видят /production-schedule и график стройотдела.
for (const role of ['ADMIN', 'BUILDER', 'PRODUCTION'] as Role[]) assert.equal(canSeeSchedules(asUser(role)), true, `${role} должен видеть графики`)
for (const role of ['MANAGER', 'DESIGNER', 'ACCOUNTING', 'VIEWER_DESIGN', 'VIEWER'] as Role[]) assert.equal(canSeeSchedules(asUser(role)), false, `${role} не должен видеть графики`)

// canWrite/isAdmin — общая семантика не расширилась незаметно на новые роли.
for (const role of ['BUILDER', 'PRODUCTION', 'ACCOUNTING', 'VIEWER_DESIGN'] as Role[]) {
	assert.equal(canWrite(asUser(role)), false, `${role} не должен получить общий canWrite — только узкие права по месту`)
	assert.equal(isAdmin(asUser(role)), false)
}

// canManageInvoices (задача C2): узкое право ИМЕННО для счетов — ACCOUNTING
// плюс существующий canWrite, остальные роли без изменений (никакого
// расширения canWrite самого по себе — проверено отдельно выше).
assert.equal(canManageInvoices(asUser('ACCOUNTING')), true, 'ACCOUNTING должна управлять счетами')
assert.equal(canManageInvoices(asUser('ADMIN')), true)
assert.equal(canManageInvoices(asUser('MANAGER')), true)
for (const role of ['BUILDER', 'PRODUCTION', 'DESIGNER', 'VIEWER_DESIGN', 'VIEWER'] as Role[]) {
	assert.equal(canManageInvoices(asUser(role)), false, `${role} не должна управлять счетами`)
}

// taskScope (задача C4): вынесено из трёх дублей на странице задачи —
// ADMIN видит все, MANAGER свои/подчинённые по договору, остальные — только
// где сами исполнитель.
assert.deepEqual(taskScope(asUser('ADMIN')), { deletedAt: null })
assert.deepEqual(taskScope(asUser('MANAGER')), { deletedAt: null, OR: [{ assigneeId: 'user-MANAGER' }, { creatorId: 'user-MANAGER' }, { contract: { managerId: 'user-MANAGER' } }] })
for (const role of ['DESIGNER', 'BUILDER', 'PRODUCTION', 'ACCOUNTING', 'VIEWER_DESIGN', 'VIEWER'] as Role[]) {
	assert.deepEqual(taskScope(asUser(role)), { deletedAt: null, assigneeId: `user-${role}` }, `${role} должен видеть только задачи, где сам исполнитель`)
}

// Узкие write-пути реально подключены в перечисленных файлах (не просто "должны быть").
const read = (file: string) => fs.readFileSync(file, 'utf8')
const checks: [string, RegExp][] = [
	['src/app/(dashboard)/production-schedule/page.tsx', /canWrite\(user\)\s*\|\|\s*user\.role === 'PRODUCTION'/],
	['src/app/(dashboard)/production-schedule/page.tsx', /canSeeSchedules\(user\)/],
	['src/app/api/production-schedule/export/route.ts', /canSeeSchedules\(user\)/],
	['src/app/(dashboard)/departments/[code]/page.tsx', /canSeeSchedules\(user\)/],
	['src/app/api/departments/construction/export/route.ts', /canSeeSchedules\(user\)/],
	['src/app/(dashboard)/projects/page.tsx', /actingUser\.role !== 'BUILDER'/],
	['src/app/(dashboard)/sites/new/page.tsx', /user\.role !== 'BUILDER'/],
	['src/app/(dashboard)/sites/[id]/page.tsx', /user\.role === 'BUILDER'/],
	['src/app/(dashboard)/executive/[contractId]/page.tsx', /acting\.role !== 'BUILDER'/],
	['src/app/(dashboard)/contracts/[id]/upload/page.tsx', /user\.role === 'BUILDER'/],
	['src/app/api/contracts/[id]/documents/route.ts', /user\.role === 'BUILDER'/],
	['src/app/api/contracts/[id]/documents/route.ts', /user\.role !== 'BUILDER' && user\.role !== 'ACCOUNTING' && formData/],
	['src/components/Sidebar.tsx', /canSeeSchedules/],
	['src/app/(dashboard)/settings/page.tsx', /VIEWER_DESIGN/],
	// Задача C2: узкий доступ ACCOUNTING к счетам — та же схема, что у BUILDER выше.
	['src/app/api/contracts/[id]/documents/route.ts', /user\.role === 'ACCOUNTING'/],
	['src/app/(dashboard)/contracts/[id]/upload/page.tsx', /user\.role === 'ACCOUNTING'/],
	['src/app/(dashboard)/contracts/[id]/invoices/new/page.tsx', /canManageInvoices/],
	['src/app/(dashboard)/contracts/[id]/page.tsx', /canManageInvoices/],
	['src/components/contract/TabAgreements.tsx', /canEditInvoices/],
	// Задача C4: вложения к задаче и к комментарию задачи — везде видимость
	// через taskScope, не через отдельно продублированные ролевые условия.
	['src/app/(dashboard)/tasks/[id]/page.tsx', /taskScope\(user\)/],
	['src/app/(dashboard)/tasks/[id]/page.tsx', /taskScope\(acting\)/],
	['src/app/api/tasks/attachments/[id]/route.ts', /taskScope\(user\)/],
	['src/app/api/tasks/comment-attachments/[id]/route.ts', /taskScope\(user\)/],
	['src/app/api/tasks/[id]/attachments/route.ts', /taskScope\(user\)/],
	['src/app/api/tasks/[id]/comments/route.ts', /taskScope\(user\)/],
]
for (const [file, pattern] of checks) assert.match(read(file), pattern, `${file} должен содержать ${pattern}`)

console.log('Role model checks passed: canSeeAmounts/contractScope/canSeeSchedules matrix, canWrite not silently widened, narrow write paths wired in all touched files.')
