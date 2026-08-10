import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { contractScope, requireUser } from '@/lib/access'
import { readStoredFile } from '@/lib/storage'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFile = promisify(execFileCallback)
const MAX_PREVIEW_PDF_BYTES = 80 * 1024 * 1024

/** Renders a PDF page to an image so Firefox never embeds its PDF plugin in an iframe. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
	const user = await requireUser()
	const document = await prisma.document.findFirst({
		where: { id: params.id, deletedAt: null, contract: contractScope(user) },
		select: { fileName: true, storagePath: true, sizeBytes: true, isConfidential: true },
	})
	if (!document) return NextResponse.json({ error: 'Документ не найден' }, { status: 404 })
	if (document.isConfidential && (user.role === 'VIEWER' || user.role === 'DESIGNER')) return NextResponse.json({ error: 'Доступ ограничен' }, { status: 403 })
	if (path.extname(document.fileName).toLowerCase() !== '.pdf') return NextResponse.json({ error: 'Предпросмотр доступен только для PDF' }, { status: 415 })
	if (Number(document.sizeBytes) > MAX_PREVIEW_PDF_BYTES) return NextResponse.json({ error: 'PDF слишком большой для безопасного предпросмотра' }, { status: 413 })

	const requestedPage = Number(new URL(request.url).searchParams.get('page') ?? '1')
	const page = Number.isInteger(requestedPage) && requestedPage > 0 && requestedPage <= 999 ? requestedPage : 1
	const directory = await mkdtemp(path.join(tmpdir(), 'izlk-preview-'))
	try {
		const input = path.join(directory, 'source.pdf')
		const outputPrefix = path.join(directory, 'page')
		await writeFile(input, await readStoredFile(document.storagePath))
		await execFile('pdftoppm', ['-png', '-singlefile', '-r', '150', '-f', String(page), '-l', String(page), input, outputPrefix], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })
		const image = await readFile(`${outputPrefix}.png`)
		return new NextResponse(new Uint8Array(image), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
	} catch (error) {
		logger.error('document.preview_failed', { route: '/api/documents/[id]/preview', method: 'GET', userId: user.id, entityType: 'Document', entityId: params.id, error })
		return NextResponse.json({ error: 'Не удалось подготовить страницу PDF. Откройте оригинал в новой вкладке.' }, { status: 422 })
	} finally {
		await rm(directory, { recursive: true, force: true }).catch(() => undefined)
	}
}
