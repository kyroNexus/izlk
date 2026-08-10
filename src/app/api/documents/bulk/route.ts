import JSZip from 'jszip'
import { NextResponse } from 'next/server'
import { DocumentKind, DocumentState } from '@prisma/client'
import { canWrite, contractScope, type SessionUser } from '@/lib/access'
import { withApiAuth } from '@/lib/api-auth'
import { writeAudit } from '@/lib/audit'
import { DOCUMENT_BATCH_MAX, documentBulkInput } from '@/lib/document-bulk'
import { DOCUMENT_KIND_LABELS } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit } from '@/lib/rate-limit'
import { readStoredFile, safeFileName } from '@/lib/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const kinds = new Set(Object.values(DocumentKind))
const states = new Set(Object.values(DocumentState))
type Result = { id: string; status: 'updated' | 'skipped' | 'failed'; error?: string }

function forbiddenResults(ids: string[], found: Set<string>): Result[] {
	return ids.filter((id) => !found.has(id)).map((id) => ({ id, status: 'skipped', error: 'Документ не найден или недоступен' }))
}

async function post(request: Request, { user }: { user: SessionUser }) {
	const parsed = documentBulkInput.safeParse(await request.json().catch(() => null))
	if (!parsed.success) return NextResponse.json({ error: 'Некорректный пакет документов' }, { status: 400 })
	const input = parsed.data
	if (input.action !== 'download' && !canWrite(user)) return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
	if (input.action === 'kind' && !input.kind || input.action === 'kind' && !kinds.has(input.kind as DocumentKind)) return NextResponse.json({ error: 'Некорректный тип документа' }, { status: 400 })
	if (input.action === 'state' && !input.state || input.action === 'state' && !states.has(input.state as DocumentState)) return NextResponse.json({ error: 'Некорректное состояние документа' }, { status: 400 })
	if (input.action === 'confidential' && typeof input.isConfidential !== 'boolean') return NextResponse.json({ error: 'Не указан режим конфиденциальности' }, { status: 400 })

	const documents = await prisma.document.findMany({
		where: { id: { in: input.ids }, deletedAt: null, contract: contractScope(user), ...(['VIEWER', 'DESIGNER'].includes(user.role) ? { isConfidential: false } : {}) },
		select: { id: true, fileName: true, storagePath: true, kind: true, state: true, signedAt: true },
	})
	const found = new Set(documents.map((document) => document.id))
	const results = forbiddenResults(input.ids, found)

	if (input.action === 'download') {
		const limit = await consumeRateLimit('contract-download', `user:${user.id}`)
		if (!limit.allowed) return NextResponse.json({ error: 'Слишком много запросов' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } })
		const zip = new JSZip()
		for (const document of documents) {
			try {
				zip.file(`${safeFileName(DOCUMENT_KIND_LABELS[document.kind])}/${safeFileName(document.fileName)}`, await readStoredFile(document.storagePath))
				results.push({ id: document.id, status: 'updated' })
				await writeAudit({ userId: user.id, action: 'DOWNLOAD', entityType: 'Document', entityId: document.id, ipAddress: request.headers.get('x-forwarded-for') })
			} catch { results.push({ id: document.id, status: 'failed', error: 'Файл недоступен в хранилище' }) }
		}
		if (!results.some((result) => result.status === 'updated')) return NextResponse.json({ error: 'Нет файлов для скачивания', results }, { status: 410 })
		zip.file('_результат.json', JSON.stringify({ results }, null, 2))
		const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
		return new NextResponse(new Uint8Array(archive), { headers: { 'Content-Type': 'application/zip', 'Content-Length': String(archive.length), 'Content-Disposition': "attachment; filename*=UTF-8''documents.zip", 'Cache-Control': 'private, no-store' } })
	}

	for (const document of documents) {
		try {
			const data = input.action === 'kind' ? { kind: input.kind as DocumentKind }
				: input.action === 'state' ? { state: input.state as DocumentState }
				: input.action === 'confidential' ? { isConfidential: input.isConfidential }
				: input.action === 'archive' ? { state: 'ARCHIVE' as const }
				: { state: document.signedAt ? 'SIGNED' as const : 'SOURCE' as const }
			await prisma.document.update({ where: { id: document.id }, data })
			await writeAudit({ userId: user.id, action: 'UPDATE', entityType: `DocumentBulk:${input.action}`, entityId: document.id, ipAddress: request.headers.get('x-forwarded-for') })
			results.push({ id: document.id, status: 'updated' })
		} catch { results.push({ id: document.id, status: 'failed', error: 'Не удалось обновить документ' }) }
	}
	return NextResponse.json({ results, limit: DOCUMENT_BATCH_MAX })
}

export const POST = withApiAuth(post, { access: 'authenticated', csrf: true })
