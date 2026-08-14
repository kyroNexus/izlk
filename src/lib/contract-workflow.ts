import type { ContractKind, ContractWorkflowStage, DocumentKind, DocumentState, Prisma, SectionCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { notify } from '@/lib/notifications'
import { logger } from '@/lib/logger'
import { addWorkingDays, calcContractDeadline } from '@/lib/deadline'
import { canTransitionWorkflowStage, getNextWorkflowStages } from './workflow-rules'

export { canTransitionWorkflowStage, getNextWorkflowStages } from './workflow-rules'

/** Порядок стадий для степпера на карточке договора. INSTALL_KZH иногда пропускается
 *  (переход возможен сразу в INSTALL_KM) — в линейном степпере он в этом случае просто
 *  считается пройденным вместе с остальными более ранними стадиями. */
export const WORKFLOW_STAGE_ORDER: ContractWorkflowStage[] = [
	'CONTRACT_PREPARATION',
	'AWAITING_CONTRACT_SIGNATURE',
	'PR1_DEVELOPMENT',
	'AWAITING_PR1_SIGNATURE',
	'DESIGN',
	'WAITING_PRODUCTION',
	'PRODUCTION',
	'AWAITING_SHIPMENT',
	'INSTALL_KZH',
	'INSTALL_KM',
	'CLOSED',
]

export const WORKFLOW_STAGE_LABEL: Record<ContractWorkflowStage, string> = {
	CONTRACT_PREPARATION: 'Подготовка договора',
	AWAITING_CONTRACT_SIGNATURE: 'Ожидание подписания договора и оплаты',
	PR1_DEVELOPMENT: 'Разработка Приложения №1',
	AWAITING_PR1_SIGNATURE: 'Ожидание подписания Приложения №1',
	DESIGN: 'Проектирование',
	WAITING_PRODUCTION: 'Ожидает производства',
	PRODUCTION: 'Производство',
	AWAITING_SHIPMENT: 'Ожидание отгрузки',
	INSTALL_KZH: 'Монтаж КЖ',
	INSTALL_KM: 'Монтаж МК',
	CLOSED: 'Закрыт',
}

type Tx = Prisma.TransactionClient

export type StageTransitionInput = {
	contractId: string
	toStage: ContractWorkflowStage
	actorId?: string | null
	isAutomatic?: boolean
	comment?: string | null
	/** Нужен для подтверждения ПР1 и исторических данных: там этап может перескочить несколько пунктов. */
	force?: boolean
}

async function transitionInTx(tx: Tx, input: StageTransitionInput) {
	const contract = await tx.contract.findUnique({
		where: { id: input.contractId },
		select: { id: true, number: true, managerId: true, workflowStage: true },
	})
	if (!contract) throw new Error('Договор не найден')
	if (contract.workflowStage === input.toStage) return { changed: false, fromStage: contract.workflowStage, contract }
	if (!input.force && !canTransitionWorkflowStage(contract.workflowStage, input.toStage)) {
		throw new Error(`Нельзя перевести договор из стадии «${WORKFLOW_STAGE_LABEL[contract.workflowStage]}» в «${WORKFLOW_STAGE_LABEL[input.toStage]}»`)
	}
	await tx.contract.update({ where: { id: contract.id }, data: { workflowStage: input.toStage, ...(input.toStage === 'CLOSED' ? { status: 'CLOSED' } : {}) } })
	await tx.contractStageHistory.create({
		data: {
			contractId: contract.id,
			fromStage: contract.workflowStage,
			toStage: input.toStage,
			changedById: input.actorId ?? null,
			isAutomatic: input.isAutomatic ?? false,
			comment: input.comment?.trim() || null,
		},
	})
	return { changed: true, fromStage: contract.workflowStage, contract }
}

async function notifyWaitingProduction(result: { changed: boolean; contract: { id: string; number: string; managerId: string | null } }, toStage: ContractWorkflowStage, fallbackUserId?: string | null) {
	if (!result.changed || toStage !== 'WAITING_PRODUCTION') return
	await notify({ userId: result.contract.managerId ?? fallbackUserId, type: 'WARNING', title: 'Договор ожидает действия производства', message: `Договор № ${result.contract.number} передан в очередь производства`, href: `/contracts/${result.contract.id}`, dedupeKey: `contract-waiting-production:${result.contract.id}` })
}

/** Единственная публичная точка ручного/автоматического перехода договора по процессу. */
export async function transitionContractStage(input: StageTransitionInput) {
	const result = await prisma.$transaction((tx) => transitionInTx(tx, input))
	await notifyWaitingProduction(result, input.toStage, input.actorId)
	return result
}

/**
 * Первый участок цепочки не требует отдельной ручной кнопки.
 * Исходник договора означает, что менеджер подготовил пакет и ждёт подпись;
 * подписанный договор переводит его к подготовке ПР1. Более поздние стадии
 * намеренно не меняются от случайной загрузки старого файла.
 */
export async function syncWorkflowAfterDocumentUpload(input: { contractId: string; actorId: string; kind: DocumentKind; state: DocumentState }) {
	if (input.kind !== 'CONTRACT') return null
	return prisma.$transaction(async (tx) => {
		const contract = await tx.contract.findUnique({ where: { id: input.contractId }, select: { workflowStage: true } })
		if (!contract) return null
		const next = input.state === 'SIGNED'
			? (['CONTRACT_PREPARATION', 'AWAITING_CONTRACT_SIGNATURE'].includes(contract.workflowStage) ? 'PR1_DEVELOPMENT' : null)
			: (contract.workflowStage === 'CONTRACT_PREPARATION' ? 'AWAITING_CONTRACT_SIGNATURE' : null)
		if (!next) return null
		return transitionInTx(tx, {
			contractId: input.contractId,
			toStage: next,
			actorId: input.actorId,
			isAutomatic: true,
			comment: input.state === 'SIGNED' ? 'Загружен подписанный договор' : 'Загружен актуальный исходник договора',
		})
	})
}

/**
 * Persisting a document is the primary operation; advancing a dashboard stage
 * is a follow-up.  A transient database/notification failure must therefore
 * never make a successfully stored file look failed to the operator or cause
 * it to be re-imported as a duplicate on retry.
 */
export async function trySyncWorkflowAfterDocumentUpload(input: { contractId: string; actorId: string; kind: DocumentKind; state: DocumentState }) {
	try {
		return { result: await syncWorkflowAfterDocumentUpload(input), error: null as string | null }
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Не удалось автоматически обновить этап договора.'
		logger.error('contract_workflow.sync_failed', { entityType: 'Contract', entityId: input.contractId, userId: input.actorId, error })
		return { result: null, error: message }
	}
}

/** АР входит в разделы проекта для любого типа договора, не только «Проектирование». */
export function sectionsForKind(kind: ContractKind): SectionCode[] {
	if (kind === 'MK') return ['KM', 'AR']
	return ['KM', 'KZH', 'AR']
}

function needsSite(kind: ContractKind): boolean {
	return kind === 'SMR'
}

export type ConfirmPr1Input = {
	contractId: string
	actorId: string
	signedAt: Date
	workingDays?: number | null
}

/**
 * Подтверждает подписанное ПР1 и запускает процесс. Операция идемпотентна:
 * повторное подтверждение не создаёт повторные площадки, разделы или задачи.
 */
export async function confirmSignedPr1Workflow(input: ConfirmPr1Input) {
	const result = await prisma.$transaction(async (tx) => {
		const contract = await tx.contract.findUnique({
			where: { id: input.contractId },
			select: {
				id: true, number: true, kind: true, objectAddress: true, managerId: true,
				workingDays: true, workflowStage: true, pr1ConfirmedAt: true,
				sites: { where: { deletedAt: null }, select: { id: true }, take: 1 },
			},
		})
		if (!contract) throw new Error('Договор не найден')
		const workingDays = input.workingDays ?? contract.workingDays ?? null
		if (workingDays != null && (!Number.isInteger(workingDays) || workingDays < 1 || workingDays > 730)) {
			throw new Error('Количество рабочих дней должно быть от 1 до 730')
		}
		const deadline = calcContractDeadline(input.signedAt, workingDays)
		await tx.contract.update({
			where: { id: contract.id },
			data: {
				pr1SignedAt: input.signedAt,
				pr1ConfirmedAt: contract.pr1ConfirmedAt ?? new Date(),
				pr1ConfirmedById: contract.pr1ConfirmedAt ? undefined : input.actorId,
				workingDays,
				deadline,
			},
		})

		let siteCreated = false
		if (needsSite(contract.kind) && contract.sites.length === 0) {
			const site = await tx.site.create({
				data: { contractId: contract.id, address: contract.objectAddress?.trim() || 'Адрес площадки уточняется' },
				select: { id: true },
			})
			await tx.siteEvent.create({ data: { siteId: site.id, type: 'INFO', text: 'Площадка создана автоматически после подтверждения подписанного ПР1' } })
			siteCreated = true
		}

		const designer = await tx.user.findFirst({
			where: { role: 'DESIGNER', isActive: true, deletedAt: null },
			orderBy: { name: 'asc' },
			select: { id: true, name: true },
		})
		const responsibleId = designer?.id ?? contract.managerId ?? input.actorId
		const codes = sectionsForKind(contract.kind)
		let sectionsCreated = 0
		let tasksCreated = 0
		for (const [index, code] of codes.entries()) {
			const existing = await tx.projectSection.findUnique({ where: { contractId_code: { contractId: contract.id, code } }, select: { id: true } })
			if (existing) continue
			const last = await tx.projectSection.aggregate({ where: { code, responsibleId, deletedAt: null }, _max: { queuePosition: true } })
			const sectionDeadline = deadline
				? addWorkingDays(input.signedAt, Math.max(1, Math.round(((workingDays ?? (codes.length * 5)) + 1) * (index + 1) / codes.length)))
				: addWorkingDays(input.signedAt, 7 + index * 5)
			await tx.projectSection.create({
				data: { contractId: contract.id, code, responsibleId, durationDays: 5, deadline: sectionDeadline, queuePosition: (last._max.queuePosition ?? 0) + 10, comment: 'Добавлено автоматически после подтверждения подписанного ПР1' },
			})
			sectionsCreated += 1
			const title = `Подготовить раздел ${code === 'KZH' ? 'КЖ' : code}`
			const existingTask = await tx.task.findFirst({ where: { contractId: contract.id, title, deletedAt: null }, select: { id: true } })
			if (!existingTask) {
				await tx.task.create({ data: { contractId: contract.id, title, category: 'Проектирование', priority: 'HIGH', assigneeId: responsibleId, creatorId: input.actorId, dueDate: sectionDeadline, description: 'Создано автоматически после подтверждения подписанного Приложения №1' } })
				tasksCreated += 1
			}
		}

		if (needsSite(contract.kind)) {
			const title = 'Подтвердить готовность площадки'
			if (!await tx.task.findFirst({ where: { contractId: contract.id, title, deletedAt: null }, select: { id: true } })) {
				await tx.task.create({ data: { contractId: contract.id, title, category: 'Площадка', priority: 'MEDIUM', assigneeId: contract.managerId ?? input.actorId, creatorId: input.actorId, dueDate: addWorkingDays(input.signedAt, 3), description: 'Создано автоматически после подтверждения подписанного Приложения №1' } })
				tasksCreated += 1
			}
		}

		const transition = await transitionInTx(tx, {
			contractId: contract.id,
			toStage: 'DESIGN',
			actorId: input.actorId,
			isAutomatic: true,
			comment: 'Подписанное Приложение №1 подтверждено: запущено проектирование',
			force: true,
		})
		return { contract, designer, siteCreated, sectionsCreated, tasksCreated, deadline, transition, alreadyConfirmed: Boolean(contract.pr1ConfirmedAt) }
	})

	await notify({ userId: result.contract.managerId ?? input.actorId, type: 'INFO', title: 'ПР1 подписан заказчиком', message: `Договор № ${result.contract.number}: ${result.sectionsCreated ? 'созданы разделы проектирования' : 'очередь проектирования уже создана'}${result.siteCreated ? ', площадка создана' : ''}`, href: `/contracts/${input.contractId}`, dedupeKey: `pr1:${input.contractId}` })
	if (result.designer && result.sectionsCreated) await notify({ userId: result.designer.id, type: 'ASSIGNMENT', title: 'Назначены проектные разделы', message: `Договор № ${result.contract.number} добавлен в вашу очередь`, href: '/projects', dedupeKey: `pr1-assignment:${input.contractId}` })
	return { siteCreated: result.siteCreated, sectionsCreated: result.sectionsCreated, tasksCreated: result.tasksCreated, responsibleName: result.designer?.name ?? null, deadline: result.deadline, alreadyConfirmed: result.alreadyConfirmed }
}

/** Обратная совместимость для уже существующей точки загрузки. */
export async function activateSignedPr1Workflow(contractId: string, fallbackResponsibleId: string) {
	return confirmSignedPr1Workflow({ contractId, actorId: fallbackResponsibleId, signedAt: new Date() })
}

/**
 * Добавляет один недостающий раздел проекта договору, у которого ПР1 уже было
 * подтверждено раньше — до того, как этот раздел стал частью sectionsForKind().
 * Идемпотентна: для уже существующего раздела ничего не создаёт.
 */
export async function addMissingProjectSection(input: { contractId: string; code: SectionCode; actorId: string }) {
	return prisma.$transaction(async (tx) => {
		const contract = await tx.contract.findUnique({ where: { id: input.contractId }, select: { id: true, kind: true, managerId: true, pr1ConfirmedAt: true } })
		if (!contract || !contract.pr1ConfirmedAt || !sectionsForKind(contract.kind).includes(input.code)) return null
		const existing = await tx.projectSection.findUnique({ where: { contractId_code: { contractId: input.contractId, code: input.code } }, select: { id: true } })
		if (existing) return null
		const designer = await tx.user.findFirst({ where: { role: 'DESIGNER', isActive: true, deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true } })
		const responsibleId = designer?.id ?? contract.managerId ?? input.actorId
		const last = await tx.projectSection.aggregate({ where: { code: input.code, responsibleId, deletedAt: null }, _max: { queuePosition: true } })
		return tx.projectSection.create({
			data: { contractId: contract.id, code: input.code, responsibleId, durationDays: 5, deadline: addWorkingDays(new Date(), 7), queuePosition: (last._max.queuePosition ?? 0) + 10, comment: 'Добавлено вручную' },
			select: { id: true },
		})
	})
}

/** Переводит договор в ожидание производства, когда все созданные проектные разделы завершены. */
export async function advanceAfterProjectSectionsReady(contractId: string, actorId: string) {
	const result = await prisma.$transaction(async (tx) => {
		const contract = await tx.contract.findUnique({
			where: { id: contractId },
			select: {
				workflowStage: true,
				projectSections: {
					where: { deletedAt: null, code: 'KM' },
					select: {
						queueStatus: true,
						documents: { where: { deletedAt: null, kind: 'PROJECT_PDF' }, select: { id: true }, take: 1 },
					},
				},
			},
		})
		const km = contract?.projectSections[0]
		// В цех нельзя передавать «готовый» КМ без итогового PDF: иначе у производства нет рабочего файла.
		if (!contract || !km || km.queueStatus !== 'DONE' || km.documents.length === 0) return null
		if (contract.workflowStage !== 'DESIGN') return null
		const moved = await transitionInTx(tx, {
			contractId,
			toStage: 'WAITING_PRODUCTION',
			actorId,
			isAutomatic: true,
			comment: 'КМ подтверждён как готовый, итоговый PDF передан в производственный буфер',
		})
		return moved
	})
	if (!result) return false
	await notifyWaitingProduction(result, 'WAITING_PRODUCTION', actorId)
	return result.changed
}

/** Первый монтажный отчёт — фактическое подтверждение начала монтажа. */
export async function advanceAfterSiteReport(input: { contractId: string; actorId: string; direction: 'KJ' | 'KM' }) {
	return prisma.$transaction(async (tx) => {
		const contract = await tx.contract.findUnique({ where: { id: input.contractId }, select: { workflowStage: true } })
		if (!contract) return false
		const next = input.direction === 'KJ'
			? (contract.workflowStage === 'AWAITING_SHIPMENT' ? 'INSTALL_KZH' : null)
			: (['AWAITING_SHIPMENT', 'INSTALL_KZH'].includes(contract.workflowStage) ? 'INSTALL_KM' : null)
		if (!next) return false
		return (await transitionInTx(tx, { contractId: input.contractId, toStage: next, actorId: input.actorId, isAutomatic: true, comment: `Добавлен первый дневной отчёт по монтажу ${input.direction === 'KJ' ? 'КЖ' : 'КМ'}` })).changed
	})
}

/** Закрытие направления подтверждается человеком в дневном отчёте. */
export async function advanceAfterInstallationCompleted(input: { contractId: string; actorId: string; direction: 'KJ' | 'KM' }) {
	return prisma.$transaction(async (tx) => {
		const contract = await tx.contract.findUnique({ where: { id: input.contractId }, select: { workflowStage: true, executiveDocs: { where: { deletedAt: null }, select: { status: true } } } })
		if (!contract) return { changed: false, closed: false }
		if (input.direction === 'KJ' && contract.workflowStage === 'INSTALL_KZH') {
			const changed = (await transitionInTx(tx, { contractId: input.contractId, toStage: 'INSTALL_KM', actorId: input.actorId, isAutomatic: true, comment: 'Монтаж КЖ завершён в дневном отчёте' })).changed
			return { changed, closed: false }
		}
		const execReady = contract.executiveDocs.length > 0 && contract.executiveDocs.every((item) => item.status === 'READY')
		if (input.direction === 'KM' && contract.workflowStage === 'INSTALL_KM' && execReady) {
			const changed = (await transitionInTx(tx, { contractId: input.contractId, toStage: 'CLOSED', actorId: input.actorId, isAutomatic: true, comment: 'Монтаж КМ и исполнительная документация подтверждены как готовые' })).changed
			return { changed, closed: changed }
		}
		return { changed: false, closed: false }
	})
}

/** Если исполнительная закрыта после монтажа КМ, закрываем договор в любом порядке событий. */
export async function closeAfterExecutiveDocsReady(input: { contractId: string; actorId: string }) {
	return prisma.$transaction(async (tx) => {
		const contract = await tx.contract.findUnique({ where: { id: input.contractId }, select: { workflowStage: true, executiveDocs: { where: { deletedAt: null }, select: { status: true } } } })
		if (!contract || contract.workflowStage !== 'INSTALL_KM' || contract.executiveDocs.length === 0 || contract.executiveDocs.some((item) => item.status !== 'READY')) return false
		return (await transitionInTx(tx, { contractId: input.contractId, toStage: 'CLOSED', actorId: input.actorId, isAutomatic: true, comment: 'Исполнительная документация полностью готова после монтажа КМ' })).changed
	})
}

/**
 * Административная отмена ошибочного подтверждения ПР1.
 * Документы, площадка и разделы намеренно не удаляются: это защищает реальные
 * данные и не даёт повторному подтверждению создать дубликаты.
 */
export async function revokePr1Confirmation(input: { contractId: string; actorId: string; reason: string }) {
	const reason = input.reason.trim()
	if (!reason) throw new Error('Укажите причину отмены подтверждения ПР1')
	return prisma.$transaction(async (tx) => {
		const contract = await tx.contract.findUnique({ where: { id: input.contractId }, select: { id: true, workflowStage: true, pr1ConfirmedAt: true } })
		if (!contract) throw new Error('Договор не найден')
		await tx.contract.update({ where: { id: contract.id }, data: { pr1SignedAt: null, pr1ConfirmedAt: null, pr1ConfirmedById: null, deadline: null } })
		await transitionInTx(tx, { contractId: contract.id, toStage: 'AWAITING_PR1_SIGNATURE', actorId: input.actorId, comment: `Отмена подтверждения ПР1: ${reason}`, force: true })
		return { changed: Boolean(contract.pr1ConfirmedAt) }
	})
}
