import JSZip from 'jszip'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { contractScope, requireUser } from '@/lib/access'
import { readStoredFile, safeFileName } from '@/lib/storage'
import { writeAudit } from '@/lib/audit'
import { DOCUMENT_KIND_LABELS } from '@/lib/format'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: { id: string } }) {
	const user = await requireUser()
	const contract = await prisma.contract.findFirst({
		where: { id: params.id, ...contractScope(user) },
		select: { id: true, number: true, documents: { where: { deletedAt: null, ...(['VIEWER', 'DESIGNER'].includes(user.role) ? { isConfidential: false } : {}) }, select: { id: true, fileName: true, storagePath: true, kind: true, executiveDoc: { select: { name: true } } } } },
	})
	if (!contract) return NextResponse.json({ error: 'Договор не найден' }, { status: 404 })
	if (!contract.documents.length) return NextResponse.json({ error: 'У договора нет файлов' }, { status: 404 })

	const zip = new JSZip()
	let added = 0
	for (const [index, document] of contract.documents.entries()) {
		try {
			const buffer = await readStoredFile(document.storagePath)
			const folder = safeFileName(document.executiveDoc?.name ?? DOCUMENT_KIND_LABELS[document.kind])
			zip.file(`${folder}/${String(index + 1).padStart(3, '0')}-${safeFileName(document.fileName)}`, buffer)
			added++
		} catch { /* один потерянный файл не должен ломать выгрузку остальных */ }
	}
	if (!added) return NextResponse.json({ error: 'Файлы недоступны в хранилище' }, { status: 410 })
	const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
	await writeAudit({ userId: user.id, action: 'DOWNLOAD', entityType: 'ContractBundle', entityId: contract.id, ipAddress: request.headers.get('x-forwarded-for') })
	const archiveName = encodeURIComponent(`Договор-${contract.number}-документы.zip`)
	return new NextResponse(new Uint8Array(archive), { headers: { 'Content-Type': 'application/zip', 'Content-Length': String(archive.length), 'Content-Disposition': `attachment; filename*=UTF-8''${archiveName}`, 'Cache-Control': 'private, no-store' } })
}
