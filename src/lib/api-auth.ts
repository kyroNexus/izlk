import { canWrite, getActiveUser, isAdmin, type SessionUser } from '@/lib/access'
import { isSameOriginRequest } from '@/lib/request-security'
import { createApiAuth, type ApiAccess, type ApiAuthOptions } from '@/lib/api-auth-core'
import { consumeRateLimit, type RateLimitName } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export type { ApiAccess, ApiAuthOptions }

export const withApiAuth = createApiAuth<SessionUser>({
	getUser: getActiveUser,
	allows: (user, access) => access === 'authenticated' || (access === 'write' ? canWrite(user) : isAdmin(user)),
	isSameOrigin: isSameOriginRequest,
	rateLimit: (user, name) => consumeRateLimit(name as RateLimitName, `user:${user.id}`),
	onUnhandled: (request, requestId, durationMs, error) => {
		// Deliberately excludes request headers/body: they may contain credentials or documents.
		logger.error('api.unhandled_error', { requestId, method: request.method, route: new URL(request.url).pathname, durationMs, error })
	},
})
