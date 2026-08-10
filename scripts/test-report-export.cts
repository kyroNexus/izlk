import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const reportData = fs.readFileSync(path.join(process.cwd(), 'src/lib/report-data.ts'), 'utf8')
const access = fs.readFileSync(path.join(process.cwd(), 'src/lib/access.ts'), 'utf8')
assert.match(reportData, /const scope = contractScope\(user\)/)
assert.match(reportData, /contract: scope/)
assert.ok(access.includes("user.role === 'MANAGER'") && access.includes('managerId: user.id'))
assert.match(reportData, /from > to/) 
const xlsx = fs.readFileSync(path.join(process.cwd(), 'src/lib/report-xlsx.ts'), 'utf8')
assert.match(xlsx, /\^\[=\+\\-@\]/, 'user strings must be escaped against formula injection')
assert.match(xlsx, /dashboard\.canSeeAmounts/, 'financial columns must respect role')
console.log('Report export checks passed: scope, period validation, formula escaping, financial RBAC.')
