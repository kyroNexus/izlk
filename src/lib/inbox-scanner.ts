import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import type { Dirent } from 'fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import path from 'path'
import JSZip from 'jszip'
import type { DocumentKind, DocumentState } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { importInboxFile, INBOX_PATH } from '@/lib/storage'
import { parseContractFile, PARSABLE_EXTENSIONS } from '@/lib/contract-parser'
import { tryConfirmSignedPr1Workflow, trySyncWorkflowAfterDocumentUpload } from '@/lib/contract-workflow'
import { writeImportEvent } from '@/lib/audit'
import { classifyDocumentPath } from '@/lib/document-classifier'
import { createVersionedDocument } from '@/lib/document-versioning'
import { logger } from '@/lib/logger'
import { matchDocumentContract, routeDocument } from '@/lib/document-routing'

export { classifyDocumentPath, documentStateForPath } from '@/lib/document-classifier'

const IGNORE = [/^thumbs\.db$/i, /^desktop\.ini$/i, /^~\$/, /\.bak$/i, /\.lnk$/i, /\.log$/i, /\.tmp$/i]
const OCR_SOURCE_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg'])
// Inbox can contain an entire historical archive. OCR is intentionally limited
// per scan, otherwise 1,000 scanned PDFs could occupy the worker for hours.
const MAX_INBOX_OCR_CANDIDATES = 16
// Задача D2: тот же принцип, что и у OCR-потолка выше — защита воркера, а не
// полная защита от zip-бомбы. jszip грузит архив и каждую запись целиком в
// память, поэтому оба предела нужны: и на сам файл архива, и на число записей.
const MAX_INBOX_ZIP_BYTES = 500 * 1024 * 1024
const MAX_INBOX_ZIP_ENTRIES = 5000

/** "_мусор/<employee>" is intentionally a private work area, not an import source. */
function isPrivateTrashPath(filePath: string) {
	const segments = path.relative(INBOX_PATH, filePath).split(path.sep).map((item) => item.toLocaleLowerCase('ru-RU'))
	return segments.includes('_мусор') || segments.includes('мусор')
}

/**
 * Задача D2: .zip во входящей папке — часто не документ, а целый архив
 * (историческая выгрузка старых договоров и т.п.), который иначе повис бы в
 * очереди одним нераспознанным файлом. Разворачиваем его рядом: Файл.zip →
 * папка Файл/ с тем же содержимым — а дальше её файлы участвуют в обычном
 * обходе scanInbox() как будто их скинули в Inbox напрямую, без отдельной
 * ветки логики для архивов в основном цикле ниже.
 *
 * Идемпотентно: если папка Файл/ уже существует — архив уже разворачивали
 * раньше, повторно не трогаем (иначе автосканер распаковывал бы его заново
 * каждые 5 секунд). Содержимое архива подхватится основным обходом только
 * на СЛЕДУЮЩЕМ цикле сканирования (files здесь — уже готовый список, его не
 * пересобираем на лету) — то же почти мгновенное (≤5 сек) отставание, что и
 * у любого только что появившегося в Inbox файла.
 */
/** Exported for a deterministic regression test: extraction, idempotency, zip-slip. */
export async function expandInboxZips(files: string[]): Promise<{ expanded: Set<string>; failed: Map<string, string> }> {
	const expanded = new Set<string>()
	const failed = new Map<string, string>()
	for (const sourcePath of files) {
		if (path.extname(sourcePath).toLowerCase() !== '.zip' || isPrivateTrashPath(sourcePath)) continue
		const resolved = path.resolve(sourcePath)
		const targetDir = sourcePath.slice(0, -'.zip'.length)
		try {
			const alreadyExpanded = await stat(targetDir).then((info) => info.isDirectory()).catch(() => false)
			if (alreadyExpanded) { expanded.add(resolved); continue }
			const info = await stat(sourcePath)
			if (info.size > MAX_INBOX_ZIP_BYTES) throw new Error(`Архив больше допустимых ${Math.round(MAX_INBOX_ZIP_BYTES / 1024 / 1024)} МБ — распакуйте вручную`)
			const zip = await JSZip.loadAsync(await readFile(sourcePath))
			const entries = Object.values(zip.files).filter((entry) => !entry.dir)
			if (entries.length === 0) throw new Error('Архив пуст или повреждён')
			if (entries.length > MAX_INBOX_ZIP_ENTRIES) throw new Error(`В архиве больше ${MAX_INBOX_ZIP_ENTRIES} файлов — распакуйте вручную`)
			const resolvedTargetDir = path.resolve(targetDir)
			for (const entry of entries) {
				// Защита от zip-slip: путь внутри архива не должен выходить за пределы targetDir.
				const destination = path.resolve(resolvedTargetDir, entry.name)
				if (destination !== resolvedTargetDir && !destination.startsWith(resolvedTargetDir + path.sep)) continue
				await mkdir(path.dirname(destination), { recursive: true })
				await writeFile(destination, await entry.async('nodebuffer'))
			}
			expanded.add(resolved)
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Не удалось распаковать архив'
			failed.set(resolved, message)
			logger.warn('inbox.zip_expand_failed', { entityType: 'Inbox', error })
		}
	}
	return { expanded, failed }
}

async function walk(dir: string): Promise<string[]> {
	let entries: Dirent[]
	try {
		entries = await readdir(dir, { withFileTypes: true })
	} catch (error) {
		logger.warn('inbox.directory_read_failed', { entityType: 'Inbox', error })
		return []
	}
	const files: string[] = []
	for (const entry of entries) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory() && !isPrivateTrashPath(full)) files.push(...await walk(full))
		else files.push(full)
	}
	return files
}

function sha256File(filePath: string): Promise<string> {
	const hash = createHash('sha256')
	const stream = createReadStream(filePath)
	return new Promise((resolve, reject) => {
		stream.on('data', (chunk) => hash.update(chunk))
		stream.on('end', () => resolve(hash.digest('hex')))
		stream.on('error', reject)
	})
}

function classifyDocumentPathLegacy(filePath: string): DocumentKind {
	const lower = filePath.toLowerCase()
	if (/доп.?\s*(соглаш|согл)|дс\s*[№_\d]/i.test(lower)) return 'AGREEMENT'
	if (/смет|локальн.*расч[её]т/i.test(lower)) return 'ESTIMATE'
	if (/сч[её]т(?!.*схем)/i.test(lower)) return 'INVOICE'
	if (/коммерч|(^|[\\/_ -])кп([\\/_ .-]|$)/i.test(lower)) return 'COMMERCIAL_PROPOSAL'
	if (/сертификат|паспорт.*материал|качест/i.test(lower)) return 'CERTIFICATE'
	if (/акт.*скрыт|аоср|акт.*при[её]м/i.test(lower)) return 'ACT'
	if (/исполн|ожр|журнал работ|схем/i.test(lower)) return 'EXECUTIVE'
	if (/\b(км|кж|ар)\b|проект|черт[её]ж/i.test(lower)) return path.extname(lower) === '.dwg' ? 'PROJECT_DWG' : 'PROJECT_PDF'
	if (/договор|контракт/i.test(lower)) return /подпис|скан|эдо/i.test(lower) ? 'SIGNED_SCAN' : 'CONTRACT'
	if (/подпис|скан|эдо/i.test(lower)) return 'SIGNED_SCAN'
	if (path.extname(lower) === '.dwg') return 'PROJECT_DWG'
	return 'OTHER'
}

function documentStateForPathLegacy(filePath: string): DocumentState {
	return /подпис|скан|эдо/i.test(filePath) ? 'SIGNED' : 'SOURCE'
}

/** Classification by readable Russian names in files and folders. */
function classifyDocumentPathDeprecated(filePath: string): DocumentKind {
	const lower = filePath.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
	// A "смета к ДС" is still an estimate, not the agreement itself.
	if (/(смет|локальн.*расч[её]т)/.test(lower)) return 'ESTIMATE'
	if (/(доп\.?\s*соглаш|дс\s*[№_\d])/.test(lower)) return 'AGREEMENT'
	if (/(счет|счёт)(?!.*схем)/.test(lower)) return 'INVOICE'
	if (/(коммерческ|(^|[\\/_ -])кп([\\/_ .-]|$))/.test(lower)) return 'COMMERCIAL_PROPOSAL'
	if (/(сертификат|паспорт.*материал|качеств)/.test(lower)) return 'CERTIFICATE'
	if (/(акт.*скрыт|аоср|акт.*при[её]м)/.test(lower)) return 'ACT'
	if (/(исполнит|ожр|журнал работ|схем)/.test(lower)) return 'EXECUTIVE'
	if (/(^|[^а-яa-z])(км|кж|ар)([^а-яa-z]|$)|проект|черт[её]ж/.test(lower)) return path.extname(lower) === '.dwg' ? 'PROJECT_DWG' : 'PROJECT_PDF'
	if (/(договор|контракт)/.test(lower)) return 'CONTRACT'
	if (/(подпис|скан|эдо)/.test(lower)) return 'SIGNED_SCAN'
	return path.extname(lower) === '.dwg' || path.extname(lower) === '.dxf' ? 'PROJECT_DWG' : 'OTHER'
}

function documentStateForPathDeprecated(filePath: string): DocumentState {
	return /(подпис|скан|эдо)/i.test(filePath) ? 'SIGNED' : 'SOURCE'
}

function folderKey(filePath: string) {
	return path.relative(INBOX_PATH, filePath).split(path.sep)[0] || '.'
}

function inboxOcrPriority(filePath: string) {
	const lower = filePath.toLocaleLowerCase('ru-RU')
	let score = classifyDocumentPath(filePath) === 'CONTRACT' ? 100 : 0
	if (/договор|контракт/.test(lower)) score += 80
	if (/подпис|приложен|смет|кп/.test(lower)) score += 20
	// Stable tie-breaker: the result does not depend on the filesystem order.
	return `${String(999 - score).padStart(3, '0')}:${lower}`
}

/** Exported for a deterministic regression test: OCR must stay bounded. */
export function selectInboxOcrCandidates(files: string[]) {
	return new Set(files
		.filter((file) => OCR_SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()))
		.sort((a, b) => inboxOcrPriority(a).localeCompare(inboxOcrPriority(b), 'ru-RU'))
		.slice(0, MAX_INBOX_OCR_CANDIDATES)
		.map((file) => path.resolve(file)))
}

/**
 * Failed records are deliberately re-checked on the next scan.  This makes a
 * temporary network/share hiccup recoverable without creating a second queue
 * record or requiring someone to re-upload the file by hand.
 */
async function retryFailedQueueItem(input: {
	id: string
	sourcePath: string
	fileName: string
	hint?: { number?: string; cipher?: string }
	allowOcr?: boolean
}) {
	try {
		const fileInfo = await stat(input.sourcePath)
		if (!fileInfo.isFile()) throw new Error('По указанному пути находится не файл')
		let parsedContractNumber = input.hint?.number
		let parsedCipher = input.hint?.cipher
		let parseError: string | null = null
		if ((PARSABLE_EXTENSIONS as readonly string[]).includes(path.extname(input.fileName).toLowerCase())) {
			try {
				const parsed = await parseContractFile(input.fileName, await readFile(input.sourcePath), input.allowOcr ?? true)
				if (classifyDocumentPath(input.sourcePath) === 'CONTRACT' || parsed.confidence >= 60) {
					parsedContractNumber = parsed.contractNumber || parsedContractNumber
					parsedCipher = parsed.cipher || parsedCipher
				}
			} catch (error) {
				parseError = error instanceof Error ? error.message : 'Не удалось повторно прочитать документ'
			}
		}
		await prisma.inboxItem.update({
			where: { id: input.id },
			data: {
				sizeBytes: BigInt(fileInfo.size),
				status: parseError ? 'FAILED' : (parsedContractNumber || parsedCipher ? 'SUGGESTED' : 'PENDING'),
				parsedContractNumber,
				parsedCipher,
				suggestedKind: routeDocument(input.sourcePath).kind,
				errorMessage: parseError,
			},
		})
		return !parseError
	} catch (error) {
		await prisma.inboxItem.update({
			where: { id: input.id },
			data: {
				status: 'FAILED',
				errorMessage: error instanceof Error ? `Файл недоступен: ${error.message}` : 'Файл недоступен для повторной проверки',
			},
		})
		return false
	}
}

async function autoImportRecognizedItems() {
	const items = await prisma.inboxItem.findMany({
		where: { status: { in: ['PENDING', 'SUGGESTED'] } },
		orderBy: { createdAt: 'asc' },
	})
	let imported = 0
	for (const item of items) {
		const route = routeDocument(item.sourcePath)
		const routeFilters = [
			...(route.cipher ? [{ cipher: { equals: route.cipher, mode: 'insensitive' as const } }] : []),
			...(route.contractNumberFull ? [{ number: { equals: route.contractNumberFull, mode: 'insensitive' as const } }] : []),
			...(route.contractNumberShort ? [
				{ number: { equals: route.contractNumberShort, mode: 'insensitive' as const } },
				{ number: { startsWith: `${route.contractNumberShort}-`, mode: 'insensitive' as const } },
				{ number: { startsWith: `${route.contractNumberShort}_`, mode: 'insensitive' as const } },
			] : []),
		]
		const routeCandidates = routeFilters.length ? await prisma.contract.findMany({ where: { deletedAt: null, OR: routeFilters }, select: { id: true, number: true, cipher: true, date: true } }) : []
		const routedContract = matchDocumentContract(route, routeCandidates).contract
		const fallbackShort = item.parsedContractNumber && /^\d{2,5}$/u.test(item.parsedContractNumber) ? item.parsedContractNumber : null
		const mayUseFolderFallback = !route.contractNumberShort || Boolean(route.pr1SignedAt)
		const fallbackContract = !routedContract && mayUseFolderFallback && (item.parsedContractNumber || item.parsedCipher) ? await prisma.contract.findFirst({
			where: { deletedAt: null, OR: [
				...(item.parsedContractNumber ? [{ number: { equals: item.parsedContractNumber, mode: 'insensitive' as const } }] : []),
				...(fallbackShort ? [{ number: { startsWith: `${fallbackShort}-`, mode: 'insensitive' as const } }, { number: { startsWith: `${fallbackShort}_`, mode: 'insensitive' as const } }] : []),
				...(item.parsedCipher ? [{ cipher: { equals: item.parsedCipher, mode: 'insensitive' as const } }] : []),
			] }, select: { id: true },
		}) : null
		const contractId = routedContract?.id ?? fallbackContract?.id
		const contract = contractId ? await prisma.contract.findUnique({
			where: { id: contractId },
			include: {
				projectSections: { where: { deletedAt: null } }, executiveDocs: { where: { deletedAt: null } },
				agreements: { where: { deletedAt: null }, select: { id: true, number: true } },
				invoices: { where: { deletedAt: null }, select: { id: true, number: true } },
			},
		}) : null
		if (!contract) continue
		let savedPath: string | null = null
		try {
			const saved = await importInboxFile({ contractId: contract.id, sourcePath: item.sourcePath, fileName: item.fileName, expectedSha256: item.sha256 })
			savedPath = saved.storagePath
			const searchable = `${item.sourcePath} ${item.fileName}`.toLocaleLowerCase('ru-RU')
			const sectionCode = route.sectionCode
			const projectSection = sectionCode
				? contract.projectSections.find((section) => section.code === sectionCode)
					?? await prisma.projectSection.upsert({
						where: { contractId_code: { contractId: contract.id, code: sectionCode } },
						create: { contractId: contract.id, code: sectionCode },
						update: { deletedAt: null },
						select: { id: true, code: true },
					})
				: null
			const executiveDoc = ['EXECUTIVE', 'ACT', 'CERTIFICATE'].includes(route.kind)
				? contract.executiveDocs.find((doc) => {
					const name = doc.name.toLowerCase()
					return (/акт|аоср/i.test(searchable) && /акт|скрыт/i.test(name)) ||
						(/сертификат|паспорт.*материал/i.test(searchable) && /сертификат/i.test(name)) ||
						(/ожр|журнал/i.test(searchable) && /журнал/i.test(name)) ||
						(/схем/i.test(searchable) && /схем/i.test(name)) ||
						(/паспорт/i.test(searchable) && /паспорт/i.test(name))
				})
				: null
			const documentKind = route.kind
			const documentState = route.state
			await createVersionedDocument({
				contractId: contract.id,
				kind: documentKind,
				state: documentState,
				fileName: item.fileName,
				storagePath: saved.storagePath,
				mimeType: saved.mimeType,
				sizeBytes: BigInt(saved.sizeBytes),
				sha256: saved.sha256,
				projectSectionId: projectSection?.id,
				executiveDocId: executiveDoc?.id,
				sourceDataKind: route.sourceDataKind,
				agreementId: contract.agreements.find((agreement) => agreement.number === route.agreementNumber)?.id,
				invoiceId: contract.invoices.find((invoice) => invoice.number === route.invoiceNumber)?.id,
				signedAt: route.pr1SignedAt ? new Date(`${route.pr1SignedAt}T12:00:00.000Z`) : undefined,
			})
			if (contract.managerId) await trySyncWorkflowAfterDocumentUpload({ contractId: contract.id, actorId: contract.managerId, kind: documentKind, state: documentState })
			if (executiveDoc) await prisma.executiveDoc.update({ where: { id: executiveDoc.id }, data: { status: 'IN_PROGRESS' } })
			let warning = matchDocumentContract(route, [contract]).warning
			if (route.pr1SignedAt) {
				if (!matchDocumentContract(route, [contract]).contract) warning = `ПР1 не подтверждён: номер в имени не совпадает с договором № ${contract.number}.`
				else if (contract.pr1ConfirmedAt) warning = 'ПР1 уже подтверждён; повторный запуск пропущен.'
				else if (contract.managerId) warning = (await tryConfirmSignedPr1Workflow({ contractId: contract.id, actorId: contract.managerId, signedAt: new Date(`${route.pr1SignedAt}T12:00:00.000Z`) })).error
				else warning = 'ПР1 не подтверждён автоматически: у договора не назначен менеджер.'
			}
			await prisma.inboxItem.update({ where: { id: item.id }, data: { status: 'MATCHED', matchedContractId: contract.id, suggestedKind: documentKind, errorMessage: warning } })
			await writeImportEvent({ inboxItemId: item.id, fileName: item.fileName, event: 'AUTO_IMPORTED', outcome: 'SUCCESS', contractId: contract.id, message: `Автоматически привязан к договору № ${contract.number}.${warning ? ` Предупреждение: ${warning}` : ''}` })
			imported++
		} catch (error) {
			if (savedPath) {
				const linked = await prisma.document.count({ where: { storagePath: savedPath } }).catch(() => 1)
				if (linked === 0) logger.warn('inbox.unlinked_upload', { entityType: 'InboxItem', entityId: item.id })
			}
			const duplicate = await prisma.document.findFirst({ where: { contractId: contract.id, sha256: item.sha256 }, select: { id: true } })
			const message = error instanceof Error ? error.message : 'Ошибка автоматического импорта'
			await prisma.inboxItem.update({ where: { id: item.id }, data: duplicate
				? { status: 'IGNORED', matchedContractId: contract.id }
				: { status: 'FAILED', errorMessage: message } })
			await writeImportEvent({ inboxItemId: item.id, fileName: item.fileName, event: 'AUTO_IMPORT_FAILED', outcome: duplicate ? 'IGNORED' : 'FAILED', contractId: contract.id, message: duplicate ? 'Повтор файла: пропущен без создания дубля.' : message })
		}
	}
	return imported
}

export async function scanInbox() {
	const files = await walk(INBOX_PATH)
	const result = { found: files.length, queued: 0, autoImported: 0, duplicates: 0, ignored: 0, parsed: 0, errors: 0, archivesExpanded: 0, issues: [] as string[] }
	// Задача D2: сначала разворачиваем архивы — их содержимое подхватит уже
	// СЛЕДУЮЩИЙ вызов scanInbox() (см. комментарий у expandInboxZips), а сам
	// .zip дальше в этом проходе пропускается основным циклом ниже.
	const { expanded: expandedZips, failed: zipFailures } = await expandInboxZips(files)
	result.archivesExpanded = expandedZips.size
	for (const [zipPath, message] of zipFailures) {
		result.errors++
		result.issues.push(`${path.basename(zipPath)}: ${message}`)
	}
	const ocrCandidates = selectInboxOcrCandidates(files)
	const parsedByPath = new Map<string, Awaited<ReturnType<typeof parseContractFile>>>()
	if (files.filter((file) => OCR_SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())).length > MAX_INBOX_OCR_CANDIDATES) {
		result.issues.push(`OCR ограничен ${MAX_INBOX_OCR_CANDIDATES} наиболее вероятными сканами за один проход; остальные файлы добавлены без OCR.`)
	}
	const discoveredPaths = new Set(files.map((file) => path.resolve(file)))
	const failedQueue = await prisma.inboxItem.findMany({
		where: { status: 'FAILED' },
		select: { id: true, sourcePath: true, fileName: true },
	})
	for (const item of failedQueue) {
		if (discoveredPaths.has(path.resolve(item.sourcePath))) continue
		await prisma.inboxItem.update({
			where: { id: item.id },
			data: { errorMessage: 'Файл больше не найден во входящей папке. Верните его в Inbox или отклоните эту запись.' },
		})
	}
	const folderHints = new Map<string, { number?: string; cipher?: string; score: number }>()

	// Сначала находим основной договор в каждой верхнеуровневой папке.
	// Его номер и шифр наследуют все остальные вложения этой папки.
	for (const sourcePath of files) {
		const fileName = path.basename(sourcePath)
		if (IGNORE.some((pattern) => pattern.test(fileName)) || !(PARSABLE_EXTENSIONS as readonly string[]).includes(path.extname(fileName).toLowerCase())) continue
		try {
			const parsed = await parseContractFile(fileName, await readFile(sourcePath), !OCR_SOURCE_EXTENSIONS.has(path.extname(fileName).toLowerCase()) || ocrCandidates.has(path.resolve(sourcePath)))
			parsedByPath.set(path.resolve(sourcePath), parsed)
			const score = parsed.confidence + (classifyDocumentPath(sourcePath) === 'CONTRACT' ? 1 : 0)
			const current = folderHints.get(folderKey(sourcePath))
			if ((parsed.contractNumber || parsed.cipher) && (!current || score > current.score)) folderHints.set(folderKey(sourcePath), { number: parsed.contractNumber || undefined, cipher: parsed.cipher || undefined, score })
		} catch { /* Одно повреждённое вложение не останавливает всю папку. */ }
	}

	for (const sourcePath of files) {
		const fileName = path.basename(sourcePath)
		// Успешно развёрнутый архив дальше не участвует как отдельный файл —
		// его содержимое уже посчитано через archivesExpanded выше, а сами
		// извлечённые файлы подхватит следующий проход (см. expandInboxZips).
		if (expandedZips.has(path.resolve(sourcePath))) continue
		if (IGNORE.some((pattern) => pattern.test(fileName))) { result.ignored++; continue }
		try {
			const sha256 = await sha256File(sourcePath)
			const hint = folderHints.get(folderKey(sourcePath))
			const target = hint?.number || hint?.cipher ? await prisma.contract.findFirst({
				where: { deletedAt: null, OR: [
					...(hint.number ? [{ number: { equals: hint.number, mode: 'insensitive' as const } }] : []),
					...(hint.cipher ? [{ cipher: { equals: hint.cipher, mode: 'insensitive' as const } }] : []),
				] },
				select: { id: true },
			}) : null
			const duplicate = target ? await prisma.document.findFirst({ where: { contractId: target.id, sha256 }, select: { id: true } }) : null
			// Content can be legitimately shared by different contract folders.
			// A queue duplicate is the same source *version*: path + checksum.  A manager
			// may replace `Смета.xlsx` in a network folder with an updated version; that
			// replacement must be queued instead of being hidden by an old Inbox record.
			const queued = await prisma.inboxItem.findFirst({ where: { sourcePath, sha256 }, select: { id: true, status: true } })
			if (duplicate) {
				// Record a duplicate once.  Otherwise it would disappear silently and the
				// import journal could not explain why the manager does not see the file.
				if (!queued) {
					const info = await stat(sourcePath)
					try {
						const ignored = await prisma.inboxItem.create({ data: {
							sourcePath, fileName, sizeBytes: BigInt(info.size), sha256, status: 'IGNORED',
							parsedContractNumber: hint?.number, parsedCipher: hint?.cipher,
							suggestedKind: routeDocument(sourcePath).kind, errorMessage: 'Точная копия уже прикреплена к этому договору.', matchedContractId: target?.id,
						} })
						await writeImportEvent({ inboxItemId: ignored.id, fileName, event: 'SCANNED', outcome: 'IGNORED', contractId: target?.id, message: 'Точная копия уже прикреплена к этому договору.' })
					} catch (error) {
						if ((error as { code?: string }).code !== 'P2002') throw error
					}
				}
				result.duplicates++
				continue
			}
			if (queued) {
				if (queued.status === 'FAILED') {
					const recovered = await retryFailedQueueItem({ id: queued.id, sourcePath, fileName, hint, allowOcr: !OCR_SOURCE_EXTENSIONS.has(path.extname(fileName).toLowerCase()) || ocrCandidates.has(path.resolve(sourcePath)) })
					if (recovered) result.parsed++
					else result.errors++
					continue
				}
				if (['PENDING', 'SUGGESTED', 'FAILED'].includes(queued.status) && (hint?.number || hint?.cipher)) {
					await prisma.inboxItem.update({ where: { id: queued.id }, data: {
						status: 'SUGGESTED',
						parsedContractNumber: hint.number,
						parsedCipher: hint.cipher,
						suggestedKind: routeDocument(sourcePath).kind,
						errorMessage: null,
					} })
				}
				result.duplicates++
				continue
			}
			let parsedContractNumber = hint?.number
			let parsedCipher = hint?.cipher
			let errorMessage: string | undefined
			if ((PARSABLE_EXTENSIONS as readonly string[]).includes(path.extname(fileName).toLowerCase())) {
				try {
					const parsed = parsedByPath.get(path.resolve(sourcePath)) ?? await parseContractFile(fileName, await readFile(sourcePath), !OCR_SOURCE_EXTENSIONS.has(path.extname(fileName).toLowerCase()) || ocrCandidates.has(path.resolve(sourcePath)))
					if (classifyDocumentPath(sourcePath) === 'CONTRACT' || parsed.confidence >= 60) {
						parsedContractNumber = parsed.contractNumber || parsedContractNumber
						parsedCipher = parsed.cipher || parsedCipher
					}
					result.parsed++
				} catch (error) {
					errorMessage = error instanceof Error ? error.message : 'Ошибка распознавания'
					result.errors++
					result.issues.push(`${fileName}: ${errorMessage}`)
				}
			}
			const info = await stat(sourcePath)
			try {
				const created = await prisma.inboxItem.create({ data: { sourcePath, fileName, sizeBytes: BigInt(info.size), sha256, status: errorMessage ? 'FAILED' : (parsedContractNumber || parsedCipher ? 'SUGGESTED' : 'PENDING'), parsedContractNumber, parsedCipher, suggestedKind: routeDocument(sourcePath).kind, errorMessage } })
				await writeImportEvent({ inboxItemId: created.id, fileName, event: 'SCANNED', outcome: errorMessage ? 'FAILED' : 'QUEUED', message: errorMessage ?? (parsedContractNumber ? `Распознан договор № ${parsedContractNumber}` : 'Ожидает выбора договора') })
				result.queued++
			} catch (error) {
				// The file may have been picked up by the watcher milliseconds earlier.
				// The database constraint makes that race harmless and idempotent.
				if ((error as { code?: string }).code === 'P2002') { result.duplicates++; continue }
				throw error
			}
		} catch (error) {
			result.errors++
			result.issues.push(`${fileName}: ${error instanceof Error ? error.message : 'Ошибка обработки'}`)
		}
	}
	result.autoImported = await autoImportRecognizedItems()
	return result
}
