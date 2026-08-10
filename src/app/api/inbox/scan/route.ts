import { NextResponse } from 'next/server'
import { type SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { machineRateLimitIdentity } from '@/lib/rate-limit'
import { runRateLimitedInboxScan } from '@/lib/inbox-scan-runner'

export const runtime = 'nodejs'

async function scan(identity: string) {
	try {
		const operation = await runRateLimitedInboxScan(identity)
		if (!operation.result) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(operation.retryAfter) } })
		return NextResponse.json(operation.result)
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : 'Inbox scan failed' }, { status: 500 })
	}
}

async function browserPost(_request: Request, { user }: { user: SessionUser }) {
	return scan(`user:${user.id}`)
}

const browserPostWithAuth = withApiAuth(browserPost, { access: 'admin', csrf: true })

export async function POST(request: Request) {
	const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
	const tokenAllowed = Boolean(process.env.INBOX_SCAN_TOKEN && token === process.env.INBOX_SCAN_TOKEN)
	if (tokenAllowed && token) return scan(machineRateLimitIdentity(token))
	return browserPostWithAuth(request)
}
