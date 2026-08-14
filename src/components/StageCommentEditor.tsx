'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContractWorkflowStage } from '@prisma/client'

type Stage = { key: ContractWorkflowStage; label: string }

export default function StageCommentEditor({ contractId, stages, comments, canWrite }: { contractId: string; stages: Stage[]; comments: Record<string, string>; canWrite: boolean }) {
	const [selected, setSelected] = useState<ContractWorkflowStage | null>(null)
	const [values, setValues] = useState(comments)
	const [text, setText] = useState('')
	const [saving, setSaving] = useState(false)
	const [position, setPosition] = useState({ top: 0, left: 0 })
	const stage = stages.find((item) => item.key === selected)
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
	return <><div className="mt-1.5 flex items-center" aria-label="Этапы договора">
		{stages.map((item, index) => <span key={item.key} className="flex items-center"><button type="button" onClick={(event) => open(event, item.key)} aria-label={`Комментарий: ${item.label}`} className={`h-2 w-2 shrink-0 rounded-full ${values[item.key] ? 'bg-brand ring-2 ring-brand/20' : 'bg-line'} hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`} />{index < stages.length - 1 && <span className="mx-1 h-px w-2 shrink-0 bg-line" />}</span>)}
	</div>{stage && createPortal(<div style={position} className="fixed z-[100] w-[280px] rounded-[var(--radius-control)] border border-line bg-surface p-3 shadow-[var(--shadow-float)]"><div className="mb-2 flex items-center justify-between gap-2"><b className="text-[11px]">{stage.label}</b><button type="button" onClick={() => setSelected(null)} className="text-[12px] text-muted hover:text-ink">×</button></div><textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} rows={3} placeholder="Комментарий к этапу" disabled={!canWrite} className="w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[11px] outline-none focus:border-brand" />{canWrite ? <button type="button" onClick={() => void save()} disabled={saving || !text.trim()} className="mt-2 h-8 rounded-[8px] bg-brand px-3 text-[11px] font-semibold text-white disabled:opacity-50">{saving ? 'Сохранение…' : 'Сохранить'}</button> : <p className="mt-2 text-[10px] text-faint">Только просмотр</p>}</div>, document.body)}</>
}
