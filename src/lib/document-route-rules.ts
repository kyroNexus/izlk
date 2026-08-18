import type { DocumentKind, SourceDataKind } from '@prisma/client'
import { classifyDocumentPath, detectSourceDataSubtype } from './document-classifier'

export const DOCUMENT_RULE_TARGETS = [
	'INVOICE', 'AGREEMENT', 'ESTIMATE_TO_AGREEMENT', 'APPENDIX_TO_AGREEMENT', 'PR1_SIGNED',
	'SOURCE_DATA:IGI', 'SOURCE_DATA:GPZU', 'SOURCE_DATA:GEOBASE', 'SOURCE_DATA:TOPO', 'SOURCE_DATA:CONSTRAINTS',
	'PROJECT:KZH', 'PROJECT:KM', 'PROJECT:AR', 'PROJECT:CIPHER',
] as const

export type DocumentRuleTarget = typeof DOCUMENT_RULE_TARGETS[number]
export type DocumentRouteRuleInput = { id: string; target: string; pattern: string; enabled: boolean; sortOrder: number; note: string | null }

export const DEFAULT_DOCUMENT_ROUTE_RULES: DocumentRouteRuleInput[] = [
	{ id: 'default-invoice', target: 'INVOICE', pattern: 'сч[её]т\\s+на\\s+оплату\\s*№?\\s*(\\d{1,6})\\s*от\\s*(\\d{1,2}[.\\/-]\\d{1,2}[.\\/-]\\d{2,4})', enabled: true, sortOrder: 10, note: 'Счёт на оплату: номер и дата' },
	{ id: 'default-agreement', target: 'AGREEMENT', pattern: 'доп\\.?\\s*соглашени\\p{L}*\\s*№\\s*(\\d{1,3})\\s*к\\s*(\\d{2,5}[-_][A-ZА-ЯЁ0-9._\\/-]{2,60})', enabled: true, sortOrder: 20, note: 'Дополнительное соглашение и номер договора' },
	{ id: 'default-estimate-ds', target: 'ESTIMATE_TO_AGREEMENT', pattern: 'смета.*к\\s*дс\\s*№\\s*(\\d{1,3})', enabled: true, sortOrder: 30, note: 'Смета к дополнительному соглашению' },
	{ id: 'default-appendix-ds', target: 'APPENDIX_TO_AGREEMENT', pattern: 'график.*к\\s*дс\\s*№\\s*(\\d{1,3})', enabled: true, sortOrder: 40, note: 'График или приложение к дополнительному соглашению' },
	{ id: 'default-pr1', target: 'PR1_SIGNED', pattern: 'подписано.*\\d{1,2}[.\\/-]\\d{1,2}[.\\/-]\\d{2,4}.*(?:пр\\.?\\s*№?\\s*1|приложение\\s*№\\s*1)', enabled: true, sortOrder: 50, note: 'Подписанное Приложение №1 с датой' },
	{ id: 'default-source-igi', target: 'SOURCE_DATA:IGI', pattern: '(^|[^\\p{L}\\p{N}])иги(?=$|[^\\p{L}\\p{N}])|инженерн(?:о|ые)[ -]?геолог', enabled: true, sortOrder: 60, note: 'Инженерно-геологические изыскания' },
	{ id: 'default-source-gpzu', target: 'SOURCE_DATA:GPZU', pattern: '(^|[^\\p{L}\\p{N}])гпзу(?=$|[^\\p{L}\\p{N}])|градостроительн', enabled: true, sortOrder: 70, note: 'Градостроительный план земельного участка' },
	{ id: 'default-source-geobase', target: 'SOURCE_DATA:GEOBASE', pattern: 'геоподоснов|геодезическ|(^|[^\\p{L}\\p{N}])основа(?=$|[^\\p{L}\\p{N}])', enabled: true, sortOrder: 80, note: 'Геоподоснова; приоритетнее топосъёмки' },
	{ id: 'default-source-topo', target: 'SOURCE_DATA:TOPO', pattern: 'топос[ъь]ем|топограф', enabled: true, sortOrder: 90, note: 'Топографическая съёмка' },
	{ id: 'default-source-constraints', target: 'SOURCE_DATA:CONSTRAINTS', pattern: 'стеснен|ограничен.*площадк', enabled: true, sortOrder: 100, note: 'Стеснённые условия и ограничения площадки' },
	{ id: 'default-project-kzh', target: 'PROJECT:KZH', pattern: '(^|[^\\p{L}\\p{N}])(?:кж|kzh|kj)(?=$|[^\\p{L}\\p{N}])', enabled: true, sortOrder: 110, note: 'Проектный раздел КЖ' },
	{ id: 'default-project-km', target: 'PROJECT:KM', pattern: '(^|[^\\p{L}\\p{N}])(?:км|km)(?=$|[^\\p{L}\\p{N}])', enabled: true, sortOrder: 120, note: 'Проектный раздел КМ' },
	{ id: 'default-project-ar', target: 'PROJECT:AR', pattern: '(^|[^\\p{L}\\p{N}])(?:ар|ar)(?=$|[^\\p{L}\\p{N}])', enabled: true, sortOrder: 130, note: 'Проектный раздел АР' },
	{ id: 'default-project-cipher', target: 'PROJECT:CIPHER', pattern: 'кб-\\d+(?:\\.\\d+){3,}', enabled: true, sortOrder: 140, note: 'Шифр проекта — приоритетный ключ договора' },
]

export function assertDocumentRulePattern(pattern: string) {
	if (!pattern.trim() || pattern.length > 1000) throw new Error('Шаблон должен содержать от 1 до 1000 символов')
	try { new RegExp(pattern, 'iu') } catch { throw new Error('Некорректное регулярное выражение') }
}

function kindForTarget(target: string, fileName: string): DocumentKind | null {
	if (target === 'INVOICE') return 'INVOICE'
	if (target === 'AGREEMENT') return 'AGREEMENT'
	if (target === 'ESTIMATE_TO_AGREEMENT') return 'ESTIMATE'
	if (target === 'APPENDIX_TO_AGREEMENT' || target === 'PR1_SIGNED') return 'APPENDIX'
	if (target.startsWith('SOURCE_DATA:')) return 'SOURCE_DATA'
	if (target.startsWith('PROJECT:')) return /\.(?:dwg|dxf)$/iu.test(fileName) ? 'PROJECT_DWG' : 'PROJECT_PDF'
	return null
}

export function testDocumentRoute(fileName: string, rules: DocumentRouteRuleInput[]) {
	const matchedRule = rules.filter((rule) => rule.enabled).sort((a, b) => a.sortOrder - b.sortOrder).find((rule) => {
		try { return new RegExp(rule.pattern, 'iu').test(fileName) } catch { return false }
	}) ?? null
	const target = matchedRule?.target ?? null
	const sourceDataKind = target?.startsWith('SOURCE_DATA:') ? target.slice('SOURCE_DATA:'.length) as SourceDataKind : detectSourceDataSubtype(fileName)
	const agreementNumber = target === 'AGREEMENT'
		? fileName.match(/доп\.?\s*соглашени\p{L}*\s*№\s*(\d{1,3})/iu)?.[1] ?? null
		: fileName.match(/к\s*дс\s*№\s*(\d{1,3})/iu)?.[1] ?? null
	return { kind: (target ? kindForTarget(target, fileName) : null) ?? classifyDocumentPath(fileName), sourceDataKind, agreementNumber, matchedRule }
}
