import { NextResponse } from 'next/server'
import { removeStoredFile, saveSitePhoto, sha256Buffer } from '@/lib/storage'
import { contractScope, type SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

const MAX_PHOTO_BYTES = 20 * 1024 * 1024
const MAX_PHOTOS = 10
const ALLOWED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])

async function post(request: Request, { user }: { user: SessionUser }, { params }: { params: { id: string } }) {
	const form = await request.formData()
	const photo = form.get('photo')
	const checksum = String(form.get('checksum') ?? '').toLowerCase()
	if (!(photo instanceof File) || !/^[a-f0-9]{64}$/.test(checksum) || !ALLOWED_IMAGES.has(photo.type) || photo.size <= 0 || photo.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: 'Разрешены JPG, PNG, WEBP или HEIC до 20 МБ' }, { status: 400 })
	const report = await prisma.siteWork.findFirst({ where: { id: params.id, site: { deletedAt: null, contract: contractScope(user) } }, select: { id: true, siteId: true } })
	if (!report) return NextResponse.json({ error: 'Отчёт не найден' }, { status: 404 })
	const buffer = Buffer.from(await photo.arrayBuffer())
	if (sha256Buffer(buffer) !== checksum) return NextResponse.json({ error: 'Контрольная сумма фотографии не совпадает' }, { status: 400 })
	const duplicate = await prisma.sitePhoto.findUnique({ where: { siteWorkId_sha256: { siteWorkId: report.id, sha256: checksum } }, select: { id: true } })
	if (duplicate) return NextResponse.json({ photoId: duplicate.id, duplicate: true })
	if (await prisma.sitePhoto.count({ where: { siteWorkId: report.id } }) >= MAX_PHOTOS) return NextResponse.json({ error: 'В отчёте может быть не более 10 фотографий' }, { status: 400 })
	const saved = await saveSitePhoto({ siteId: report.siteId, workId: report.id, fileName: photo.name, buffer })
	try {
		const created = await prisma.$transaction(async (tx) => {
			await tx.$queryRaw`SELECT id FROM "SiteWork" WHERE id = ${report.id} FOR UPDATE`
			if (await tx.sitePhoto.count({ where: { siteWorkId: report.id } }) >= MAX_PHOTOS) throw new Error('PHOTO_LIMIT')
			return tx.sitePhoto.create({ data: { siteWorkId: report.id, fileName: saved.fileName, storagePath: saved.storagePath, mimeType: saved.mimeType, sizeBytes: BigInt(saved.sizeBytes), sha256: saved.sha256 }, select: { id: true } })
		})
		return NextResponse.json({ photoId: created.id }, { status: 201 })
	} catch (error: unknown) {
		await removeStoredFile(saved.storagePath)
		if ((error as Error).message === 'PHOTO_LIMIT') return NextResponse.json({ error: 'В отчёте может быть не более 10 фотографий' }, { status: 400 })
		if ((error as { code?: string }).code === 'P2002') {
			const existing = await prisma.sitePhoto.findUnique({ where: { siteWorkId_sha256: { siteWorkId: report.id, sha256: checksum } }, select: { id: true } })
			if (existing) return NextResponse.json({ photoId: existing.id, duplicate: true })
		}
		throw error
	}
}

export const POST = withApiAuth(post, { access: 'write', csrf: true })
