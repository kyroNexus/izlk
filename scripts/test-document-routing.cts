import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { matchDocumentContract, routeDocument } from '../src/lib/document-routing'
import type { DocumentRouteRuleInput } from '../src/lib/document-route-rules'

const contract = { id: 'contract-731', number: '731-ИЗЛКРус-СМР-2026', date: new Date('2026-01-01') }
const route = (fileName: string) => routeDocument(fileName)

assert.deepEqual(route('Счет на оплату №326 от 29.06.26.pdf'), { kind: 'INVOICE', state: 'SOURCE', invoiceNumber: '326', invoiceDate: '2026-06-29' })
for (const extension of ['pdf', 'docx']) assert.deepEqual(route(`Доп. соглашение №2 к 731-ИЗЛКРус-СМР-2026.${extension}`), {
	kind: 'AGREEMENT', state: extension === 'pdf' ? 'SIGNED' : 'SOURCE', agreementNumber: '2', contractNumberFull: '731-ИЗЛКРус-СМР-2026', contractNumberShort: '731',
})
assert.deepEqual(route('731-ИЗЛКРус-СМР-2026 №2 График к ДС №1.pdf'), {
	kind: 'APPENDIX', state: 'SIGNED', agreementNumber: '1', contractNumberFull: '731-ИЗЛКРус-СМР-2026', contractNumberShort: '731',
})
assert.deepEqual(route('731-ИЗЛКРус-СМР-2026 №1,2 Смета, График к ДС №1.xlsx'), {
	kind: 'ESTIMATE', state: 'SOURCE', agreementNumber: '1', contractNumberFull: '731-ИЗЛКРус-СМР-2026', contractNumberShort: '731',
})
assert.deepEqual(route('731-ИЗЛКРус-СМР-2026 №1 Смета к ДС №1.docx'), {
	kind: 'ESTIMATE', state: 'SOURCE', agreementNumber: '1', contractNumberFull: '731-ИЗЛКРус-СМР-2026', contractNumberShort: '731',
})
assert.deepEqual(route('ПОДПИСАНО_25.02.2026 Пр.№1 (731).pdf'), {
	kind: 'APPENDIX', state: 'SIGNED', pr1SignedAt: '2026-02-25', contractNumberShort: '731',
})
for (const fileName of ['Отчет ИГИ (731).pdf', 'ИГИ (731).pdf']) assert.deepEqual(route(fileName), {
	kind: 'SOURCE_DATA', state: 'SOURCE', sourceDataKind: 'IGI', contractNumberShort: '731',
})
assert.deepEqual(route('КЖ/СМР-2026 КБ-300.16.21.52.60-КЖ-731.dwg'), {
	kind: 'PROJECT_DWG', state: 'SOURCE', cipher: 'КБ-300.16.21.52.60', sectionCode: 'KZH',
})
assert.equal(route('731_КМ_КМД_кровля.dwg').sectionCode, 'KM')

assert.notEqual(route('логистика.pdf').kind, 'SOURCE_DATA')
assert.equal(route('Пр.№10 отчет.pdf').pr1SignedAt, undefined)
assert.equal(route('Смета к договору.pdf').agreementNumber, undefined)
assert.equal(matchDocumentContract(route('ПОДПИСАНО Пр.№1 (999).pdf'), [contract]).contract, null)
assert.equal(matchDocumentContract(route('ПОДПИСАНО Пр.№1 (731).pdf'), [contract]).contract?.id, contract.id)

const customRule: DocumentRouteRuleInput = { id: 'custom-gpzu', target: 'SOURCE_DATA:GPZU', pattern: 'уникальный-тестер', enabled: true, sortOrder: 1, note: null }
assert.deepEqual(routeDocument('уникальный-тестер.pdf', [customRule]), { kind: 'SOURCE_DATA', state: 'SOURCE', sourceDataKind: 'GPZU' })
assert.equal(routeDocument('уникальный-тестер.pdf', [{ ...customRule, enabled: false }]).kind, 'OTHER')

for (const sourcePath of ['src/app/api/contracts/[id]/documents/route.ts', 'src/app/api/contracts/import/route.ts', 'src/lib/inbox-scanner.ts']) {
	const source = fs.readFileSync(path.join(process.cwd(), sourcePath), 'utf8')
	assert.match(source, /documentRouteRule\.findMany\(/, `${sourcePath} must load enabled database rules`)
	assert.match(source, /routeDocument\([\s\S]*?routeRules\)/, `${sourcePath} must pass database rules into routing`)
}

console.log('Document routing checks passed: real naming conventions, negative cases, and enabled database rules.')
