import { NextResponse } from 'next/server'
import { hasNotificationSyncToken, runNotificationSyncJob } from '@/lib/notification-sync-job'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!hasNotificationSyncToken(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await runNotificationSyncJob()
    if (result.status === 'locked') return NextResponse.json({ error: 'Notification sync is already running' }, { status: 409, headers: { 'Retry-After': '30' } })
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Notification sync failed' }, { status: 500 })
  }
}
