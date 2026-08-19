import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { detectContractorType, parseContractFolder, parseContractText, parseEstimateWorkbook } from '../src/lib/contract-parser'
import { classifyDocumentPath } from '../src/lib/document-classifier'
import { assertDocumentRulePattern, DEFAULT_DOCUMENT_ROUTE_RULES, testDocumentRoute } from '../src/lib/document-route-rules'
import { matchDocumentContract, routeDocument } from '../src/lib/document-routing'
import './test-document-routing.cts'
import './test-contract-customers.cts'
import { isValidOgrn } from '../src/lib/validation'
import { parseEstimateWorkbook as parseManualEstimateWorkbook } from '../src/lib/estimate-parser'

function estimateBuffer(rows: string[][], sheetName = 'Смета') {
	const workbook = XLSX.utils.book_new()
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName)
	return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

const manualEstimateAddress = parseManualEstimateWorkbook(estimateBuffer([['Стройка: Московская обл., г.о. Подольск, п. Поливаново, к.н. 50:27:0020412:1803']]))
assert.equal(manualEstimateAddress.objectAddress, 'Московская обл., г.о. Подольск, п. Поливаново, к.н. 50:27:0020412:1803')
assert.equal(parseManualEstimateWorkbook(estimateBuffer([['Смета без адреса объекта']])).objectAddress, null)
assert.equal(parseManualEstimateWorkbook(estimateBuffer([['Стройка: 117461, г. Москва, ул. Каховка, дом 20А, помещ. 10/4']])).objectAddress, null)

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
assert.equal(classifyDocumentPath('Заказчик/Геоподоснова участка.pdf'), 'SOURCE_DATA')

const invoiceRoute = testDocumentRoute('Счёт на оплату № 42 от 18.08.2026.pdf', DEFAULT_DOCUMENT_ROUTE_RULES)
assert.equal(invoiceRoute.kind, 'INVOICE')
assert.equal(invoiceRoute.matchedRule?.id, 'default-invoice')

const sourceRoute = testDocumentRoute('Исходные данные ИГИ.pdf', DEFAULT_DOCUMENT_ROUTE_RULES)
assert.equal(sourceRoute.kind, 'SOURCE_DATA')
assert.equal(sourceRoute.sourceDataKind, 'IGI')

const estimateRoute = testDocumentRoute('Смета к ДС № 3.xlsx', DEFAULT_DOCUMENT_ROUTE_RULES)
assert.equal(estimateRoute.kind, 'ESTIMATE')
assert.equal(estimateRoute.agreementNumber, '3')

const disabledInvoiceRoute = testDocumentRoute(
	'Счёт на оплату № 42 от 18.08.2026.pdf',
	DEFAULT_DOCUMENT_ROUTE_RULES.map((rule) => rule.id === 'default-invoice' ? { ...rule, enabled: false } : rule),
)
assert.equal(disabledInvoiceRoute.kind, 'INVOICE', 'встроенный классификатор остаётся запасным вариантом')
assert.equal(disabledInvoiceRoute.matchedRule, null, 'отключённое правило не должно считаться совпавшим')

const customRoute = testDocumentRoute('Спецакт 2026.pdf', [
	{ id: 'custom-rule', target: 'APPENDIX_TO_AGREEMENT', pattern: '^Спецакт', enabled: true, sortOrder: 1, note: null },
	...DEFAULT_DOCUMENT_ROUTE_RULES,
])
assert.equal(customRoute.matchedRule?.id, 'custom-rule', 'правило из БД должно дополнять встроенную классификацию')
assert.equal(customRoute.kind, 'APPENDIX')
assert.throws(() => assertDocumentRulePattern('['), /регулярное выражение/)

assert.deepEqual(routeDocument('Счет на оплату №326 от 29.06.26.pdf'), {
	kind: 'INVOICE', state: 'SOURCE', invoiceNumber: '326', invoiceDate: '2026-06-29',
})
assert.deepEqual(routeDocument('Доп. соглашение №2 к 731-ИЗЛКРус-СМР-2026.pdf'), {
	kind: 'AGREEMENT', state: 'SIGNED', agreementNumber: '2', contractNumberFull: '731-ИЗЛКРус-СМР-2026', contractNumberShort: '731',
})
const linkedEstimateRoute = routeDocument('731-ИЗЛКРус-СМР-2026 №1,2 Смета, График к ДС №1.xlsx')
assert.equal(linkedEstimateRoute.kind, 'ESTIMATE')
assert.equal(linkedEstimateRoute.state, 'SOURCE')
assert.equal(linkedEstimateRoute.agreementNumber, '1')
const signedPr1Route = routeDocument('ПОДПИСАНО_25.02.2026 Пр.№1 (731).pdf')
assert.equal(signedPr1Route.kind, 'APPENDIX')
assert.equal(signedPr1Route.state, 'SIGNED')
assert.equal(signedPr1Route.pr1SignedAt, '2026-02-25')
assert.equal(signedPr1Route.contractNumberShort, '731')
assert.equal(routeDocument('ПОДПИСАНО Пр.№1 25.02.2026 (731).pdf').contractNumberShort, '731', 'дата после ПР1 не должна приниматься за номер договора')
assert.equal(routeDocument('Пр.№10 отчет.pdf').pr1SignedAt, undefined)
assert.equal(routeDocument('ИГИ (731).pdf').sourceDataKind, 'IGI')
assert.equal(routeDocument('ИГИ (731).pdf').contractNumberShort, '731')
const projectRoute = routeDocument('КЖ/СМР-2026 КБ-300.16.21.52.60-КЖ-731.dwg')
assert.equal(projectRoute.kind, 'PROJECT_DWG')
assert.equal(projectRoute.state, 'SOURCE')
assert.equal(projectRoute.sectionCode, 'KZH')
assert.equal(projectRoute.cipher, 'КБ-300.16.21.52.60')
assert.equal(routeDocument('731_КМД_кровля.dwg').sectionCode, 'KM')
assert.equal(routeDocument('Договор 731-ИЗЛКРус-СМР-2026.pdf').state, 'SOURCE', 'одиночный PDF договора не считается подписанным')

const contractMatch = matchDocumentContract(projectRoute, [
	{ id: 'number', number: '731-ИЗЛКРус-СМР-2026', cipher: 'КБ-ДРУГОЙ.20.20', date: '2026-01-01' },
	{ id: 'cipher', number: '999-ИЗЛКРус-СМР-2026', cipher: 'КБ-300.16.21.52.60', date: '2026-01-01' },
])
assert.equal(contractMatch.contract?.id, 'cipher', 'шифр должен быть приоритетнее номера')
const yearMismatch = matchDocumentContract(routeDocument('ИГИ к 731-ИЗЛКРус-СМР-2023.pdf'), [
	{ id: 'short', number: '731-ИЗЛКРус-СМР-2026', date: '2026-01-01' },
])
assert.equal(yearMismatch.contract?.id, 'short', 'расхождение года не отменяет привязку по уникальному короткому номеру')
assert.match(yearMismatch.warning ?? '', /Год 2023/)

// Формулировка по образцу реального договора (ФИО вымышленное) — заказчик
// физ. лицо, действующее через представителя по доверенности; у представителя
// в той же клаузуле тоже есть свой паспорт, поэтому важно, что детектор не
// путает их и не переключается на подрядчика (ООО), упомянутого дальше в тексте.
assert.equal(detectContractorType(`
Гражданин РФ Иванов Иван Иванович, 01.01.1970 года рождения, СНИЛС: 111-222-333 44,
паспорт 11 22 334455, в лице Петровой Марии Сергеевны, 02.02.1985 года рождения,
паспорт 55 66 778899, действующей на основании доверенности, именуемая в дальнейшем
«Заказчик» с одной стороны, и Общество с ограниченной ответственностью «ИЗЛК РУС»,
именуемое в дальнейшем «Подрядчик», в лице Генерального директора, действующего на
основании Устава, с другой стороны, заключили настоящий Договор.
`), 'INDIVIDUAL')
assert.equal(detectContractorType('Общество с ограниченной ответственностью «СтройИнвест», именуемое в дальнейшем «Заказчик», в лице Генерального директора Иванова И.И., действующего на основании Устава'), 'LEGAL')
assert.equal(detectContractorType('Индивидуальный предприниматель Сидоров Сидор Сидорович, именуемый в дальнейшем «Заказчик»'), 'LEGAL')
assert.equal(detectContractorType('Просто текст без явных маркеров стороны договора и без слова на «З»'), null)

// Регрессия на найденный баг: физ. лицо-заказчик своего ИНН в тексте не
// указывает (только СНИЛС), а у Подрядчика (ИЗЛК) свой ИНН стоит в блоке
// реквизитов в конце документа. Раньше "первое ИНН во всём тексте" молча
// подставляло заказчику чужой (ИЗЛК) ИНН — теперь должно остаться пустым.
const individualCustomerContract = parseContractText('731-ИЗЛКРус-СМР-2026.doc', `
г. Москва «20» февраля 2026 г.
Гражданин РФ Могилевич Алла Федоровна, 01.08.1949 года рождения, СНИЛС: 024-787-983-99,
паспорт 29 97 031923, именуемая в дальнейшем «Заказчик» с одной стороны, и
Общество с ограниченной ответственностью «ИЗЛК РУС», именуемое в дальнейшем «Подрядчик»,
в лице Генерального директора, действующего на основании Устава, с другой стороны,
заключили настоящий Договор № 731-ИЗЛКРус-СМР-2026.
Общая цена договора составляет: 5 243 000 рублей 00 копеек.

Реквизиты сторон
Подрядчик: ООО «ИЗЛК РУС», ОГРН: 1197746687731, ИНН: 9725024975, КПП: 772701001
`)
assert.equal(individualCustomerContract.contractorName, 'Могилевич Алла Федоровна')
assert.equal(individualCustomerContract.contractorType, 'INDIVIDUAL')
assert.equal(individualCustomerContract.inn, '', 'ИНН Подрядчика (ИЗЛК) из реквизитов не должен попадать в поле заказчика')
assert.equal(individualCustomerContract.ogrn, '', 'ОГРН Подрядчика (ИЗЛК) из реквизитов не должен попадать в поле заказчика')
// Без представителя — паспорт/СНИЛС находятся и относятся к самому заказчику,
// поле представителя остаётся пустым.
assert.equal(individualCustomerContract.snils, '024-787-983-99')
assert.equal(individualCustomerContract.passportSeries, '29 97')
assert.equal(individualCustomerContract.passportNumber, '031923')
assert.equal(individualCustomerContract.representativeName, '', 'без "в лице" в тексте представителя быть не должно')

// Регрессия/новая задача: заказчик физ. лицо действует через представителя по
// доверенности — у представителя в той же клаузуле тоже указан свой паспорт.
// Паспорт представителя (55 66 778899) в тексте стоит РАНЬШЕ слова
// "доверенности" — делить по этому слову означало бы приписать его
// заказчику. Правильное деление — по "в лице": реквизиты заказчика ищутся до
// него, реквизиты представителя — после. Спутать эти данные — испорченные
// юридически значимые данные, не опечатка, поэтому проверяем оба набора
// раздельно и точно.
const proxyContract = parseContractText('proxy-contract.doc', `
Гражданин РФ Иванов Иван Иванович, 01.01.1970 года рождения, СНИЛС: 111-222-333 44,
паспорт 11 22 334455, в лице Петровой Марии Сергеевны, 02.02.1985 года рождения,
паспорт 55 66 778899, действующей на основании доверенности, именуемая в дальнейшем
«Заказчик» с одной стороны, и Общество с ограниченной ответственностью «ИЗЛК РУС»,
именуемое в дальнейшем «Подрядчик», в лице Генерального директора, действующего на
основании Устава, с другой стороны, заключили настоящий Договор.
`)
assert.equal(proxyContract.contractorType, 'INDIVIDUAL')
assert.equal(proxyContract.snils, '111-222-333 44', 'СНИЛС заказчика (Иванова), не представителя')
assert.equal(proxyContract.passportSeries, '11 22', 'паспорт заказчика (Иванова), не представителя')
assert.equal(proxyContract.passportNumber, '334455')
assert.equal(proxyContract.representativeName, 'Петровой Марии Сергеевны')
assert.equal(proxyContract.representativeSnils, '', 'у представителя в тексте СНИЛС не указан')
assert.equal(proxyContract.representativePassportSeries, '55 66', 'паспорт представителя (Петровой), не заказчика')
assert.equal(proxyContract.representativePassportNumber, '778899')
assert.ok(proxyContract.warnings.some((w) => w.includes('представитель')), 'должно быть предупреждение сверить данные представителя')

// Задача: защита от "своих" реквизитов ИЗЛК — на случай, когда область
// поиска (до клаузулы Подрядчика) почему-то не спасает, потому что
// реквизиты ИЗЛК оказались раньше в тексте (перепутанный шаблон и т.п.).
// Проверяем именно эту ситуацию — реквизиты ИЗЛК ДО клаузулы Подрядчика.
const guardContract = parseContractText('guard-test.doc', `
Гражданин РФ Тестов Тест Тестович, именуемый в дальнейшем «Заказчик».
ИНН: 9725024975
ОГРН: 1197746687731
Общество с ограниченной ответственностью «ИЗЛК РУС», именуемое в дальнейшем «Подрядчик», в лице Генерального директора, действующего на основании Устава.
`)
assert.equal(guardContract.inn, '', 'собственный ИНН ИЗЛК не должен попасть в поле заказчика')
assert.equal(guardContract.ogrn, '', 'собственный ОГРН ИЗЛК не должен попасть в поле заказчика')
assert.ok(guardContract.warnings.some((w) => w.includes('ИНН') && w.includes('ИЗЛК')), 'должно быть предупреждение о совпадении с собственным ИНН ИЗЛК')
assert.ok(guardContract.warnings.some((w) => w.includes('ОГРН') && w.includes('ИЗЛК')), 'должно быть предупреждение о совпадении с собственным ОГРН ИЗЛК')

const guardAddressContract = parseContractText('guard-address-test.doc', `
Договор № 950-ИЗЛКРус-СМР-2026 от 01.03.2026
Заказчик: ООО «Ромашка»
Работы выполняются по адресу: 117461, г. Москва, вн. тер. г. Муниципальный Округ Черемушки, ул. Каховка, дом 20А, помещ. 10/4
Сумма договора составляет: 1 000 000,00 руб.
`)
assert.equal(guardAddressContract.objectAddress, '', 'собственный адрес ИЗЛК не должен попасть в поле адреса объекта')
assert.ok(guardAddressContract.warnings.some((w) => w.includes('адрес') && w.includes('ИЗЛК')), 'должно быть предупреждение о совпадении с собственным адресом ИЗЛК')

assert.equal(isValidOgrn('1027700132195'), true, 'реальный контрольный разряд ОГРН (13 цифр)')
assert.equal(isValidOgrn('1027700132196'), false, 'испорченный контрольный разряд ОГРН должен не пройти проверку')
assert.equal(isValidOgrn('304500116000157'), true, 'реальный контрольный разряд ОГРНИП (15 цифр)')
assert.equal(isValidOgrn('123'), false, 'ОГРН неверной длины')

// Задача: адрес объекта, тип фундамента и "своя плита у заказчика" — из
// сметы, по ячейкам, а не из общего текстового блока.
const foundationEstimate = parseEstimateWorkbook('Смета.xlsx', estimateBuffer([
	['Смета № 12 к договору 731-ИЗЛКРус-СМР-2026'],
	['Стройка: Московская обл., г.о Подольск, п.Поливаново, к.н. 50:27:0020412:1803'],
	['Изготовление и устройство фундамента (Шифр ИЗЛК Рус КБ-300.16.30.74.60)'],
	['Ж/б фундамент Серия ФБР-1600.ИЗЛКРус.2021 с анкерами /Раздел ИЗЛК Рус КБ-300.2.30.48.58.60-КЖ/'],
	['Итого по смете: 5 243 000,00'],
]))
assert.equal(foundationEstimate.objectAddress, 'Московская обл., г.о Подольск, п.Поливаново, к.н. 50:27:0020412:1803')
assert.equal(foundationEstimate.foundationType, 'ФБР-1600')
assert.equal(foundationEstimate.customerOwnSlab, false)
assert.equal(foundationEstimate.amount, '5243000.00')
assert.equal(foundationEstimate.warnings.length, 0)

const slabEstimate = parseEstimateWorkbook('Смета.xlsx', estimateBuffer([
	['Стройка: г. Тверь, ул. Мира, д. 5'],
	['Устройство химических анкеров'],
]))
assert.equal(slabEstimate.customerOwnSlab, true, '"Устройство химических анкеров" — признак своей плиты у заказчика')
assert.equal(slabEstimate.foundationType, '', 'без позиции фундамента тип должен остаться пустым')

const missingSiteEstimate = parseEstimateWorkbook('Смета.xlsx', estimateBuffer([['Смета без адресной метки объекта']]))
assert.equal(missingSiteEstimate.objectAddress, '')
assert.ok(missingSiteEstimate.warnings.some((w) => w.includes('Стройка')), 'должно предупредить, что ячейку "Стройка:" не нашли')

// Задача: если в папке договора есть ДС №1/№2/№3, смета берётся из папки с
// САМЫМ БОЛЬШИМ номером (последняя редакция) — не из корня и не из ДС №1.
// parseContractFolder асинхронна, а tsx здесь транспилирует в CJS (top-level
// await недоступен) — оборачиваем хвост теста в async IIFE.
void (async () => {
	const dsFolderResult = await parseContractFolder([
		{ fileName: 'Договор.txt', relativePath: 'Договор.txt', buffer: Buffer.from(`
ДОГОВОР № 900-ИЗЛКРус-СМР-2026 от 10.03.2026
Заказчик: ООО «Полигон»
ИНН 7712345678
Сумма договора составляет: 3 000 000,00 руб.
Адрес объекта: этот адрес из текста договора — должен быть переопределён сметой из ДС №2
`, 'utf8') },
		{ fileName: 'Смета.xlsx', relativePath: 'Смета.xlsx', buffer: estimateBuffer([['Стройка: Адрес из корневой сметы']]) },
		{ fileName: 'Смета.xlsx', relativePath: 'ДС №1/Смета.xlsx', buffer: estimateBuffer([['Стройка: Адрес из ДС №1']]) },
		{ fileName: 'Смета.xlsx', relativePath: 'ДС №2/Смета.xlsx', buffer: estimateBuffer([['Стройка: Адрес из ДС №2, самый новый']]) },
	])
	assert.equal(dsFolderResult.parsed.objectAddress, 'Адрес из ДС №2, самый новый', 'адрес должен браться из сметы в папке ДС с максимальным номером, а не из корня, ДС №1 или текста договора')

	// Без папок ДС — смета из корня.
	const rootOnlyResult = await parseContractFolder([
		{ fileName: 'Договор.txt', relativePath: 'Договор.txt', buffer: Buffer.from(`
ДОГОВОР № 901-ИЗЛКРус-СМР-2026 от 11.03.2026
Заказчик: ООО «Полигон-2»
ИНН 7712345679
Сумма договора составляет: 2 000 000,00 руб.
`, 'utf8') },
		{ fileName: 'Смета.xlsx', relativePath: 'Смета.xlsx', buffer: estimateBuffer([['Стройка: Единственный адрес из корневой сметы']]) },
	])
	assert.equal(rootOnlyResult.parsed.objectAddress, 'Единственный адрес из корневой сметы')

	console.log(`Parser test passed: ${parsed.foundFields.join(', ')}; confidence ${parsed.confidence}%; contractor type detection: OK; estimate/ОГРН/ИЗЛК-guard checks: OK`)
})()
