'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Paperclip, X } from 'lucide-react'
import Icon from '@/components/Icon'
import FileDropField, { type FileDropFieldHandle, type SelectedFile } from '@/components/FileDropField'
import AttachmentPreview, { type AttachmentSummary } from '@/components/AttachmentPreview'
import { formatDateTime } from '@/lib/format'
import { DOCUMENT_EXTENSIONS } from '@/lib/upload-constants'
import type { ContractWorkflowStage } from '@prisma/client'

type Stage = { key: ContractWorkflowStage; label: string }
type ThreadItem = { id: string; text: string | null; authorName: string | null; createdAt: string; attachments: AttachmentSummary[] }

// Задача C3: скрепка — "приложить фото подтверждения к заметке", не массовая
// загрузка — небольшой явный потолок, тот же, что сервер уже проверяет сам.
const MAX_STAGE_COMMENT_ATTACHMENTS = 5

/**
 * Светофор этапов договора — не отражает реальный workflowStage напрямую,
 * а показывает прогресс по обсуждению: как только на этапе появляется
 * хотя бы одно сообщение (ручная заметка или авто-описание реального
 * перехода — оба пишутся в StageComment), его кружок закрашивается зелёным,
 * а следующий становится активным. Реальный перевод стадии договора —
 * отдельно, через вкладку "Ход договора"; здесь — тред обсуждения этапа.
 */
export default function StageCommentEditor({ contractId, stages, comments, canWrite }: { contractId: string; stages: Stage[]; comments: Record<string, ThreadItem[]>; canWrite: boolean }) {
	const [selected, setSelected] = useState<ContractWorkflowStage | null>(null)
	const [threads, setThreads] = useState(comments)
	const [text, setText] = useState('')
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState('')
	const [position, setPosition] = useState({ top: 0, left: 0 })
	const [attachOpen, setAttachOpen] = useState(false)
	const [pendingFiles, setPendingFiles] = useState<SelectedFile[]>([])
	// Пересоздаёт FileDropField с пустым состоянием после отправки/смены этапа —
	// тот же приём, что и в ChatPanel (C1).
	const [attachResetKey, setAttachResetKey] = useState(0)
	const attachRef = useRef<FileDropFieldHandle>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const stage = stages.find((item) => item.key === selected)
	// Первый этап без сообщений — тот, что сейчас "в фокусе" и ждёт обсуждения.
	const activeIndex = stages.findIndex((item) => !threads[item.key]?.length)

	useEffect(() => {
		if (!selected) return
		const closeOnOutside = (event: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(event.target as Node)) setSelected(null) }
		const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null) }
		document.addEventListener('mousedown', closeOnOutside)
		document.addEventListener('keydown', closeOnEscape)
		return () => { document.removeEventListener('mousedown', closeOnOutside); document.removeEventListener('keydown', closeOnEscape) }
	}, [selected])

	function open(event: React.MouseEvent<HTMLButtonElement>, key: ContractWorkflowStage) {
		const rect = event.currentTarget.getBoundingClientRect()
		setPosition({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)) })
		setSelected(key); setText(''); setError(''); setAttachOpen(false); setPendingFiles([]); setAttachResetKey((key) => key + 1)
	}
	function onAttachFilesChange(items: SelectedFile[]) {
		setPendingFiles(items.filter((item) => item.status === 'pending'))
	}
	async function save() {
		if (!selected || (!text.trim() && !pendingFiles.length)) return
		setSaving(true)
		const body = new FormData()
		body.append('stage', selected)
		if (text.trim()) body.append('text', text.trim())
		for (const item of pendingFiles) body.append('files', item.file, item.file.name)
		const response = await fetch(`/api/contracts/${contractId}/stage-comments`, { method: 'POST', body })
		if (response.ok) {
			const created = await response.json()
			setThreads((current) => ({ ...current, [selected]: [...(current[selected] ?? []), created] }))
			setText(''); setError(''); setPendingFiles([]); setAttachOpen(false); setAttachResetKey((key) => key + 1)
		} else if (response.status === 429) {
			const retryAfter = Number(response.headers.get('Retry-After'))
			setError(retryAfter > 0 ? `Слишком много сообщений подряд — попробуйте через ${retryAfter} сек.` : 'Слишком много сообщений подряд, подождите немного.')
		} else {
			setError('Не удалось сохранить сообщение.')
		}
		setSaving(false)
	}
	return <><div className="mt-1.5 flex items-center" aria-label="Прогресс по этапам договора">
		{stages.map((item, index) => {
			const done = Boolean(threads[item.key]?.length)
			const isActive = !done && index === activeIndex
			const dotTone = done ? 'bg-ok ring-2 ring-ok/25' : isActive ? 'bg-warn ring-2 ring-warn/30 animate-pulse' : 'bg-line'
			const lineTone = index < activeIndex || (activeIndex === -1 && done) ? 'bg-ok/50' : 'bg-line'
			return <span key={item.key} className="flex items-center">
				<button type="button" onClick={(event) => open(event, item.key)} aria-label={`${item.label}: ${done ? `обсуждение — ${threads[item.key].length} сообщ.` : isActive ? 'ожидает обсуждения' : 'ещё не наступил'}`} title={item.label} className={`h-2 w-2 shrink-0 rounded-full transition-transform ${dotTone} hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`} />
				{index < stages.length - 1 && <span className={`mx-1 h-px w-2 shrink-0 ${lineTone}`} />}
			</span>
		})}
	</div>{stage && createPortal(<div ref={panelRef} style={position} className="animate-[fade-in_.16s_ease-out] fixed z-[100] flex max-h-[70vh] w-[280px] flex-col rounded-control border border-line bg-surface p-3 shadow-[var(--shadow-float)]">
		<div className="mb-2 flex items-center justify-between gap-2"><b className="text-xs">{stage.label}</b><button type="button" onClick={() => setSelected(null)} className="text-muted hover:text-ink" aria-label="Закрыть"><Icon icon={X} size={14} /></button></div>
		<div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
			{threads[stage.key]?.length ? threads[stage.key].map((item) => <div key={item.id} className="rounded-tight bg-raised px-2 py-1.5"><div className="flex items-baseline justify-between gap-2 text-2xs text-faint"><span className="font-semibold text-muted">{item.authorName ?? 'Система'}</span><span>{formatDateTime(item.createdAt)}</span></div>{item.text && <p className="mt-0.5 whitespace-pre-wrap text-xs leading-4">{item.text}</p>}{item.attachments.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} className="mt-1" />)}</div>) : <p className="text-xs text-faint">Сообщений пока нет.</p>}
		</div>
		{canWrite ? <div className="mt-2 flex-none">
			{error && <p className="mb-1.5 rounded-tight bg-warn-bg px-2 py-1.5 text-xs text-warn">{error}</p>}
			{attachOpen && <div className="mb-1.5">
				<FileDropField
					key={attachResetKey}
					ref={attachRef}
					endpoint={`/api/contracts/${contractId}/stage-comments`}
					accept={DOCUMENT_EXTENSIONS}
					maxFiles={MAX_STAGE_COMMENT_ATTACHMENTS}
					hideUploadButton
					onFilesChange={onAttachFilesChange}
				/>
			</div>}
			<div className="flex items-end gap-1.5">
				<button type="button" onClick={() => setAttachOpen((open) => !open)} aria-label="Приложить файл" aria-pressed={attachOpen} className={`grid h-8 w-8 flex-none place-items-center rounded-tight border transition ${attachOpen || pendingFiles.length ? 'border-brand/40 bg-brand-soft text-brand-ink' : 'border-line bg-surface text-muted hover:border-brand/30'}`}>
					<Icon icon={Paperclip} size={13} />
				</button>
				<textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} rows={3} placeholder="Сообщение к этапу — например, «деньги поступят через неделю»" className="min-w-0 flex-1 resize-none rounded-tight border border-line bg-surface px-2.5 py-2 text-xs outline-none focus:border-brand" />
			</div>
			<button type="button" onClick={() => void save()} disabled={saving || (!text.trim() && !pendingFiles.length)} className="mt-2 h-8 w-full rounded-tight bg-brand px-3 text-xs font-semibold text-white disabled:opacity-50">{saving ? 'Отправка…' : 'Отправить'}</button>
		</div> : <p className="mt-2 flex-none text-2xs text-faint">Только просмотр</p>}
	</div>, document.body)}</>
}
