'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type FileEntityType = 'document' | 'chat-attachment' | 'stage-attachment' | 'task-attachment' | 'task-comment-attachment' | 'site-photo'

function parts(fileName: string) {
	const dot = fileName.lastIndexOf('.')
	return dot > 0 ? { base: fileName.slice(0, dot), extension: fileName.slice(dot) } : { base: fileName, extension: '' }
}

export default function RenameFileButton({ type, id, fileName, onRenamed }: { type: FileEntityType; id: string; fileName: string; onRenamed?: (fileName: string) => void }) {
	const router = useRouter()
	const [open, setOpen] = useState(false)
	const [name, setName] = useState(parts(fileName).base)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState('')
	const extension = parts(fileName).extension

	async function save(event: React.FormEvent) {
		event.preventDefault()
		setSaving(true); setError('')
		const response = await fetch(`/api/files/${type}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
		const result = await response.json().catch(() => null)
		setSaving(false)
		if (!response.ok) { setError(result?.error ?? 'Не удалось переименовать файл.'); return }
		onRenamed?.(result.fileName)
		setOpen(false)
		router.refresh()
	}

	return <span className="relative inline-flex flex-none">
		<button type="button" onClick={() => { setName(parts(fileName).base); setError(''); setOpen((value) => !value) }} className="rounded-tight px-1.5 py-1 text-2xs font-semibold text-muted hover:bg-brand-soft hover:text-brand-ink" aria-label={`Переименовать ${fileName}`}>Переименовать</button>
		{open && <form onSubmit={save} role="dialog" aria-modal="true" aria-label={`Переименовать ${fileName}`} className="fixed left-1/2 top-1/2 z-[120] w-[min(360px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-control border border-line bg-surface p-3 shadow-[var(--shadow-float)]">
			<div className="mb-1.5 text-xs font-bold">Новое имя файла</div>
			<div className="flex items-center gap-1"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} className="h-8 min-w-0 flex-1 rounded-tight border border-line bg-canvas px-2 text-xs outline-none focus:border-brand" /><span className="max-w-16 truncate text-2xs text-faint">{extension}</span></div>
			{error && <div className="mt-1.5 text-2xs text-danger">{error}</div>}
			<div className="mt-2 flex justify-end gap-1.5"><button type="button" onClick={() => setOpen(false)} className="h-8 rounded-tight px-2.5 text-2xs font-semibold text-muted hover:bg-raised">Отмена</button><button disabled={saving} className="h-8 rounded-tight bg-brand px-2.5 text-2xs font-semibold text-white disabled:opacity-50">{saving ? 'Сохранение…' : 'Сохранить'}</button></div>
		</form>}
	</span>
}
