import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma'

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:38080'
const run = `QA-HTTP-${randomUUID().slice(0, 8).toUpperCase()}`
const login = `${run.toLowerCase()}@test.local`
const password = 'qa-import-only-password'

function setCookies(response: Response) {
	const headers = response.headers as Headers & { getSetCookie?: () => string[] }
	const values = headers.getSetCookie?.() ?? (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')!] : [])
	return values.map((item) => item.split(';', 1)[0]).join('; ')
}

function mergeCookies(...headers: string[]) {
	const items = new Map<string, string>()
	for (const header of headers.filter(Boolean)) for (const item of header.split(/, (?=[^;]+?=)/)) {
		const [name] = item.split('=', 1)
		items.set(name, item)
	}
	return [...items.values()].join('; ')
}

function sourceContractFile() {
	return new Blob([[
		`Договор № ${run} от 07.08.2026`,
		'Заказчик: ООО «Тестовый заказчик HTTP-импорта»',
		'ИНН 7707083893',
		'Телефон: +7 (495) 123-45-67',
		'Email: qa-http@example.test',
		'Сумма договора: 1 250 000,00 руб.',
		'Шифр объекта: КБ-QA.26.10',
		'Адрес объекта: г. Москва, тестовый объект HTTP',
	].join('\n')], { type: 'text/plain' })
}

async function requestJson(path: string, options: RequestInit, cookie: string) {
	const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { origin: baseUrl, cookie, ...(options.headers ?? {}) }, redirect: 'manual' })
	const body = await response.json().catch(() => ({}))
	return { response, body }
}

async function main() {
	if (!process.env.DATABASE_URL?.includes('izlk_test_import')) throw new Error('HTTP import test may run only against izlk_test_import.')
	const manager = await prisma.user.create({
		data: { login, email: login, passwordHash: await bcrypt.hash(password, 10), name: 'QA HTTP Manager', role: 'MANAGER' },
	})
	let contractId = ''
	try {
		const csrf = await fetch(`${baseUrl}/api/auth/csrf`)
		assert.equal(csrf.status, 200, 'CSRF endpoint must be available')
		const csrfBody = await csrf.json() as { csrfToken?: string }
		assert.ok(csrfBody.csrfToken, 'CSRF token must be returned')
		const csrfCookie = setCookies(csrf)
		const loginResponse = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
			method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: csrfCookie },
			body: new URLSearchParams({ csrfToken: csrfBody.csrfToken, login, password, callbackUrl: `${baseUrl}/contracts` }),
		})
		assert.ok([302, 303].includes(loginResponse.status), `Login must redirect, got ${loginResponse.status}`)
		const cookie = mergeCookies(csrfCookie, setCookies(loginResponse))
		assert.match(cookie, /authjs\.session-token=/, 'Authenticated session cookie must be issued')

		const parsedForm = new FormData()
		parsedForm.append('file', sourceContractFile(), `${run}-contract.txt`)
		const parsed = await requestJson('/api/contracts/parse', { method: 'POST', body: parsedForm }, cookie)
		assert.equal(parsed.response.status, 200, `Parser failed: ${JSON.stringify(parsed.body)}`)
		assert.equal(parsed.body.contractNumber, run)
		assert.equal(parsed.body.phone, '+7 (495) 123-45-67')
		assert.equal(parsed.body.email, 'qa-http@example.test')
		const officeLockParseForm = new FormData()
		officeLockParseForm.append('file', new Blob(['Office lock']), '~$contract.docx')
		const officeLockParse = await requestJson('/api/contracts/parse', { method: 'POST', body: officeLockParseForm }, cookie)
		assert.equal(officeLockParse.response.status, 400, 'Office lock must not be parsed as a contract')
		const officeLockImportForm = new FormData()
		officeLockImportForm.append('file', new Blob(['Office lock']), '~$contract.docx')
		const officeLockImport = await requestJson('/api/contracts/import', { method: 'POST', body: officeLockImportForm }, cookie)
		assert.equal(officeLockImport.response.status, 400, 'Office lock must not create a contract')

		const createForm = new FormData()
		createForm.append('file', sourceContractFile(), `${run}-contract.txt`)
		for (const [key, value] of Object.entries({
			contractNumber: run, contractDate: '2026-08-07', amount: '1250000.00', contractorName: 'ООО «Тестовый заказчик HTTP-импорта»',
			inn: '7707083893', contractorPhone: '+7 (495) 123-45-67', contractorEmail: 'qa-http@example.test', cipher: 'КБ-QA.26.10',
			objectAddress: 'г. Москва, тестовый объект HTTP', currency: 'RUB', kind: 'SMR',
		})) createForm.append(key, value)
		const created = await requestJson('/api/contracts/import', { method: 'POST', body: createForm }, cookie)
		assert.equal(created.response.status, 200, `Contract creation failed: ${JSON.stringify(created.body)}`)
		contractId = created.body.contractId
		assert.ok(contractId, 'Import must return a contract id')
		const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: { contractor: true, documents: true } })
		assert.equal(contract.managerId, manager.id, 'Imported contract must be assigned to the acting manager')
		assert.equal(contract.contractor.phone, '+7 (495) 123-45-67')
		assert.equal(contract.contractor.email, 'qa-http@example.test')
		assert.equal(contract.documents.filter((document) => document.kind === 'CONTRACT').length, 1)

		const folder = new FormData()
		folder.append('operation', 'attach')
		folder.append('targetContractNumber', run)
		folder.append('files', new Blob(['estimate QA'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${run}-смета.xlsx`)
		folder.append('relativePaths', `${run}/Сметы/${run}-смета.xlsx`)
		folder.append('files', new Blob(['drawing QA']), `${run}-КМ-01.dxf`)
		folder.append('relativePaths', `${run}/КМ/${run}-КМ-01.dxf`)
		folder.append('files', new Blob(['Office lock']), `~$${run}.docx`)
		folder.append('relativePaths', `${run}/~$${run}.docx`)
		folder.append('files', new Blob(['blocked executable']), `${run}-blocked.exe`)
		folder.append('relativePaths', `${run}/${run}-blocked.exe`)
		const attached = await requestJson('/api/contracts/import', { method: 'POST', body: folder }, cookie)
		assert.equal(attached.response.status, 200, `Folder attach failed: ${JSON.stringify(attached.body)}`)
		assert.equal(attached.body.importedFiles, 2, 'Estimate and drawing must be attached')
		assert.equal(attached.body.skippedFiles, 2, 'Office lock and unsafe extension must be skipped')
		const attachedDocuments = await prisma.document.findMany({ where: { contractId }, include: { projectSection: true } })
		assert.ok(attachedDocuments.some((document) => document.kind === 'ESTIMATE'))
		assert.ok(attachedDocuments.some((document) => document.kind === 'PROJECT_DWG' && document.projectSection?.code === 'KM'))
		assert.equal(attachedDocuments.some((document) => document.fileName.startsWith('~$')), false)

		const secondFolder = new FormData()
		secondFolder.append('operation', 'attach')
		secondFolder.append('targetContractNumber', run)
		secondFolder.append('files', new Blob(['estimate QA'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${run}-смета.xlsx`)
		secondFolder.append('relativePaths', `${run}/Сметы/${run}-смета.xlsx`)
		secondFolder.append('files', new Blob(['drawing QA']), `${run}-КМ-01.dxf`)
		secondFolder.append('relativePaths', `${run}/КМ/${run}-КМ-01.dxf`)
		const repeated = await requestJson('/api/contracts/import', { method: 'POST', body: secondFolder }, cookie)
		assert.equal(repeated.response.status, 200, `Repeated folder attach failed: ${JSON.stringify(repeated.body)}`)
		assert.equal(repeated.body.importedFiles, 0, 'Exact duplicates must not be created')
		assert.equal(await prisma.document.count({ where: { contractId } }), 3, 'The package must remain deduplicated')
		console.log('HTTP import flow passed: login → parse → create → folder attach → Office lock skip → duplicate protection.')
	} finally {
		if (contractId) {
			await prisma.contractAccess.deleteMany({ where: { contractId } })
			await prisma.document.deleteMany({ where: { contractId } })
			await prisma.projectSection.deleteMany({ where: { contractId } })
			await prisma.executiveDoc.deleteMany({ where: { contractId } })
			await prisma.site.deleteMany({ where: { contractId } })
			await prisma.contractStageHistory.deleteMany({ where: { contractId } })
			await prisma.contract.delete({ where: { id: contractId } })
		}
		await prisma.contractor.deleteMany({ where: { email: 'qa-http@example.test', contracts: { none: {} } } })
		await prisma.auditLog.deleteMany({ where: { userId: manager.id } })
		await prisma.user.delete({ where: { id: manager.id } })
		await prisma.$disconnect()
	}
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
