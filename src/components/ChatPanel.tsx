'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

type Message = { id: string; text: string; createdAt: string; author: { id: string; name: string }; own: boolean }

const NEAR_BOTTOM_PX = 40

export default function ChatPanel({ endpoint, title }: { endpoint: string; title: string }) {
	const [messages, setMessages] = useState<Message[]>([])
	const [canWrite, setCanWrite] = useState(false)
	const [hasMore, setHasMore] = useState(false)
	const [loadingOlder, setLoadingOlder] = useState(false)
	const [text, setText] = useState('')
	const [error, setError] = useState('')
	const listRef = useRef<HTMLDivElement>(null)
	// Two DOM adjustments happen after a re-render, not during it: keep the
	// scroll spot when older messages are prepended above the viewport, and
	// follow new messages to the bottom only if the reader was already there.
	const restoreScrollRef = useRef<{ height: number; top: number } | null>(null)
	const stickToBottomRef = useRef(true)
	const messagesRef = useRef<Message[]>([])
	useEffect(() => { messagesRef.current = messages }, [messages])

	const loadInitial = useCallback(async () => {
		const response = await fetch(endpoint, { cache: 'no-store' })
		if (!response.ok) { setError(response.status === 403 ? 'Чат недоступен для вашей роли.' : 'Не удалось загрузить чат.'); return }
		const data = await response.json()
		setMessages(data.messages); setCanWrite(data.canWrite); setHasMore(data.hasMore); setError('')
	}, [endpoint])

	useEffect(() => { void loadInitial() }, [loadInitial])

	useEffect(() => {
		// messagesRef (not the messages closure) so sending/deleting between ticks
		// doesn't reset this interval — it keeps a steady 12s cadence regardless.
		const timer = window.setInterval(async () => {
			const lastId = messagesRef.current.length ? messagesRef.current[messagesRef.current.length - 1].id : null
			if (!lastId) { void loadInitial(); return }
			const el = listRef.current
			stickToBottomRef.current = el ? el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX : true
			const response = await fetch(`${endpoint}?after=${encodeURIComponent(lastId)}`, { cache: 'no-store' })
			if (!response.ok) return
			const data = await response.json()
			setCanWrite(data.canWrite)
			if (data.messages.length) setMessages((current) => [...current, ...data.messages])
		}, 12_000)
		return () => window.clearInterval(timer)
	}, [endpoint, loadInitial])

	// stickToBottomRef starts true, so the very first load (as well as every
	// later poll/send made while already at the bottom) opens/stays scrolled
	// to the newest message rather than the top of the fetched page.
	useLayoutEffect(() => {
		const el = listRef.current
		if (!el) return
		if (restoreScrollRef.current) {
			const { height, top } = restoreScrollRef.current
			el.scrollTop = top + (el.scrollHeight - height)
			restoreScrollRef.current = null
		} else if (stickToBottomRef.current) {
			el.scrollTop = el.scrollHeight
		}
	}, [messages])

	async function loadOlder() {
		if (!messages.length || loadingOlder) return
		setLoadingOlder(true)
		const el = listRef.current
		if (el) restoreScrollRef.current = { height: el.scrollHeight, top: el.scrollTop }
		const response = await fetch(`${endpoint}?before=${encodeURIComponent(messages[0].id)}`, { cache: 'no-store' })
		if (response.ok) {
			const data = await response.json()
			setMessages((current) => [...data.messages, ...current])
			setHasMore(data.hasMore)
		} else {
			restoreScrollRef.current = null
		}
		setLoadingOlder(false)
	}

	async function send(event: React.FormEvent) {
		event.preventDefault()
		if (!text.trim()) return
		stickToBottomRef.current = true
		const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
		if (!response.ok) { setError('Не удалось отправить сообщение.'); return }
		const created = await response.json()
		setMessages((current) => [...current, created]); setText('')
	}
	async function remove(messageId: string) {
		// Deleting one of your own messages shouldn't yank the view to the bottom.
		stickToBottomRef.current = false
		const response = await fetch(`${endpoint}?messageId=${encodeURIComponent(messageId)}`, { method: 'DELETE' })
		if (!response.ok) { setError('Не удалось удалить сообщение.'); return }
		setMessages((current) => current.filter((message) => message.id !== messageId))
	}
	return <section className="overflow-hidden rounded-[14px] border border-line bg-surface"><div className="border-b border-line-soft px-4 py-3"><b className="text-[13px]">{title}</b><span className="ml-2 text-[10.5px] text-faint">обновление каждые 12 сек.</span></div><div ref={listRef} className="max-h-64 space-y-2 overflow-y-auto p-3">{error ? <p className="rounded-lg bg-warn-bg p-3 text-[11px] text-warn">{error}</p> : messages.length ? <>{hasMore && <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="mb-1 block w-full rounded-lg py-1.5 text-center text-[10.5px] font-semibold text-brand-ink hover:bg-raised disabled:opacity-60">{loadingOlder ? 'Загрузка…' : 'Показать раньше'}</button>}{messages.map((message) => <div key={message.id} className={`rounded-[10px] px-3 py-2 text-[11.5px] ${message.own ? 'ml-5 bg-brand-soft' : 'mr-5 bg-raised'}`}><div className="flex justify-between gap-2 text-[10px] text-faint"><span>{message.author.name}</span><span>{new Date(message.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span></div><p className="mt-1 whitespace-pre-wrap">{message.text}</p>{message.own && canWrite && <button type="button" onClick={() => void remove(message.id)} className="mt-1 text-[10px] text-danger hover:underline">Удалить</button>}</div>)}</> : <p className="py-5 text-center text-[11px] text-faint">Сообщений пока нет.</p>}</div>{canWrite && <form onSubmit={send} className="flex gap-2 border-t border-line-soft p-3"><textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} rows={2} placeholder="Сообщение…" className="min-w-0 flex-1 resize-none rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[11.5px] outline-none focus:border-brand/60" /><button className="rounded-[9px] bg-brand px-3 text-[11px] font-semibold text-white hover:opacity-90">Отправить</button></form>}</section>
}
