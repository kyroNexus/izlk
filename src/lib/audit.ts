import type { AuditAction } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Запись в журнал действий.
 *
 * Модель AuditLog была в схеме с самого начала, но в неё никто не писал.
 * Для договоров и подписанных сканов это критично: нужно знать, кто
 * загрузил и кто скачал документ.
 *
 * Аудит не должен ронять основной сценарий, поэтому ошибки только логируются.
 */
export async function writeAudit(input: {
	userId: string
	action: AuditAction
	entityType: string
	entityId: string
	ipAddress?: string | null
}): Promise<void> {
	if (!input.userId) return
	try {
		await prisma.auditLog.create({
			data: {
				userId: input.userId,
				action: input.action,
				entityType: input.entityType,
				entityId: input.entityId,
				ipAddress: input.ipAddress ?? null,
			},
		})
	} catch (error) {
		console.error('Не удалось записать событие аудита:', error)
	}
}

/** Import events are separate from the audit trail because a scanner has no user. */
export async function writeImportEvent(input: {
	inboxItemId?: string | null
	fileName: string
	event: 'SCANNED' | 'AUTO_IMPORTED' | 'AUTO_IMPORT_FAILED' | 'MANUAL_IMPORTED' | 'CONTRACT_CREATED' | 'IGNORED' | 'RETRY'
	outcome: 'QUEUED' | 'SUCCESS' | 'FAILED' | 'IGNORED'
	message?: string | null
	contractId?: string | null
	actorId?: string | null
}) {
	try {
		await prisma.importEvent.create({ data: input })
	} catch (error) {
		console.error('Не удалось записать событие импорта:', error)
	}
}
