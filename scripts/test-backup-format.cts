const { Prisma } = require('@prisma/client')
const { assertBackupModelCoverage, backupTables, restoreOrder } = require('./backup-models')

assertBackupModelCoverage()
const expected = Prisma.dmmf.datamodel.models.map((model: { name: string }) => model.name).sort()
const backedUp = backupTables.map((table: { model: string }) => table.model).sort()
if (JSON.stringify(expected) !== JSON.stringify(backedUp)) throw new Error('Backup model set differs from Prisma schema.')
if (new Set(restoreOrder).size !== restoreOrder.length) throw new Error('Restore order contains duplicates.')
console.log(`Backup model coverage passed: ${backupTables.length} Prisma models.`)
