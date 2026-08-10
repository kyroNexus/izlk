import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * A changed file with the same name is a new version, not a second current
 * document. Exact binary copies are rejected by callers using SHA-256 before
 * this point. Older variants stay available in the archive.
 */
export async function createVersionedDocument(data: Prisma.DocumentUncheckedCreateInput) {
	return prisma.$transaction(async (tx) => {
		const previous = await tx.document.findMany({
			where: { contractId: data.contractId, fileName: data.fileName, deletedAt: null },
			select: { id: true, version: true },
		})
		if (previous.length) {
			await tx.document.updateMany({
				where: { id: { in: previous.map((document) => document.id) } },
				data: { state: 'ARCHIVE' },
			})
		}
		const nextVersion = Math.max(0, ...previous.map((document) => document.version)) + 1
		return tx.document.create({ data: { ...data, version: nextVersion } })
	})
}
