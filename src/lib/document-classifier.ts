import type { DocumentKind, DocumentState, SectionCode, SourceDataKind } from '@prisma/client'

/**
 * Изоморфный модуль (задача B2): классификация работает по строке —
 * имени файла и пути — поэтому её можно посчитать и в браузере, чтобы
 * показать предполагаемый вид ещё до отправки (SmartDocumentUpload).
 * Раньше basename/extname брались из node:path, из-за чего модуль нельзя
 * было импортировать в клиентский компонент. Ниже — свои чистые аналоги
 * с тем же поведением (path.extname('.gitignore') === '' и т.п.), без
 * какой-либо серверной зависимости.
 */

function basenameOf(filePath: string): string {
	const normalized = filePath.replace(/\\/g, '/')
	const idx = normalized.lastIndexOf('/')
	return idx === -1 ? normalized : normalized.slice(idx + 1)
}

function extnameOf(filePath: string): string {
	const base = basenameOf(filePath)
	const dot = base.lastIndexOf('.')
	// dot <= 0: точки нет вообще, либо это скрытый файл вида ".gitignore" —
	// в обоих случаях node:path.extname тоже вернул бы пустую строку.
	return dot <= 0 ? '' : base.slice(dot)
}

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

/** Unicode-aware token match. JavaScript's \b only treats ASCII as word characters. */
export function hasToken(value: string, pattern: string | string[]) {
	const source = Array.isArray(pattern) ? pattern.join('|') : pattern
	return new RegExp(`(^|[^\\p{L}\\p{N}])(?:${source})(?=$|[^\\p{L}\\p{N}])`, 'iu').test(value)
}

/** Files created by Office/desktop systems that are never real documents. */
export function isTransientSystemFile(filePath: string) {
	const fileName = basenameOf(filePath)
	return /^~\$/.test(fileName) || /^\.~lock\..+#$/i.test(fileName) || ['thumbs.db', 'desktop.ini', '.ds_store'].includes(fileName.toLowerCase())
}

/** Определяет раздел проекта по русской или латинской метке в имени/папке. */
export function detectProjectSectionCode(filePath: string): SectionCode | null {
	const value = normalizeDocumentPath(filePath)
	if (hasToken(value, ['кж', 'kzh', 'kj'])) return 'KZH'
	if (hasToken(value, ['км', 'km'])) return 'KM'
	if (hasToken(value, ['ар', 'ar'])) return 'AR'
	return null
}

/** Подтип исходных данных; первое совпадение по подтверждённому приоритету побеждает. */
export function detectSourceDataSubtype(filePath: string): SourceDataKind | null {
	const value = normalizeDocumentPath(filePath)
	if (hasToken(value, 'иги') || /инженерн(?:о|ые)[ -]?геолог/u.test(value)) return 'IGI'
	if (hasToken(value, 'гпзу') || /градостроительн/u.test(value)) return 'GPZU'
	if (/геоподоснов|геодезическ/u.test(value) || hasToken(value, 'основа')) return 'GEOBASE'
	if (/топос[ъь]ем|топограф/u.test(value)) return 'TOPO'
	if (/стеснен|ограничен.*площадк/u.test(value)) return 'CONSTRAINTS'
	return null
}

/** Предсказуемая классификация для веб-импорта, обычной загрузки и Inbox-сканера. */
export function classifyDocumentPath(filePath: string): DocumentKind {
	const lower = normalizeDocumentPath(filePath)
	const ext = extnameOf(lower)
	if (hasToken(lower, ['иги', 'гпзу']) || /(?:инженерн(?:о|ые)[ -]?геолог|градостроительн|топос[ъь]ем|топограф|геоподоснов|геодезическ(?:ая|ий)?\s+основ|стеснен|исходн(?:ые)?[ -]?данн)/u.test(lower)) return 'SOURCE_DATA'
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
