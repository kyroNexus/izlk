import { readFile } from 'node:fs/promises'
import path from 'node:path'

type WatcherFile = {
	status?: string
	checkedAt?: string
	inboxPath?: string
	intervalMs?: number
	result?: { queued?: number; duplicates?: number; errors?: number; archivesExpanded?: number }
	error?: string
	// Задача D3: раз в сутки watcher сам проверяет, что pdftoppm/tesseract
	// вообще есть на сервере — не дожидаясь, пока это всплывёт на реальном скане.
	ocr?: { ok: boolean; issues: string[] } | null
}

export async function getInboxWatcherStatus() {
	try {
		const data = JSON.parse(await readFile(path.join(process.cwd(), '.inbox-watcher.json'), 'utf8')) as WatcherFile
		const checkedAt = data.checkedAt ? new Date(data.checkedAt) : null
		const online = data.status === 'RUNNING' && checkedAt !== null && Date.now() - checkedAt.getTime() < Math.max(20_000, (data.intervalMs ?? 5000) * 3)
		return { online, checkedAt, inboxPath: data.inboxPath, result: data.result, error: data.error, ocr: data.ocr ?? null }
	} catch {
		return { online: false, checkedAt: null, inboxPath: process.env.INBOX_PATH || './inbox', result: undefined, error: undefined, ocr: null }
	}
}
