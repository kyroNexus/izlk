import assert from 'node:assert/strict'
import fs from 'node:fs'
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

// D4: a timed page load logs how much data there was (a count), never the data itself.
log('info', 'dashboard.loaded', { durationMs: 340, count: 57, userId: 'user-1' })
const timed = JSON.parse(lines[1])
assert.equal(timed.count, 57)
assert.equal(timed.durationMs, 340)
log('info', 'no_count_event', {})
const untimed = JSON.parse(lines[2])
assert.equal('count' in untimed, false, 'count must be omitted, not written as 0/undefined, when nothing was measured')

// The two D4 call sites must actually be wired, not just possible in principle.
const dashboardSrc = fs.readFileSync('src/lib/dashboard.ts', 'utf8')
assert.match(dashboardSrc, /logger\.info\('dashboard\.loaded', \{ durationMs: Date\.now\(\) - startedAt/, 'loadDashboard must log its own duration')
const contractPageSrc = fs.readFileSync('src/app/(dashboard)/contracts/[id]/page.tsx', 'utf8')
assert.match(contractPageSrc, /logger\.info\('contract\.loaded', \{/, 'the contract card page must log its load duration')

console.log('Technical logger checks passed: redaction, count field, D4 timing call sites wired.')
