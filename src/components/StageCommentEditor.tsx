'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContractWorkflowStage } from '@prisma/client'

type Stage = { key: ContractWorkflowStage; label: string }

/**
 * Светофор этапов договора — не отражает реальный workflowStage напрямую,
 * а показывает последовательный прогресс по комментариям: как только на
 * этапе появляется комментарий (например "деньги поступят через неделю"),
 * его кружок закрашивается зелёным, а следующий становится активным.
 * Реальный перевод стадии договора отдельно, через вкладку "Ход договора" —
 * здесь только заметки и наглядная дорожка прогресса.
 */
export default function StageCommentEditor({ contractId, stages, comments, canWrite }: { contractId: string; stages: Stage[]; comments: Record<string, string>; canWrite: boolean }) {
	const [selected, setSelected] = useState<ContractWorkflowStage | null>(null)
	const [values, setValues] = useState(comments)
	const [text, setText] = useState('')
	const [saving, setSaving] = useState(false)
	const [position, setPosition] = useState({ top: 0, left: 0 })
	const panelRef = useRef<HTMLDivElement>(null)
	const stage = stages.find((item) => item.key === selected)
	// Первый этап без комментария — тот, что сейчас "в фокусе" и ждёт отметки.
	const activeIndex = stages.findIndex((item) => !values[item.key])

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
		setSelected(key); setText(values[key] ?? '')
	}
	async function save() {
		if (!selected || !text.trim()) return
		setSaving(true)
		const response = await fetch(`/api/contracts/${contractId}/stage-comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage: selected, text }) })
		if (response.ok) { setValues((current) => ({ ...current, [selected]: text.trim() })); setSelected(null) }
		setSaving(false)
	}
	return <><div className="mt-1.5 flex items-center" aria-label="Прогресс по этапам договора">
		{stages.map((item, index) => {
			const done = Boolean(values[item.key])
			const isActive = !done && index === activeIndex
			const dotTone = done ? 'bg-ok ring-2 ring-ok/25' : isActive ? 'bg-warn ring-2 ring-warn/30 animate-pulse' : 'bg-line'
			const lineTone = index < activeIndex || (activeIndex === -1 && done) ? 'bg-ok/50' : 'bg-line'
			return <span key={item.key} className="flex items-center">
				<button type="button" onClick={(event) => open(event, item.key)} aria-label={`${item.label}: ${done ? 'отмечено — ' + values[item.key] : isActive ? 'ожидает комментария' : 'ещё не наступил'}`} title={item.label} className={`h-2 w-2 shrink-0 rounded-full transition-transform ${dotTone} hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`} />
				{index < stages.length - 1 && <span className={`mx-1 h-px w-2 shrink-0 ${lineTone}`} />}
			</span>
		})}
	</div>{stage && createPortal(<div ref={panelRef} style={position} className="animate-[fade-in_.16s_ease-out] fixed z-[100] w-[280px] rounded-[var(--radius-control)] border border-line bg-surface p-3 shadow-[var(--shadow-float)]"><div className="mb-2 flex items-center justify-between gap-2"><b className="text-[11px]">{stage.label}</b><button type="button" onClick={() => setSelected(null)} className="text-[12px] text-muted hover:text-ink">×</button></div><textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} rows={3} placeholder="Комментарий к этапу — например, «деньги поступят через неделю»" disabled={!canWrite} className="w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[11px] outline-none focus:border-brand" />{canWrite ? <button type="button" onClick={() => void save()} disabled={saving || !text.trim()} className="mt-2 h-8 rounded-[8px] bg-brand px-3 text-[11px] font-semibold text-white disabled:opacity-50">{saving ? 'Сохранение…' : 'Сохранить и отметить пройденным'}</button> : <p className="mt-2 text-[10px] text-faint">Только просмотр</p>}</div>, document.body)}</>
}
