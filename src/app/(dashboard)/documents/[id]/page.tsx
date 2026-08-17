import path from 'path'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { Card, Chip, FileIcon, selectClass } from '@/components/ui'
import { DOCUMENT_KIND_LABELS, formatBytes, formatDate, initials } from '@/lib/format'
import { canWrite, contractScope, requireUser } from '@/lib/access'
import { prisma } from '@/lib/prisma'
import { readStoredFile } from '@/lib/storage'
import { writeAudit } from '@/lib/audit'
import type { CommercialProposalStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

const MAX_TEXT_PREVIEW_BYTES = 12 * 1024 * 1024

const PROPOSAL_STATUS: Record<CommercialProposalStatus, { label: string; tone: 'off' | 'brand' | 'warn' | 'ok' | 'danger'; hint: string }> = {
	DRAFT: { label: 'Черновик', tone: 'off', hint: 'Ещё не отправлено заказчику' },
	SENT: { label: 'Отправлено', tone: 'brand', hint: 'КП передано заказчику' },
	WAITING_RESPONSE: { label: 'Ждём ответ', tone: 'warn', hint: 'Нужен контроль ответа заказчика' },
	ACCEPTED: { label: 'Принято', tone: 'ok', hint: 'Заказчик подтвердил предложение' },
	REJECTED: { label: 'Отклонено', tone: 'danger', hint: 'Заказчик отказался от предложения' },
}

function extension(fileName: string) {
	return path.extname(fileName).toLowerCase()
}

function isImage(ext: string) {
	return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)
}

function positivePage(value: string | undefined, max: number) {
	const page = Number(value)
	return Number.isInteger(page) && page > 0 ? Math.min(page, Math.max(1, max)) : 1
}

export default async function DocumentViewerPage({ params, searchParams }: { params: { id: string }; searchParams: { page?: string; sheet?: string; sheetPage?: string; textPage?: string } }) {
	const user = await requireUser()
	const document = await prisma.document.findFirst({
		where: {
			id: params.id,
			deletedAt: null,
			contract: contractScope(user),
			...(['VIEWER', 'DESIGNER'].includes(user.role) ? { isConfidential: false } : {}),
		},
		include: {
			contract: { select: { id: true, number: true, cipher: true, contractor: { select: { name: true } } } },
			executiveDoc: { select: { name: true } },
			uploadedBy: { select: { name: true } },
		},
	})
	if (!document) notFound()
	const proposalMeta = document.kind === 'COMMERCIAL_PROPOSAL' ? PROPOSAL_STATUS[document.proposalStatus] : null

	async function updateProposalStatus(formData: FormData) {
		'use server'
		const actor = await requireUser()
		if (!canWrite(actor)) redirect(`/documents/${params.id}`)
		const next = String(formData.get('proposalStatus') ?? '') as CommercialProposalStatus
		if (!Object.prototype.hasOwnProperty.call(PROPOSAL_STATUS, next)) redirect(`/documents/${params.id}`)
		const target = await prisma.document.findFirst({
			where: {
				id: params.id,
				kind: 'COMMERCIAL_PROPOSAL',
				deletedAt: null,
				contract: contractScope(actor),
			},
			select: { id: true, proposalSentAt: true, proposalRespondedAt: true },
		})
		if (!target) redirect('/documents')
		const now = new Date()
		await prisma.document.update({
			where: { id: target.id },
			data: {
				proposalStatus: next,
				proposalSentAt: next !== 'DRAFT' ? target.proposalSentAt ?? now : null,
				proposalRespondedAt: next === 'ACCEPTED' || next === 'REJECTED' ? target.proposalRespondedAt ?? now : null,
			},
		})
		await writeAudit({ userId: actor.id, action: 'UPDATE', entityType: 'CommercialProposalStatus', entityId: target.id })
		redirect(`/documents/${target.id}?proposalStatus=saved`)
	}

	const ext = extension(document.fileName)
	const previewUrl = `/api/documents/${document.id}?inline=1`
	let pdfPreviewUrl = `/api/documents/${document.id}/preview`
	const name = user.name ?? user.email ?? ''
	let fullTextPreview = ''
	let sheetName = ''
	let sheetRows: string[][] = []
	let sheetNames: string[] = []
	let sheetRowsTotal = 0
	let sheetPage = 1
	let sheetPageCount = 1
	let archiveEntries: Array<{ name: string; size: number | null }> = []
	let previewError = ''

	const needsServerPreview = ['.txt', '.csv', '.json', '.xml', '.log', '.dxf', '.rtf', '.docx', '.xlsx', '.xls', '.zip'].includes(ext)
	if (needsServerPreview && Number(document.sizeBytes) <= MAX_TEXT_PREVIEW_BYTES) {
		try {
			const buffer = await readStoredFile(document.storagePath)
			if (['.txt', '.csv', '.json', '.xml', '.log', '.dxf'].includes(ext)) {
				fullTextPreview = buffer.toString('utf8')
			} else if (ext === '.rtf') {
				fullTextPreview = buffer.toString('utf8').replace(/\\par[d]?/g, '\n').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').trim()
			} else if (ext === '.docx') {
				const mammoth = (await import('mammoth')).default
				fullTextPreview = (await mammoth.extractRawText({ buffer })).value.trim()
			} else if (ext === '.zip') {
				const JSZip = (await import('jszip')).default
				const archive = await JSZip.loadAsync(buffer)
				archiveEntries = Object.values(archive.files).filter((entry) => !entry.dir).map((entry) => ({ name: entry.name, size: null }))
			} else {
				const XLSX = await import('xlsx')
				const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
				sheetNames = workbook.SheetNames
				sheetName = sheetNames.includes(searchParams.sheet ?? '') ? searchParams.sheet! : (sheetNames[0] ?? '')
				const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
				if (sheet) {
					const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
					sheetRowsTotal = allRows.length
					sheetPageCount = Math.max(1, Math.ceil(sheetRowsTotal / 100))
					sheetPage = positivePage(searchParams.sheetPage, sheetPageCount)
					sheetRows = allRows.slice((sheetPage - 1) * 100, sheetPage * 100).map((row) => row.map((cell) => String(cell ?? '')))
				}
			}
		} catch (error) {
			console.error('Document preview error:', error)
			previewError = 'Не удалось подготовить предпросмотр. Файл можно скачать и открыть в обычной программе.'
		}
	}

	let pdfPageCount = 1
	let pdfPage = 1
	if (ext === '.pdf' && Number(document.sizeBytes) <= 80 * 1024 * 1024) {
		try {
			const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
			const pdf = await pdfParse(await readStoredFile(document.storagePath))
			pdfPageCount = Math.min(Math.max(1, pdf.numpages), 999)
			pdfPage = positivePage(searchParams.page, pdfPageCount)
			pdfPreviewUrl += `?page=${pdfPage}`
		} catch {
			previewError = 'Не удалось определить страницы PDF. Откройте оригинал в новой вкладке.'
		}
	}
	const textPageSize = 60_000
	const textPageCount = Math.max(1, Math.ceil(fullTextPreview.length / textPageSize))
	const textPage = positivePage(searchParams.textPage, textPageCount)
	const textPreview = fullTextPreview.slice((textPage - 1) * textPageSize, textPage * textPageSize)
	const pdfHref = (page: number) => `/documents/${document.id}?page=${page}`
	const sheetHref = (nextSheet: string, nextPage = 1) => `/documents/${document.id}?sheet=${encodeURIComponent(nextSheet)}&sheetPage=${nextPage}`
	const textHref = (page: number) => `/documents/${document.id}?textPage=${page}`
	const nativePreview = ext === '.pdf' || isImage(ext)
	const hasTextPreview = Boolean(fullTextPreview || sheetRows.length || archiveEntries.length)
	const tooLargeForPreview = needsServerPreview && Number(document.sizeBytes) > MAX_TEXT_PREVIEW_BYTES

	return <>
		<Topbar crumbs={[
			{ label: 'Главная', href: '/' },
			{ label: 'Документы', href: '/documents' },
			{ label: document.fileName },
		]} userName={name.split(' ')[0]} initials={initials(name)} />
		<div className="mx-auto max-w-[1380px] px-[26px] py-[22px]">
			<div className="mb-[16px] flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<FileIcon fileName={document.fileName} />
					<div className="min-w-0"><h1 className="truncate text-2xl font-bold tracking-[-0.02em]">{document.fileName}</h1><p className="mt-1 text-sm text-muted">{formatBytes(document.sizeBytes)} · {DOCUMENT_KIND_LABELS[document.kind]}</p></div>
				</div>
				<div className="flex gap-2"><a href={`/api/documents/${document.id}`} className="inline-flex h-control items-center rounded-tight border border-line bg-surface px-4 text-sm font-semibold hover:bg-raised">Скачать</a><Link href={`/contracts/${document.contract.id}`} className="inline-flex h-control items-center rounded-tight border border-line bg-surface px-4 text-sm font-semibold hover:bg-raised">К договору</Link></div>
			</div>

			<div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_300px]">
				<Card className="min-h-[560px] overflow-hidden">
					<div className="border-b border-line px-4 py-3 text-base font-semibold">Просмотр документа</div>
					{nativePreview ? <div className="h-[calc(100vh-240px)] min-h-[560px] overflow-auto bg-raised p-4">{ext === '.pdf' ? <div className="mx-auto max-w-[1100px]"><div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-tight border border-line bg-surface px-3 py-2 text-xs text-muted"><span>Страница {pdfPage} из {pdfPageCount}</span><div className="flex items-center gap-3">{pdfPageCount > 1 && <span className="flex items-center gap-2"><Link href={pdfHref(Math.max(1, pdfPage - 1))} aria-disabled={pdfPage === 1} className={`font-semibold ${pdfPage === 1 ? 'pointer-events-none text-faint' : 'text-brand-ink hover:underline'}`}>← Назад</Link><Link href={pdfHref(Math.min(pdfPageCount, pdfPage + 1))} aria-disabled={pdfPage === pdfPageCount} className={`font-semibold ${pdfPage === pdfPageCount ? 'pointer-events-none text-faint' : 'text-brand-ink hover:underline'}`}>Вперёд →</Link></span>}<a href={previewUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-ink hover:underline">Открыть оригинал ↗</a></div></div><img src={pdfPreviewUrl} alt={`Страница ${pdfPage}: ${document.fileName}`} className="mx-auto h-auto max-w-full rounded-[6px] border border-line bg-white shadow-sm" /></div> : <img src={previewUrl} alt={document.fileName} className="mx-auto h-auto max-h-full max-w-full rounded-[6px] object-contain" />}</div> : hasTextPreview ? <div className="p-4">{archiveEntries.length > 0 ? <div className="max-h-[calc(100vh-290px)] overflow-auto rounded-tight border border-line"><div className="border-b border-line bg-raised px-3 py-2 text-xs text-muted">Содержимое архива · файлов: {archiveEntries.length}</div>{archiveEntries.map((entry) => <div key={entry.name} className="flex items-center justify-between gap-3 border-b border-line-soft px-3 py-2 text-sm last:border-0"><span className="min-w-0 break-all">{entry.name}</span><span className="flex-none text-faint">{entry.size == null ? '' : formatBytes(entry.size)}</span></div>)}</div> : sheetRows.length > 0 ? <div className="overflow-auto rounded-tight border border-line"><div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-3 py-2 text-xs text-muted"><span>Лист: {sheetName} · строки {(sheetPage - 1) * 100 + 1}–{Math.min(sheetPage * 100, sheetRowsTotal)} из {sheetRowsTotal}</span><span className="ml-auto flex flex-wrap gap-1">{sheetNames.map((name) => <Link key={name} href={sheetHref(name)} className={`rounded px-2 py-1 font-semibold ${name === sheetName ? 'bg-brand text-white' : 'bg-surface text-brand-ink hover:bg-brand-soft'}`}>{name}</Link>)}</span></div><table className="min-w-full text-left text-sm"><tbody>{sheetRows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-line-soft last:border-0">{row.map((cell, cellIndex) => <td key={cellIndex} className={`max-w-[360px] whitespace-pre-wrap px-3 py-2 align-top ${rowIndex === 0 && sheetPage === 1 ? 'bg-raised font-semibold' : ''}`}>{cell || '—'}</td>)}</tr>)}</tbody></table>{sheetPageCount > 1 && <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 text-sm"><Link href={sheetHref(sheetName, Math.max(1, sheetPage - 1))} aria-disabled={sheetPage === 1} className={sheetPage === 1 ? 'pointer-events-none text-faint' : 'font-semibold text-brand-ink hover:underline'}>← Предыдущие строки</Link><span className="text-muted">Страница {sheetPage} из {sheetPageCount}</span><Link href={sheetHref(sheetName, Math.min(sheetPageCount, sheetPage + 1))} aria-disabled={sheetPage === sheetPageCount} className={sheetPage === sheetPageCount ? 'pointer-events-none text-faint' : 'font-semibold text-brand-ink hover:underline'}>Следующие строки →</Link></div>}</div> : <><pre className="max-h-[calc(100vh-360px)] overflow-auto whitespace-pre-wrap break-words rounded-tight bg-raised p-4 font-sans text-base leading-6 text-ink">{textPreview || 'В документе нет извлекаемого текста.'}</pre>{textPageCount > 1 && <div className="mt-3 flex items-center justify-between gap-3 text-sm"><Link href={textHref(Math.max(1, textPage - 1))} aria-disabled={textPage === 1} className={textPage === 1 ? 'pointer-events-none text-faint' : 'font-semibold text-brand-ink hover:underline'}>← Назад</Link><span className="text-muted">Часть {textPage} из {textPageCount}</span><Link href={textHref(Math.min(textPageCount, textPage + 1))} aria-disabled={textPage === textPageCount} className={textPage === textPageCount ? 'pointer-events-none text-faint' : 'font-semibold text-brand-ink hover:underline'}>Вперёд →</Link></div>}</>}</div> : <div className="grid min-h-[520px] place-items-center p-8 text-center"><div><FileIcon fileName={document.fileName} /><h2 className="mt-4 text-md font-bold">Предпросмотр недоступен для этого формата</h2><p className="mx-auto mt-2 max-w-[430px] text-base leading-6 text-muted">{previewError || tooLargeForPreview ? 'Файл слишком большой для безопасного просмотра в браузере.' : 'DWG и старый DOC открываются в профильной программе. Сам файл уже лежит в системе и доступен в один клик.'}</p><a href={`/api/documents/${document.id}`} className="brand-gradient mt-5 inline-flex h-control items-center rounded-tight px-4 text-sm font-semibold text-white">Скачать файл</a></div></div>}
				</Card>
				<Card className="h-fit p-4"><div className="text-base font-bold">Сведения</div><dl className="mt-4 grid gap-3 text-sm"><div><dt className="text-faint">Договор</dt><dd className="mt-1 font-semibold">№ {document.contract.number}{document.contract.cipher ? ` · ${document.contract.cipher}` : ''}</dd></div><div><dt className="text-faint">Контрагент</dt><dd className="mt-1 font-semibold">{document.contract.contractor.name}</dd></div><div><dt className="text-faint">Раздел</dt><dd className="mt-1">{document.executiveDoc?.name ?? DOCUMENT_KIND_LABELS[document.kind]}</dd></div><div><dt className="text-faint">Добавлен</dt><dd className="mt-1">{formatDate(document.createdAt)}{document.uploadedBy?.name ? ` · ${document.uploadedBy.name}` : ''}</dd></div><div><dt className="text-faint">Версия</dt><dd className="mt-1">{document.state === 'SIGNED' ? 'Подписанная' : document.state === 'ARCHIVE' ? 'Архивная' : 'Актуальный исходник'}</dd></div></dl>{proposalMeta && <div className="mt-5 border-t border-line pt-4"><div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">Статус ответа по КП</span><Chip tone={proposalMeta.tone}>{proposalMeta.label}</Chip></div><p className="mt-2 text-xs leading-5 text-muted">{proposalMeta.hint}</p>{document.proposalSentAt && <p className="mt-2 text-xs text-muted">Отправлено: {formatDate(document.proposalSentAt)}</p>}{document.proposalRespondedAt && <p className="mt-1 text-xs text-muted">Ответ получен: {formatDate(document.proposalRespondedAt)}</p>}{canWrite(user) && <form action={updateProposalStatus} className="mt-3 flex gap-2"><select name="proposalStatus" defaultValue={document.proposalStatus} className={`${selectClass} h-[34px] min-w-0 flex-1 text-sm`}><option value="DRAFT">Черновик</option><option value="SENT">Отправлено</option><option value="WAITING_RESPONSE">Ждём ответ</option><option value="ACCEPTED">Принято</option><option value="REJECTED">Отклонено</option></select><button className="h-[34px] rounded-tight bg-brand px-3 text-xs font-semibold text-white transition hover:brightness-110">Сохранить</button></form>}</div>}</Card>
			</div>
		</div>
	</>
}
