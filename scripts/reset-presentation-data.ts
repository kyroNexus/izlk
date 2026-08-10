import { prisma } from '../src/lib/prisma'

/**
 * Clears operational demo data before a presentation.
 *
 * Important: this script changes ONLY database records. It deliberately does
 * not touch STORAGE_PATH, INBOX_PATH or any original file on disk.
 */
const confirmation = 'YES_DELETE_CONTRACT_DATA'

async function main() {
  if (process.env.CONFIRM_PRESENTATION_RESET !== confirmation) {
    throw new Error(`Для очистки укажите CONFIRM_PRESENTATION_RESET=${confirmation}`)
  }

  const removed = await prisma.$transaction(async (tx) => {
    // Delete dependants first. This keeps the operation independent from
    // database-level cascade settings and makes the scope explicit.
    const [taskComments, documents, sitePhotos, siteCrewEntries, siteCostItems, siteWorks, siteEvents] = await Promise.all([
      tx.taskComment.deleteMany(),
      tx.document.deleteMany(),
      tx.sitePhoto.deleteMany(),
      tx.siteCrewEntry.deleteMany(),
      tx.siteCostItem.deleteMany(),
      tx.siteWork.deleteMany(),
      tx.siteEvent.deleteMany(),
    ])

    await tx.agreement.updateMany({ data: { parentId: null } })

    const [sites, projectSections, executiveDocs, estimates, agreements, invoices, contractAccess, stageHistory, tasks, inboxItems, importEvents, snapshots, auditLogs, notifications] = await Promise.all([
      tx.site.deleteMany(),
      tx.projectSection.deleteMany(),
      tx.executiveDoc.deleteMany(),
      tx.estimate.deleteMany(),
      tx.agreement.deleteMany(),
      tx.invoice.deleteMany(),
      tx.contractAccess.deleteMany(),
      tx.contractStageHistory.deleteMany(),
      tx.task.deleteMany(),
      tx.inboxItem.deleteMany(),
      tx.importEvent.deleteMany(),
      tx.departmentDailySnapshot.deleteMany(),
      tx.auditLog.deleteMany(),
      tx.notification.deleteMany(),
    ])

    const contracts = await tx.contract.deleteMany()
    const contractors = await tx.contractor.deleteMany({ where: { contracts: { none: {} } } })

    return {
      taskComments: taskComments.count,
      documents: documents.count,
      sitePhotos: sitePhotos.count,
      siteCrewEntries: siteCrewEntries.count,
      siteCostItems: siteCostItems.count,
      siteWorks: siteWorks.count,
      siteEvents: siteEvents.count,
      sites: sites.count,
      projectSections: projectSections.count,
      executiveDocs: executiveDocs.count,
      estimates: estimates.count,
      agreements: agreements.count,
      invoices: invoices.count,
      contractAccess: contractAccess.count,
      stageHistory: stageHistory.count,
      tasks: tasks.count,
      contracts: contracts.count,
      inboxItems: inboxItems.count,
      importEvents: importEvents.count,
      snapshots: snapshots.count,
      auditLogs: auditLogs.count,
      notifications: notifications.count,
      contractors: contractors.count,
    }
  })

  const total = Object.values(removed).reduce((sum, count) => sum + count, 0)
  console.log(`Очищено записей БД: ${total}`)
  console.table(removed)
  console.log('Оригинальные файлы в storage и inbox не удалялись.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
