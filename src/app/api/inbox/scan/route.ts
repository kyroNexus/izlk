import { NextResponse } from 'next/server'
import { getActiveUser, isAdmin } from '@/lib/access'
import { scanInbox } from '@/lib/inbox-scanner'

export const runtime = 'nodejs'

export async function POST(request: Request) {
	const user = await getActiveUser()
	const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
	const tokenAllowed = Boolean(process.env.INBOX_SCAN_TOKEN && token === process.env.INBOX_SCAN_TOKEN)
	if ((!user || !isAdmin(user)) && !tokenAllowed) return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
	try { return NextResponse.json(await scanInbox()) }
	catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Ошибка сканирования' }, { status: 500 }) }
}
