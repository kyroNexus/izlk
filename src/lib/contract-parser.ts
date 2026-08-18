import path from 'path'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import WordExtractor from 'word-extractor'

const execFile = promisify(execFileCallback)
const OCR_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg'])
const MAX_OCR_PAGES = 2
const OCR_TIMEOUT_MS = 25_000
// A folder can contain hundreds of scans. OCR is intentionally bounded to the
// most likely contract files so one web request cannot run for hours.
const MAX_FOLDER_OCR_CANDIDATES = 2

/** Bounded server-side OCR fallback for scans and PDFs without a text layer. */
async function extractOcrText(fileName: string, buffer: Buffer): Promise<{ text: string; warning?: string }> {
	const extension = path.extname(fileName).toLowerCase()
	if (!OCR_EXTENSIONS.has(extension)) return { text: '' }
	const workdir = await mkdtemp(path.join(tmpdir(), 'izlk-ocr-'))
	try {
		const input = path.join(workdir, `input${extension}`)
		await writeFile(input, buffer)
		let images = [input]
		if (extension === '.pdf') {
			const prefix = path.join(workdir, 'page')
			try {
				await execFile('pdftoppm', ['-png', '-r', '160', '-f', '1', '-l', String(MAX_OCR_PAGES), input, prefix], { timeout: OCR_TIMEOUT_MS, maxBuffer: 1024 * 1024 })
				images = (await readdir(workdir)).filter((name) => /^page-\d+\.png$/i.test(name)).sort().map((name) => path.join(workdir, name))
				if (!images.length) return { text: '', warning: 'OCR: страницы PDF не удалось преобразовать в изображения.' }
			} catch { return { text: '', warning: 'OCR недоступен: на сервере не найден конвертер PDF.' } }
		}
		const parts: string[] = []
		for (const image of images.slice(0, MAX_OCR_PAGES)) {
			try {
				const { stdout } = await execFile('tesseract', [image, 'stdout', '-l', 'rus+eng', '--psm', '6'], { timeout: OCR_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
				if (stdout.trim()) parts.push(stdout.trim())
			} catch { return { text: parts.join('\n'), warning: 'OCR недоступен: не установлен русский язык Tesseract.' } }
		}
		return { text: parts.join('\n\n') }
	} finally {
		await rm(workdir, { recursive: true, force: true }).catch(() => undefined)
	}
}

export type OcrHealthResult = { ok: boolean; issues: string[] }

/**
 * Задача D3: extractOcrText() выше уже возвращает предупреждение, когда
 * pdftoppm/tesseract недоступны — но оно всплывает только реактивно, на
 * конкретном скане, и легко теряется среди обычных сообщений импорта. Это —
 * проактивная самопроверка без реального распознавания: спрашивает версии
 * обоих бинарников и список языков tesseract. Дешевле, чем гонять OCR
 * реальной картинки, но ловит ровно те поломки, что случаются на практике —
 * бинарник пропал при пересборке контейнера, языковой пакет rus не
 * установлен — теми же формулировками, что уже использует extractOcrText.
 */
export async function checkOcrHealth(): Promise<OcrHealthResult> {
	const issues: string[] = []
	try {
		await execFile('pdftoppm', ['-v'], { timeout: 5000 })
	} catch {
		issues.push('Не найден конвертер PDF (pdftoppm) — сканы в PDF не распознаются.')
	}
	try {
		const { stdout, stderr } = await execFile('tesseract', ['--list-langs'], { timeout: 5000 })
		if (!/\brus\b/.test(`${stdout}\n${stderr}`)) issues.push('В Tesseract не установлен русский язык (rus) — русские сканы не распознаются.')
	} catch {
		issues.push('Не найден Tesseract OCR — сканы не распознаются вовсе.')
	}
	return { ok: issues.length === 0, issues }
}

/** Formats from which the server can extract actual text without desktop Office. */
export const PARSABLE_EXTENSIONS = ['.doc', '.docx', '.xlsx', '.xls', '.pdf', '.txt', '.csv', '.png', '.jpg', '.jpeg'] as const
export const MAX_PARSE_BYTES = 25 * 1024 * 1024
/** One web folder import: suited to a real contract archive, but still bounded for server stability. */
export const MAX_FOLDER_FILES = 1000
export const MAX_FOLDER_TOTAL_BYTES = 750 * 1024 * 1024
// Folder import only needs to identify its primary contract. The remaining
// files are still classified and attached on save, without wasting minutes on
// text/OCR extraction for every estimate, drawing and photo.
const MAX_FOLDER_TEXT_CANDIDATES = 32

function isTransientSystemFile(filePath: string) {
	const fileName = path.basename(filePath.replace(/\\/g, '/'))
	return /^~\$/.test(fileName) || /^\.~lock\..+#$/i.test(fileName) || ['thumbs.db', 'desktop.ini', '.ds_store'].includes(fileName.toLowerCase())
}

export type ParsedContract = {
	fileName: string
	contractNumber: string
	contractDate: string
	amount: string
	currency: 'RUB' | 'USD' | 'EUR' | 'CNY'
	contractorName: string
	/** '' — не удалось определить, форма подставит дефолт LEGAL и даст поправить вручную. */
	contractorType: 'LEGAL' | 'INDIVIDUAL' | ''
	inn: string
	ogrn: string
	phone?: string
	email?: string
	cipher: string
	objectAddress: string
	/** Из актуальной сметы (см. parseEstimateWorkbook ниже): "ФБР-1600" и т.п.
	 *  Пусто, если в смете нет позиции фундамента или её не нашли. */
	foundationType: string
	/** true — в смете вместо фундамента позиция "Устройство химических
	 *  анкеров": у заказчика уже есть своя плита, ИЗЛК фундамент не делает. */
	customerOwnSlab: boolean
	/** Реквизиты физ. лица — заказчика. Ищутся только когда сам заказчик
	 *  назван формулой "Гражданин РФ" (contractorType === 'INDIVIDUAL');
	 *  для юр. лиц всегда пустые. */
	snils: string
	passportSeries: string
	passportNumber: string
	passportIssuedBy: string
	passportIssuedAt: string
	passportDeptCode: string
	/** Представитель по доверенности — отдельный человек, не сам заказчик.
	 *  Заполняется, только если в клаузуле заказчика после его формулы
	 *  "Гражданин РФ ..." встречается упоминание доверенности. Реквизиты
	 *  ищутся в тексте ПОСЛЕ этого упоминания — не тем же способом, что и
	 *  реквизиты заказчика (та же логика, что уже отделяет Заказчика от
	 *  Подрядчика по позиции в тексте, а не пытается угадывать регэкспом,
	 *  чей это паспорт: спутать паспортные данные двух разных людей —
	 *  испорченные юридически значимые данные, не опечатка). */
	representativeName: string
	representativeSnils: string
	representativePassportSeries: string
	representativePassportNumber: string
	representativePassportIssuedBy: string
	representativePassportIssuedAt: string
	representativePassportDeptCode: string
	representativeProxyNumber: string
	representativeProxyDate: string
	confidence: number
	foundFields: string[]
	warnings: string[]
	preview: string
}

export type FolderParseFile = { fileName: string; relativePath?: string; buffer: Buffer }
export type FolderParseReport = {
	totalFiles: number
	parsedFiles: number
	textCandidates: number
	primaryFile: string
	categories: Array<{ key: string; label: string; count: number; files: string[] }>
	skippedFiles: Array<{ fileName: string; reason: string }>
	warnings: string[]
}

export type FolderParseResult = { parsed: ParsedContract; folder: FolderParseReport }

const RUSSIAN_MONTHS: Record<string, string> = {
	января: '01', февраля: '02', марта: '03', апреля: '04', мая: '05', июня: '06',
	июля: '07', августа: '08', сентября: '09', октября: '10', ноября: '11', декабря: '12',
}

const FOLDER_CATEGORIES = [
	{ key: 'source-data', label: 'Исходные данные заказчика', expression: /(?:\bиги\b|инженерн(?:о|ые)[ -]?геолог|\bгпзу\b|градостроительн|топос[ъь]ем|топограф|геоподоснов|геодезическ(?:ая|ий)?\s+основ|стеснен|исходн(?:ые)?[ -]?данн)/i },
	{ key: 'estimate', label: 'Сметы и расчёты', expression: /смет|расч[её]т|калькуляц/i },
	{ key: 'project', label: 'Проектирование', expression: /(?:^|[^а-яё])кж(?:[^а-яё]|$)|(?:^|[^а-яё])км(?:[^а-яё]|$)|(?:^|[^а-яё])ар(?:[^а-яё]|$)|dwg|проект|черт[её]ж/i },
	{ key: 'executive', label: 'Исполнительная документация', expression: /исполн|аоср|акт|сертификат|ожр|паспорт|схем/i },
	{ key: 'photo', label: 'Фотоотчёт', expression: /\.(?:jpg|jpeg|png|heic)$/i },
	{ key: 'contract', label: 'Договор и приложения', expression: /договор|контракт|приложен(?:ие|ия)|дс\s*№|дополн?ительн/i },
]

function compact(value: string) {
	return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function cleanField(value: string) {
	return compact(value).replace(/[;,.:]+$/, '').replace(/\s{2,}/g, ' ').trim()
}

function firstMatch(text: string, patterns: RegExp[]) {
	for (const pattern of patterns) {
		const value = text.match(pattern)?.[1]
		if (value) return cleanField(value)
	}
	return ''
}

function isoDate(value: string) {
	const numeric = value.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/)
	if (numeric) {
		const year = numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]
		return `${year}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`
	}
	const verbal = value.toLocaleLowerCase('ru-RU').match(/(\d{1,2})\s*[»"]?\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})/i)
	return verbal ? `${verbal[3]}-${RUSSIAN_MONTHS[verbal[2].toLocaleLowerCase('ru-RU')]}-${verbal[1].padStart(2, '0')}` : ''
}

function normalizeAmount(value: string) {
	const parsed = Number(value.replace(/\u00a0/g, '').replace(/\s/g, '').replace(',', '.'))
	return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : ''
}

function numberFromFileName(fileName: string) {
	const base = path.basename(fileName, path.extname(fileName))
	const fullNumber = base.match(/\b(\d{2,5}[-_][A-ZА-ЯЁ][A-ZА-ЯЁ0-9._/-]*(?:[-_]\d{2,4}))\b/iu)?.[1]
	if (fullNumber) return fullNumber.replace(/_/g, '-')
	return base.match(/(?:договор|контракт)\s*(?:№|N)?\s*([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9._/-]{1,60})/iu)?.[1] ?? ''
}

function organizationName(value: string) {
	const cleaned = cleanField(value)
	if (/^общество с ограниченной ответственностью/i.test(cleaned)) return cleaned.replace(/^общество с ограниченной ответственностью/i, 'ООО')
	if (/^акционерное общество/i.test(cleaned)) return cleaned.replace(/^акционерное общество/i, 'АО')
	return cleaned
}

function plausibleContractorName(value: string) {
	const cleaned = organizationName(value)
	return /стоимост|изготовлен|монтаж|фундамент|настоящ(?:ий|его)s+договор|составляет/i.test(cleaned) ? '' : cleaned
}

/**
 * Физ. лицо в типовом договоре открывается формулой «Гражданин(ка) РФ Фамилия
 * Имя Отчество, ДД.ММ.ГГГГ года рождения ... СНИЛС ... паспорт ...» — иногда
 * действующее через представителя по доверенности (у представителя тоже
 * может быть указан свой паспорт, поэтому смотрим только на клаузулу ДО
 * первого упоминания «Заказчик», где называется сама сторона договора, а не
 * весь текст: иначе «ООО» из клаузулы Подрядчика ложно перевесило бы «Гражданин»
 * заказчика, стоящего раньше в тексте, и наоборот).
 * Юр. лицо — ООО/АО/ПАО/ЗАО или ИП, действующие на основании устава/свидетельства.
 * Если ни один маркер не найден — возвращаем null: пусть решает человек,
 * а не молчаливый дефолт на LEGAL, который до этой функции стоял всегда.
 */
export function detectContractorType(rawText: string): 'LEGAL' | 'INDIVIDUAL' | null {
	const text = rawText.replace(/\s+/g, ' ')
	const labelIndex = text.search(/заказчик/iu)
	const clause = labelIndex === -1 ? text.slice(0, 1200) : text.slice(0, labelIndex + 20)
	// \b не годится для кириллицы (в JS "словом" для \b считаются только
	// [A-Za-z0-9_]) — та же граница явными не-буквенными символами по краям,
	// что и в detectProjectSectionCode выше, а не \b.
	const hasToken = (pattern: string) => new RegExp(`(^|[^\\p{L}\\p{N}])(?:${pattern})(?=$|[^\\p{L}\\p{N}])`, 'iu').test(clause)
	if (hasToken('гражданин(?:ин|ка)?\\s+(?:рф|российской\\s+федерации)') || hasToken('снилс')) return 'INDIVIDUAL'
	if (hasToken('ооо|ао|пао|зао|общество\\s+с\\s+ограниченной\\s+ответственностью|акционерное\\s+общество|индивидуальн[\\p{L}]*\\s+предпринимател[\\p{L}]*|ип')) return 'LEGAL'
	return null
}

type PersonIdentity = { snils: string; passportSeries: string; passportNumber: string; passportIssuedBy: string; passportIssuedAt: string; passportDeptCode: string }
const BLANK_IDENTITY: PersonIdentity = { snils: '', passportSeries: '', passportNumber: '', passportIssuedBy: '', passportIssuedAt: '', passportDeptCode: '' }

/**
 * СНИЛС и паспорт по формуле «... паспорт серия SSSS № NNNNNN, выдан ...,
 * ДД.ММ.ГГГГ, код подразделения NNN-NNN ..., СНИЛС NNN-NNN-NNN NN». Ищет
 * только внутри переданного фрагмента текста — вызывающий код сам решает,
 * какой это фрагмент (сам заказчик или его представитель по доверенности),
 * а не пытается угадать регэкспом, чей это паспорт, когда в тексте названы
 * два разных человека.
 */
function extractPersonIdentity(segment: string): PersonIdentity {
	const passportMatch = segment.match(/паспорт\s*(?:серия)?\s*[:№]?\s*(\d{2}\s?\d{2})\s*(?:№|номер)?\s*(\d{6})/iu)
	const deptCodeRaw = firstMatch(segment, [/код\s+подразделения\s*[:№]?\s*(\d{3}[-\s]?\d{3})/iu])
	return {
		snils: firstMatch(segment, [/снилс\s*[:№]?\s*(\d{3}[-\s]?\d{3}[-\s]?\d{3}[-\s]?\d{2})/iu]).replace(/\s+/g, ' '),
		passportSeries: passportMatch?.[1] ? cleanField(passportMatch[1]).replace(/\s+/g, ' ') : '',
		passportNumber: passportMatch?.[2] ?? '',
		passportIssuedBy: firstMatch(segment, [/выдан[а-яё]*\s+([^\n,;]{5,150}?)(?=\s*(?:\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}|,|;|код\s+подразделения|$))/iu]),
		passportIssuedAt: isoDate(firstMatch(segment, [/выдан[а-яё]*[^\n]{0,150}?(\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4})/iu])),
		passportDeptCode: deptCodeRaw.replace(/\s+/g, ''),
	}
}

// ИЗЛК Рус — собственные реквизиты подрядчика (ЕГРЮЛ). Если авторазбор по
// ошибке зацепит именно эти значения в поле ЗАКАЗЧИКА (перепутал блок
// реквизитов сторон в конце договора, либо считал не тот угол сметы), это
// хуже пустого поля — заметить такую подмену сложнее, чем отсутствие данных.
// Список — по жалобе пользователя, значения официальные (ЕГРЮЛ ИЗЛК Рус).
const IZLK_OWN_INN = '9725024975'
const IZLK_OWN_OGRN = '1197746687731'
const IZLK_OWN_ADDRESS_MARKERS = [/117461/, /черёмушки|черемушки/iu, /каховк/iu, /дом\s*20\s*а\b/iu, /помещ\.?\s*10\/4/iu]

/** Два и более совпадения — уже точно наш адрес, не просто "Москва" у заказчика. */
function isIzlkOwnAddress(value: string) {
	return IZLK_OWN_ADDRESS_MARKERS.filter((marker) => marker.test(value)).length >= 2
}

function categorize(fileName: string, relativePath?: string) {
	const searchable = `${relativePath ?? ''} ${fileName}`.toLocaleLowerCase('ru-RU')
	return FOLDER_CATEGORIES.find((category) => category.expression.test(searchable)) ?? { key: 'other', label: 'Прочие файлы', expression: /./ }
}

function candidateScore(file: FolderParseFile, parsed: ParsedContract) {
	const name = `${file.relativePath ?? ''} ${file.fileName}`.toLocaleLowerCase('ru-RU')
	let score = parsed.confidence * 4
	if (/договор|контракт/.test(name)) score += 120
	if (/смет|приложен|сертификат|акт|паспорт|кж|км|ар/.test(name)) score -= 35
	if (parsed.contractNumber) score += 40
	if (parsed.contractDate) score += 25
	if (parsed.amount) score += 25
	if (parsed.contractorName || parsed.inn) score += 20
	return score
}

/** Prioritises likely contracts before estimates and auxiliary files. */
function textCandidatePriority(file: FolderParseFile) {
	const name = `${file.relativePath ?? ''} ${file.fileName}`.toLocaleLowerCase('ru-RU')
	let score = 0
	if (/договор|контракт/.test(name)) score += 100
	if (/^\d{1,3}[ _.-]/.test(path.basename(file.fileName))) score += 10
	if (/смет|приложен|сертификат|акт|паспорт|кж|км|ар/.test(name)) score -= 20
	return score
}

export async function extractDocumentText(fileName: string, buffer: Buffer) {
	if (buffer.length > MAX_PARSE_BYTES) throw new Error('Файл больше 25 МБ: для авторазбора выберите меньший файл или загрузите его без парсинга.')
	const ext = path.extname(fileName).toLowerCase()
	if (!(PARSABLE_EXTENSIONS as readonly string[]).includes(ext)) throw new Error('Авторазбор поддерживает DOC, DOCX, XLSX, XLS, PDF, TXT, CSV и сканы JPG/PNG.')
	if (ext === '.doc') {
		const extractor = new WordExtractor()
		const document = await extractor.extract(buffer)
		return [document.getBody(), document.getHeaders(), document.getFootnotes(), document.getEndnotes()].filter(Boolean).join('\n')
	}
	if (ext === '.docx') return (await mammoth.extractRawText({ buffer })).value
	if (ext === '.xlsx' || ext === '.xls') {
		const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
		return workbook.SheetNames.map((name) => `Лист: ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false })}`).join('\n\n')
	}
	if (ext === '.pdf') return (await pdfParse(buffer)).text
	if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') return ''
	return buffer.toString('utf8')
}

export function parseContractText(fileName: string, rawText: string): ParsedContract {
	const text = rawText.replace(/\r/g, '')
	const contractNumber = [
		firstMatch(text, [
		/(?:^|[^\p{L}\p{N}])(?:договор|контракт)(?:\s+подряда)?\s*(?:№|N|номер)\s*[:№]?\s*([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9._\/-]{1,60})/iu,
		]),
		firstMatch(text, [
		/(?:^|[^\p{L}\p{N}])(?:договор|контракт)(?:\s+подряда)?\s+([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9._\/-]{2,60})/iu,
		]),
		firstMatch(text, [
		/\b(\d{2,5}[-_][А-ЯЁA-Z]+[-_](?:МК|СМР|П)[-_]\d{4})\b/iu,
		]),
		numberFromFileName(fileName),
	].find((value) => value && !/^(вступает|заключ[её]н|является|считается|подписан)/i.test(value)) ?? ''
	const dateRaw = firstMatch(text, [
		/^[^\n]{0,120}?[«"]?\s*(\d{1,2}\s*[»"]?\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4})\s*(?:г\.|года)?/imu,
		/[«"]?\s*(\d{1,2}\s*[»"]?\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4})\s*(?:г\.|года)?/iu,
		/(?:договор|контракт)[\s\S]{0,180}?(?:^|\s)от\s*[«"]?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/imu,
		/(?:дата(?:\s+договора)?)\s*[:№]?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/iu,
	])
	const amountRaw = firstMatch(text, [
		/(?:общая\s+)?цена\s+договора[^\n]{0,160}?составляет\s*[:—-]?\s*([\d\s\u00a0]+(?:[,.]\d{1,2})?)/iu,
		/(?:общая\s+)?цена\s+договора\s*[:—-]\s*([\d\s\u00a0]+(?:[,.]\d{1,2})?)/iu,
		/(?:сумма)(?:\s+(?:настоящего\s+)?договора)?\s*(?:составляет|равна)?\s*[:—-]?\s*([\d\s\u00a0]+(?:[,.]\d{1,2})?)/iu,
		/(?:итого|всего)\s*[:—-]?\s*([\d\s\u00a0]+(?:[,.]\d{1,2})?)/iu,
	])
	// Найденный баг: реквизиты Подрядчика (ИЗЛК — его название, ИНН и т.п.)
	// стоят в конце почти любого договора, и ничем не отличаются по форме от
	// реквизитов Заказчика — "первый встреченный ООО/ИНН во всём тексте" в
	// части случаев тихо подставлял Заказчику данные ИЗЛК, а не наоборот.
	// Особенно заметно, когда у Заказчика (физ. лицо) вообще нет своего ИНН —
	// тогда единственный ИНН в документе оказывается заведомо чужим. Ищем
	// реквизиты Заказчика только до формального представления Подрядчика —
	// дальше начинается его собственная клаузула, включая блок реквизитов
	// в конце. Именно формального: искать любое слово "подрядчик" нельзя —
	// оно может встретиться в бытовой фразе вроде "работы выполняются
	// Подрядчиком по адресу..." задолго до реквизитов, и обрезать реальные
	// данные заказчика, которые в тексте ещё не закончились.
	const contractorClauseIndex = text.search(/именуем\S*[^\n]{0,60}«?подрядчик/iu)
	const textBeforeContractorParty = contractorClauseIndex === -1 ? text : text.slice(0, contractorClauseIndex)
	const customerParty = firstMatch(textBeforeContractorParty, [
		/((?:ООО|АО|ПАО|ИП|Общество\s+с\s+ограниченной\s+ответственностью|Акционерное\s+общество)\s+[«"][^»"\n]{2,110}[»"]?)[\s,]{0,80}(?:именуем\w*[^\n]{0,90})?[«"]?Заказчик/iu,
	])
	// Тоже в область до Подрядчика: на коротком документе окно в 800 символов
	// от слова "заказчик" может дотянуться до его реквизитов в конце текста
	// (на реальных многостраничных договорах это менее вероятно чисто из-за
	// объёма, но полагаться на длину документа как на защиту — не дело).
	const innNearCustomer = firstMatch(textBeforeContractorParty, [
		/(?:заказчик)[\s\S]{0,800}?ИНН\s*[:№]?\s*(\d{10}|\d{12})/iu,
	])
	let inn = innNearCustomer || firstMatch(textBeforeContractorParty, [/(?:^|\s)ИНН\s*[:№]?\s*(\d{10}|\d{12})(?=\s|$)/imu])
	// ОГРН — та же логика области поиска и та же защита от "своего" ОГРН
	// Подрядчика, что и у ИНН чуть выше.
	const ogrnNearCustomer = firstMatch(textBeforeContractorParty, [
		/(?:заказчик)[\s\S]{0,800}?ОГРН(?:ИП)?\s*[:№]?\s*(\d{13}|\d{15})/iu,
	])
	let ogrn = ogrnNearCustomer || firstMatch(textBeforeContractorParty, [/(?:^|\s)ОГРН(?:ИП)?\s*[:№]?\s*(\d{13}|\d{15})(?=\s|$)/imu])
	// Задача: даже если приведённая выше область поиска (до клаузулы Подрядчика)
	// почему-то не сработала — конкретные известные "свои" значения ИЗЛК всё
	// равно никогда не должны попасть в поле заказчика.
	const izlkGuardWarnings: string[] = []
	if (inn === IZLK_OWN_INN) { inn = ''; izlkGuardWarnings.push('Распознанный ИНН совпал с собственным ИНН ИЗЛК — вероятно, перепутан блок реквизитов сторон. Поле оставлено пустым, заполните вручную.') }
	if (ogrn === IZLK_OWN_OGRN) { ogrn = ''; izlkGuardWarnings.push('Распознанный ОГРН совпал с собственным ОГРН ИЗЛК — вероятно, перепутан блок реквизитов сторон. Поле оставлено пустым, заполните вручную.') }
	const cipher = firstMatch(text, [
		/((?:ИЗЛК\s*Рус\s*)?КБ[-–—]\s*\d+(?:\.\d+){2,})/iu,
		/(?:шифр(?:\s+объекта)?)\s*[:№]?\s*([^\n,;]{3,80})/iu,
	])
	// Физ. лицо называется по формуле «Гражданин(ка) РФ Фамилия Имя Отчество»,
	// а не ООО/заказчик-с-двоеточием — ни один из паттернов ниже его не ловит,
	// имя доставалось пустым. ФИО сразу после этой формулы, до запятой (дальше
	// в тексте — дата рождения) — это сама сторона договора, а не представитель
	// по доверенности (тот называется дальше, после «в лице»).
	const individualMatch = textBeforeContractorParty.match(/гражданин(?:ин|ка)?\s+(?:рф|российской\s+федерации)\s+([А-ЯЁ][а-яёА-ЯЁ-]+\s+[А-ЯЁ][а-яёА-ЯЁ-]+(?:\s+[А-ЯЁ][а-яёА-ЯЁ-]+)?)(?=\s*,)/iu)
	const individualCustomerName = individualMatch?.[1] ? cleanField(individualMatch[1]) : ''
	// Здесь же, а не только по строке "снилс"/"гражданин" из detectContractorType
	// выше: contractorType уже посчитан по всему документу, переиспользуем его,
	// а не гадаем заново.
	const contractorType = detectContractorType(text)
	// СНИЛС/паспорт — только когда сам заказчик назван формулой «Гражданин РФ»
	// (contractorType === INDIVIDUAL): для юр. лица «в лице генерального
	// директора ..., действующего на основании доверенности» — обычная и
	// безобидная формулировка, там нет второго человека с личным документом,
	// который можно с кем-то перепутать.
	let identity: PersonIdentity = BLANK_IDENTITY
	let representativeName = ''
	let representativeIdentity: PersonIdentity = BLANK_IDENTITY
	let representativeProxyNumber = ''
	let representativeProxyDate = ''
	if (contractorType === 'INDIVIDUAL') {
		const clause = textBeforeContractorParty.slice(individualMatch?.index ?? 0)
		// Представитель по доверенности называется дальше в этой же клаузуле,
		// после самого заказчика, по формуле «..., в лице ФИО, действующ...
		// на основании доверенности № ... от ДД.ММ.ГГГГ, паспорт ...». Делим
		// ИМЕННО по «в лице», а не по слову «доверенности»: паспорт
		// представителя в тексте обычно стоит ПЕРЕД словом «доверенности»
		// (сначала называют, кто действует, потом — на каком основании) —
		// раздели мы по «доверенности», паспорт представителя достался бы
		// заказчику. Реквизиты заказчика ищем ТОЛЬКО до «в лице», реквизиты
		// представителя — ТОЛЬКО после: та же логика, что уже отделяет
		// Заказчика от Подрядчика по позиции в тексте, а не пытается угадать
		// регэкспом, чей это паспорт — спутать паспортные данные двух разных
		// людей — испорченные юридически значимые данные, не опечатка.
		const proxyIndex = clause.search(/в\s+лице\s+(?:представител[яь]\s+)?[А-ЯЁ]/iu)
		const customerSegment = proxyIndex === -1 ? clause : clause.slice(0, proxyIndex)
		identity = extractPersonIdentity(customerSegment)
		if (proxyIndex !== -1) {
			const representativeSegment = clause.slice(proxyIndex)
			representativeIdentity = extractPersonIdentity(representativeSegment)
			representativeName = firstMatch(representativeSegment, [
				/в\s+лице\s+(?:представител[яь]\s+)?([А-ЯЁ][а-яёА-ЯЁ-]+\s+[А-ЯЁ][а-яёА-ЯЁ-]+(?:\s+[А-ЯЁ][а-яёА-ЯЁ-]+)?)/iu,
			])
			const proxyMatch = representativeSegment.match(/довереннос[а-яё]*\s*(?:№|N|номер)?\s*[:]?\s*([0-9A-ZА-ЯЁ][0-9A-ZА-ЯЁ .\/-]{0,40}?)\s*от\s*[«"]?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/iu)
			representativeProxyNumber = proxyMatch?.[1] ? cleanField(proxyMatch[1]) : ''
			representativeProxyDate = proxyMatch?.[2] ? isoDate(proxyMatch[2]) : ''
		}
	}
	const contractorName = [
		firstMatch(textBeforeContractorParty, [
		/(?:заказчик|покупатель|контрагент)\s*[:—-]\s*([^\n]{3,140})/iu,
		]),
		firstMatch(textBeforeContractorParty, [
		/((?:ООО|АО|ПАО|ИП)\s+[«"]?[^\n,»"]{2,100}[»"]?)/iu,
		]),
		customerParty,
		individualCustomerName,
	].map(plausibleContractorName).find(Boolean) ?? ''
	const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu)?.[0] ?? ''
	const phone = text.match(/(?:\+7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/u)?.[0]?.replace(/\s+/g, ' ').trim() ?? ''
	let objectAddress = firstMatch(text, [
		/(?:адрес\s+(?:объекта|строительства)|место\s+выполнения\s+работ|по\s+адресу)\s*[:—-]?\s*([^\n]{5,220})/iu,
	])
	if (objectAddress && isIzlkOwnAddress(objectAddress)) { objectAddress = ''; izlkGuardWarnings.push('Распознанный адрес объекта совпал с собственным адресом ИЗЛК — вероятно, перепутан блок реквизитов сторон. Поле оставлено пустым, заполните вручную.') }
	const currency: ParsedContract['currency'] = /(?:USD|доллар)/iu.test(text) ? 'USD' : /(?:EUR|евро)/iu.test(text) ? 'EUR' : /(?:CNY|юан)/iu.test(text) ? 'CNY' : 'RUB'
	// contractorType/identity/representative* не участвуют в values/confidence —
	// как и currency, это отдельные, не входящие в "обязательные поля" признаки:
	// раньше их не было вовсе, и менять формулу уверенности распознавания
	// заодно не стоит (проверяется точным числом в scripts/test-contract-parser.ts).
	const values = { contractNumber, contractDate: isoDate(dateRaw), amount: normalizeAmount(amountRaw), contractorName, inn, phone, email, cipher, objectAddress }
	const labels: Record<keyof typeof values, string> = { contractNumber: 'номер договора', contractDate: 'дата', amount: 'сумма', contractorName: 'контрагент', inn: 'ИНН', phone: 'телефон', email: 'email', cipher: 'шифр', objectAddress: 'адрес объекта' }
	const foundFields = (Object.keys(values) as (keyof typeof values)[]).filter((key) => values[key]).map((key) => labels[key])
	const essential = [values.contractNumber, values.contractDate, values.amount, values.contractorName || values.inn]
	const warnings: string[] = []
	if (!values.contractNumber) warnings.push('Не найден номер договора')
	if (!values.contractDate) warnings.push('Не найдена дата договора')
	if (!values.amount) warnings.push('Не найдена сумма договора')
	if (!values.contractorName && !values.inn) warnings.push('Не найден контрагент или ИНН')
	if (compact(text).length < 40) warnings.push('В файле почти нет текста: вероятно, это скан без текстового слоя. Его можно приложить, но реквизиты нужно заполнить вручную.')
	// СНИЛС/паспорт — юридически значимые данные: спутать их с чужими — не
	// опечатка, которую легко заметить. Автораспознанные значения всегда
	// просим перепроверить перед сохранением, а не подставляем молча.
	if (identity.snils || identity.passportNumber) warnings.push('СНИЛС/паспорт заказчика распознаны автоматически — сверьте с документом перед сохранением.')
	if (representativeName || representativeIdentity.snils || representativeIdentity.passportNumber) warnings.push('В договоре упомянут представитель по доверенности — сверьте его данные и саму доверенность перед сохранением.')
	warnings.push(...izlkGuardWarnings)
	const confidence = Math.min(100, Math.round((essential.filter(Boolean).length / essential.length) * 80 + (foundFields.length / Object.keys(values).length) * 20))
	return {
		fileName, ...values, ogrn, foundationType: '', customerOwnSlab: false, contractorType: contractorType ?? '', currency,
		...identity,
		representativeName,
		representativeSnils: representativeIdentity.snils,
		representativePassportSeries: representativeIdentity.passportSeries,
		representativePassportNumber: representativeIdentity.passportNumber,
		representativePassportIssuedBy: representativeIdentity.passportIssuedBy,
		representativePassportIssuedAt: representativeIdentity.passportIssuedAt,
		representativePassportDeptCode: representativeIdentity.passportDeptCode,
		representativeProxyNumber, representativeProxyDate,
		confidence, foundFields, warnings, preview: compact(text).slice(0, 1200),
	}
}

export async function parseContractFile(fileName: string, buffer: Buffer, allowOcr = true) {
	let extracted = ''
	let extractionWarning = ''
	try {
		extracted = await extractDocumentText(fileName, buffer)
	} catch (error) {
		if (!OCR_EXTENSIONS.has(path.extname(fileName).toLowerCase())) throw error
		// Broken or encrypted PDF text layers are common in scans with stamps.
		// Keep the document eligible for OCR instead of failing the whole import.
		extractionWarning = error instanceof Error
			? `Текстовый слой не прочитан (${error.message}); запускаю OCR.`
			: 'Текстовый слой не прочитан; запускаю OCR.'
	}
	const parsed = parseContractText(fileName, extracted)
	const warnings = extractionWarning ? [...parsed.warnings, extractionWarning] : parsed.warnings
	if (allowOcr && (parsed.preview.length < 80 || parsed.confidence < 55) && ['.pdf', '.png', '.jpg', '.jpeg'].includes(path.extname(fileName).toLowerCase())) {
		const ocr = await extractOcrText(fileName, buffer)
		if (ocr.text.trim().length >= 20) {
			const recognized = parseContractText(fileName, ocr.text)
			return { ...recognized, warnings: [...recognized.warnings, ...(extractionWarning ? [extractionWarning] : []), 'Реквизиты извлечены OCR из скана — проверьте их перед сохранением.'] }
		}
		if (ocr.warning) return { ...parsed, warnings: [...warnings, ocr.warning] }
	}
	return { ...parsed, warnings }
}

/** Номер ДС из первого сегмента относительного пути ("ДС №2/Смета.xlsx" → 2). */
function dsFolderNumber(relativePath: string): number | null {
	const first = relativePath.replace(/\\/g, '/').split('/')[0] ?? ''
	const match = first.match(/^ДС\s*№?\s*(\d+)/iu)
	return match ? Number(match[1]) : null
}

/**
 * Выбирает смету, из которой берём адрес/шифр/тип фундамента: если в корне
 * договора есть папки "ДС №1"/"ДС №2"/... — смета из папки с САМЫМ БОЛЬШИМ
 * номером (последняя редакция — данные могли измениться после исходного
 * договора). Без папок ДС — смета из корня, иначе первая попавшаяся.
 */
function selectEstimateFile(files: FolderParseFile[]): FolderParseFile | null {
	const candidates = files.filter((file) => /смет/iu.test(file.fileName) && ['.xlsx', '.xls'].includes(path.extname(file.fileName).toLowerCase()))
	if (!candidates.length) return null
	const withDs = candidates
		.map((file) => ({ file, ds: dsFolderNumber(file.relativePath ?? '') }))
		.filter((item): item is { file: FolderParseFile; ds: number } => item.ds !== null)
	if (withDs.length) return withDs.sort((a, b) => b.ds - a.ds)[0].file
	const root = candidates.find((file) => !(file.relativePath ?? '').replace(/\\/g, '/').includes('/'))
	return root ?? candidates[0]
}

export type EstimateExtract = {
	objectAddress: string
	foundationType: string
	customerOwnSlab: boolean
	cipher: string
	contractorName: string
	amount: string
	sourceFile: string
	warnings: string[]
}

/**
 * Структурный разбор сметы — в отличие от остального парсера, который читает
 * плоский CSV-текст всех листов сразу, здесь именно лист "Смета" и именно
 * по ячейкам: адрес объекта в реальных сметах стоит в ячейке вида
 * "Стройка: Московская обл., г.о Подольск, п.Поливаново, к.н. 50:27:...",
 * и брать его из общего текстового блока ненадёжнее, чем найти саму ячейку.
 */
export function parseEstimateWorkbook(fileName: string, buffer: Buffer): EstimateExtract {
	const blank: EstimateExtract = { objectAddress: '', foundationType: '', customerOwnSlab: false, cipher: '', contractorName: '', amount: '', sourceFile: fileName, warnings: [] }
	let workbook: XLSX.WorkBook
	try {
		workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
	} catch {
		return { ...blank, warnings: [`Смета «${fileName}» не открылась — структура не разобрана, реквизиты придётся заполнить вручную.`] }
	}
	const sheetName = workbook.SheetNames.find((name) => /^смета$/iu.test(name.trim())) ?? workbook.SheetNames.find((name) => /смет/iu.test(name)) ?? workbook.SheetNames[0]
	if (!sheetName) return { ...blank, warnings: [`В файле сметы «${fileName}» нет ни одного листа.`] }
	const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false })
	const cells = rows.flatMap((row) => row.map((cell) => String(cell ?? '').trim())).filter(Boolean)
	const warnings: string[] = []

	// "Стройка: <адрес>" — адрес объекта берём из этой же ячейки, отрезав метку.
	const siteCellIndex = cells.findIndex((cell) => /стройка\s*:/iu.test(cell))
	const objectAddress = siteCellIndex !== -1 ? cleanField(cells[siteCellIndex].replace(/^[\s\S]*?стройка\s*:\s*/iu, '')) : ''
	if (siteCellIndex === -1) warnings.push(`В листе «${sheetName}» не нашёл ячейку "Стройка:" — адрес объекта не распознан из сметы.`)
	if (objectAddress && isIzlkOwnAddress(objectAddress)) warnings.push('Адрес из ячейки "Стройка:" похож на собственный адрес ИЗЛК — проверьте вручную.')

	// Тип фундамента: заголовок "Изготовление и устройство фундамента", рядом —
	// "Ж/б фундамент Серия ФБР-1600.ИЗЛКРус...". Верстка сметы отличается между
	// шаблонами, поэтому ищем "Серия <код>.ИЗЛКРус" сперва в самой заголовочной
	// ячейке (перенос строки внутри одной ячейки), затем в нескольких соседних.
	const seriesPattern = /серия\s+([A-ZА-ЯЁ]{2,8}[-–—]\d{2,5})\s*\.\s*ИЗЛКРус/iu
	const foundationHeaderIndex = cells.findIndex((cell) => /изготовлен[а-яё]*\s+и\s+устройств[а-яё]*\s+фундамент/iu.test(cell))
	let foundationType = ''
	if (foundationHeaderIndex !== -1) {
		const direct = cells[foundationHeaderIndex].match(seriesPattern)
		foundationType = direct?.[1] ?? ''
		if (!foundationType) {
			for (const candidate of cells.slice(foundationHeaderIndex + 1, foundationHeaderIndex + 6)) {
				const match = candidate.match(seriesPattern)
				if (match) { foundationType = match[1]; break }
			}
		}
		foundationType = foundationType.replace(/[–—]/g, '-')
		if (!foundationType) warnings.push(`В листе «${sheetName}» нашёл позицию фундамента, но не распознал серию (Серия ...ИЗЛКРус) — заполните тип фундамента вручную.`)
	}

	// "Устройство химических анкеров" — своя плита у заказчика, ИЗЛК фундамент не делает.
	const customerOwnSlab = cells.some((cell) => /устройств[а-яё]*\s+хим(?:ическ[а-яё]*)?\s+анкер/iu.test(cell))

	// Шифр/наименование заказчика/итог — тем же способом, что и для текста
	// договора (см. parseContractText), но применённым только к этой смете:
	// задача — "берём из актуальной сметы", а не из первого попавшегося файла.
	const sheetText = rows.map((row) => row.join(' ')).join('\n')
	const cipher = firstMatch(sheetText, [/((?:ИЗЛК\s*Рус\s*)?КБ[-–—]\s*\d+(?:\.\d+){2,})/iu])
	const contractorName = [
		firstMatch(sheetText, [/заказчик\s*[:—-]\s*([^\n]{3,140})/iu]),
		firstMatch(sheetText, [/((?:ООО|АО|ПАО|ИП)\s+[«"]?[^\n,»"]{2,100}[»"]?)/iu]),
	].map(plausibleContractorName).find(Boolean) ?? ''
	const amount = normalizeAmount(firstMatch(sheetText, [
		/итог[а-яё]*\s+по\s+смете\s*[:—-]?\s*([\d\s ]+(?:[,.]\d{1,2})?)/iu,
		/(?:итого|всего)\s*[:—-]?\s*([\d\s ]+(?:[,.]\d{1,2})?)/iu,
	]))

	return { objectAddress, foundationType, customerOwnSlab, cipher, contractorName, amount, sourceFile: fileName, warnings }
}

/** Parses every readable file in a selected directory and chooses the most credible contract. */
export async function parseContractFolder(files: FolderParseFile[]): Promise<FolderParseResult> {
	const transientFiles = files.filter((file) => isTransientSystemFile(file.relativePath || file.fileName))
	files = files.filter((file) => !isTransientSystemFile(file.relativePath || file.fileName))
	if (!files.length) throw new Error('В папке есть только служебные файлы Office. Выберите папку с документами.')
	if (!files.length) throw new Error('В папке нет файлов.')
	if (files.length > MAX_FOLDER_FILES) throw new Error(`В одной загрузке можно проверить до ${MAX_FOLDER_FILES} файлов.`)
	const totalBytes = files.reduce((sum, file) => sum + file.buffer.length, 0)
	if (totalBytes > MAX_FOLDER_TOTAL_BYTES) throw new Error('Папка больше 750 МБ. Для такого архива используйте Inbox на сервере: он обработает файлы по очереди.')
	const categorized = new Map<string, { key: string; label: string; count: number; files: string[] }>()
	for (const file of files) {
		const category = categorize(file.fileName, file.relativePath)
		const previous = categorized.get(category.key) ?? { key: category.key, label: category.label, count: 0, files: [] }
		previous.count += 1
		previous.files.push(file.relativePath || file.fileName)
		categorized.set(category.key, previous)
	}

	const allReadable = files.filter((file) => (PARSABLE_EXTENSIONS as readonly string[]).includes(path.extname(file.fileName).toLowerCase()) && file.buffer.length <= MAX_PARSE_BYTES)
	const readable = [...allReadable].sort((a, b) => textCandidatePriority(b) - textCandidatePriority(a)).slice(0, MAX_FOLDER_TEXT_CANDIDATES)
	const ocrCandidates = new Set(readable
		.filter((file) => OCR_EXTENSIONS.has(path.extname(file.fileName).toLowerCase()))
		.slice(0, MAX_FOLDER_OCR_CANDIDATES)
		.map((file) => file.relativePath || file.fileName))
	const skippedFiles: FolderParseReport['skippedFiles'] = files
		.filter((file) => !(PARSABLE_EXTENSIONS as readonly string[]).includes(path.extname(file.fileName).toLowerCase()) || file.buffer.length > MAX_PARSE_BYTES)
		.map((file) => ({ fileName: file.relativePath || file.fileName, reason: file.buffer.length > MAX_PARSE_BYTES ? 'больше 25 МБ — прикрепим без распознавания' : 'формат прикрепим без распознавания' }))
	for (const file of transientFiles) skippedFiles.push({ fileName: file.relativePath || file.fileName, reason: 'служебный временный файл Office — не будет импортирован' })
	// Each candidate's text extraction (and its own bounded OCR fallback) is
	// independent of every other file's — running them one at a time was the
	// main reason a folder with several documents felt slow. MAX_FOLDER_TEXT_CANDIDATES
	// and MAX_FOLDER_OCR_CANDIDATES already cap how much work this can ever be.
	const attempts: Array<{ file: FolderParseFile; parsed: ParsedContract }> = []
	const outcomes = await Promise.all(readable.map(async (file) => {
		try { return { file, parsed: await parseContractFile(file.fileName, file.buffer, !OCR_EXTENSIONS.has(path.extname(file.fileName).toLowerCase()) || ocrCandidates.has(file.relativePath || file.fileName)) } }
		catch { return { file, parsed: null } }
	}))
	for (const outcome of outcomes) {
		if (outcome.parsed) attempts.push({ file: outcome.file, parsed: outcome.parsed })
		else skippedFiles.push({ fileName: outcome.file.relativePath || outcome.file.fileName, reason: 'не удалось извлечь текст' })
	}
	if (!attempts.length) throw new Error('В папке не найден читаемый договор. Добавьте DOC, DOCX, XLSX, XLS, PDF, TXT, CSV или скан JPG/PNG.')
	attempts.sort((a, b) => candidateScore(b.file, b.parsed) - candidateScore(a.file, a.parsed))
	const selected = attempts[0]
	const warnings = [...selected.parsed.warnings]
	if (attempts.length > 1) warnings.push(`Проверено файлов с текстом: ${attempts.length}. Основным выбран «${selected.file.fileName}».`)
	if (allReadable.length > readable.length) warnings.push(`Из ${allReadable.length} текстовых файлов подробно проверены ${readable.length} наиболее подходящих к договору. Все ${files.length} файлов классифицированы и будут проверены при сохранении.`)
	const ocrFiles = readable.filter((file) => OCR_EXTENSIONS.has(path.extname(file.fileName).toLowerCase())).length
	if (ocrFiles > MAX_FOLDER_OCR_CANDIDATES) warnings.push(`OCR выполнен для ${MAX_FOLDER_OCR_CANDIDATES} наиболее вероятных сканов из ${ocrFiles}; остальные файлы будут прикреплены без OCR.`)
	if (skippedFiles.length) warnings.push(`Файлов приложим без авторазбора: ${skippedFiles.length}.`)

	// Адрес объекта и тип фундамента — ВСЕГДА из сметы, когда она есть в папке
	// (задача пользователя: из договора это ненадёжнее, а иногда там вообще
	// нет адреса). selectEstimateFile сама выбирает смету из ДС с наибольшим
	// номером — это последняя редакция, в ней данные могли уже измениться.
	let parsedResult = selected.parsed
	const estimateFile = selectEstimateFile(files)
	if (estimateFile) {
		const estimate = parseEstimateWorkbook(estimateFile.relativePath || estimateFile.fileName, estimateFile.buffer)
		parsedResult = {
			...parsedResult,
			objectAddress: estimate.objectAddress || parsedResult.objectAddress,
			foundationType: estimate.foundationType || parsedResult.foundationType,
			customerOwnSlab: estimate.customerOwnSlab || parsedResult.customerOwnSlab,
			cipher: estimate.cipher || parsedResult.cipher,
			contractorName: parsedResult.contractorName || estimate.contractorName,
			amount: parsedResult.amount || estimate.amount,
		}
		warnings.push(`Адрес объекта и тип фундамента проверены по смете «${estimateFile.relativePath || estimateFile.fileName}».`)
		warnings.push(...estimate.warnings)
	}
	return {
		parsed: { ...parsedResult, warnings },
		folder: { totalFiles: files.length, parsedFiles: attempts.length, textCandidates: allReadable.length, primaryFile: selected.file.relativePath || selected.file.fileName, categories: [...categorized.values()], skippedFiles, warnings },
	}
}
