import { NextResponse } from 'next/server'
import { requireUser, contractScope } from '@/lib/access'
import { prisma } from '@/lib/prisma'
import { readStoredFile } from '@/lib/storage'

export async function GET(_request: Request, { params }: { params: { id: string } }) {
	const user = await requireUser()
	const photo = await prisma.sitePhoto.findFirst({ where: { id: params.id, siteWork: { site: { contract: contractScope(user) } } }, select: { fileName: true, storagePath: true, mimeType: true } })
	if (!photo) return new NextResponse('Not found', { status: 404 })
	try {
		const buffer = await readStoredFile(photo.storagePath)
		return new NextResponse(new Uint8Array(buffer), { headers: { 'Content-Type': photo.mimeType, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(photo.fileName)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
	} catch {
		return new NextResponse('Файл недоступен в хранилище', { status: 410 })
	}
}
