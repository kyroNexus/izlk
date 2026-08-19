import type { DocumentKind, DocumentState, SectionCode, SourceDataKind } from '@prisma/client'
import { classifyDocumentPath, detectProjectSectionCode, detectSourceDataSubtype, documentStateForPath } from './document-classifier'
import { testDocumentRoute, type DocumentRouteRuleInput } from './document-route-rules'

export type DocumentRoute = {
	kind: DocumentKind
	state: DocumentState
	sourceDataKind?: SourceDataKind
	agreementNumber?: string
	invoiceNumber?: string
	invoiceDate?: string
	pr1SignedAt?: string
	contractNumberFull?: string
	contractNumberShort?: string
	cipher?: string
	sectionCode?: SectionCode
}

export type RoutableContract = { id: string; number: string; cipher?: string | null; date: Date | string }

function fileStem(filePath: string) {
	const name = filePath.replace(/\\/g, '/').split('/').at(-1) ?? filePath
	return name.replace(/\.[^.]+$/u, '')
}

function extension(filePath: string) {
	return filePath.match(/\.([^.\\/]+)$/u)?.[1].toLocaleLowerCase('ru-RU') ?? ''
}

function isoDate(value: string | undefined) {
	if (!value) return undefined
	const [day, month, rawYear] = value.split(/[.\/-]/u).map(Number)
	const year = rawYear < 100 ? 2000 + rawYear : rawYear
	const date = new Date(Date.UTC(year, month - 1, day))
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
	return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function versionState(kind: DocumentKind, ext: string, fallback: DocumentState) {
	if (!['AGREEMENT', 'ESTIMATE', 'APPENDIX', 'PROJECT_PDF', 'PROJECT_DWG'].includes(kind)) return fallback
	if (ext === 'pdf') return 'SIGNED' as const
	if (['doc', 'docx', 'xls', 'xlsx', 'dwg', 'dxf'].includes(ext)) return 'SOURCE' as const
	return fallback
}

export function routeDocument(filePath: string, rules: DocumentRouteRuleInput[] = []): DocumentRoute {
	// NFKC turns the business-significant `№` into `No`; NFC preserves it.
	const value = filePath.normalize('NFC')
	const stem = fileStem(value)
	const ext = extension(value)
	const fullNumber = stem.match(/(\d{2,5}[-_][\p{L}\p{N}._/-]*?(?:19|20)\d{2})(?!\d)/iu)?.[1]
	const cipherMatch = stem.match(/кб[-–—]\s*\d+(?:\.\d+){2,}/iu)?.[0]
	const cipher = cipherMatch?.replace(/[–—]/gu, '-').replace(/\s+/gu, '').toLocaleUpperCase('ru-RU')
	let sourceDataKind = detectSourceDataSubtype(value) ?? undefined
	let sectionCode = detectProjectSectionCode(value) ?? undefined
	const invoice = stem.match(/сч[её]т\s+на\s+оплату\s*№?\s*(\d{1,6})\s*от\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/iu)
	const agreement = stem.match(/доп\.?\s*соглашени\p{L}*\s*№\s*(\d{1,3})\s*к\s*(\d{2,5}[-_][\p{L}\p{N}._/-]{2,60})\s*$/iu)
	const linkedAgreement = fullNumber && /№\s*\d{1,3}(?:\s*,\s*\d{1,3})*\s+.*(?:смета|график)/iu.test(stem)
		? stem.match(/к\s*дс\s*№\s*(\d{1,3})(?!\d)/iu)?.[1]
		: undefined
	let agreementNumber = agreement?.[1] ?? linkedAgreement
	const pr1Token = stem.match(/(?:пр\s*\.?\s*№?\s*1|приложение\s*№?\s*1)(?!\d)/iu)
	const pr1Tail = pr1Token ? stem.slice((pr1Token.index ?? 0) + pr1Token[0].length) : ''
	const signedDate = stem.match(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/u)?.[0]
	const pr1ContractNumber = pr1Tail.replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/gu, ' ').match(/\(\s*(\d{2,5})\s*\)|(?:^|[^\d])(\d{2,5})(?!\d)/u)
	const isSignedPr1 = /подписано/iu.test(stem) && Boolean(signedDate && pr1Token && pr1ContractNumber)
	const shortNumber = fullNumber?.match(/^\d{2,5}/u)?.[0]
		?? pr1ContractNumber?.[1] ?? pr1ContractNumber?.[2]
		?? stem.match(/\(\s*(\d{2,5})\s*\)/u)?.[1]
		?? stem.match(/^(\d{2,5})(?!\d)/u)?.[1]

	let kind = classifyDocumentPath(value)
	if (sourceDataKind) kind = 'SOURCE_DATA'
	if (sectionCode) kind = ['dwg', 'dxf'].includes(ext) ? 'PROJECT_DWG' : 'PROJECT_PDF'
	if (invoice) kind = 'INVOICE'
	if (agreement) kind = 'AGREEMENT'
	if (linkedAgreement) kind = /смета/iu.test(stem) ? 'ESTIMATE' : 'APPENDIX'
	if (isSignedPr1) kind = 'APPENDIX'
	const configured = rules.length ? testDocumentRoute(value, rules) : null
	if (configured?.matchedRule) {
		kind = configured.kind
		sourceDataKind = configured.sourceDataKind ?? sourceDataKind
		agreementNumber = configured.agreementNumber ?? agreementNumber
		const configuredSection = configured.matchedRule.target.match(/^PROJECT:(KZH|KM|AR)$/u)?.[1] as SectionCode | undefined
		sectionCode = configuredSection ?? sectionCode
	}

	const route: DocumentRoute = {
		kind,
		state: isSignedPr1 ? 'SIGNED' : versionState(kind, ext, documentStateForPath(value)),
		...(sourceDataKind ? { sourceDataKind } : {}),
		...(agreementNumber ? { agreementNumber } : {}),
		...(invoice ? { invoiceNumber: invoice[1], invoiceDate: isoDate(invoice[2]) } : {}),
		...(isSignedPr1 ? { pr1SignedAt: isoDate(signedDate) } : {}),
		...(agreement?.[2] || fullNumber ? { contractNumberFull: agreement?.[2] ?? fullNumber } : {}),
		...(shortNumber ? { contractNumberShort: shortNumber } : {}),
		...(cipher ? { cipher } : {}),
		...(sectionCode ? { sectionCode } : {}),
	}
	return route
}

function same(left: string | null | undefined, right: string | null | undefined) {
	return Boolean(left && right && left.localeCompare(right, 'ru-RU', { sensitivity: 'accent' }) === 0)
}

function shortContractNumber(value: string) {
	return value.match(/^(\d{2,5})(?!\d)/u)?.[1]
}

export function matchDocumentContract(route: DocumentRoute, contracts: RoutableContract[]) {
	const contract = contracts.find((item) => same(item.cipher, route.cipher))
		?? contracts.find((item) => same(item.number, route.contractNumberFull))
		?? contracts.find((item) => shortContractNumber(item.number) === route.contractNumberShort)
		?? null
	if (!contract) return { contract: null, warning: null }
	const fileYear = route.contractNumberFull?.match(/(?:19|20)\d{2}(?!\d)/u)?.[0]
	const contractYear = new Date(contract.date).getUTCFullYear()
	const warning = fileYear && Math.abs(Number(fileYear) - contractYear) > 1
		? `Год ${fileYear} в имени файла расходится с датой договора № ${contract.number}`
		: null
	return { contract, warning }
}
