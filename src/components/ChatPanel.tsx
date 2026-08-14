'use client'

import { useCallback, useEffect, useState } from 'react'

type Message = { id: string; text: string; createdAt: string; author: { id: string; name: string }; own: boolean }

export default function ChatPanel({ endpoint, title }: { endpoint: string; title: string }) {
	const [messages, setMessages] = useState<Message[]>([])
	const [canWrite, setCanWrite] = useState(false)
	const [text, setText] = useState('')
	const [error, setError] = useState('')
	const load = useCallback(async () => {
		const response = await fetch(endpoint, { cache: 'no-store' })
		if (!response.ok) { setError(response.status === 403 ? 'Чат недоступен для вашей роли.' : 'Не удалось загрузить чат.'); return }
		const data = await response.json()
		setMessages(data.messages); setCanWrite(data.canWrite); setError('')
	}, [endpoint])
	useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 12_000); return () => window.clearInterval(timer) }, [load])
	async function send(event: React.FormEvent) {
		event.preventDefault()
		if (!text.trim()) return
		const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
		if (!response.ok) { setError('Не удалось отправить сообщение.'); return }
		setText(''); await load()
	}
	async function remove(messageId: string) {
		const response = await fetch(`${endpoint}?messageId=${encodeURIComponent(messageId)}`, { method: 'DELETE' })
		if (!response.ok) { setError('Не удалось удалить сообщение.'); return }
		await load()
	}
	return <section className="overflow-hidden rounded-[14px] border border-line bg-surface"><div className="border-b border-line-soft px-4 py-3"><b className="text-[13px]">{title}</b><span className="ml-2 text-[10.5px] text-faint">обновление каждые 12 сек.</span></div><div className="max-h-64 space-y-2 overflow-y-auto p-3">{error ? <p className="rounded-lg bg-warn-bg p-3 text-[11px] text-warn">{error}</p> : messages.length ? messages.map((message) => <div key={message.id} className={`rounded-[10px] px-3 py-2 text-[11.5px] ${message.own ? 'ml-5 bg-brand-soft' : 'mr-5 bg-raised'}`}><div className="flex justify-between gap-2 text-[10px] text-faint"><span>{message.author.name}</span><span>{new Date(message.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span></div><p className="mt-1 whitespace-pre-wrap">{message.text}</p>{message.own && canWrite && <button type="button" onClick={() => void remove(message.id)} className="mt-1 text-[10px] text-danger hover:underline">Удалить</button>}</div>) : <p className="py-5 text-center text-[11px] text-faint">Сообщений пока нет.</p>}</div>{canWrite && <form onSubmit={send} className="flex gap-2 border-t border-line-soft p-3"><textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} rows={2} placeholder="Сообщение…" className="min-w-0 flex-1 resize-none rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[11.5px] outline-none focus:border-brand/60" /><button className="rounded-[9px] bg-brand px-3 text-[11px] font-semibold text-white hover:opacity-90">Отправить</button></form>}</section>
}
