import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DOCUMENT_BATCH_MAX, documentBulkInput } from '../src/lib/document-bulk'

const id = 'clw1234567890123456789012'
assert.equal(documentBulkInput.safeParse({ action: 'archive', ids: [id] }).success, true)
assert.equal(documentBulkInput.safeParse({ action: 'archive', ids: Array.from({ length: DOCUMENT_BATCH_MAX + 1 }, (_, i) => `${id.slice(0, -1)}${i}`) }).success, false)
assert.equal(documentBulkInput.safeParse({ action: 'archive', ids: [id, id] }).success, false)
const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/documents/bulk/route.ts'), 'utf8')
assert.match(route, /contract: contractScope\(user\)/, 'every batch lookup must be contract-scoped')
assert.match(route, /input\.action !== 'download' && !canWrite\(user\)/, 'metadata mutations must require write permission')
assert.match(route, /consumeRateLimit\('contract-download'/, 'ZIP must be rate-limited')
console.log('Document bulk checks passed: validation, RBAC scope, and ZIP limit.')
