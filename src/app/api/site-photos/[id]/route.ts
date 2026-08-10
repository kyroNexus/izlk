import { NextResponse } from 'next/server'
import { contractScope, type SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { readStoredFile } from '@/lib/storage'

async function get(_request: Request, { user }: { user: SessionUser }, { params }: { params: { id: string } }) {
	const photo = await prisma.sitePhoto.findFirst({ where: { id: params.id, siteWork: { site: { contract: contractScope(user) } } }, select: { fileName: true, storagePath: true, mimeType: true } })
	if (!photo) return new NextResponse('Not found', { status: 404 })
	try {
		const buffer = await readStoredFile(photo.storagePath)
		return new NextResponse(new Uint8Array(buffer), { headers: { 'Content-Type': photo.mimeType, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(photo.fileName)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
	} catch {
		return new NextResponse('Файл недоступен в хранилище', { status: 410 })
	}
}

export const GET = withApiAuth(get, { access: 'authenticated' })
