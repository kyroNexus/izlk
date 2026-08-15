import type { Prisma, SiteStatus } from '@prisma/client'

/**
 * Единственный источник формы include для карточки договора — и сам запрос
 * в page.tsx, и тип ниже берут её отсюда, поэтому расхождение между тем,
 * что реально запрошено, и тем, что ожидают вкладки, невозможно в принципе.
 */
export const CONTRACT_INCLUDE = {
	contractor: true,
	manager: { select: { name: true } },
	estimates: { where: { deletedAt: null }, orderBy: { date: 'asc' } },
	agreements: { where: { deletedAt: null }, orderBy: { date: 'asc' }, include: { estimates: { where: { deletedAt: null } } } },
	invoices: { where: { deletedAt: null }, orderBy: { date: 'asc' } },
	documents: { where: { deletedAt: null }, orderBy: { signedAt: 'desc' } },
	sites: { include: { events: { orderBy: { occurredAt: 'asc' } }, works: { select: { direction: true, crewCost: true, equipmentCost: true, materialCost: true, otherCost: true } } } },
	executiveDocs: { orderBy: { name: 'asc' } },
	projectSections: { orderBy: { code: 'asc' }, include: { responsible: { select: { name: true } }, documents: { where: { deletedAt: null, kind: { in: ['PROJECT_PDF', 'PROJECT_DWG'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, fileName: true, kind: true } } } },
	tasks: { where: { deletedAt: null, status: { notIn: ['DONE', 'CANCELLED'] } }, orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }], include: { assignee: { select: { name: true } } }, take: 5 },
	stageHistory: { orderBy: { createdAt: 'desc' }, include: { changedBy: { select: { name: true } } } },
} satisfies Prisma.ContractInclude

export type ContractWithRelations = Prisma.ContractGetPayload<{ include: typeof CONTRACT_INCLUDE }>

export type ContractAuditLog = Prisma.AuditLogGetPayload<{ include: { user: { select: { name: true } } } }>

export const PROJECT_SECTION_LABEL: Record<string, string> = {
	KM: 'КМ',
	AR: 'АР',
	KZH: 'КЖ',
	OTHER: 'Прочее',
}

export const SITE_STATUS: Record<SiteStatus, { label: string; tone: 'ok' | 'warn' | 'off' | 'danger' }> = {
	READY: { label: 'Готова', tone: 'ok' },
	PREPARING: { label: 'Подготовка', tone: 'off' },
	ISSUE: { label: 'Проблема', tone: 'warn' },
	BLOCKED: { label: 'Заблокирована', tone: 'danger' },
}

export const EVENT_DOT: Record<string, string> = {
	SUCCESS: 'bg-ok',
	WARNING: 'bg-warn',
	INFO: 'bg-brand',
}

/** Номер ДС часто уже содержит «ДС» или «№» — без этого выходило «ДС №ДС №1». */
export function agreementTitle(rawNumber: string): string {
	const raw = rawNumber.trim()
	if (/^ДС/i.test(raw)) return raw
	return raw.startsWith('№') ? `ДС ${raw}` : `ДС №${raw}`
}

export function estimateTitle(rawNumber: string): string {
	const raw = rawNumber.trim()
	if (/^Смета/i.test(raw)) return raw
	return raw.startsWith('№') ? `Смета ${raw}` : `Смета №${raw}`
}
