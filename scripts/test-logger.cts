import assert from 'node:assert/strict'
import { createLogger } from '../src/lib/logger'

const lines: string[] = []
const log = createLogger((_level, line) => lines.push(line))
const failure = new Error('storage unavailable; token=secret; Bearer another-secret')
log('error', 'document.read_failed', { requestId: 'request-1', route: '/api/documents/id', method: 'GET', durationMs: 12, userId: 'user-1', entityType: 'Document', entityId: 'document-1', error: failure, headers: { authorization: 'secret' } } as never)
const entry = JSON.parse(lines[0])
assert.equal(entry.level, 'error')
assert.equal(entry.event, 'document.read_failed')
assert.equal(entry.requestId, 'request-1')
assert.equal(entry.error.name, 'Error')
assert.equal(entry.error.message, 'storage unavailable; token=[REDACTED]; Bearer [REDACTED]')
assert.ok(entry.timestamp)
assert.equal(entry.headers, undefined)
console.log('Technical logger checks passed.')
