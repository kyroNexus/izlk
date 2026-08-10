import path from 'path'
import type { DocumentKind, DocumentState, SectionCode } from '@prisma/client'

/**
 * Нормализуем и имя файла, и относительный путь. Папки часто содержат
 * единственную подсказку: `КМ/чертежи/лист-01.dxf`.
 */
export function normalizeDocumentPath(filePath: string) {
	return filePath
		.normalize('NFKC')
		.toLocaleLowerCase('ru-RU')
		.replace(/ё/g, 'е')
		.replace(/[\\/]+/g, ' ')
}

/** Files created by Office/desktop systems that are never real documents. */
export function isTransientSystemFile(filePath: string) {
	const fileName = path.basename(filePath.replace(/\\/g, '/'))
	return /^~\$/.test(fileName) || /^\.~lock\..+#$/i.test(fileName) || ['thumbs.db', 'desktop.ini', '.ds_store'].includes(fileName.toLowerCase())
}

/** Определяет раздел проекта по русской или латинской метке в имени/папке. */
export function detectProjectSectionCode(filePath: string): SectionCode | null {
	const value = normalizeDocumentPath(filePath)
	const hasToken = (tokens: string[]) => new RegExp(`(^|[^\\p{L}\\p{N}])(?:${tokens.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu').test(value)
	if (hasToken(['кж', 'kzh', 'kj'])) return 'KZH'
	if (hasToken(['км', 'km'])) return 'KM'
	if (hasToken(['ар', 'ar'])) return 'AR'
	return null
}

/** Предсказуемая классификация для веб-импорта и Inbox-сканера. */
export function classifyDocumentPath(filePath: string): DocumentKind {
	const lower = normalizeDocumentPath(filePath)
	const ext = path.extname(lower)
	if (/(?:\bиги\b|инженерн(?:о|ые)[ -]?геолог|\bгпзу\b|градостроительн|топос[ъь]ем|топограф|стеснен|исходн(?:ые)?[ -]?данн)/u.test(lower)) return 'SOURCE_DATA'
	if (/(смет|локальн.*расч[ее]т)/u.test(lower)) return 'ESTIMATE'
	if (/(доп\.?\s*соглаш|дс\s*[№_\d])/u.test(lower)) return 'AGREEMENT'
	if (/(счет|счёт)(?!.*схем)/u.test(lower)) return 'INVOICE'
	if (/(коммерческ|(^|[\\/_ -])кп([\\/_ .-]|$))/u.test(lower)) return 'COMMERCIAL_PROPOSAL'
	if (/(сертификат|паспорт.*материал|качеств)/u.test(lower)) return 'CERTIFICATE'
	if (/(акт.*скрыт|аоср|акт.*при[ее]м)/u.test(lower)) return 'ACT'
	if (/(исполнит|ожр|журнал работ|схем)/u.test(lower)) return 'EXECUTIVE'
	if (detectProjectSectionCode(lower) || /проект|черт[ее]ж/u.test(lower)) return ext === '.dwg' || ext === '.dxf' ? 'PROJECT_DWG' : 'PROJECT_PDF'
	if (/(договор|контракт)/u.test(lower)) return 'CONTRACT'
	if (/(подпис|скан|эдо)/u.test(lower)) return 'SIGNED_SCAN'
	return ext === '.dwg' || ext === '.dxf' ? 'PROJECT_DWG' : 'OTHER'
}

export function documentStateForPath(filePath: string): DocumentState {
	return /(подпис|скан|эдо)/iu.test(normalizeDocumentPath(filePath)) ? 'SIGNED' : 'SOURCE'
}
