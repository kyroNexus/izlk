import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
const reportData = fs.readFileSync(path.join(process.cwd(), 'src/lib/report-data.ts'), 'utf8')
const access = fs.readFileSync(path.join(process.cwd(), 'src/lib/access.ts'), 'utf8')
assert.match(reportData, /const scope = contractScope\(user\)/)
assert.match(reportData, /contract: scope/)
// 2026-08-18: contractScope no longer restricts MANAGER by managerId (user's
// explicit request — MANAGER sees/edits every contract now). Isolate the
// function body specifically, since taskScope() elsewhere in access.ts still
// legitimately contains the same "role === 'MANAGER'"/"managerId" substrings
// for an unrelated reason (task visibility), which would make a whole-file
// substring check pass for the wrong reason.
const contractScopeBody = access.match(/export function contractScope[\s\S]*?\n}\n/)?.[0]
assert.ok(contractScopeBody, 'contractScope function must exist in access.ts')
assert.ok(!contractScopeBody!.includes("role === 'MANAGER'"), 'contractScope must not restrict MANAGER by managerId anymore')
assert.ok(contractScopeBody!.includes("role === 'VIEWER'"), 'contractScope must still restrict VIEWER to explicit access — nobody asked to change that')
assert.match(reportData, /from > to/) 
const xlsx = fs.readFileSync(path.join(process.cwd(), 'src/lib/report-xlsx.ts'), 'utf8')
assert.match(xlsx, /\^\[=\+\\-@\]/, 'user strings must be escaped against formula injection')
assert.match(xlsx, /dashboard\.canSeeAmounts/, 'financial columns must respect role')
console.log('Report export checks passed: scope, period validation, formula escaping, financial RBAC.')
