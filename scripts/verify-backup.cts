import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import JSZip from 'jszip'

async function hashFile(file: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyDatabaseArchive(file: string) {
  const manifestFile = file.replace(/\.json\.gz$/, '.manifest.json')
  const [archive, manifestText] = await Promise.all([readFile(file), readFile(manifestFile, 'utf8')])
  const manifest = JSON.parse(manifestText) as { archive?: { sha256?: string }; tables?: Array<{ delegate?: string; rows?: number }> }
  if (manifest.archive?.sha256 !== createHash('sha256').update(archive).digest('hex')) throw new Error(`Checksum mismatch: ${path.basename(file)}`)
  const backup = JSON.parse(gunzipSync(archive).toString('utf8')) as { format?: string; tables?: Record<string, unknown[]> }
  if (backup.format !== 'izlk-logical-backup-v2' || !backup.tables) throw new Error(`Invalid database backup: ${path.basename(file)}`)
  for (const table of manifest.tables ?? []) {
    if (!table.delegate || backup.tables[table.delegate]?.length !== table.rows) throw new Error(`Row count mismatch: ${table.delegate ?? 'unknown table'}`)
  }
}

async function verifyFilesArchive(file: string) {
  const manifestFile = file.replace(/\.zip$/, '.manifest.json')
  const [manifestText, digest, archive] = await Promise.all([readFile(manifestFile, 'utf8'), hashFile(file), readFile(file)])
  const manifest = JSON.parse(manifestText) as { archive?: { sha256?: string }; fileCount?: number }
  if (manifest.archive?.sha256 !== digest) throw new Error(`Checksum mismatch: ${path.basename(file)}`)
  const zip = await JSZip.loadAsync(archive)
  const fileCount = Object.values(zip.files).filter((entry) => !entry.dir).length
  if (fileCount !== manifest.fileCount) throw new Error(`File count mismatch: ${path.basename(file)}`)
}

async function main() {
  const target = process.argv[2]
  if (!target) throw new Error('Usage: npm.cmd run verify:backup -- <snapshot-directory>')
  const entries = await readdir(target)
  const databases = entries.filter((entry) => entry.endsWith('.json.gz')).map((entry) => path.join(target, entry))
  const files = entries.filter((entry) => entry.endsWith('.zip')).map((entry) => path.join(target, entry))
  if (!databases.length || !files.length) throw new Error('Snapshot must contain one database archive and one files archive.')
  await Promise.all([...databases.map(verifyDatabaseArchive), ...files.map(verifyFilesArchive)])

  const snapshotManifest = path.join(target, 'snapshot-manifest.json')
  try {
    const snapshot = JSON.parse(await readFile(snapshotManifest, 'utf8')) as { status?: string; artifacts?: Array<{ fileName?: string; sha256?: string }> }
    if (snapshot.status !== 'complete') throw new Error('Snapshot manifest is not marked complete.')
    for (const artifact of snapshot.artifacts ?? []) {
      if (!artifact.fileName || !artifact.sha256) throw new Error('Snapshot manifest has an invalid artifact.')
      const fullPath = path.resolve(target, artifact.fileName)
      if (path.dirname(fullPath) !== path.resolve(target) || (await hashFile(fullPath)) !== artifact.sha256) throw new Error(`Snapshot artifact mismatch: ${artifact.fileName}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const stats = await Promise.all([...databases, ...files].map((file) => stat(file)))
  console.log(`Backup smoke check passed: ${databases.length} database archive(s), ${files.length} files archive(s), ${stats.reduce((sum, item) => sum + item.size, 0)} bytes.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
