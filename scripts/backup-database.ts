import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { prisma } from '../src/lib/prisma'

const tables = [
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

function serialize(_key: string, value: unknown) {
  return typeof value === 'bigint' ? { __izlkType: 'bigint', value: value.toString() } : value
}

async function main() {
  const destination = path.resolve(process.argv[2] ?? path.join(process.cwd(), 'backups'))
  await mkdir(destination, { recursive: true })

  const data: Record<string, unknown[]> = {}
  for (const table of tables) {
    const delegate = (prisma as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[table]
    data[table] = await delegate.findMany()
  }

  const payload = {
    format: 'izlk-logical-backup-v1',
    createdAt: new Date().toISOString(),
    tables: data,
  }
  const json = JSON.stringify(payload, serialize)
  const archive = gzipSync(Buffer.from(json, 'utf8'), { level: 9 })
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const target = path.join(destination, `izlk-database_${stamp}.json.gz`)
  await writeFile(target, archive)

  const verification = JSON.parse(gunzipSync(await readFile(target)).toString('utf8'))
  if (verification.format !== 'izlk-logical-backup-v1') {
    throw new Error('Не удалось проверить созданную копию')
  }

  const rowCount = Object.values(data).reduce((sum, rows) => sum + rows.length, 0)
  console.log(`Копия базы создана и проверена: ${target}`)
  console.log(`Таблиц: ${tables.length}; записей: ${rowCount}; размер: ${archive.length} байт`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
