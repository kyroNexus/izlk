import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runRateLimitedInboxScan } from '../src/lib/inbox-scan-runner'
import { INBOX_PATH } from '../src/lib/storage'
import { prisma } from '../src/lib/prisma'
import { purgeExpiredTrash } from '../src/lib/trash'
import { checkOcrHealth, type OcrHealthResult } from '../src/lib/contract-parser'

const intervalMs = Math.max(3000, Number(process.env.INBOX_SCAN_INTERVAL_MS || 5000))
const heartbeatPath = path.join(process.cwd(), '.inbox-watcher.json')
let stopping = false
let lastTrashCleanup = 0
// Задача D3: раз в сутки, не на каждом 5-секундном цикле — сам факт наличия
// бинарников почти никогда не меняется без пересборки контейнера (которая и
// так перезапускает процесс), гонять две лишние execFile каждые 5 секунд смысла нет.
let lastOcrCheck = 0
let lastOcrResult: OcrHealthResult | null = null

async function heartbeat(data: Record<string, unknown>) {
	await writeFile(heartbeatPath, JSON.stringify({ pid: process.pid, inboxPath: INBOX_PATH, intervalMs, ...data }, null, 2), 'utf8')
}

async function cycle() {
	const startedAt = new Date()
	try {
		const operation = await runRateLimitedInboxScan('system:watch-inbox')
		if (!operation.result) return
		const result = operation.result
		if (Date.now() - lastTrashCleanup > 24 * 60 * 60 * 1000) {
			await purgeExpiredTrash()
			lastTrashCleanup = Date.now()
		}
		if (Date.now() - lastOcrCheck > 24 * 60 * 60 * 1000) {
			lastOcrResult = await checkOcrHealth().catch((error) => ({ ok: false, issues: [error instanceof Error ? error.message : 'Не удалось проверить OCR'] }))
			lastOcrCheck = Date.now()
			if (!lastOcrResult.ok) console.error(`[OCR] ${lastOcrResult.issues.join(' ')}`)
		}
		await heartbeat({ status: 'RUNNING', startedAt, checkedAt: new Date(), result, ocr: lastOcrResult })
		if (result.queued || result.errors || result.archivesExpanded) console.log(`[${new Date().toLocaleTimeString('ru-RU')}] В очередь: ${result.queued}; копий: ${result.duplicates}; архивов распаковано: ${result.archivesExpanded}; ошибок: ${result.errors}`)
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
		await heartbeat({ status: 'ERROR', startedAt, checkedAt: new Date(), error: message })
		console.error(`[сканер] ${message}`)
	}
}

async function main() {
	await mkdir(INBOX_PATH, { recursive: true })
	console.log(`Автосканер запущен: ${INBOX_PATH}`)
	console.log(`Интервал проверки: ${Math.round(intervalMs / 1000)} сек.`)
	while (!stopping) {
		await cycle()
		await new Promise((resolve) => setTimeout(resolve, intervalMs))
	}
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true })

main()
	.catch((error) => { console.error(error); process.exitCode = 1 })
	.finally(async () => {
		await heartbeat({ status: 'STOPPED', checkedAt: new Date() }).catch(() => undefined)
		await prisma.$disconnect()
	})
