/**
 * Быстрая SDET-проверка самой рискованной логики перед релизом.
 * Не требует тестовой БД и не меняет реальные данные.
 */
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { parseContractFile, parseContractFolder, parseContractText } = require('../src/lib/contract-parser') as typeof import('../src/lib/contract-parser')
const { contractImportSchema, isValidInn, parseAmount } = require('../src/lib/validation') as typeof import('../src/lib/validation')
const { classifyDocumentPath, detectProjectSectionCode, isTransientSystemFile } = require('../src/lib/document-classifier') as typeof import('../src/lib/document-classifier')
const { configuredPublicOrigin, isSameOriginRequest } = require('../src/lib/request-security') as typeof import('../src/lib/request-security')
const { assertFileContentMatchesName, assertSafeDocumentUpload, repairMojibakeFileName } = require('../src/lib/storage') as typeof import('../src/lib/storage')
const { normalizeCompanyName, normalizePhone } = require('../src/lib/contractor-normalization') as typeof import('../src/lib/contractor-normalization')
const { canTransitionWorkflowStage } = require('../src/lib/workflow-rules') as typeof import('../src/lib/workflow-rules')

async function run() {
	const parsed = parseContractText('765-ДЕМО-СМР-2026.docx', `
ДОГОВОР № 765-ДЕМО-СМР-2026 от 07.08.2026
Заказчик: ООО «СтройИнвест»
ИНН 7707083893
Телефон: +7 (495) 123-45-67
Email: contracts@stroyinvest.example
Цена договора составляет: 5 600 000,00 руб.
Шифр объекта: КБ-812.25.01.20.03
Адрес объекта: г. Москва, ул. Ленина, д. 10
`)
	assert.equal(parsed.contractNumber, '765-ДЕМО-СМР-2026')
	assert.equal(parsed.contractDate, '2026-08-07')
	assert.equal(parsed.amount, '5600000.00')
	assert.equal(parsed.phone, '+7 (495) 123-45-67')
	assert.equal(parsed.email, 'contracts@stroyinvest.example')
	assert.ok(parsed.confidence >= 90)
	const latinContractNumber = parseContractText('contract.txt', 'Договор № QA-UPLOAD-2026 от 07.08.2026\nЗаказчик: ООО «Тестовый заказчик импорта»')
	assert.equal(latinContractNumber.contractNumber, 'QA-UPLOAD-2026')
	assert.equal(latinContractNumber.contractorName, 'ООО «Тестовый заказчик импорта»')
	const noisyContract = parseContractText('731-ИЗЛКРус-СМР-2026.doc', 'Настоящий договор вступает в силу. Заказчик: ИП и стоимость изготовления и монтажа фундаментов. ИНН 9725024975')
	assert.equal(noisyContract.contractNumber, '731-ИЗЛКРус-СМР-2026')
	assert.equal(noisyContract.contractorName, '')
	// A broken PDF text layer must still return a recoverable result. In normal
	// import this exact condition proceeds to OCR rather than aborting the file.
	const brokenPdf = await parseContractFile('broken-scan.pdf', Buffer.from('%PDF-not-a-real-text-layer'), false)
	assert.equal(brokenPdf.fileName, 'broken-scan.pdf')
	assert.ok(brokenPdf.warnings.some((warning) => warning.includes('Текстовый слой') || warning.includes('скан')))

	const folder = await parseContractFolder([
		{ fileName: '765-ДЕМО-СМР-2026 договор.txt', relativePath: '765-ДЕМО-СМР-2026/Договор/договор.txt', buffer: Buffer.from(`Договор № 765-ДЕМО-СМР-2026 от 07.08.2026\nЗаказчик: ООО «СтройИнвест»\nИНН 7707083893\nСумма договора: 5 600 000,00\nШифр: КБ-812.25.01.20.03`) },
		{ fileName: '765-ДЕМО-СМР-2026 смета.xlsx', relativePath: '765-ДЕМО-СМР-2026/Сметы/смета.xlsx', buffer: Buffer.from('Смета') },
		{ fileName: 'Акт скрытых работ.pdf', relativePath: '765-ДЕМО-СМР-2026/Исполнительная/Акт скрытых работ.pdf', buffer: Buffer.from('%PDF demo') },
	])
	assert.equal(folder.parsed.contractNumber, '765-ДЕМО-СМР-2026')
	assert.equal(folder.folder.totalFiles, 3)
	assert.ok(folder.folder.categories.some((category) => category.key === 'contract'))
	const officeLockCheck = await parseContractFolder([
		{ fileName: 'contract.txt', relativePath: 'package/contract.txt', buffer: Buffer.from('contract QA-UPLOAD-2026') },
		{ fileName: '~$contract.docx', relativePath: 'package/~$contract.docx', buffer: Buffer.from('Office lock') },
	])
	assert.equal(officeLockCheck.folder.primaryFile, 'package/contract.txt')
	assert.ok(officeLockCheck.folder.skippedFiles.some((item) => item.fileName.endsWith('~$contract.docx')))
	// Large folders should inspect only the best contract candidates. Files beyond
	// that budget remain available for classification and import, not OCR work.
	const largeFolder = await parseContractFolder(Array.from({ length: 40 }, (_, index) => ({
		fileName: index === 0 ? 'договор QA-UPLOAD-2026.txt' : `приложение-${index}.txt`,
		relativePath: `QA-UPLOAD-2026/${index}.txt`,
		buffer: Buffer.from(index === 0 ? 'Договор № QA-UPLOAD-2026 от 07.08.2026' : `Приложение ${index}`),
	})))
	assert.equal(largeFolder.folder.parsedFiles, 32)
	assert.equal(largeFolder.folder.totalFiles, 40)
	// A budget belonging to an addendum must stay a budget, not become the addendum.
	assert.equal(classifyDocumentPath('765 / Доп. соглашение / Смета к ДС № 2.xlsx'), 'ESTIMATE')
	assert.equal(classifyDocumentPath('765 / Доп. соглашение № 2.docx'), 'AGREEMENT')
	// A real package can mix Russian folder names, English labels and DXF drawings.
	// They must go to a project section instead of flooding the common document list.
	assert.equal(detectProjectSectionCode('731/КМ/Чертежи/лист-01.dxf'), 'KM')
	assert.equal(detectProjectSectionCode('731/kzh/foundation.pdf'), 'KZH')
	assert.equal(detectProjectSectionCode('731/АР/планировка.dwg'), 'AR')
	assert.equal(classifyDocumentPath('731/КМ/Чертежи/лист-01.dxf'), 'PROJECT_DWG')

	assert.equal(parseAmount('5 600 000,00'), '5600000.00')
	assert.equal(isTransientSystemFile('731/~$contract-731.docx'), true)
	assert.equal(isTransientSystemFile('731/contract-731.docx'), false)
	assert.equal(assertSafeDocumentUpload('../safe-contract.pdf'), 'safe-contract.pdf')
	assert.doesNotThrow(() => assertFileContentMatchesName('scan.pdf', Buffer.from('%PDF-1.7')))
	assert.doesNotThrow(() => assertFileContentMatchesName('photo.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])))
	assert.throws(() => assertFileContentMatchesName('invoice.pdf', Buffer.from('<script>alert(1)</script>')))
	assert.throws(() => assertFileContentMatchesName('photo.jpg', Buffer.from('%PDF-1.7')))
	const brokenRussianPhotoName = Buffer.from('Изображение WhatsApp 2025-11-15.jpg', 'utf8').toString('latin1')
	assert.equal(repairMojibakeFileName(brokenRussianPhotoName), 'Изображение WhatsApp 2025-11-15.jpg')
	assert.throws(() => assertSafeDocumentUpload('unsafe.exe'))
	assert.equal(parseAmount('-1'), null)
	assert.equal(isValidInn('7707083893'), true)
	assert.equal(isValidInn('7707083890'), false)
	// The same counterparty often comes from 1C, scans and folders with different
	// punctuation/company prefixes. Matching must remain deterministic.
	assert.equal(normalizePhone('8 (495) 123-45-67'), '74951234567')
	assert.equal(normalizePhone('+7 495 123 45 67'), '74951234567')
	assert.equal(normalizeCompanyName('ООО «Строй-Инвест»'), normalizeCompanyName('Строй Инвест'))

	// A contract moves through departments in a fixed order. Skipping a stage must
	// stay impossible outside of an explicit administrative recovery action.
	assert.equal(canTransitionWorkflowStage('DESIGN', 'WAITING_PRODUCTION'), true)
	assert.equal(canTransitionWorkflowStage('WAITING_PRODUCTION', 'PRODUCTION'), true)
	assert.equal(canTransitionWorkflowStage('PRODUCTION', 'AWAITING_SHIPMENT'), true)
	assert.equal(canTransitionWorkflowStage('DESIGN', 'PRODUCTION'), false)
	assert.equal(canTransitionWorkflowStage('INSTALL_KZH', 'CLOSED'), false)

	const validImport = contractImportSchema.safeParse({
		number: '765-ДЕМО-СМР-2026', date: '2026-08-07', amount: '5600000.00',
		contractorName: 'ООО «СтройИнвест»', inn: '7707083893', cipher: 'КБ-812.25.01.20.03',
		objectAddress: 'г. Москва, ул. Ленина, д. 10', currency: 'RUB', kind: 'SMR',
	})
	assert.equal(validImport.success, true)
	const invalidImport = contractImportSchema.safeParse({ ...validImport.data, inn: '1234567890' })
	assert.equal(invalidImport.success, false)

	// A Docker-internal localhost URL must not send a browser back to localhost
	// after an upload when the user opened the public VPS address.
	const previousAuthUrl = process.env.AUTH_URL
	process.env.AUTH_URL = 'http://localhost:3000'
	const publicRequest = new Request('http://localhost:3000/api/contracts/test/documents', {
		headers: { host: '195.93.252.155:80', origin: 'http://195.93.252.155' },
	})
	assert.equal(configuredPublicOrigin(publicRequest), 'http://195.93.252.155')
	assert.equal(isSameOriginRequest(publicRequest), true)
	if (previousAuthUrl === undefined) delete process.env.AUTH_URL
	else process.env.AUTH_URL = previousAuthUrl

	console.log('Critical flow checks passed: parser, folder import, and validation.')
}

run().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
