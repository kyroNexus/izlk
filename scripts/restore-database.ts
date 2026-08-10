import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma'

const createOrder = [
  'user',
  'contractor',
  'contract',
  'agreement',
  'estimate',
  'invoice',
  'site',
  'siteWork',
  'siteCrewEntry',
  'siteCostItem',
  'sitePhoto',
  'siteEvent',
  'projectSection',
  'executiveDoc',
  'task',
  'taskComment',
  'document',
  'inboxItem',
  'auditLog',
  'contractAccess',
] as const

type Delegate = {
  createMany: (args: { data: Record<string, unknown>[] }) => Promise<unknown>
  deleteMany: () => Promise<unknown>
  update?: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
}

function reviveBigInts(_key: string, value: unknown) {
  if (value && typeof value === 'object') {
    const tagged = value as { __izlkType?: unknown; value?: unknown }
    if (tagged.__izlkType === 'bigint' && typeof tagged.value === 'string') {
      return BigInt(tagged.value)
    }
  }
  return value
}

function normalizeRows(modelName: string, rows: Record<string, unknown>[]) {
  const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName)
  if (!model) throw new Error(`Неизвестная модель: ${modelName}`)
  const dateFields = new Set(model.fields.filter((field) => field.type === 'DateTime').map((field) => field.name))
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        dateFields.has(key) && typeof value === 'string' ? new Date(value) : value,
      ]),
    ),
  )
}

async function main() {
  const file = process.argv.find((item) => item.endsWith('.json.gz'))
  const confirmed = process.argv.includes('--confirm=RESTORE')
  if (!file || !confirmed) {
    throw new Error('Использование: npm.cmd run restore:database -- <копия.json.gz> --confirm=RESTORE')
  }

  const backup = JSON.parse(gunzipSync(await readFile(file)).toString('utf8'), reviveBigInts) as {
    format: string
    tables: Record<string, Record<string, unknown>[]>
  }
  if (backup.format !== 'izlk-logical-backup-v1') throw new Error('Неподдерживаемый формат копии')

  for (const table of [...createOrder].reverse()) {
    await ((prisma as unknown as Record<string, Delegate>)[table]).deleteMany()
  }

  for (const table of createOrder) {
    const modelName = table[0].toUpperCase() + table.slice(1)
    let rows = normalizeRows(modelName, backup.tables[table] ?? [])
    if (table === 'agreement') {
      const parentLinks = rows
        .filter((row) => row.parentId)
        .map((row) => ({ id: String(row.id), parentId: String(row.parentId) }))
      rows = rows.map(({ parentId: _parentId, ...row }) => ({ ...row, parentId: null }))
      if (rows.length) await ((prisma as unknown as Record<string, Delegate>)[table]).createMany({ data: rows })
      for (const link of parentLinks) {
        await ((prisma as unknown as Record<string, Delegate>)[table]).update?.({
          where: { id: link.id },
          data: { parentId: link.parentId },
        })
      }
      continue
    }
    if (rows.length) await ((prisma as unknown as Record<string, Delegate>)[table]).createMany({ data: rows })
  }

  console.log('База восстановлена из копии. Перезапустите приложение и выполните проверку входа.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
