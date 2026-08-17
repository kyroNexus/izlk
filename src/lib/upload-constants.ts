/**
 * Клиентские (браузерные) копии констант из src/lib/storage.ts.
 * storage.ts нельзя импортировать в клиентский код — там node:fs/node:crypto.
 * Меняете разрешённые форматы или лимит в storage.ts — обновите и этот файл.
 */

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

/** Зеркало MIME_BY_EXT из storage.ts — то, что реально пройдёт assertSafeDocumentUpload. */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.png', '.jpg', '.jpeg', '.heic', '.dwg', '.dxf', '.zip', '.rar', '.7z', '.txt']

/** Зеркало PHOTO_EXTENSIONS из storage.ts. Отдельный от документов набор —
 *  включает .webp, которого нет среди документных форматов (так в storage.ts). */
export const PHOTO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.heic']
