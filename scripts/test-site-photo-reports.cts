import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { siteReportPayloadSchema } from '../src/lib/site-report-payload'
import { assertFileContentMatchesName, assertSafePhotoUpload, sha256Buffer } from '../src/lib/storage'

const valid = { clientSubmissionId: 'd26501ac-1e39-45a8-a8f3-e461ad2c1c1e', direction: 'KJ', workDate: '2026-08-11', stage: 'Монтаж колонн', crew: [{ name: 'Иванов', days: 1, rate: 2000 }], costs: [{ category: 'MATERIAL', name: 'Бетон', payment: 'CASHLESS', quantity: 1, price: 1000 }] }
assert.equal(siteReportPayloadSchema.safeParse(valid).success, true)
assert.equal(siteReportPayloadSchema.safeParse({ ...valid, direction: 'OTHER' }).success, false)
assert.equal(siteReportPayloadSchema.safeParse({ ...valid, crew: [{ ...valid.crew[0], days: -1 }] }).success, false)
assert.equal(assertSafePhotoUpload('../photo.jpg'), 'photo.jpg')
assert.throws(() => assertSafePhotoUpload('photo.exe'))
assert.doesNotThrow(() => assertFileContentMatchesName('photo.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])))
assert.throws(() => assertFileContentMatchesName('photo.jpg', Buffer.from('%PDF-1.7')))
assert.equal(sha256Buffer(Buffer.from('photo')), sha256Buffer(Buffer.from('photo')))
const createRoute = readFileSync('src/app/api/sites/[id]/reports/route.ts', 'utf8')
const uploadRoute = readFileSync('src/app/api/site-reports/[id]/photos/route.ts', 'utf8')
assert.match(createRoute, /withApiAuth\(post, \{ access: 'write', csrf: true \}\)/)
assert.match(uploadRoute, /withApiAuth\(post, \{ access: 'write', csrf: true \}\)/)
assert.match(uploadRoute, /siteWorkId_sha256/)
console.log('Mobile site photo report checks passed.')
