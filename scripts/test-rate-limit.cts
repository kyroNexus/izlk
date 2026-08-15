import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RATE_LIMITS, machineRateLimitIdentity } from '../src/lib/rate-limit-config'

assert.deepEqual(RATE_LIMITS['contract-parse'], { limit: 10, windowMs: 5 * 60_000 })
assert.deepEqual(RATE_LIMITS['contract-import'], { limit: 5, windowMs: 10 * 60_000 })
assert.deepEqual(RATE_LIMITS['inbox-scan'], { limit: 2, windowMs: 60_000 })
assert.deepEqual(RATE_LIMITS['contract-download'], { limit: 5, windowMs: 10 * 60_000 })
assert.deepEqual(RATE_LIMITS['chat-message'], { limit: 30, windowMs: 5 * 60_000 })
assert.deepEqual(RATE_LIMITS['stage-comment'], { limit: 20, windowMs: 5 * 60_000 })
assert.notEqual(machineRateLimitIdentity('one'), machineRateLimitIdentity('two'))
assert.ok(!machineRateLimitIdentity('one').includes('one'))

// A3: both POST endpoints that let a user flood the db with rows must actually
// declare the withApiAuth rateLimit option, not just have a config entry sitting unused.
const chatsRoute = readFileSync('src/app/api/chats/[scope]/[id]/route.ts', 'utf8')
const stageCommentsRoute = readFileSync('src/app/api/contracts/[id]/stage-comments/route.ts', 'utf8')
assert.match(chatsRoute, /POST = withApiAuth\(post, \{ access: 'write', csrf: true, rateLimit: 'chat-message' \}\)/, 'chat POST must be rate-limited')
assert.match(stageCommentsRoute, /POST = withApiAuth\(post, \{ access: 'write', csrf: true, rateLimit: 'stage-comment' \}\)/, 'stage-comment POST must be rate-limited')

console.log('Rate limit configuration checks passed.')
