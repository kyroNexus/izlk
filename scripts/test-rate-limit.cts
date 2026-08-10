import assert from 'node:assert/strict'
import { RATE_LIMITS, machineRateLimitIdentity } from '../src/lib/rate-limit-config'

assert.deepEqual(RATE_LIMITS['contract-parse'], { limit: 10, windowMs: 5 * 60_000 })
assert.deepEqual(RATE_LIMITS['contract-import'], { limit: 5, windowMs: 10 * 60_000 })
assert.deepEqual(RATE_LIMITS['inbox-scan'], { limit: 2, windowMs: 60_000 })
assert.deepEqual(RATE_LIMITS['contract-download'], { limit: 5, windowMs: 10 * 60_000 })
assert.notEqual(machineRateLimitIdentity('one'), machineRateLimitIdentity('two'))
assert.ok(!machineRateLimitIdentity('one').includes('one'))
console.log('Rate limit configuration checks passed.')
