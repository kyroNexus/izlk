'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import Icon from '@/components/Icon'
import FileDropField, { type FileDropFieldHandle, type SelectedFile } from '@/components/FileDropField'
import { formatBytes, formatDateTime } from '@/lib/format'
import { DOCUMENT_EXTENSIONS } from '@/lib/upload-constants'

type Attachment = { id: string; fileName: string; sizeBytes: number; isImage: boolean; url: string }
type Message = { id: string; text: string | null; createdAt: string; author: { id: string; name: string }; own: boolean; canDelete: boolean; attachments: Attachment[] }

const NEAR_BOTTOM_PX = 40
// Задача C1: скрепка — "приложить пару фото к сообщению", не массовая
// загрузка (для неё уже есть умный импорт/загрузка на карточку договора) —
// небольшой явный потолок, тот же, что сервер уже проверяет самостоятельно.
const MAX_CHAT_ATTACHMENTS = 5

function rateLimitMessage(response: Response) {
	if (response.status !== 429) return null
	const retryAfter = Number(response.headers.get('Retry-After'))
	return retryAfter > 0 ? `Слишком много сообщений подряд — попробуйте через ${retryAfter} сек.` : 'Слишком много сообщений подряд, подождите немного.'
}

function AttachmentRow({ attachment }: { attachment: Attachment }) {
	if (attachment.isImage) {
		return <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 block max-w-[220px] overflow-hidden rounded-tight border border-line-soft">
			<img src={attachment.url} alt={attachment.fileName} className="block max-h-[220px] w-full object-cover" />
		</a>
	}
	return <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 flex items-center gap-1.5 rounded-tight border border-line-soft bg-surface/60 px-2 py-1.5 text-2xs hover:border-brand/40">
		<Icon icon={Paperclip} size={12} className="flex-none text-faint" />
		<span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
		<span className="flex-none tnum text-faint">{formatBytes(attachment.sizeBytes)}</span>
	</a>
}

export default function ChatPanel({ endpoint, title }: { endpoint: string; title: string }) {
	const [messages, setMessages] = useState<Message[]>([])
	const [canWrite, setCanWrite] = useState(false)
	const [hasMore, setHasMore] = useState(false)
	const [loadingOlder, setLoadingOlder] = useState(false)
	const [text, setText] = useState('')
	const [error, setError] = useState('')
	const [sending, setSending] = useState(false)
	const [attachOpen, setAttachOpen] = useState(false)
	const [pendingFiles, setPendingFiles] = useState<SelectedFile[]>([])
	// Пересоздаёт FileDropField с пустым состоянием после отправки — простой
	// способ сбросить его внутренний список файлов извне, без отдельного
	// императивного метода "очистить всё" в самом поле.
	const [attachResetKey, setAttachResetKey] = useState(0)
	const attachRef = useRef<FileDropFieldHandle>(null)
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

	// Вставка из буфера прямо в поле сообщения (задача C1) — textarea и
	// FileDropField это разные элементы с разным фокусом, браузер не отдаёт
	// paste из textarea полю выбора файлов сам. Обычная вставка текста не
	// трогается: preventDefault только если в буфере реально были файлы.
	function onTextareaPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
		const files: File[] = []
		for (const item of event.clipboardData.items) {
			if (item.kind === 'file') {
				const file = item.getAsFile()
				if (file) files.push(file)
			}
		}
		if (!files.length) return
		event.preventDefault()
		setAttachOpen(true)
		attachRef.current?.addFiles(files)
	}

	function onAttachFilesChange(items: SelectedFile[]) {
		setPendingFiles(items.filter((item) => item.status === 'pending'))
	}

	async function send(event: React.FormEvent) {
		event.preventDefault()
		const trimmed = text.trim()
		if (!trimmed && pendingFiles.length === 0) return
		stickToBottomRef.current = true
		setSending(true)
		setError('')
		const body = new FormData()
		if (trimmed) body.append('text', trimmed)
		for (const item of pendingFiles) body.append('files', item.file, item.file.name)
		const response = await fetch(endpoint, { method: 'POST', body })
		setSending(false)
		if (!response.ok) { setError(rateLimitMessage(response) ?? 'Не удалось отправить сообщение.'); return }
		const created = await response.json()
		setMessages((current) => [...current, created])
		setText(''); setPendingFiles([]); setAttachOpen(false); setAttachResetKey((key) => key + 1)
	}
	async function remove(messageId: string) {
		// Deleting one of your own messages shouldn't yank the view to the bottom.
		stickToBottomRef.current = false
		const response = await fetch(`${endpoint}?messageId=${encodeURIComponent(messageId)}`, { method: 'DELETE' })
		if (!response.ok) { setError('Не удалось удалить сообщение.'); return }
		setMessages((current) => current.filter((message) => message.id !== messageId))
	}
	return <section className="overflow-hidden rounded-[14px] border border-line bg-surface"><div className="border-b border-line-soft px-4 py-3"><b className="text-base">{title}</b><span className="ml-2 text-xs text-faint">обновление каждые 12 сек.</span></div><div ref={listRef} className="max-h-64 space-y-2 overflow-y-auto p-3">{error ? <p className="rounded-lg bg-warn-bg p-3 text-xs text-warn">{error}</p> : messages.length ? <>{hasMore && <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="mb-1 block w-full rounded-lg py-1.5 text-center text-xs font-semibold text-brand-ink hover:bg-raised disabled:opacity-60">{loadingOlder ? 'Загрузка…' : 'Показать раньше'}</button>}{messages.map((message) => <div key={message.id} className={`rounded-control px-3 py-2 text-xs ${message.own ? 'ml-5 bg-brand-soft' : 'mr-5 bg-raised'}`}><div className="flex justify-between gap-2 text-2xs text-faint"><span>{message.author.name}</span><span>{formatDateTime(message.createdAt)}</span></div>{message.text && <p className="mt-1 whitespace-pre-wrap">{message.text}</p>}{message.attachments.map((attachment) => <AttachmentRow key={attachment.id} attachment={attachment} />)}{message.canDelete && canWrite && <button type="button" onClick={() => void remove(message.id)} className="mt-1 text-2xs text-danger hover:underline">Удалить</button>}</div>)}</> : <p className="py-5 text-center text-xs text-faint">Сообщений пока нет.</p>}</div>{canWrite && <div className="border-t border-line-soft p-3">
		{attachOpen && <div className="mb-2.5">
			<FileDropField
				key={attachResetKey}
				ref={attachRef}
				endpoint={endpoint}
				accept={DOCUMENT_EXTENSIONS}
				maxFiles={MAX_CHAT_ATTACHMENTS}
				hideUploadButton
				onFilesChange={onAttachFilesChange}
				hint={`До ${MAX_CHAT_ATTACHMENTS} файлов на сообщение`}
			/>
		</div>}
		<form onSubmit={send} className="flex items-end gap-2">
			<button type="button" onClick={() => setAttachOpen((open) => !open)} aria-label="Прикрепить файл" aria-pressed={attachOpen} className={`grid h-8 w-8 flex-none place-items-center rounded-tight border transition ${attachOpen || pendingFiles.length ? 'border-brand/40 bg-brand-soft text-brand-ink' : 'border-line bg-surface text-muted hover:border-brand/30'}`}>
				<Icon icon={Paperclip} size={15} />
			</button>
			<textarea value={text} onChange={(event) => setText(event.target.value)} onPaste={onTextareaPaste} maxLength={4000} rows={2} placeholder="Сообщение…" className="min-w-0 flex-1 resize-none rounded-tight border border-line bg-surface px-2.5 py-2 text-xs outline-none focus:border-brand/60" />
			<button disabled={sending || (!text.trim() && !pendingFiles.length)} className="rounded-tight bg-brand px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">{sending ? 'Отправка…' : 'Отправить'}</button>
		</form>
	</div>}</section>
}
