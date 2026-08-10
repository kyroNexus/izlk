import { readFile } from 'node:fs/promises'
import path from 'node:path'

type WatcherFile = {
	status?: string
	checkedAt?: string
	inboxPath?: string
	intervalMs?: number
	result?: { queued?: number; duplicates?: number; errors?: number }
	error?: string
}

export async function getInboxWatcherStatus() {
	try {
		const data = JSON.parse(await readFile(path.join(process.cwd(), '.inbox-watcher.json'), 'utf8')) as WatcherFile
		const checkedAt = data.checkedAt ? new Date(data.checkedAt) : null
		const online = data.status === 'RUNNING' && checkedAt !== null && Date.now() - checkedAt.getTime() < Math.max(20_000, (data.intervalMs ?? 5000) * 3)
		return { online, checkedAt, inboxPath: data.inboxPath, result: data.result, error: data.error }
	} catch {
		return { online: false, checkedAt: null, inboxPath: process.env.INBOX_PATH || './inbox', result: undefined, error: undefined }
	}
}
