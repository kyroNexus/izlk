import { Prisma } from '@prisma/client'

export type BackupTable = {
  model: string
  delegate: string
}

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1)

// Always backed up from Prisma's actual schema, so a new model cannot be missed.
export const backupTables: BackupTable[] = Prisma.dmmf.datamodel.models.map(({ name }) => ({
  model: name,
  delegate: delegateName(name),
}))

// Parent rows must exist before a child row is restored. Keep this explicit and
// fail fast when the Prisma schema gains a new model.
export const restoreOrder = [
  'user',
  'contractor',
  'contract',
  'productionPlan',
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
  'document',
  'task',
  'taskComment',
  'notification',
  'inboxItem',
  'importEvent',
  'auditLog',
  'contractStageHistory',
  'contractStageComment',
  'stageComment',
  'chatThread',
  'chatMessage',
  'departmentDailySnapshot',
  'contractAccess',
  'backgroundJob',
  'rateLimitBucket',
] as const

export function assertBackupModelCoverage() {
  const actual = new Set(backupTables.map((table) => table.delegate))
  const ordered = new Set<string>(restoreOrder)
  const missing = [...actual].filter((table) => !ordered.has(table))
  const unknown = [...ordered].filter((table) => !actual.has(table))
  if (missing.length || unknown.length) {
    throw new Error(
      `Restore order does not match Prisma schema. Missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}.`,
    )
  }
}

export function modelForDelegate(delegate: string) {
  const table = backupTables.find((item) => item.delegate === delegate)
  if (!table) throw new Error(`Unknown Prisma delegate: ${delegate}`)
  return table.model
}
