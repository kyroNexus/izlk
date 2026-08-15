type LogLevel = 'info' | 'warn' | 'error'

export type TechnicalLog = {
	requestId?: string
	route?: string
	method?: string
	durationMs?: number
	userId?: string
	entityType?: string
	entityId?: string
	/** Row count behind a timed load — never the data itself, just how much of it there was. */
	count?: number
	error?: unknown
}

type WriteLine = (level: LogLevel, line: string) => void

function errorDetails(error: unknown) {
	const redact = (value: string) => value.replace(/\b(authorization|cookie|password|token)\s*[:=]\s*[^\s;,]+|\bbearer\s+[^\s;,]+/gi, (match, key) => key ? `${key}=[REDACTED]` : 'Bearer [REDACTED]')
	if (error instanceof Error) return { name: error.name, message: redact(error.message), stack: error.stack && redact(error.stack) }
	return { name: 'Error', message: redact(String(error)) }
}

function defaultWrite(level: LogLevel, line: string) {
	console[level === 'info' ? 'log' : level](line)
}

export function createLogger(write: WriteLine = defaultWrite) {
	return (level: LogLevel, event: string, context: TechnicalLog = {}) => {
		const { requestId, route, method, durationMs, userId, entityType, entityId, count, error } = context
		write(level, JSON.stringify({
			timestamp: new Date().toISOString(),
			level,
			event,
			...(requestId ? { requestId } : {}),
			...(route ? { route } : {}),
			...(method ? { method } : {}),
			...(typeof durationMs === 'number' ? { durationMs } : {}),
			...(userId ? { userId } : {}),
			...(entityType ? { entityType } : {}),
			...(entityId ? { entityId } : {}),
			...(typeof count === 'number' ? { count } : {}),
			...(error === undefined ? {} : { error: errorDetails(error) }),
		}))
	}
}

const write = createLogger()
export const logger = {
	info: (event: string, context?: TechnicalLog) => write('info', event, context),
	warn: (event: string, context?: TechnicalLog) => write('warn', event, context),
	error: (event: string, context?: TechnicalLog) => write('error', event, context),
}
