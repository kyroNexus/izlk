import { NextResponse } from 'next/server'
import { canWrite, findContractInScope, type SessionUser } from '@/lib/access'
import { prisma } from '@/lib/prisma'

const DEPARTMENTS = new Set(['commercial', 'engineering', 'production', 'construction'])

export async function chatThread(user: SessionUser, scope: 'department' | 'contract', value: string) {
	if (scope === 'department') {
		if (!DEPARTMENTS.has(value) || user.role === 'VIEWER') return null
		return prisma.chatThread.upsert({ where: { key: `department:${value}` }, create: { key: `department:${value}`, scope: 'DEPARTMENT', department: value }, update: {} })
	}
	const contract = await findContractInScope(value, user)
	if (!contract) return null
	return prisma.chatThread.upsert({ where: { key: `contract:${contract.id}` }, create: { key: `contract:${contract.id}`, scope: 'CONTRACT', contractId: contract.id }, update: {} })
}

export async function requireChatWrite(user: SessionUser, scope: 'department' | 'contract', value: string) {
	if (!canWrite(user)) return false
	return Boolean(await chatThread(user, scope, value))
}

export function chatError() {
	return NextResponse.json({ error: 'Нет доступа к чату' }, { status: 403 })
}
