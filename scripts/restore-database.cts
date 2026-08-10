import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma'
import { assertBackupModelCoverage, modelForDelegate, restoreOrder } from './backup-models'

const LEGACY_FORMAT = 'izlk-logical-backup-v1'
const CURRENT_FORMAT = 'izlk-logical-backup-v2'

type Delegate = {
  createMany: (args: { data: Record<string, unknown>[] }) => Promise<unknown>
  deleteMany: () => Promise<unknown>
  update?: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
}

type LoadedBackup = {
  format: typeof LEGACY_FORMAT | typeof CURRENT_FORMAT
  tables: Record<string, Record<string, unknown>[]>
}

function reviveBigInts(_key: string, value: unknown) {
  if (value && typeof value === 'object') {
    const tagged = value as { __izlkType?: unknown; value?: unknown }
    if (tagged.__izlkType === 'bigint' && typeof tagged.value === 'string') return BigInt(tagged.value)
  }
  return value
}

function normalizeRows(modelName: string, rows: Record<string, unknown>[]) {
  const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName)
  if (!model) throw new Error(`Unknown Prisma model: ${modelName}`)
  const dateFields = new Set(model.fields.filter((field) => field.type === 'DateTime').map((field) => field.name))
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, dateFields.has(key) && typeof value === 'string' ? new Date(value) : value])))
}

async function readBackup(file: string): Promise<LoadedBackup> {
  const archive = await readFile(file)
  const backup = JSON.parse(gunzipSync(archive).toString('utf8'), reviveBigInts) as {
    format?: string
    tables?: Record<string, Record<string, unknown>[]>
  }
  if (!backup.tables || ![LEGACY_FORMAT, CURRENT_FORMAT].includes(backup.format ?? '')) throw new Error('Unsupported backup format.')

  if (backup.format === CURRENT_FORMAT) {
    const manifestPath = file.replace(/\.json\.gz$/, '.manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { archive?: { sha256?: string }; tables?: Array<{ delegate?: string; rows?: number }> }
    const actualHash = createHash('sha256').update(archive).digest('hex')
    if (manifest.archive?.sha256 !== actualHash) throw new Error('Database archive checksum does not match its manifest.')
    for (const item of manifest.tables ?? []) {
      if (!item.delegate || (backup.tables[item.delegate] ?? []).length !== item.rows) throw new Error(`Manifest row count mismatch for ${item.delegate ?? 'unknown table'}.`)
    }
  }
  return { format: backup.format as LoadedBackup['format'], tables: backup.tables }
}

async function main() {
  assertBackupModelCoverage()
  const file = process.argv.find((item) => item.endsWith('.json.gz'))
  const confirmed = process.argv.includes('--confirm=RESTORE')
  const dryRun = process.argv.includes('--dry-run')
  if (!file || (!confirmed && !dryRun)) throw new Error('Usage: npm.cmd run restore:database -- <backup.json.gz> --dry-run | --confirm=RESTORE')

  const backup = await readBackup(file)
  const tables = backup.tables
  for (const table of restoreOrder) {
    if (!Array.isArray(tables[table])) throw new Error(`Backup does not contain table ${table}. Restoration stopped before any data was changed.`)
  }
  const rows = Object.values(tables).reduce((sum, value) => sum + value.length, 0)
  if (dryRun) return void console.log(`Backup is valid. ${rows} rows would be restored; no data was changed.`)

  const delegates = prisma as unknown as Record<string, Delegate>
  for (const table of [...restoreOrder].reverse()) await delegates[table].deleteMany()

  for (const table of restoreOrder) {
    let rowsForTable = normalizeRows(modelForDelegate(table), tables[table])
    if (table === 'agreement') {
      const parentLinks = rowsForTable.filter((row) => row.parentId).map((row) => ({ id: String(row.id), parentId: String(row.parentId) }))
      rowsForTable = rowsForTable.map(({ parentId: _parentId, ...row }) => ({ ...row, parentId: null }))
      if (rowsForTable.length) await delegates[table].createMany({ data: rowsForTable })
      for (const link of parentLinks) await delegates[table].update?.({ where: { id: link.id }, data: { parentId: link.parentId } })
    } else if (rowsForTable.length) {
      await delegates[table].createMany({ data: rowsForTable })
    }
  }
  console.log(`Database restored from backup (${rows} rows). Restart the application and verify login.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
