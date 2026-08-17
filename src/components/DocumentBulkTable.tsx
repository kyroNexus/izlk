'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { DocumentKind, DocumentState } from '@prisma/client'
import { FileIcon } from '@/components/ui'
import { useBulkSelection } from '@/components/useBulkSelection'
import { DOCUMENT_KIND_LABELS, DOCUMENT_KIND_ORDER, formatBytes, formatDate } from '@/lib/format'

type Row = { id: string; fileName: string; sizeBytes: number; kind: DocumentKind; signedAt: Date | null; createdAt: Date; contract: { id: string; number: string }; executiveDoc: { name: string } | null; uploadedBy: { name: string | null } | null }
const states: { value: DocumentState; label: string }[] = [{ value: 'SOURCE', label: 'Исходник' }, { value: 'SIGNED', label: 'Подписан' }, { value: 'ARCHIVE', label: 'Архив' }]

export default function DocumentBulkTable({ documents, canEdit }: { documents: Row[]; canEdit: boolean }) {
	const router = useRouter()
	const selection = useBulkSelection(documents.map((document) => document.id))
	const run = async (action: string, extra: Record<string, unknown> = {}) => {
		if (!selection.selected.length) return
		if ((action === 'archive' || (action === 'state' && extra.state === 'ARCHIVE')) && !window.confirm('Архивировать выбранные документы?')) return
		if (action === 'restore' && !window.confirm('Восстановить выбранные документы?')) return
		const response = await fetch('/api/documents/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids: selection.selected, ...extra }) })
		if (action === 'download' && response.ok) {
			const url = URL.createObjectURL(await response.blob()), link = document.createElement('a')
			link.href = url; link.download = 'documents.zip'; link.click(); URL.revokeObjectURL(url); selection.clear(); return
		}
		if (!response.ok) { alert((await response.json().catch(() => ({}))).error ?? 'Операция не выполнена'); return }
		const data = await response.json()
		const failed = data.results.filter((result: { status: string }) => result.status !== 'updated').length
		selection.clear(); router.refresh()
		if (failed) alert(`Обработано частично: ${failed} документов пропущено или не обновлено.`)
	}
	return <div>
		{selection.selected.length > 0 && <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3.5 py-2 shadow-sm"><b className="mr-1 text-sm">Выбрано: {selection.selected.length}</b>{canEdit && <><select defaultValue="" onChange={(event) => { if (event.target.value) run('kind', { kind: event.target.value }); event.currentTarget.value = '' }} className="h-8 rounded border border-line bg-surface px-2 text-xs"><option value="">Тип…</option>{DOCUMENT_KIND_ORDER.map((kind) => <option key={kind} value={kind}>{DOCUMENT_KIND_LABELS[kind]}</option>)}</select><select defaultValue="" onChange={(event) => { if (event.target.value) run('state', { state: event.target.value }); event.currentTarget.value = '' }} className="h-8 rounded border border-line bg-surface px-2 text-xs"><option value="">Состояние…</option>{states.map((state) => <option key={state.value} value={state.value}>{state.label}</option>)}</select><button onClick={() => run('confidential', { isConfidential: true })} className="rounded border border-line px-2 py-1 text-xs font-semibold">Конфиденциально</button><button onClick={() => run('confidential', { isConfidential: false })} className="rounded border border-line px-2 py-1 text-xs font-semibold">Обычные</button><button onClick={() => run('archive')} className="rounded border border-line px-2 py-1 text-xs font-semibold">В архив</button><button onClick={() => run('restore')} className="rounded border border-line px-2 py-1 text-xs font-semibold">Восстановить</button></>}<button onClick={() => run('download')} className="rounded border border-line px-2 py-1 text-xs font-semibold">Скачать ZIP</button><button onClick={selection.clear} className="ml-auto text-xs text-muted hover:text-ink">Очистить</button></div>}
		<div className="grid grid-cols-[28px_minmax(220px,1fr)_125px_90px_115px_110px] gap-3 border-b border-line-soft bg-raised px-3.5 py-2 text-2xs font-semibold uppercase tracking-wide text-faint"><input aria-label="Выбрать страницу" type="checkbox" checked={selection.allSelected} onChange={selection.togglePage} /><span>Документ</span><span>Раздел</span><span>Дата</span><span>Договор</span><span /></div>
		{documents.map((document) => <div key={document.id} className="grid grid-cols-[28px_minmax(220px,1fr)_125px_90px_115px_110px] items-center gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-0 hover:bg-raised/50"><input aria-label={`Выбрать ${document.fileName}`} type="checkbox" checked={selection.has(document.id)} onChange={() => selection.toggle(document.id)} /><Link href={`/documents/${document.id}`} className="flex min-w-0 items-center gap-2"><FileIcon fileName={document.fileName} /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{document.fileName}</span><span className="mt-[2px] block text-xs text-faint">{formatBytes(document.sizeBytes)}{document.uploadedBy?.name ? ` · ${document.uploadedBy.name}` : ''}</span></span></Link><span className="line-clamp-2 text-xs leading-4 text-muted">{document.executiveDoc?.name ?? DOCUMENT_KIND_LABELS[document.kind]}</span><span className="text-xs text-muted">{formatDate(document.signedAt ?? document.createdAt)}</span><Link href={`/contracts/${document.contract.id}`} className="truncate text-xs font-semibold text-brand-ink hover:underline">№ {document.contract.number}</Link><Link href={`/documents/${document.id}`} className="rounded-tight border border-line px-2 py-1.5 text-center text-xs font-semibold hover:bg-raised">Открыть</Link></div>)}
	</div>
}
