import type { Prisma } from '@prisma/client'
import { withApiAuth } from '@/lib/api-auth'
import { contractScope } from '@/lib/access'
import { prisma } from '@/lib/prisma'

const LIMIT = 6
const MIN_QUERY_LENGTH = 2

type Item = { id: string; type: 'contract' | 'contractor' | 'document' | 'task' | 'site'; title: string; subtitle?: string; href: string }

export const GET = withApiAuth(async (request, { user }) => {
	const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
	if (query.length === 1) return Response.json({ error: `Введите минимум ${MIN_QUERY_LENGTH} символа` }, { status: 400 })
	const contains = query ? { contains: query, mode: 'insensitive' as const } : undefined
	const scope = contractScope(user)
	const taskScope: Prisma.TaskWhereInput = user.role === 'ADMIN' ? {} : user.role === 'MANAGER'
		? { OR: [{ assigneeId: user.id }, { creatorId: user.id }, { contract: { managerId: user.id } }] }
		: { assigneeId: user.id }
	const [contracts, contractors, documents, tasks, sites] = await Promise.all([
		prisma.contract.findMany({ where: { ...scope, ...(contains ? { OR: [{ number: contains }, { cipher: contains }] } : {}) }, select: { id: true, number: true, cipher: true }, orderBy: { updatedAt: 'desc' }, take: LIMIT }),
		prisma.contractor.findMany({ where: { deletedAt: null, ...(user.role === 'ADMIN' ? {} : { contracts: { some: scope } }), ...(contains ? { name: contains } : {}) }, select: { id: true, name: true }, orderBy: { updatedAt: 'desc' }, take: LIMIT }),
		prisma.document.findMany({ where: { deletedAt: null, contract: scope, ...(contains ? { fileName: contains } : {}), ...(['VIEWER', 'DESIGNER'].includes(user.role) ? { isConfidential: false } : {}) }, select: { id: true, fileName: true, contract: { select: { number: true } } }, orderBy: { createdAt: 'desc' }, take: LIMIT }),
		prisma.task.findMany({ where: { deletedAt: null, ...taskScope, ...(contains ? { title: contains } : {}) }, select: { id: true, title: true, contract: { select: { number: true } } }, orderBy: { updatedAt: 'desc' }, take: LIMIT }),
		prisma.site.findMany({ where: { deletedAt: null, contract: scope, ...(contains ? { OR: [{ address: contains }, { contract: { ...scope, OR: [{ number: contains }, { cipher: contains }, { contractor: { name: contains } }] } }] } : {}) }, select: { id: true, address: true, contract: { select: { number: true } } }, orderBy: { updatedAt: 'desc' }, take: LIMIT }),
	])
	const results: Item[] = [
		...contracts.map((item) => ({ id: item.id, type: 'contract' as const, title: `Договор № ${item.number}`, subtitle: item.cipher ?? undefined, href: `/contracts/${item.id}` })),
		...contractors.map((item) => ({ id: item.id, type: 'contractor' as const, title: item.name, href: `/contractors/${item.id}` })),
		...documents.map((item) => ({ id: item.id, type: 'document' as const, title: item.fileName, subtitle: `Договор № ${item.contract.number}`, href: `/documents/${item.id}` })),
		...tasks.map((item) => ({ id: item.id, type: 'task' as const, title: item.title, subtitle: item.contract ? `Договор № ${item.contract.number}` : undefined, href: `/tasks/${item.id}` })),
		...sites.map((item) => ({ id: item.id, type: 'site' as const, title: item.address, subtitle: `Договор № ${item.contract.number}`, href: `/sites/${item.id}` })),
	]
	return Response.json({ results })
}, { access: 'authenticated' })
