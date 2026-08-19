import { PrismaClient, Role, ContractStatus, SiteStatus, SiteEventType, SectionCode, ExecStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_DOCUMENT_ROUTE_RULES } from '../src/lib/document-route-rules';

const DEFAULT_LIBRARY_IGNORE_RULES = [
  { type: 'NAME_PATTERN', value: '~$*', note: 'Временные файлы Microsoft Office' },
  { type: 'NAME_PATTERN', value: 'Thumbs.db', note: 'Служебный файл Windows' },
  { type: 'NAME_PATTERN', value: 'desktop.ini', note: 'Служебный файл Windows' },
  { type: 'EXTENSION', value: '.bak', note: 'Резервная копия' },
  { type: 'EXTENSION', value: '.lnk', note: 'Ярлык Windows' },
  { type: 'EXTENSION', value: '.log', note: 'Журнал' },
  { type: 'EXTENSION', value: '.tmp', note: 'Временный файл' },
  { type: 'SUBTREE', value: '_мусор', note: 'Приватная рабочая область' },
  { type: 'SUBTREE', value: 'мусор', note: 'Приватная рабочая область' },
] as const;

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Сидирование базы данных ИЗЛК...');

  await prisma.documentRouteRule.createMany({ data: DEFAULT_DOCUMENT_ROUTE_RULES, skipDuplicates: true });
  await prisma.libraryIgnoreRule.createMany({ data: [...DEFAULT_LIBRARY_IGNORE_RULES], skipDuplicates: true });
  await prisma.libraryRoot.createMany({
    data: [
      { label: 'Договоры', path: '\\\\192.168.24.102\\share\\Договоры', kind: 'CONTRACTS', folderTemplate: 'Договора {year} года/{contract}' },
      { label: 'Проекты в работе', path: '\\\\192.168.5.103\\share\\Проекты\\Проекты в работе', kind: 'PROJECTS_ACTIVE', folderTemplate: '{contract}' },
      { label: 'Выполненные проекты', path: '\\\\192.168.5.103\\share\\Проекты\\Проекты выполненные', kind: 'PROJECTS_DONE', folderTemplate: '{contract}' },
    ],
    skipDuplicates: true,
  });
  const contractsRoot = await prisma.libraryRoot.findUniqueOrThrow({ where: { path: '\\\\192.168.24.102\\share\\Договоры' } });
  await prisma.librarySettings.upsert({
    where: { id: 'library' },
    update: { defaultContractsRootId: contractsRoot.id },
    create: { id: 'library', defaultContractsRootId: contractsRoot.id },
  });

  const izlkRus = await prisma.ownEntity.upsert({
    where: { id: 'seed-own-entity-izlk-rus' },
    update: {},
    create: {
      id: 'seed-own-entity-izlk-rus',
      name: 'ООО «ИЗЛК Рус»',
      shortName: 'ИЗЛК Рус',
      inn: '9725024975',
      ogrn: '1197746687731',
      isDefault: true,
    },
  });

  // --- Пользователи ---
  const adminPass = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { login: 'admin@izlk.ru' },
    update: {},
    create: {
      login: 'admin@izlk.ru',
      email: 'admin@izlk.ru',
      passwordHash: adminPass,
      name: 'Администратор',
      role: Role.ADMIN,
    },
  });

  const managerPass = await bcrypt.hash('manager123', 10);
  const manager = await prisma.user.upsert({
    where: { login: 'maksim@izlk.ru' },
    update: {},
    create: {
      login: 'maksim@izlk.ru',
      email: 'maksim@izlk.ru',
      passwordHash: managerPass,
      name: 'Максим',
      role: Role.MANAGER,
    },
  });

  // --- Контрагент ---
  const contractor = await prisma.contractor.upsert({
    where: { id: 'seed-contractor-1' },
    update: {},
    create: {
      id: 'seed-contractor-1',
      name: 'ООО «СтройИнвест»',
      inn: '770123456789',
      address: 'г. Москва, ул. Ленина, д. 10, стр. 2',
      phone: '+7 (495) 123-45-67',
      email: 'info@stroinvest.ru',
    },
  });

  // --- Договор №555 (из макета) ---
  const contract555 = await prisma.contract.upsert({
    where: { number: '555' },
    update: {},
    create: {
      number: '555',
      cipher: 'КБ-300.24.60.76.60',
      contractorId: contractor.id,
      managerId: manager.id,
      date: new Date('2024-04-15'),
      amount: 12450000,
      currency: 'RUB',
      status: ContractStatus.ACTIVE,
      ownEntityId: izlkRus.id,
    },
  });

  const agreement1 = await prisma.agreement.create({
    data: { contractId: contract555.id, number: 'ДС №1', date: new Date('2024-05-20') },
  });
  await prisma.agreement.create({
    data: {
      contractId: contract555.id,
      number: 'ДС №2',
      date: new Date('2024-06-10'),
      parentId: agreement1.id,
    },
  });

  await prisma.estimate.create({
    data: { contractId: contract555.id, number: 'Смета №1', date: new Date('2024-04-15') },
  });
  await prisma.estimate.create({
    data: { contractId: contract555.id, agreementId: agreement1.id, number: 'Смета №2', date: new Date('2024-05-20') },
  });

  const site = await prisma.site.create({
    data: {
      contractId: contract555.id,
      address: 'г. Москва, ул. Ленина, д. 10, стр. 2',
      status: SiteStatus.ISSUE,
    },
  });
  await prisma.siteEvent.createMany({
    data: [
      { siteId: site.id, type: SiteEventType.SUCCESS, text: 'Площадку подготовили', occurredAt: new Date('2024-04-12T10:30:00') },
      { siteId: site.id, type: SiteEventType.WARNING, text: 'Проблема с подготовкой площадки под разгрузку', occurredAt: new Date('2024-05-20T15:45:00') },
    ],
  });

  await prisma.projectSection.createMany({
    data: [
      { contractId: contract555.id, code: SectionCode.KM, responsibleId: admin.id },
      { contractId: contract555.id, code: SectionCode.AR, responsibleId: manager.id },
      { contractId: contract555.id, code: SectionCode.KZH },
    ],
  });

  await prisma.executiveDoc.createMany({
    data: [
      { contractId: contract555.id, name: 'Паспорт на каркас', status: ExecStatus.READY },
      { contractId: contract555.id, name: 'Акты скрытых работ', status: ExecStatus.IN_PROGRESS },
      { contractId: contract555.id, name: 'ОЖР', status: ExecStatus.NOT_READY },
    ],
  });

  console.log('✅ Готово. Вход: admin@izlk.ru / admin123 (админ), maksim@izlk.ru / manager123 (менеджер)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
