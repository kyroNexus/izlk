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
const uploadRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/contracts/[id]/documents/route.ts'), 'utf8')
const importRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/contracts/import/route.ts'), 'utf8')
const inboxScanner = fs.readFileSync(path.join(process.cwd(), 'src/lib/inbox-scanner.ts'), 'utf8')
for (const [name, source] of [['upload', uploadRoute], ['import', importRoute], ['inbox', inboxScanner]] as const) {
	assert.match(source, /routeDocument\(/, `${name} flow must use the shared document router`)
	assert.match(source, /sourceDataKind/, `${name} flow must persist source-data subtype`)
	assert.match(source, /(?:tryConfirm|confirm)SignedPr1Workflow/, `${name} flow must reuse the signed PR1 workflow`)
}
assert.match(uploadRoute, /item\.number === \(agreementNumberRaw \|\| routed\.agreementNumber\)/, 'explicit agreement number must win over routing')
assert.match(inboxScanner, /mayUseFolderFallback = !route\.contractNumberShort \|\| Boolean\(route\.pr1SignedAt\)/, 'unknown short numbers must stay queued except mismatched PR1 attachments')
console.log('Document checks passed: bulk safety and routing wired into upload/import/inbox.')
