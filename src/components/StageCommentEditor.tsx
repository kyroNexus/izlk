'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import Icon from '@/components/Icon'
import type { ContractWorkflowStage } from '@prisma/client'

type Stage = { key: ContractWorkflowStage; label: string }
type ThreadItem = { id: string; text: string; authorName: string | null; createdAt: string }

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
		setSelected(key); setText(''); setError('')
	}
	async function save() {
		if (!selected || !text.trim()) return
		setSaving(true)
		const response = await fetch(`/api/contracts/${contractId}/stage-comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage: selected, text }) })
		if (response.ok) {
			const created = await response.json()
			setThreads((current) => ({ ...current, [selected]: [...(current[selected] ?? []), created] }))
			setText(''); setError('')
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
	</div>{stage && createPortal(<div ref={panelRef} style={position} className="animate-[fade-in_.16s_ease-out] fixed z-[100] flex max-h-[70vh] w-[280px] flex-col rounded-[var(--radius-control)] border border-line bg-surface p-3 shadow-[var(--shadow-float)]">
		<div className="mb-2 flex items-center justify-between gap-2"><b className="text-[11px]">{stage.label}</b><button type="button" onClick={() => setSelected(null)} className="text-muted hover:text-ink" aria-label="Закрыть"><Icon icon={X} size={14} /></button></div>
		<div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
			{threads[stage.key]?.length ? threads[stage.key].map((item) => <div key={item.id} className="rounded-[8px] bg-raised px-2 py-1.5"><div className="flex items-baseline justify-between gap-2 text-[9.5px] text-faint"><span className="font-semibold text-muted">{item.authorName ?? 'Система'}</span><span>{new Date(item.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span></div><p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-4">{item.text}</p></div>) : <p className="text-[10.5px] text-faint">Сообщений пока нет.</p>}
		</div>
		{canWrite ? <div className="mt-2 flex-none">{error && <p className="mb-1.5 rounded-[7px] bg-warn-bg px-2 py-1.5 text-[10.5px] text-warn">{error}</p>}<textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} rows={3} placeholder="Сообщение к этапу — например, «деньги поступят через неделю»" className="w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[11px] outline-none focus:border-brand" /><button type="button" onClick={() => void save()} disabled={saving || !text.trim()} className="mt-2 h-8 w-full rounded-[8px] bg-brand px-3 text-[11px] font-semibold text-white disabled:opacity-50">{saving ? 'Отправка…' : 'Отправить'}</button></div> : <p className="mt-2 flex-none text-[10px] text-faint">Только просмотр</p>}
	</div>, document.body)}</>
}
