import assert from 'node:assert/strict'
import { parseContractText } from '../src/lib/contract-parser'
import { classifyDocumentPath } from '../src/lib/document-classifier'

const parsed = parseContractText('Договор_ТЕСТ-701-ИЗЛК-СМР-2026.docx', `
ДОГОВОР № ТЕСТ-701-ИЗЛК-СМР-2026 от 15.08.2026
Заказчик: ООО «СтройИнвест»
ИНН 7701234567
Сумма договора составляет: 5 600 000,00 руб.
Шифр объекта: КБ-812.25.01.20.03
Адрес объекта: г. Москва, ул. Ленина, д. 10
`)

assert.equal(parsed.contractNumber, 'ТЕСТ-701-ИЗЛК-СМР-2026')
assert.equal(parsed.contractDate, '2026-08-15')
assert.equal(parsed.amount, '5600000.00')
assert.equal(parsed.inn, '7701234567')
assert.equal(parsed.cipher, 'КБ-812.25.01.20.03')
assert.equal(parsed.currency, 'RUB')
assert.ok(parsed.confidence >= 90)

const legacyWordStyle = parseContractText('717-ИЗЛКРус-СМР-2026.doc', `
г. Москва «06» февраля 2026 г.
Общество с ограниченной ответственностью «СТ-Машсервис», именуемое в дальнейшем «Заказчик».
Указанные СМР выполняются Подрядчиком по адресу: РФ, МО, г. Руза, ш. Волоколамское.
Шифр ИЗЛК Рус КБ-300.18.36.64.60.
Общая цена договора составляет: 6 899 000 (Шесть миллионов) рублей 00 копеек.
ИНН: 5047046602
`)

assert.equal(legacyWordStyle.contractNumber, '717-ИЗЛКРус-СМР-2026')
assert.equal(legacyWordStyle.contractDate, '2026-02-06')
assert.equal(legacyWordStyle.amount, '6899000.00')
assert.equal(legacyWordStyle.contractorName, 'ООО «СТ-Машсервис»')
assert.equal(legacyWordStyle.inn, '5047046602')
assert.equal(legacyWordStyle.cipher, 'ИЗЛК Рус КБ-300.18.36.64.60')

assert.equal(classifyDocumentPath('Заказчик/Исходные данные/ГПЗУ участка.pdf'), 'SOURCE_DATA')
assert.equal(classifyDocumentPath('ИГИ/инженерно-геологические изыскания.pdf'), 'SOURCE_DATA')

console.log(`Parser test passed: ${parsed.foundFields.join(', ')}; confidence ${parsed.confidence}%`)
