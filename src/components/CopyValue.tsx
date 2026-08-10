'use client'

import { useState } from 'react'

export default function CopyValue({ value, label = 'Скопировать' }: { value: string; label?: string }) {
	const [done, setDone] = useState(false)
	if (!value || value === '—') return null
	async function copy() {
		try {
			await navigator.clipboard.writeText(value)
			setDone(true)
			window.setTimeout(() => setDone(false), 1400)
		} catch { /* Clipboard access may be unavailable in an embedded browser. */ }
	}
	return <button type="button" onClick={copy} className="ml-1 inline-grid h-5 w-5 place-items-center rounded-md text-faint transition hover:bg-brand-soft hover:text-brand-ink" title={done ? 'Скопировано' : label} aria-label={done ? 'Скопировано' : label}>{done ? '✓' : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4"/></svg>}</button>
}

export function CopyContractorDetails({
	name,
	inn,
	phone,
	email,
	address,
}: {
	name: string
	inn?: string | null
	phone?: string | null
	email?: string | null
	address?: string | null
}) {
	const [done, setDone] = useState(false)
	async function copy() {
		const details = [
			`Контрагент: ${name}`,
			inn && `ИНН: ${inn}`,
			phone && `Телефон: ${phone}`,
			email && `Email: ${email}`,
			address && `Адрес: ${address}`,
		].filter(Boolean).join('\n')
		try {
			await navigator.clipboard.writeText(details)
			setDone(true)
			window.setTimeout(() => setDone(false), 1600)
		} catch { /* Clipboard access may be unavailable in an embedded browser. */ }
	}
	return <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-[8px] border border-brand/25 bg-surface/80 px-2.5 py-1.5 text-[11px] font-semibold text-brand-ink transition hover:-translate-y-px hover:bg-brand-soft" title="Скопировать все реквизиты контрагента">{done ? '✓ Скопировано' : 'Копировать реквизиты'}</button>
}
