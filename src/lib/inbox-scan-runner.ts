import { scanInbox } from '@/lib/inbox-scanner'
import { acquireRateLimitLock, consumeRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export async function runRateLimitedInboxScan(identity: string) {
	const startedAt = Date.now()
	const lock = await acquireRateLimitLock('inbox-scan', 30 * 60_000)
	if (!lock) return { result: null, retryAfter: 30 }
	try {
		const limit = await consumeRateLimit('inbox-scan', identity)
		if (!limit.allowed) return { result: null, retryAfter: limit.retryAfter }
		const result = await scanInbox()
		logger.info('inbox.scan_completed', { durationMs: Date.now() - startedAt, entityType: 'Inbox' })
		return { result, retryAfter: null }
	} catch (error) {
		logger.error('inbox.scan_failed', { durationMs: Date.now() - startedAt, entityType: 'Inbox', error })
		throw error
	} finally {
		await lock.release()
	}
}
