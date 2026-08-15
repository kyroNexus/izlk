import { NextResponse } from 'next/server'
import { canSeeSchedules, getActiveUser } from '@/lib/access'
import { createProductionScheduleWorkbook } from '@/lib/report-xlsx'

export const runtime = 'nodejs'

export async function GET() {
	const user = await getActiveUser()
	if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 })
	if (!canSeeSchedules(user)) return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
	try {
		const file = await createProductionScheduleWorkbook(user)
		const stamp = new Date().toISOString().slice(0, 10)
		const filename = `grafik-proizvodstva-${stamp}.xlsx`
		return new NextResponse(new Uint8Array(file), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось сформировать файл' }, { status: 400 })
	}
}
