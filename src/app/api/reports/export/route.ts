import { NextResponse } from 'next/server'
import { getActiveUser } from '@/lib/access'
import { parseReportPeriod } from '@/lib/report-data'
import { createReportWorkbook } from '@/lib/report-xlsx'

export const runtime = 'nodejs'

export async function GET(request: Request) {
	const user = await getActiveUser()
	if (!user) return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 })
	try {
		const { searchParams } = new URL(request.url)
		const period = parseReportPeriod({ from: searchParams.get('from'), to: searchParams.get('to') })
		const file = await createReportWorkbook(user, period)
		const stamp = new Date().toISOString().slice(0, 10)
		const filename = `Отчёт_${period.from.toISOString().slice(0, 10)}_${period.to.toISOString().slice(0, 10)}_${stamp}.xlsx`
		return new NextResponse(new Uint8Array(file), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Не удалось сформировать отчёт' }, { status: 400 })
	}
}
