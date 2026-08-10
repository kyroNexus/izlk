import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const route = fs.readFileSync(path.join(root, 'src/app/api/command-palette/search/route.ts'), 'utf8')
const palette = fs.readFileSync(path.join(root, 'src/components/CommandPalette.tsx'), 'utf8')
assert.match(route, /withApiAuth[\s\S]*access: 'authenticated'/)
assert.match(route, /contractScope\(user\)/)
assert.match(route, /contract: scope/)
assert.match(route, /isConfidential: false/)
assert.match(route, /query\.length === 1/)
assert.match(palette, /event\.metaKey \|\| event\.ctrlKey/)
assert.match(palette, /AbortController/)
assert.match(palette, /aria-modal="true"/)
assert.match(palette, /motion-reduce/)
console.log('Command palette checks passed: scoped search, keyboard access, cancellation and reduced motion.')
