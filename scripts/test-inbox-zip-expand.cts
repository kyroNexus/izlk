import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { expandInboxZips } from '../src/lib/inbox-scanner'

async function main() {
	const dir = await mkdtemp(path.join(tmpdir(), 'izlk-zip-test-'))
	try {
		// A normal archive with a nested folder — must extract with the same structure.
		const zip = new JSZip()
		zip.file('Договор.pdf', 'contract text')
		zip.file('Сметы/смета1.xlsx', 'estimate content')
		const zipPath = path.join(dir, 'Архив.zip')
		await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }))

		const first = await expandInboxZips([zipPath])
		assert.equal(first.expanded.size, 1, 'archive must be reported as expanded')
		assert.equal(first.failed.size, 0, 'a well-formed archive must not fail')
		assert.equal(await readFile(path.join(dir, 'Архив', 'Договор.pdf'), 'utf8'), 'contract text', 'top-level entry must be extracted with its content intact')
		assert.equal(await readFile(path.join(dir, 'Архив', 'Сметы', 'смета1.xlsx'), 'utf8'), 'estimate content', 'nested folder structure inside the archive must be preserved')

		// Idempotency: a second pass over the SAME zip must not re-extract — the
		// target folder already exists, so a file someone edited by hand after
		// extraction must survive the next scan cycle untouched.
		await writeFile(path.join(dir, 'Архив', 'Договор.pdf'), 'edited by hand after extraction')
		const second = await expandInboxZips([zipPath])
		assert.equal(second.expanded.size, 1, 'an already-expanded archive is still reported as expanded, so the caller skips it as a regular file')
		assert.equal(await readFile(path.join(dir, 'Архив', 'Договор.pdf'), 'utf8'), 'edited by hand after extraction', 'a re-scan must not overwrite a file already touched after extraction')

		// Zip-slip: an entry path escaping the target directory must be dropped,
		// not written outside it — a legitimate sibling entry in the same
		// archive must still be extracted normally.
		const evilZip = new JSZip()
		evilZip.file('../../evil.txt', 'should never land outside the target folder')
		evilZip.file('safe.txt', 'this one is fine')
		const evilZipPath = path.join(dir, 'Вредный.zip')
		await writeFile(evilZipPath, await evilZip.generateAsync({ type: 'nodebuffer' }))
		await expandInboxZips([evilZipPath])
		await assert.rejects(readFile(path.join(dir, 'evil.txt')), 'a zip-slip entry must not escape the target directory')
		assert.equal(await readFile(path.join(dir, 'Вредный', 'safe.txt'), 'utf8'), 'this one is fine', 'a legitimate entry in the same archive must still be extracted')

		console.log('Inbox zip expansion checks passed: extraction, nested folders, idempotency, zip-slip protection.')
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
