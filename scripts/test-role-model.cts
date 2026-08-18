import assert from 'node:assert/strict'
import fs from 'node:fs'
import { canManageInvoices, canSeeAmounts, canSeeSchedules, canWrite, contractScope, isAdmin, taskScope } from '../src/lib/access'

type Role = 'ADMIN' | 'MANAGER' | 'DESIGNER' | 'BUILDER' | 'PRODUCTION' | 'ACCOUNTING' | 'VIEWER_DESIGN' | 'VIEWER'
const asUser = (role: Role) => ({ id: `user-${role}`, name: role, email: `${role}@izlk.test`, role })

// «Просмотр всего» (включая суммы) подтверждено для всех ролей, кроме старой VIEWER.
const seesAmounts: Role[] = ['ADMIN', 'MANAGER', 'DESIGNER', 'BUILDER', 'PRODUCTION', 'ACCOUNTING', 'VIEWER_DESIGN']
for (const role of seesAmounts) assert.equal(canSeeAmounts(asUser(role)), true, `${role} должен видеть суммы`)
assert.equal(canSeeAmounts(asUser('VIEWER')), false, 'старая VIEWER суммы видеть не должна')

// contractScope (изменение 2026-08-18, по прямому запросу пользователя):
// MANAGER и DESIGNER больше не ограничены — видят и редактируют любой
// договор, как ADMIN. Осталась только VIEWER (внешний ограниченный доступ).
for (const role of ['MANAGER', 'DESIGNER', 'BUILDER', 'PRODUCTION', 'ACCOUNTING', 'VIEWER_DESIGN'] as Role[]) {
	assert.deepEqual(contractScope(asUser(role)), { deletedAt: null }, `${role} должен видеть все договоры без дополнительного фильтра`)
}
assert.deepEqual(contractScope(asUser('ADMIN')), { deletedAt: null })
assert.deepEqual(contractScope(asUser('VIEWER')), { deletedAt: null, access: { some: { userId: 'user-VIEWER' } } }, 'VIEWER должна остаться на явном доступе — её никто не просил менять')

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
	// Список ролей в форме "Настройки" больше не захардкожен в самой
	// странице — берётся из общего ROLE_LABELS (src/lib/format.ts), поэтому
	// VIEWER_DESIGN проверяем там, а не литеральной строкой в settings/page.tsx.
	['src/lib/format.ts', /VIEWER_DESIGN:/],
	['src/app/(dashboard)/settings/page.tsx', /ROLES = Object\.keys\(ROLE_LABELS\)/],
	['src/app/(dashboard)/settings/page.tsx', /async function updateUser[\s\S]*id !== acting\.id[\s\S]*passwordHash/],
	['src/app/(dashboard)/settings/page.tsx', /async function deleteUser[\s\S]*id === acting\.id[\s\S]*deletedAt: new Date\(\)/],
	['src/app/(dashboard)/contracts/[id]/page.tsx', /id: 'documents'[\s\S]*id: 'agreements'/],
	['src/components/contract/TabExecutive.tsx', /InlineDocumentUpload[\s\S]*executiveDocId: ed\.id/],
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
	// Изменение 2026-08-18: MANAGER больше не ограничен managerId — проверка
	// сохранения задачи должна пускать то же самое, что и выпадающий список
	// "Договор" (оба через contractScope), а не отдельную ролевую проверку.
	['src/app/(dashboard)/tasks/[id]/page.tsx', /contractScope\(acting\)/],
	// Раз MANAGER может редактировать чужие договоры — создание ДС/счёта
	// обязано писать реального автора в журнал (writeAudit), не молчать.
	['src/app/(dashboard)/contracts/[id]/agreements/new/page.tsx', /writeAudit.*entityType: 'Agreement'/s],
	['src/app/(dashboard)/contracts/[id]/invoices/new/page.tsx', /writeAudit.*entityType: 'Invoice'/s],
]
for (const [file, pattern] of checks) assert.match(read(file), pattern, `${file} должен содержать ${pattern}`)

console.log('Role model checks passed: canSeeAmounts/contractScope/canSeeSchedules matrix, canWrite not silently widened, narrow write paths wired in all touched files.')
