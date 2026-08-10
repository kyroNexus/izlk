import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
const css = read('src/app/globals.css')
const shell = read('src/components/DashboardShell.tsx')
const ui = read('src/components/ui.tsx')
const contracts = read('src/app/(dashboard)/contracts/page.tsx')

assert.match(css, /prefers-reduced-motion/)
assert.match(css, /table thead th \{ position: sticky/)
assert.match(css, /data-table-density='compact'/)
assert.match(shell, /izlk-table-density/)
assert.match(shell, /aria-pressed/)
assert.match(ui, /export function RichEmptyState/)
assert.match(contracts, /Нет назначенных договоров/)
assert.match(contracts, /<Icon icon=\{Folder\}/)
console.log('Design-system checks passed: icons, empty state, density, sticky headers, and reduced motion.')
