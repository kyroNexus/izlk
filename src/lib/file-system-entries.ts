/**
 * Обход перетащенных файлов/папок через File and Directory Entries API
 * (webkitGetAsEntry — де-факто стандарт во всех современных браузерах, не
 * только на движке WebKit). Вынесено из FileDropField (задача A1), чтобы
 * тем же кодом мог воспользоваться и ContractImportForm ("умный импорт") —
 * там область выбора папки выглядела как дропзона (пунктирная рамка,
 * как у настоящей), но drag&drop не был подключён вовсе: перетаскивание
 * либо ничего не делало, либо браузер пытался открыть папку как обычную
 * навигацию — то самое "0% минуту" из жалобы.
 */

export type CollectedFile = { file: File; relativePath: string }

function readDirectoryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
	return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

/**
 * Рекурсивно обходит одну запись (файл или папку). readEntries отдаёт
 * записи пачками не больше ~100 за вызов, поэтому его нужно звать в цикле,
 * пока не вернётся пусто. budget.left — общий на весь обход потолок числа
 * файлов (защита от случайно перетащенной гигантской папки); вызывающий
 * код сам решает, каким он должен быть для его сценария.
 */
export async function collectEntry(entry: FileSystemEntry, basePath: string, budget: { left: number }): Promise<CollectedFile[]> {
	if (budget.left <= 0) return []
	if (entry.isFile) {
		budget.left -= 1
		const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
		return [{ file, relativePath: `${basePath}${entry.name}` }]
	}
	if (!entry.isDirectory) return []
	const reader = (entry as FileSystemDirectoryEntry).createReader()
	const children: FileSystemEntry[] = []
	for (;;) {
		const batch = await readDirectoryBatch(reader)
		if (!batch.length) break
		children.push(...batch)
		if (children.length >= budget.left) break
	}
	const collected: CollectedFile[] = []
	for (const child of children) {
		if (budget.left <= 0) break
		collected.push(...(await collectEntry(child, `${basePath}${entry.name}/`, budget)))
	}
	return collected
}

/**
 * Синхронно достаёт entries из DataTransferItemList в момент onDrop — это
 * обязательно нужно сделать ДО первого await, иначе браузер успевает
 * очистить drag data store, и webkitGetAsEntry() начнёт возвращать null.
 * Сам обход entries (entry.file()/readEntries()) уже можно делать асинхронно.
 * Возвращает null, если API недоступно в этом браузере — тогда вызывающий
 * код сам решает откат на плоский dataTransfer.files (без раскрытия папок).
 */
export function readEntriesFromDataTransfer(items: DataTransferItemList): FileSystemEntry[] | null {
	if (!items || items.length === 0 || typeof items[0]?.webkitGetAsEntry !== 'function') return null
	const entries = Array.from(items)
		.map((item) => item.webkitGetAsEntry())
		.filter((entry): entry is FileSystemEntry => Boolean(entry))
	return entries.length ? entries : null
}

/** Обходит все entries параллельно с общим бюджетом и склеивает результат. */
export async function collectEntries(entries: FileSystemEntry[], maxFiles: number): Promise<CollectedFile[]> {
	const budget = { left: maxFiles }
	return (await Promise.all(entries.map((entry) => collectEntry(entry, '', budget)))).flat()
}
