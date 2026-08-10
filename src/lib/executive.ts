import type { ContractKind } from '@prisma/client'

export const EXEC_TEMPLATES: Record<ContractKind, string[]> = {
	SMR: ['Паспорт на конструкцию', 'Акты скрытых работ', 'Общий журнал работ', 'Исполнительные схемы', 'Сертификаты на материалы', 'Акт приёмки выполненных работ'],
	MK: ['Паспорт на конструкцию', 'Сертификаты на материалы'],
	PROJECT: [],
}

export const CONTRACT_KIND_LABEL: Record<ContractKind, string> = {
	SMR: 'СМР — исполнительная документация и паспорт',
	MK: 'МК — паспорт без комплекта СМР',
	PROJECT: 'Проектный — ИД не требуется',
}
