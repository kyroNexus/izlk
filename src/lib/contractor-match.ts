import { prisma } from './prisma'
import { normalizeCompanyName, normalizePhone } from './contractor-normalization'

export type ContractorMatchInput = {
	name?: string | null
	inn?: string | null
	phone?: string | null
	email?: string | null
}

export type ContractorMatch = {
	id: string
	name: string
	inn: string | null
	phone: string | null
	email: string | null
	aliases: string[]
	reasons: Array<'inn' | 'email' | 'phone' | 'name' | 'alias'>
}

export { normalizeCompanyName, normalizePhone } from './contractor-normalization'

/** Finds one contractor without creating a duplicate during folder import. */
export async function findMatchingContractor(input: ContractorMatchInput): Promise<ContractorMatch | null> {
	const inn = (input.inn ?? '').replace(/\D/g, '')
	const email = (input.email ?? '').trim().toLocaleLowerCase('ru-RU')
	const phone = normalizePhone(input.phone)
	const name = normalizeCompanyName(input.name)
	if (!inn && !email && !phone && !name) return null

	// The company catalogue is small (hundreds, not millions). Comparing the
	// normalized phone/name in memory handles human-entered formats reliably.
	const candidates = await prisma.contractor.findMany({
		where: { deletedAt: null },
		select: { id: true, name: true, inn: true, phone: true, email: true, aliases: true },
		take: 3000,
	})

	let best: ContractorMatch | null = null
	let bestScore = 0
	for (const candidate of candidates) {
		const reasons: ContractorMatch['reasons'] = []
		let score = 0
		if (inn && candidate.inn === inn) { reasons.push('inn'); score += 100 }
		if (email && candidate.email?.trim().toLocaleLowerCase('ru-RU') === email) { reasons.push('email'); score += 80 }
		if (phone && normalizePhone(candidate.phone) === phone) { reasons.push('phone'); score += 70 }
		if (name && normalizeCompanyName(candidate.name) === name) { reasons.push('name'); score += 50 }
		if (name && candidate.aliases.some((alias) => normalizeCompanyName(alias) === name)) { reasons.push('alias'); score += 40 }
		if (score > bestScore) { bestScore = score; best = { ...candidate, reasons } }
	}
	return best
}
