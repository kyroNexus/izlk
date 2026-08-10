import type { CommercialProposalStatus } from '@prisma/client'
import { contractScope, type SessionUser } from '@/lib/access'
import { loadDashboard } from '@/lib/dashboard'
import { prisma } from '@/lib/prisma'

export type ReportPeriod = { from: Date; to: Date }

export function parseReportPeriod(input: { from?: string | null; to?: string | null }, now = new Date()): ReportPeriod {
	const from = input.from ? new Date(`${input.from}T00:00:00.000`) : new Date(now.getFullYear(), now.getMonth(), 1)
	const to = input.to ? new Date(`${input.to}T23:59:59.999`) : now
	if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new Error('Некорректный период отчёта')
	return { from, to }
}

export const proposalStatusLabel: Record<CommercialProposalStatus, string> = {
	DRAFT: 'Черновик', SENT: 'Отправлено', WAITING_RESPONSE: 'Ждём ответ', ACCEPTED: 'Принято', REJECTED: 'Отклонено',
}

/** Shared, scoped source for the reports screen and its XLSX export. */
export async function loadReportData(user: SessionUser, period: ReportPeriod) {
	const scope = contractScope(user)
	const dateFilter = { gte: period.from, lte: period.to }
	const [dashboard, proposals, contracts] = await Promise.all([
		loadDashboard(user),
		prisma.document.findMany({
			where: { deletedAt: null, kind: 'COMMERCIAL_PROPOSAL', createdAt: dateFilter, contract: scope, ...(!user || ['VIEWER', 'DESIGNER'].includes(user.role) ? { isConfidential: false } : {}) },
			select: { id: true, fileName: true, proposalStatus: true, proposalSentAt: true, proposalRespondedAt: true, createdAt: true, contract: { select: { id: true, number: true, contractor: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 500,
		}),
		prisma.contract.findMany({
			where: scope,
			select: { id: true, number: true, cipher: true, date: true, status: true, workflowStage: true, currency: true, contractor: { select: { name: true } }, amount: true, smrAmount: true, mkAmount: true, deliveryAmount: true, sites: { where: { deletedAt: null }, select: { works: { where: { workDate: dateFilter }, select: { direction: true, crewCost: true, equipmentCost: true, materialCost: true, otherCost: true } } } } },
			orderBy: { date: 'desc' }, take: 2000,
		}),
	])
	const planFact = contracts.map((contract) => {
		const plan = Number(contract.smrAmount ?? 0) + Number(contract.mkAmount ?? 0) + Number(contract.deliveryAmount ?? 0)
		const works = contract.sites.flatMap((site) => site.works)
		const actual = works.reduce((sum, work) => sum + Number(work.crewCost) + Number(work.equipmentCost) + Number(work.materialCost) + Number(work.otherCost), 0)
		return { id: contract.id, number: contract.number, cipher: contract.cipher, currency: contract.currency, plan, actual, variance: plan - actual }
	})
	return { dashboard, proposals, contracts, planFact }
}
