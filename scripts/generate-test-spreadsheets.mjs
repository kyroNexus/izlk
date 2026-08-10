import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'ТЕСТОВЫЕ_ДОКУМЕНТЫ_ДЛЯ_ЗАГРУЗКИ');
const contract = 'ТЕСТ-701-ИЗЛК-СМР-2026';
const cipher = 'КБ-701.26.10.01.01';
const contractor = 'ООО «ТестСтройПроект»';
const inn = '7707012345';

function applyLayout(sheet, title, width = 5) {
  sheet.showGridLines = false;
  sheet.getRange(`A1:${String.fromCharCode(64 + width)}1`).merge();
  sheet.getRange('A1').values = [[title]];
  sheet.getRange('A1').format = {
    fill: '#492D8C',
    font: { bold: true, color: '#FFFFFF', size: 16 },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
  };
  sheet.getRange('A1').format.rowHeight = 30;
  sheet.freezePanes.freezeRows(3);
}

async function save(workbook, relativePath, sheetName, range) {
  const file = await SpreadsheetFile.exportXlsx(workbook);
  await file.save(path.join(output, relativePath));
  const preview = await workbook.render({ sheetName, range, scale: 1.5, format: 'png' });
  const previewDir = path.join(root, 'tmp', 'test-doc-previews');
  await fs.mkdir(previewDir, { recursive: true });
  await fs.writeFile(path.join(previewDir, `${path.basename(relativePath, '.xlsx')}.png`), new Uint8Array(await preview.arrayBuffer()));
}

async function createParserWorkbook() {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add('Договор');
  applyLayout(sheet, 'ДОГОВОР ПОДРЯДА', 2);
  sheet.getRange('A3:B10').values = [
    ['Номер договора', contract],
    ['Шифр объекта', cipher],
    ['Контрагент', contractor],
    ['ИНН', inn],
    ['Адрес объекта', 'г. Москва, ул. Примерная, д. 7, стр. 1'],
    ['Дата договора', new Date('2026-08-05T00:00:00')],
    ['Сумма договора', 15780000],
    ['Валюта', 'RUB'],
  ];
  sheet.getRange('A3:A10').format = { fill: '#EEEAF8', font: { bold: true }, verticalAlignment: 'center' };
  sheet.getRange('A3:B10').format.borders = { preset: 'all', style: 'thin', color: '#C8C1E1' };
  sheet.getRange('B8').format.numberFormat = 'yyyy-mm-dd';
  sheet.getRange('B9').format.numberFormat = '#,##0.00';
  sheet.getRange('A12:A17').values = [
    [`Договор № ${contract} от 05.08.2026`],
    [`Контрагент: ${contractor}`],
    [`ИНН: ${inn}`],
    [`Шифр объекта: ${cipher}`],
    ['Адрес объекта: г. Москва, ул. Примерная, д. 7, стр. 1'],
    ['Сумма договора: 15 780 000,00 руб.'],
  ];
  sheet.getRange('A12:A17').format = { font: { color: '#555555', italic: true } };
  sheet.getRange('A:A').format.columnWidth = 24;
  sheet.getRange('B:B').format.columnWidth = 48;
  await save(workbook, `01_Парсер_договора/Договор_${contract}.xlsx`, 'Договор', 'A1:B17');
}

async function createEstimateWorkbook() {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add('Смета');
  applyLayout(sheet, 'СМЕТА № 01', 6);
  sheet.getRange('A3:F3').values = [['№', 'Наименование работ', 'Ед.', 'Кол-во', 'Цена, руб.', 'Сумма, руб.']];
  sheet.getRange('A4:E6').values = [
    [1, 'Монтаж металлоконструкций', 'т', 25, 180000],
    [2, 'Аренда автокрана', 'смена', 8, 45000],
    [3, 'Расходные материалы', 'компл.', 1, 90000],
  ];
  sheet.getRange('F4').formulas = [['=D4*E4']];
  sheet.getRange('F4:F6').fillDown();
  sheet.getRange('E4:F6').format.numberFormat = '#,##0.00';
  sheet.getRange('A3:F3').format = { fill: '#492D8C', font: { bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center' };
  sheet.getRange('A3:F6').format.borders = { preset: 'all', style: 'thin', color: '#D9D9E6' };
  sheet.getRange('A8:E8').merge();
  sheet.getRange('A8').values = [['ИТОГО']];
  sheet.getRange('F8').formulas = [['=SUM(F4:F6)']];
  sheet.getRange('A8:F8').format = { fill: '#EEEAF8', font: { bold: true }, borders: { preset: 'all', style: 'thin', color: '#C8C1E1' } };
  sheet.getRange('F8').format.numberFormat = '#,##0.00';
  for (const [column, width] of [['A', 8], ['B', 35], ['C', 11], ['D', 11], ['E', 16], ['F', 16]]) sheet.getRange(`${column}:${column}`).format.columnWidth = width;
  await save(workbook, `02_Хронология_договора/Смета_01_${contract}.xlsx`, 'Смета', 'A1:F8');
}

async function createActWorkbook() {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add('Акт');
  applyLayout(sheet, 'АКТ СКРЫТЫХ РАБОТ № 01', 4);
  sheet.getRange('A3:B7').values = [
    ['Договор', contract],
    ['Шифр', cipher],
    ['Дата', new Date('2026-08-12T00:00:00')],
    ['Контрагент', contractor],
    ['Статус', 'Тестовый документ'],
  ];
  sheet.getRange('A3:A7').format = { fill: '#EEEAF8', font: { bold: true } };
  sheet.getRange('A3:B7').format.borders = { preset: 'all', style: 'thin', color: '#C8C1E1' };
  sheet.getRange('B5').format.numberFormat = 'yyyy-mm-dd';
  sheet.getRange('A:A').format.columnWidth = 22;
  sheet.getRange('B:B').format.columnWidth = 48;
  await save(workbook, `04_Исполнительная_документация/Акт_скрытых_работ_01_${contract}.xlsx`, 'Акт', 'A1:D7');
}

await fs.mkdir(output, { recursive: true });
await createParserWorkbook();
await createEstimateWorkbook();
await createActWorkbook();
