import { redirect } from 'next/navigation'
import type { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

/**
 * Единая точка проверки прав.
 *
 * Раньше ролевые условия дублировались на каждой странице, а серверные
 * действия (создание ДС, сметы, редактирование контрагента) проверяли
 * только роль VIEWER. Из-за этого MANAGER мог подставить в URL чужой
 * contractId и записать данные в договор, который ему не виден.
 * Теперь любая запись проходит через assertContractAccess().
 */

export type Role = 'ADMIN' | 'MANAGER' | 'DESIGNER' | 'BUILDER' | 'PRODUCTION' | 'ACCOUNTING' | 'VIEWER_DESIGN' | 'VIEWER'

export type SessionUser = {
	id: string
	name?: string | null
	email?: string | null
	role: Role
}

/** Текущий пользователь. Без сессии — редирект на /login. */
export async function getActiveUser(): Promise<SessionUser | null> {
	const session = await auth()
	if (!session?.user) return null
	const user = session.user as Partial<SessionUser>
	// A JWT can outlive a changed/deactivated account.  Resolving the principal
	// from the database keeps server actions and Settings from running with a
	// stale tab after another account signs in in the same browser profile.
	const id = String(user.id ?? '')
	if (!id) return null
	const actual = await prisma.user.findFirst({ where: { id, isActive: true, deletedAt: null }, select: { id: true, name: true, email: true, role: true } })
	if (!actual) return null
	return {
		id: actual.id,
		name: actual.name,
		email: actual.email,
		role: actual.role as Role,
	}
}

export async function requireUser(): Promise<SessionUser> {
	const user = await getActiveUser()
	if (!user) redirect('/login')
	return user
}

/** Только старая роль VIEWER (внешний/ограниченный доступ) не видит суммы. */
export function canSeeAmounts(user: SessionUser): boolean {
	return user.role !== 'VIEWER'
}

/** VIEWER не может ничего создавать и изменять. */
export function canWrite(user: SessionUser): boolean {
	return user.role === 'ADMIN' || user.role === 'MANAGER'
}

/**
 * Задача C2: у ACCOUNTING сейчас нет прав вообще нигде (canWrite — только
 * ADMIN/MANAGER), а работа со счетами — её прямая задача. Отдельная узкая
 * проверка ИМЕННО для счетов (не расширяем canWrite целиком — это разом
 * дало бы ACCOUNTING запись во все остальные формы приложения, от карточки
 * контрагента до перевода этапов договора, о чём в задаче речи не было).
 */
export function canManageInvoices(user: SessionUser): boolean {
	return canWrite(user) || user.role === 'ACCOUNTING'
}

/** Только администратор управляет пользователями и очередью импорта. */
export function isAdmin(user: SessionUser): boolean {
	return user.role === 'ADMIN'
}

/** График производства и график стройотдела видят только эти три роли. */
export function canSeeSchedules(user: SessionUser): boolean {
	return user.role === 'ADMIN' || user.role === 'BUILDER' || user.role === 'PRODUCTION'
}

/**
 * Область видимости договоров для роли.
 * По прямому запросу пользователя (2026-08-18): MANAGER и DESIGNER видят и
 * редактируют ЛЮБОЙ договор, не только свои/назначенные — раньше MANAGER
 * был ограничен managerId, а DESIGNER — ContractAccess/ответственностью за
 * раздел проекта. Это единственная функция, через которую идёт и список
 * (contracts, dashboard, поиск), и проверка на запись (assertContractAccess/
 * findContractInScope) — так что снятие фильтра здесь разом даёт менеджерам
 * право редактировать чужие договоры (загружать файлы, менять этап, ДС,
 * счета). Пользователь подтвердил это осознанно, с условием: все изменения
 * остаются в журнале (writeAudit пишет реального автора действия, не
 * managerId договора — «Последняя активность» у ADMIN покажет, кто что менял).
 * ADMIN, BUILDER, PRODUCTION, ACCOUNTING и VIEWER_DESIGN тут и раньше не
 * фильтровались — «просмотр всего» для них означает без дополнительного
 * фильтра. Осталась только VIEWER (внешний/ограниченный доступ) — её сюда
 * никто не просил менять.
 */
export function contractScope(user: SessionUser): Prisma.ContractWhereInput {
	return {
		deletedAt: null,
		...(user.role === 'VIEWER' ? { access: { some: { userId: user.id } } } : {}),
	}
}

/**
 * Область видимости задач для роли (задача C4) — раньше это условие было
 * продублировано трижды на странице задачи (просмотр, updateTask, addComment).
 * ADMIN видит все; MANAGER — свои (исполнитель/постановщик) и задачи
 * договоров, которыми управляет; остальные роли — только там, где сами исполнитель.
 */
export function taskScope(user: SessionUser): Prisma.TaskWhereInput {
	return {
		deletedAt: null,
		...(user.role === 'ADMIN'
			? {}
			: user.role === 'MANAGER'
				? { OR: [{ assigneeId: user.id }, { creatorId: user.id }, { contract: { managerId: user.id } }] }
				: { assigneeId: user.id }),
	}
}

/**
 * Every newly created contract is visible to active designers immediately.
 * This is an explicit per-contract grant rather than opening historical or
 * unrelated contracts to the whole design department.
 */
export async function grantDesignReadAccess(contractId: string) {
	const designers = await prisma.user.findMany({
		where: { role: 'DESIGNER', isActive: true, deletedAt: null },
		select: { id: true },
	})
	if (!designers.length) return 0
	const created = await prisma.contractAccess.createMany({
		data: designers.map((designer) => ({ contractId, userId: designer.id, level: 'READ' })),
		skipDuplicates: true,
	})
	return created.count
}

/** Договор виден пользователю? Возвращает минимальные поля или null. */
export async function findContractInScope(contractId: string, user: SessionUser) {
	if (!contractId) return null
	return prisma.contract.findFirst({
		where: { id: contractId, ...contractScope(user) },
		select: { id: true, number: true, managerId: true },
	})
}

/**
 * Проверка перед записью в договор.
 * Если договор недоступен или роль только для чтения — редирект,
 * а не молчаливая запись в чужие данные.
 */
export async function assertContractAccess(
	contractId: string,
	user: SessionUser,
	options: { write?: boolean } = {},
) {
	if (options.write && !canWrite(user)) redirect('/contracts')
	const contract = await findContractInScope(contractId, user)
	if (!contract) redirect('/contracts')
	return contract
}

/**
 * Контрагент доступен, только если у пользователя есть хотя бы один
 * видимый договор с ним. Иначе MANAGER мог править чужие карточки.
 */
export async function assertContractorAccess(
	contractorId: string,
	user: SessionUser,
	options: { write?: boolean } = {},
) {
	if (options.write && !canWrite(user)) redirect('/contractors')
	const contractor = await prisma.contractor.findFirst({
		where: {
			id: contractorId,
			deletedAt: null,
			...(user.role === 'ADMIN' ? {} : { contracts: { some: contractScope(user) } }),
		},
		select: { id: true, name: true },
	})
	if (!contractor) redirect('/contractors')
	return contractor
}
