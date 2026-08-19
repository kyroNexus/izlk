import assert from 'node:assert/strict'
import { isLibraryPathIgnored } from '../src/lib/library-ignore'

const defaults = [
	{ type: 'NAME_PATTERN', value: '~$*', enabled: true },
	{ type: 'NAME_PATTERN', value: 'Thumbs.db', enabled: true },
	{ type: 'NAME_PATTERN', value: 'desktop.ini', enabled: true },
	{ type: 'EXTENSION', value: '.bak', enabled: true },
	{ type: 'EXTENSION', value: '.lnk', enabled: true },
	{ type: 'EXTENSION', value: '.log', enabled: true },
	{ type: 'EXTENSION', value: '.tmp', enabled: true },
	{ type: 'SUBTREE', value: '_мусор', enabled: true },
	{ type: 'SUBTREE', value: 'мусор', enabled: true },
] as const

assert.equal(isLibraryPathIgnored('Договор/~$смета.xlsx', false, [...defaults]), true)
assert.equal(isLibraryPathIgnored('Договор/Thumbs.db', false, [...defaults]), true)
assert.equal(isLibraryPathIgnored('Договор/смета.xlsx.tmp', false, [...defaults]), true)
assert.equal(isLibraryPathIgnored('_мусор/сотрудник/файл.pdf', false, [...defaults]), true)
assert.equal(isLibraryPathIgnored('Договор/смета.xlsx', false, [...defaults]), false)
assert.equal(isLibraryPathIgnored('Договор/смета.bak', false, [{ type: 'EXTENSION', value: '.bak', enabled: false }]), false)
console.log('Library ignore-rule defaults preserve Inbox exclusions.')
