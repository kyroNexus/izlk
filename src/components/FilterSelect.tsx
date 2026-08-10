'use client'

import { useEffect, useId, useRef, useState } from 'react'

type Option = { value: string; label: string }

export default function FilterSelect({ name, defaultValue = '', options, placeholder = 'Все' }: { name: string; defaultValue?: string; options: Option[]; placeholder?: string }) {
	const [value, setValue] = useState(defaultValue)
	const [open, setOpen] = useState(false)
	const root = useRef<HTMLDivElement>(null)
	const listId = useId()
	const selected = options.find((item) => item.value === value)?.label ?? placeholder

	useEffect(() => setValue(defaultValue), [defaultValue])
	useEffect(() => {
		const close = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false) }
		document.addEventListener('mousedown', close)
		return () => document.removeEventListener('mousedown', close)
	}, [])
	useEffect(() => {
		const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
		document.addEventListener('keydown', closeOnEscape)
		return () => document.removeEventListener('keydown', closeOnEscape)
	}, [])

	return <div ref={root} className="filter-select relative min-w-[220px]">
		<input type="hidden" name={name} value={value} />
		<button type="button" onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-controls={listId} aria-expanded={open} className="flex h-10 w-full items-center justify-between gap-3 rounded-[10px] border border-line bg-surface px-3 text-left text-[12.5px] font-medium text-ink shadow-sm transition hover:border-brand/45 hover:bg-brand-soft/30 focus:outline-none focus:ring-[3px] focus:ring-brand/16">
			<span className="truncate">{selected}</span><svg className={`h-4 w-4 flex-none text-brand transition-transform duration-200 ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg>
		</button>
		{open && <div id={listId} role="listbox" className="absolute left-0 top-[calc(100%+6px)] z-40 w-[min(340px,calc(100vw-32px))] min-w-full overflow-hidden rounded-[11px] border border-brand/30 bg-surface p-1.5 shadow-[0_18px_42px_rgba(16,12,44,.32)]">
			<div className="app-scrollbar max-h-64 overflow-y-auto pr-1">{options.map((item) => <button key={item.value || '__all'} type="button" role="option" aria-selected={item.value === value} onClick={() => { setValue(item.value); setOpen(false) }} className={`flex w-full items-center rounded-[8px] px-2.5 py-2 text-left text-[12px] leading-5 transition ${item.value === value ? 'bg-brand text-white shadow-sm' : 'text-ink hover:bg-brand-soft hover:text-brand-ink'}`}><span className="block w-full break-words">{item.label}</span></button>)}</div>
		</div>}
	</div>
}
