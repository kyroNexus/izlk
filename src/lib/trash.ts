import { prisma } from '@/lib/prisma'

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export async function permanentlyDeleteDocument(id: string) {
  const target = await prisma.document.findUnique({ where: { id } })
  if (!target) return false
  // The registry is not the source archive.  Even a permanent removal from
  // the UI must never erase the physical original/copy until the company
  // approves a separate file-retention policy.
  await prisma.document.delete({ where: { id } })
  return true
}

export async function permanentlyDeleteContract(id: string) {
  const target = await prisma.contract.findUnique({ where: { id }, include: { documents: true } })
  if (!target) return false
  await prisma.$transaction(async (tx) => {
    await tx.document.deleteMany({ where: { contractId: id } })
    await tx.sitePhoto.deleteMany({ where: { siteWork: { site: { contractId: id } } } })
    await tx.siteCrewEntry.deleteMany({ where: { siteWork: { site: { contractId: id } } } })
    await tx.siteCostItem.deleteMany({ where: { siteWork: { site: { contractId: id } } } })
    await tx.siteWork.deleteMany({ where: { site: { contractId: id } } })
    await tx.siteEvent.deleteMany({ where: { site: { contractId: id } } })
    await tx.site.deleteMany({ where: { contractId: id } })
    await tx.taskComment.deleteMany({ where: { task: { contractId: id } } })
    await tx.task.deleteMany({ where: { contractId: id } })
    await tx.projectSection.deleteMany({ where: { contractId: id } })
    await tx.executiveDoc.deleteMany({ where: { contractId: id } })
    await tx.estimate.deleteMany({ where: { contractId: id } })
    await tx.agreement.deleteMany({ where: { contractId: id } })
    await tx.invoice.deleteMany({ where: { contractId: id } })
    await tx.contractAccess.deleteMany({ where: { contractId: id } })
    await tx.contractStageHistory.deleteMany({ where: { contractId: id } })
    await tx.contract.delete({ where: { id } })
  })
  return true
}

/** Called by the worker at most once a day. Expired records are irreversibly removed. */
export async function purgeExpiredTrash() {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS)
  const [documents, contracts] = await Promise.all([
    prisma.document.findMany({ where: { deletedAt: { lte: cutoff } }, select: { id: true } }),
    prisma.contract.findMany({ where: { deletedAt: { lte: cutoff } }, select: { id: true } }),
  ])
  for (const item of documents) await permanentlyDeleteDocument(item.id)
  for (const item of contracts) await permanentlyDeleteContract(item.id)
  return { documents: documents.length, contracts: contracts.length }
}
