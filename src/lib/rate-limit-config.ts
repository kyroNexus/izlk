import { createHash } from 'node:crypto'

export const RATE_LIMITS = {
	'contract-parse': { limit: 10, windowMs: 5 * 60_000 },
	'estimate-preview': { limit: 10, windowMs: 5 * 60_000 },
	'contract-import': { limit: 5, windowMs: 10 * 60_000 },
	'inbox-scan': { limit: 2, windowMs: 60_000 },
	'contract-download': { limit: 5, windowMs: 10 * 60_000 },
	'document-download': { limit: 30, windowMs: 10 * 60_000 },
	'chat-message': { limit: 30, windowMs: 5 * 60_000 },
	'stage-comment': { limit: 20, windowMs: 5 * 60_000 },
	'task-attachment': { limit: 20, windowMs: 5 * 60_000 },
	'document-rule': { limit: 30, windowMs: 5 * 60_000 },
} as const

export type RateLimitName = keyof typeof RATE_LIMITS

export function machineRateLimitIdentity(token: string) {
	return `token:${createHash('sha256').update(token).digest('hex')}`
}
