import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { prisma } from '../src/lib/prisma'
import { assertBackupModelCoverage, backupTables } from './backup-models'
import { logger } from '../src/lib/logger'

const FORMAT = 'izlk-logical-backup-v2'
const MANIFEST_FORMAT = 'izlk-database-backup-manifest-v1'

type PrismaDelegate = { findMany: () => Promise<unknown[]> }

function serialize(_key: string, value: unknown) {
  return typeof value === 'bigint' ? { __izlkType: 'bigint', value: value.toString() } : value
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function appInfo() {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { name?: string; version?: string }
  let commit: string | null = null
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    // Backups must work from a release directory without .git.
  }
  return { name: packageJson.name ?? 'izlk', version: packageJson.version ?? 'unknown', commit }
}

async function main() {
  assertBackupModelCoverage()
  const destination = path.resolve(process.argv[2] ?? path.join(process.cwd(), 'backups'))
  await mkdir(destination, { recursive: true })

  const data: Record<string, unknown[]> = {}
  const delegates = prisma as unknown as Record<string, PrismaDelegate>
  for (const table of backupTables) data[table.delegate] = await delegates[table.delegate].findMany()

  const createdAt = new Date().toISOString()
  const payload = { format: FORMAT, createdAt, tables: data }
  const archive = gzipSync(Buffer.from(JSON.stringify(payload, serialize), 'utf8'), { level: 9 })
  const stamp = createdAt.replace(/[:T]/g, '-').slice(0, 19)
  const fileName = `izlk-database_${stamp}.json.gz`
  const target = path.join(destination, fileName)
  const manifestPath = target.replace(/\.json\.gz$/, '.manifest.json')
  await writeFile(target, archive)

  // Smoke check before the snapshot is considered complete.
  const verification = JSON.parse(gunzipSync(await readFile(target)).toString('utf8')) as { format?: string; tables?: unknown }
  if (verification.format !== FORMAT || !verification.tables) throw new Error('Created database archive failed verification.')

  const manifest = {
    format: MANIFEST_FORMAT,
    createdAt,
    application: await appInfo(),
    backupFormat: FORMAT,
    archive: { fileName, sizeBytes: archive.length, sha256: sha256(archive) },
    tables: backupTables.map((table) => ({ model: table.model, delegate: table.delegate, rows: data[table.delegate].length })),
    totalRows: Object.values(data).reduce((sum, rows) => sum + rows.length, 0),
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

	logger.info('backup.database_completed', { entityType: 'Backup', entityId: fileName })
}

main()
  .catch((error) => {
	logger.error('backup.database_failed', { entityType: 'Backup', error })
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
