import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { contractScope, type SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { writeAudit } from '@/lib/audit'
import { mimeByFileName, readStoredFile } from '@/lib/storage'
import { logger } from '@/lib/logger'

// fs/promises и crypto работают только в Node-рантайме, не в Edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Скачивание документа.
 *
 * Раньше файлы вообще нельзя было получить из интерфейса: в БД лежал
 * только storagePath. Здесь файл отдаётся с проверкой доступа к договору,
 * защитой от выхода за пределы хранилища и записью в аудит.
 */
async function get(
	request: Request,
	{ user, requestId }: { user: SessionUser; requestId: string },
	{ params }: { params: { id: string } },
) {

	const document = await prisma.document.findFirst({
		where: {
			id: params.id,
			deletedAt: null,
			contract: contractScope(user),
		},
		select: {
			id: true,
			fileName: true,
			storagePath: true,
			mimeType: true,
			isConfidential: true,
		},
	})

	if (!document) {
		return NextResponse.json({ error: 'Документ не найден' }, { status: 404 })
	}

	// Конфиденциальные документы не выдаются роли только для чтения.
	if (document.isConfidential && (user.role === 'VIEWER' || user.role === 'DESIGNER')) {
		return NextResponse.json({ error: 'Доступ ограничен' }, { status: 403 })
	}

	let file: Buffer
	try {
		file = await readStoredFile(document.storagePath)
	} catch (error) {
		logger.error('document.read_failed', { requestId, route: '/api/documents/[id]', method: 'GET', userId: user.id, entityType: 'Document', entityId: document.id, error })
		return NextResponse.json({ error: 'Файл недоступен на диске' }, { status: 410 })
	}

	await writeAudit({
		userId: user.id,
		action: 'DOWNLOAD',
		entityType: 'Document',
		entityId: document.id,
		ipAddress: request.headers.get('x-forwarded-for'),
	})

	const fileName = encodeURIComponent(document.fileName)
	const requestedInline = new URL(request.url).searchParams.get('inline') === '1'
	const safeInlineTypes = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/heic'])
	const declaredType = mimeByFileName(document.fileName)
	// Имя файла нельзя считать доказательством формата. Если в «.pdf» лежит
	// что-то другое, не отдаём это браузерному PDF-просмотрщику — только скачивание.
	const validPdf = declaredType !== 'application/pdf' || file.subarray(0, 5).toString('ascii') === '%PDF-'
	const contentType = validPdf ? declaredType : 'application/octet-stream'
	const inline = requestedInline && safeInlineTypes.has(contentType)

	return new NextResponse(new Uint8Array(file), {
		headers: {
			// Never trust a browser-supplied MIME type persisted by older versions.
			'Content-Type': contentType,
			'Content-Length': String(file.length),
			'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${fileName}`,
			'X-Content-Type-Options': 'nosniff',
			// The global application policy forbids frames. This endpoint is the
			// deliberate authenticated same-origin exception used by the viewer.
			'X-Frame-Options': 'SAMEORIGIN',
			'Content-Security-Policy': "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'",
			'Cache-Control': 'private, no-store',
		},
	})
}

export const GET = withApiAuth(get, { access: 'authenticated', rateLimit: 'document-download' })
