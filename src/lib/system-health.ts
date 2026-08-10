import { access, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/prisma'
import { INBOX_PATH, STORAGE_PATH } from '@/lib/storage'

type DirectoryHealth = {
	path: string
	available: boolean
	files: number
	bytes: number
}

async function inspectDirectory(root: string): Promise<DirectoryHealth> {
	const result: DirectoryHealth = { path: root, available: false, files: 0, bytes: 0 }
	try {
		await access(root, constants.R_OK | constants.W_OK)
		result.available = true
		const pending = [root]
		while (pending.length) {
			const current = pending.pop()!
			for (const entry of await readdir(current, { withFileTypes: true })) {
				const absolute = path.join(current, entry.name)
				if (entry.isDirectory()) pending.push(absolute)
				else if (entry.isFile()) {
					result.files += 1
					result.bytes += (await stat(absolute)).size
				}
			}
		}
	} catch {
		// Недоступная папка отображается в интерфейсе как проблема, а не ломает страницу.
	}
	return result
}

export async function getSystemHealth() {
	const startedAt = Date.now()
	const [storage, inbox, users, contracts, documents, pendingImports] = await Promise.all([
		inspectDirectory(STORAGE_PATH),
		inspectDirectory(INBOX_PATH),
		prisma.user.count({ where: { deletedAt: null, isActive: true } }),
		prisma.contract.count({ where: { deletedAt: null } }),
		prisma.document.count({ where: { deletedAt: null } }),
		prisma.inboxItem.count({ where: { status: { in: ['PENDING', 'SUGGESTED', 'FAILED'] } } }),
	])

	return {
		database: { available: true, latencyMs: Date.now() - startedAt },
		storage,
		inbox,
		counts: { users, contracts, documents, pendingImports },
		checkedAt: new Date(),
	}
}
