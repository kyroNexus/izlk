import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * A contract import crosses the database and file storage.  If a failure occurs
 * between those steps, remove all records created for that new contract so an
 * incomplete card never appears in the working list. Physical files are
 * intentionally preserved: operational policy forbids deleting originals
 * until retention rules are agreed with the customer.
 */
export async function rollbackNewContractImport(contractId: string): Promise<void> {
	await prisma.$transaction(async (tx) => {
		await tx.document.deleteMany({ where: { contractId } })
		await tx.task.deleteMany({ where: { contractId } })
		await tx.contractAccess.deleteMany({ where: { contractId } })
		await tx.executiveDoc.deleteMany({ where: { contractId } })
		await tx.projectSection.deleteMany({ where: { contractId } })
		await tx.site.deleteMany({ where: { contractId } })
		await tx.estimate.deleteMany({ where: { contractId } })
		await tx.agreement.deleteMany({ where: { contractId } })
		await tx.invoice.deleteMany({ where: { contractId } })
		await tx.contractStageHistory.deleteMany({ where: { contractId } })
		await tx.contract.deleteMany({ where: { id: contractId } })
	})
	// Keep storage/<contractId> untouched. An administrator can inspect or
	// recover these bytes later; no automatic import failure may erase them.
}

/** Delete a newly-created contractor only when no successful contract uses it. */
export async function removeUnusedImportedContractor(contractorId: string | null): Promise<void> {
	if (!contractorId) return
	const stillUsed = await prisma.contract.count({ where: { contractorId } })
	if (stillUsed === 0) await prisma.contractor.delete({ where: { id: contractorId } }).catch((error) => logger.error('contract_import.contractor_cleanup_failed', { entityType: 'Contractor', entityId: contractorId, error }))
}
