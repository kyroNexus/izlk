import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { RATE_LIMITS, type RateLimitName } from '@/lib/rate-limit-config'

export { machineRateLimitIdentity, RATE_LIMITS, type RateLimitName } from '@/lib/rate-limit-config'
export type RateLimitResult = { allowed: boolean; retryAfter: number }

let cleanupAfter = 0

function maybeCleanExpiredBuckets(now: Date) {
	if (now.getTime() < cleanupAfter) return
	cleanupAfter = now.getTime() + 5 * 60_000
	void prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => undefined)
}

export async function consumeRateLimit(name: RateLimitName, identity: string): Promise<RateLimitResult> {
	const now = new Date()
	const config = RATE_LIMITS[name]
	const expiresAt = new Date(now.getTime() + config.windowMs)
	const key = `rate:${name}:${identity}`
	const [bucket] = await prisma.$queryRaw<Array<{ count: number; expiresAt: Date }>>`
		INSERT INTO "RateLimitBucket" ("key", "count", "expiresAt", "updatedAt")
		VALUES (${key}, 1, ${expiresAt}, ${now})
		ON CONFLICT ("key") DO UPDATE SET
			"count" = CASE WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
			"expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${expiresAt} ELSE "RateLimitBucket"."expiresAt" END,
			"updatedAt" = ${now}
		RETURNING "count", "expiresAt"
	`
	maybeCleanExpiredBuckets(now)
	return { allowed: bucket.count <= config.limit, retryAfter: Math.max(1, Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000)) }
}

export async function acquireRateLimitLock(name: string, ttlMs: number) {
	const now = new Date()
	const expiresAt = new Date(now.getTime() + ttlMs)
	const token = randomUUID()
	const key = `lock:${name}`
	const rows = await prisma.$queryRaw<Array<{ key: string }>>`
		INSERT INTO "RateLimitBucket" ("key", "count", "expiresAt", "lockToken", "updatedAt")
		VALUES (${key}, 1, ${expiresAt}, ${token}, ${now})
		ON CONFLICT ("key") DO UPDATE SET
			"count" = 1, "expiresAt" = ${expiresAt}, "lockToken" = ${token}, "updatedAt" = ${now}
		WHERE "RateLimitBucket"."expiresAt" <= ${now}
		RETURNING "key"
	`
	if (!rows.length) return null
	// ponytail: global Inbox lock; split by inbox source only if separate scanners are added.
	return { release: () => prisma.rateLimitBucket.deleteMany({ where: { key, lockToken: token } }).then(() => undefined) }
}
