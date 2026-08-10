export type ApiAccess = 'authenticated' | 'write' | 'admin'

export type ApiAuthOptions = {
	access: ApiAccess
	csrf?: boolean
	rateLimit?: string
}

export type ApiContext<User> = { user: User; requestId: string }
type ApiHandler<User, Args extends unknown[]> = (request: Request, context: ApiContext<User>, ...args: Args) => Response | Promise<Response>
type Dependencies<User> = {
	getUser: () => Promise<User | null>
	allows: (user: User, access: ApiAccess) => boolean
	isSameOrigin: (request: Request) => boolean
	onUnhandled: (request: Request, requestId: string, durationMs: number, error: unknown) => void
	rateLimit?: (user: User, name: string) => Promise<{ allowed: boolean; retryAfter: number }>
}

function apiError(status: number, error: string, requestId: string, retryAfter?: number) {
	return Response.json({ error, requestId }, { status, headers: retryAfter ? { 'Retry-After': String(retryAfter) } : undefined })
}

export function createApiAuth<User>(dependencies: Dependencies<User>) {
	return function withApiAuth<Args extends unknown[]>(handler: ApiHandler<User, Args>, options: ApiAuthOptions) {
		return async (request: Request, ...args: Args): Promise<Response> => {
			const requestId = crypto.randomUUID()
			const startedAt = Date.now()
			let response: Response
			try {
				if (options.csrf && !dependencies.isSameOrigin(request)) response = apiError(403, 'Cross-site request blocked', requestId)
				else {
					const user = await dependencies.getUser()
					if (!user) response = apiError(401, 'Authentication required', requestId)
					else if (!dependencies.allows(user, options.access)) response = apiError(403, 'Insufficient permissions', requestId)
					else if (options.rateLimit && dependencies.rateLimit) {
						const limit = await dependencies.rateLimit(user, options.rateLimit)
						response = limit.allowed ? await handler(request, { user, requestId }, ...args) : apiError(429, 'Too many requests', requestId, limit.retryAfter)
					} else response = await handler(request, { user, requestId }, ...args)
				}
			} catch (error) {
				dependencies.onUnhandled(request, requestId, Date.now() - startedAt, error)
				response = apiError(500, 'Internal server error', requestId)
			}
			response.headers.set('X-Request-Id', requestId)
			return response
		}
	}
}
