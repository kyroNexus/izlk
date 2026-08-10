import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'fs/promises'
import path from 'path'

/**
 * Файловое хранилище.
 *
 * В БД лежит только путь (Document.storagePath), сам файл — на диске.
 * STORAGE_PATH монтируется как volume, INBOX_PATH — папка сканера входящих файлов.
 */

export const STORAGE_PATH = path.resolve(process.env.STORAGE_PATH || path.join(process.cwd(), 'storage'))
export const INBOX_PATH = path.resolve(process.env.INBOX_PATH || path.join(process.cwd(), 'inbox'))

/** Private drop-folder for a designer. The scanner deliberately never reads it. */
export function designerTrashPath(userId: string): string {
	const safeId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '_')
	return path.join(INBOX_PATH, '_мусор', safeId)
}

/** Максимальный размер загружаемого файла — 200 МБ (чертежи и сканы бывают тяжёлыми). */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
	'.pdf': 'application/pdf',
	'.doc': 'application/msword',
	'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'.xls': 'application/vnd.ms-excel',
	'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'.csv': 'text/csv',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.heic': 'image/heic',
	'.dwg': 'image/vnd.dwg',
	'.dxf': 'image/vnd.dxf',
	'.zip': 'application/zip',
	'.rar': 'application/vnd.rar',
	'.7z': 'application/x-7z-compressed',
	'.txt': 'text/plain; charset=utf-8',
}

const DOCUMENT_EXTENSIONS = new Set(Object.keys(MIME_BY_EXT))
const PHOTO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic'])

export function mimeByFileName(fileName: string): string {
	const ext = path.extname(fileName).toLowerCase()
	return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/** Only document formats supported by the system are stored. */
export function assertSafeDocumentUpload(fileName: string) {
	const safeName = safeFileName(fileName)
	const ext = path.extname(safeName).toLowerCase()
	if (!DOCUMENT_EXTENSIONS.has(ext)) {
		throw new Error('Недопустимый формат файла. Разрешены PDF, Office, изображения, DWG/DXF, архивы и текстовые файлы.')
	}
	return safeName
}

/** Site photo endpoints render files inline, so they accept images only. */
export function assertSafePhotoUpload(fileName: string) {
	const safeName = safeFileName(fileName)
	if (!PHOTO_EXTENSIONS.has(path.extname(safeName).toLowerCase())) {
		throw new Error('Для фотоотчёта разрешены PNG, JPG, JPEG и HEIC.')
	}
	return safeName
}

/**
 * A browser can lie about a file's MIME type and its extension alone is not
 * proof of its format. Check the inexpensive, stable signatures before we
 * persist a binary or hand a PDF to a parser/preview tool.
 * Text formats intentionally stay extension-only: they are always downloaded
 * with `nosniff` and are never rendered as HTML by the application.
 */
export function assertFileContentMatchesName(fileName: string, buffer: Buffer) {
	const ext = path.extname(safeFileName(fileName)).toLowerCase()
	const starts = (value: number[]) => value.every((byte, index) => buffer[index] === byte)
	const ascii = (value: string, offset = 0) => buffer.subarray(offset, offset + value.length).toString('ascii') === value
	const zip = starts([0x50, 0x4b, 0x03, 0x04]) || starts([0x50, 0x4b, 0x05, 0x06]) || starts([0x50, 0x4b, 0x07, 0x08])
	const ole = starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
	const signatures: Record<string, boolean> = {
		'.pdf': ascii('%PDF-'),
		'.png': starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		'.jpg': starts([0xff, 0xd8, 0xff]),
		'.jpeg': starts([0xff, 0xd8, 0xff]),
		'.webp': ascii('RIFF') && ascii('WEBP', 8),
		'.docx': zip,
		'.xlsx': zip,
		'.doc': ole,
		'.xls': ole,
		'.zip': zip,
		'.rar': ascii('Rar!\x1a\x07\x00') || ascii('Rar!\x1a\x07\x01\x00'),
		'.7z': starts([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
		'.dwg': ascii('AC10'),
		'.dxf': ascii('AutoCAD Binary DXF') || buffer.subarray(0, 128).toString('utf8').replace(/^\uFEFF/, '').includes('SECTION'),
		'.heic': ascii('ftyp', 4),
	}
	if (ext in signatures && !signatures[ext]) {
		throw new Error('Содержимое файла не соответствует его расширению. Проверьте исходный файл и загрузите его заново.')
	}
}

/** Обрезает опасные символы, оставляя читаемое имя (кириллица допустима). */
export function safeFileName(fileName: string): string {
	const base = path.basename(repairMojibakeFileName(fileName)).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
	const cleaned = base.replace(/^\.+/, '').slice(0, 180)
	return cleaned || 'file'
}

/** Restores a UTF-8 filename that a Windows/browser upload sent as Latin-1.
 * It is deliberately conservative: ordinary Russian and Latin names are left
 * untouched, and a failed conversion falls back to the original value. */
export function repairMojibakeFileName(fileName: string): string {
	if (!/[ÐÑ]/.test(fileName)) return fileName
	try {
		const repaired = Buffer.from(fileName, 'latin1').toString('utf8')
		return repaired.includes('\uFFFD') || !/[А-Яа-яЁё]/.test(repaired) ? fileName : repaired
	} catch {
		return fileName
	}
}

export function sha256Buffer(buffer: Buffer): string {
	return createHash('sha256').update(buffer).digest('hex')
}

/** Кладёт файл в STORAGE_PATH/<contractId>/<хеш>-<имя>. */
export async function saveContractFile(input: {
	contractId: string
	fileName: string
	buffer: Buffer
}): Promise<{ storagePath: string; sha256: string; sizeBytes: number; mimeType: string }> {
	const sha256 = sha256Buffer(input.buffer)
	const dir = path.join(STORAGE_PATH, input.contractId)
	await mkdir(dir, { recursive: true })

	const fileName = assertSafeDocumentUpload(input.fileName)
	assertFileContentMatchesName(fileName, input.buffer)
	const target = path.join(dir, `${sha256.slice(0, 12)}-${fileName}`)
	// Never expose a half-written scan/DWG when a request is interrupted. The
	// final name becomes visible only after the full buffer reaches the volume.
	const temporary = `${target}.upload-${randomUUID()}.tmp`
	try {
		await writeFile(temporary, input.buffer)
		await rename(temporary, target)
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => undefined)
		throw error
	}

	return {
		storagePath: target,
		sha256,
		sizeBytes: input.buffer.length,
		mimeType: mimeByFileName(fileName),
	}
}

/** Remove a freshly-created contract folder after an import transaction fails. */
export async function removeContractStorage(contractId: string): Promise<void> {
	const target = path.resolve(STORAGE_PATH, contractId)
	if (path.dirname(target) !== STORAGE_PATH) throw new Error('Недопустимый путь очистки хранилища')
	await rm(target, { recursive: true, force: true })
}

/** Remove one freshly-written file after its database record could not be created. */
export async function removeStoredFile(storagePath: string): Promise<void> {
	if (!isAllowedStoragePath(storagePath)) throw new Error('Недопустимый путь очистки файла')
	const target = path.resolve(storagePath)
	if (target === STORAGE_PATH || target === INBOX_PATH) throw new Error('Нельзя удалить корень хранилища')
	await unlink(target).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== 'ENOENT') throw error
	})
}

/** Сохраняет фотографию дневного отчёта отдельно от договорных документов. */
export async function saveSitePhoto(input: { siteId: string; workId: string; fileName: string; buffer: Buffer }) {
	const sha256 = sha256Buffer(input.buffer)
	const dir = path.join(STORAGE_PATH, 'sites', input.siteId, input.workId)
	await mkdir(dir, { recursive: true })
	const fileName = assertSafePhotoUpload(input.fileName)
	assertFileContentMatchesName(fileName, input.buffer)
	const target = path.join(dir, `${sha256.slice(0, 12)}-${fileName}`)
	await writeFile(target, input.buffer)
	return { storagePath: target, sha256, sizeBytes: input.buffer.length, mimeType: mimeByFileName(fileName), fileName }
}

/**
 * Защита от выхода за пределы хранилища.
 * storagePath приходит из БД, но файл могли импортировать из Inbox,
 * поэтому разрешены ровно два корня: STORAGE_PATH и INBOX_PATH.
 */
export function isAllowedStoragePath(storagePath: string): boolean {
	const resolved = path.resolve(storagePath)
	return (
		resolved === STORAGE_PATH ||
		resolved === INBOX_PATH ||
		resolved.startsWith(STORAGE_PATH + path.sep) ||
		resolved.startsWith(INBOX_PATH + path.sep)
	)
}

export async function readStoredFile(storagePath: string): Promise<Buffer> {
	if (!isAllowedStoragePath(storagePath)) {
		throw new Error('Путь к файлу вне разрешённого хранилища')
	}
	return readFile(path.resolve(storagePath))
}

/** Копирует файл из Inbox в постоянное хранилище договора. */
export async function importInboxFile(input: {
	contractId: string
	sourcePath: string
	fileName: string
	expectedSha256?: string
}) {
	if (!isAllowedStoragePath(input.sourcePath)) {
		throw new Error('Файл вне разрешённой папки импорта')
	}
	const buffer = await readFile(path.resolve(input.sourcePath))
	if (input.expectedSha256 && sha256Buffer(buffer) !== input.expectedSha256) {
		throw new Error('Файл в Inbox изменился после сканирования. Он не был прикреплён: повторите сканирование, чтобы создать новую версию.')
	}
	return saveContractFile({
		contractId: input.contractId,
		fileName: input.fileName,
		buffer,
	})
}
