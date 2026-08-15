import { NextResponse } from 'next/server'
import { getActiveUser } from '@/lib/access'
import { createConstructionScheduleWorkbook } from '@/lib/report-xlsx'

export const runtime = 'nodejs'

export async function GET() {
	const user = await getActiveUser()
	if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 })
	try {
		const file = await createConstructionScheduleWorkbook(user)
		const stamp = new Date().toISOString().slice(0, 10)
		const filename = `grafik-strojotdela-${stamp}.xlsx`
		return new NextResponse(new Uint8Array(file), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось сформировать файл' }, { status: 400 })
	}
}
