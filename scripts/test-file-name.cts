import assert from 'node:assert/strict'
import { renamedFileName } from '../src/lib/file-name'

assert.equal(renamedFileName('Счёт №1.pdf', 'Счёт август'), 'Счёт август.pdf')
assert.equal(renamedFileName('архив.tar.gz', 'резервная копия'), 'резервная копия.gz')
assert.equal(renamedFileName('без-расширения', 'новое имя'), 'новое имя')
assert.equal(renamedFileName('документ.pdf', '../секрет'), null)
assert.equal(renamedFileName('документ.pdf', '   '), null)

console.log('file name checks passed')
