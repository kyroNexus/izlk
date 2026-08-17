'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertCircle, Archive, Camera, CheckCircle2, FileImage, FileSpreadsheet, FileText, Loader2, Paperclip, Ruler, Upload, X } from 'lucide-react'
import Icon from '@/components/Icon'
import { ProgressBar } from '@/components/ui'
import { formatBytes } from '@/lib/format'
import { MAX_UPLOAD_BYTES } from '@/lib/upload-constants'

/**
 * Единое переиспользуемое поле загрузки файлов на всё приложение (задача A1).
 *
 * Владеет всем циклом: выбор (клик/drag&drop/вставка из буфера/камера на
 * телефоне) → клиентская предвалидация → отправка через XMLHttpRequest с
 * прогрессом на всю пачку и отменой → статус по каждому файлу.
 *
 * Рендерит настоящий <input type="file" name="files">, поэтому родитель
 * может обернуть поле в обычный <form action=...> — без JS сработает
 * нативная отправка формы, с JS страница может вызвать собственную загрузку
 * через кнопку внутри поля. Это wiring уровня конкретного экрана (см. задачу
 * A2 для SmartDocumentUpload), сам компонент от наличия form не зависит.
 */

type FileStatus = 'pending' | 'uploading' | 'done' | 'error'

type SelectedFile = {
	id: string
	file: File
	status: FileStatus
	message?: string
}

export type FileDropFieldResult = {
	ok: boolean
	status: number
	raw?: unknown
	uploadedCount: number
	failedCount: number
	/** Итоговый URL после серверного редиректа (XHR его прозрачно проходит).
	 *  Пока эндпоинты не отдают JSON (см. A3), это единственный способ узнать,
	 *  куда сервер решил перенаправить — на карточку договора или обратно на
	 *  форму с ?error=. */
	responseUrl?: string
}

type PerFileResult = { fileName: string; status: string; message?: string }

type Props = {
	/** Куда шлём файлы: multipart/form-data, поле "files". */
	endpoint: string
	/** Разрешённые расширения с точкой, например ['.pdf', '.docx']. Пустой список — без ограничения. */
	accept?: string[]
	maxFiles?: number
	/** Лимит на один файл в байтах. Должен вручную совпадать с MAX_UPLOAD_BYTES
	 *  в src/lib/storage.ts — импортировать его сюда нельзя, там fs/crypto. */
	maxBytes?: number
	multiple?: boolean
	extraFields?: Record<string, string>
	onDone?: (result: FileDropFieldResult) => void
	label?: string
	hint?: string
	disabled?: boolean
	/** required на нативном input — работает только для no-JS отправки формы,
	 *  на кнопку загрузки внутри поля не влияет (её проверяет beforeUpload). */
	required?: boolean
	/** Текст кнопки загрузки без счётчика — сам компонент добавит " (N)".
	 *  По умолчанию «Загрузить». Экран может передать, например,
	 *  «Загрузить и запустить договор», когда это уместно в его контексте. */
	uploadLabel?: string
	/** Вызывается перед стартом загрузки — например, чтобы проверить обязательные
	 *  поля формы вокруг поля (required у обычного <input> работает только при
	 *  нативной отправке формы, а кнопка внутри поля её не делает). Непустая
	 *  строка — сообщение показывается вместо notice, загрузка не начинается. */
	beforeUpload?: () => string | null | undefined
}

const DEFAULT_MAX_FILES = 100
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic'])

function extOf(name: string): string {
	const i = name.lastIndexOf('.')
	return i === -1 ? '' : name.slice(i).toLowerCase()
}

function randomId(): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)
}

function ExtIcon({ fileName }: { fileName: string }) {
	const ext = extOf(fileName)
	if (['.pdf', '.doc', '.docx', '.txt', '.rtf'].includes(ext)) return <Icon icon={FileText} size={15} />
	if (['.xls', '.xlsx', '.csv'].includes(ext)) return <Icon icon={FileSpreadsheet} size={15} />
	if (IMAGE_EXTENSIONS.has(ext)) return <Icon icon={FileImage} size={15} />
	if (['.zip', '.rar', '.7z'].includes(ext)) return <Icon icon={Archive} size={15} />
	if (['.dwg', '.dxf'].includes(ext)) return <Icon icon={Ruler} size={15} />
	return <Icon icon={Paperclip} size={15} />
}

function StatusText({ item }: { item: SelectedFile }) {
	if (item.status === 'pending') return <span className="text-faint">Ожидает</span>
	if (item.status === 'uploading') return <span className="inline-flex items-center gap-1 text-brand-ink"><Icon icon={Loader2} size={11} className="animate-spin" />Загружается…</span>
	if (item.status === 'done') return <span className="inline-flex items-center gap-1 text-ok"><Icon icon={CheckCircle2} size={11} />Готово</span>
	return <span className="inline-flex items-center gap-1 text-danger" title={item.message}><Icon icon={AlertCircle} size={11} />{item.message ?? 'Ошибка'}</span>
}

function Row({ item, onRemove, disabled }: { item: SelectedFile; onRemove: () => void; disabled: boolean }) {
	return (
		<div className="flex items-center gap-2.5 px-3 py-2 text-sm">
			<span className="grid h-7 w-7 flex-none place-items-center rounded-tight bg-raised text-muted"><ExtIcon fileName={item.file.name} /></span>
			<div className="min-w-0 flex-1">
				<div className="truncate font-medium text-ink">{item.file.name}</div>
				<div className="mt-0.5 flex items-center gap-1.5 text-xs">
					<span className="tnum text-faint">{formatBytes(item.file.size)}</span>
					<span className="text-faint">·</span>
					<StatusText item={item} />
				</div>
			</div>
			{item.status !== 'uploading' && (
				<button type="button" onClick={onRemove} disabled={disabled} aria-label={`Убрать ${item.file.name}`} className="grid h-7 w-7 flex-none place-items-center rounded-tight text-faint transition hover:bg-danger/10 hover:text-danger disabled:opacity-40">
					<Icon icon={X} size={14} />
				</button>
			)}
		</div>
	)
}

export default function FileDropField({
	endpoint,
	accept = [],
	maxFiles = DEFAULT_MAX_FILES,
	maxBytes = MAX_UPLOAD_BYTES,
	multiple = true,
	extraFields = {},
	onDone,
	label,
	hint,
	disabled = false,
	uploadLabel = 'Загрузить',
	beforeUpload,
	required = false,
}: Props) {
	const fileInputRef = useRef<HTMLInputElement>(null)
	const cameraInputRef = useRef<HTMLInputElement>(null)
	const xhrRef = useRef<XMLHttpRequest | null>(null)
	const [items, setItems] = useState<SelectedFile[]>([])
	const [dragging, setDragging] = useState(false)
	const [uploading, setUploading] = useState(false)
	const [progress, setProgress] = useState(0)
	const [notice, setNotice] = useState('')

	const acceptSet = useMemo(() => new Set(accept.map((ext) => ext.toLowerCase())), [accept])
	const acceptAttr = accept.join(',') || undefined
	// Пустой accept — без ограничения по картинкам, поэтому кнопка камеры видна и тогда.
	const showCamera = accept.length === 0 || accept.some((ext) => IMAGE_EXTENSIONS.has(ext.toLowerCase()))
	const pendingCount = items.filter((item) => item.status === 'pending').length

	const addFiles = useCallback((incoming: File[]) => {
		if (!incoming.length) return
		setItems((current) => {
			const existingKeys = new Set(current.map((item) => `${item.file.name}::${item.file.size}`))
			const seenInBatch = new Set<string>()
			const room = Math.max(0, maxFiles - current.length)
			const additions: SelectedFile[] = []
			let overflow = 0
			for (const file of incoming) {
				const key = `${file.name}::${file.size}`
				if (existingKeys.has(key) || seenInBatch.has(key)) continue
				seenInBatch.add(key)
				if (additions.length >= room) { overflow += 1; continue }
				const ext = extOf(file.name)
				let status: FileStatus = 'pending'
				let message: string | undefined
				if (acceptSet.size && !acceptSet.has(ext)) { status = 'error'; message = `Формат ${ext || '?'} не поддерживается` }
				else if (file.size === 0) { status = 'error'; message = 'Пустой файл' }
				else if (file.size > maxBytes) { status = 'error'; message = `Больше ${formatBytes(maxBytes)}` }
				additions.push({ id: randomId(), file, status, message })
			}
			setNotice(overflow > 0 ? `Лимит ${maxFiles} файлов за раз: ещё ${overflow} не добавлены.` : '')
			return [...current, ...additions]
		})
	}, [acceptSet, maxBytes, maxFiles])

	function onInputChange(event: React.ChangeEvent<HTMLInputElement>) {
		addFiles(Array.from(event.target.files ?? []))
		event.target.value = ''
	}

	function onPaste(event: React.ClipboardEvent<HTMLDivElement>) {
		if (disabled) return
		const files: File[] = []
		for (const item of event.clipboardData.items) {
			if (item.kind === 'file') {
				const file = item.getAsFile()
				if (file) files.push(file)
			}
		}
		if (files.length) { event.preventDefault(); addFiles(files) }
	}

	function onDrop(event: React.DragEvent<HTMLLabelElement>) {
		event.preventDefault()
		setDragging(false)
		if (disabled) return
		addFiles(Array.from(event.dataTransfer.files))
	}

	function removeItem(id: string) {
		setItems((current) => current.filter((item) => item.id !== id))
	}

	function clearAll() {
		setItems([])
		setNotice('')
	}

	function cancelUpload() {
		xhrRef.current?.abort()
	}

	function startUpload() {
		const pending = items.filter((item) => item.status === 'pending')
		if (!pending.length || uploading) return
		const validationError = beforeUpload?.()
		if (validationError) { setNotice(validationError); return }
		setUploading(true)
		setProgress(0)
		setItems((current) => current.map((item) => (item.status === 'pending' ? { ...item, status: 'uploading' } : item)))

		const body = new FormData()
		for (const item of pending) body.append('files', item.file, item.file.name)
		for (const [key, value] of Object.entries(extraFields)) body.append(key, value)

		const xhr = new XMLHttpRequest()
		xhrRef.current = xhr
		xhr.open('POST', endpoint)
		xhr.setRequestHeader('Accept', 'application/json')
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100))
		}
		xhr.onload = () => {
			const ok = xhr.status >= 200 && xhr.status < 300
			let raw: unknown
			try { raw = xhr.responseText ? JSON.parse(xhr.responseText) : undefined } catch { raw = undefined }
			// Пока конечная точка не отдаёт perFile (см. задачу A3), любой ответ 2xx
			// считается успехом для всей пачки — это уточнится, когда сервер начнёт
			// присылать построчный результат.
			const perFile = raw && typeof raw === 'object' && Array.isArray((raw as { perFile?: unknown }).perFile) ? (raw as { perFile: PerFileResult[] }).perFile : null
			let uploadedCount = 0
			let failedCount = 0
			setItems((current) => current.map((item) => {
				if (item.status !== 'uploading') return item
				const match = perFile?.find((entry) => entry.fileName === item.file.name)
				const nextStatus: FileStatus = match ? (/success|ok/i.test(match.status) ? 'done' : 'error') : ok ? 'done' : 'error'
				if (nextStatus === 'done') uploadedCount += 1
				else failedCount += 1
				return { ...item, status: nextStatus, message: match?.message ?? (nextStatus === 'error' ? `Сервер ответил ошибкой (${xhr.status})` : undefined) }
			}))
			setUploading(false)
			setProgress(100)
			onDone?.({ ok, status: xhr.status, raw, uploadedCount, failedCount, responseUrl: xhr.responseURL || undefined })
			xhrRef.current = null
		}
		xhr.onerror = () => {
			setItems((current) => current.map((item) => (item.status === 'uploading' ? { ...item, status: 'error', message: 'Сбой сети — повторите попытку' } : item)))
			setUploading(false)
			onDone?.({ ok: false, status: 0, uploadedCount: 0, failedCount: pending.length })
			xhrRef.current = null
		}
		xhr.onabort = () => {
			setItems((current) => current.map((item) => (item.status === 'uploading' ? { ...item, status: 'error', message: 'Отменено' } : item)))
			setUploading(false)
			xhrRef.current = null
		}
		xhr.send(body)
	}

	return (
		<div className="grid gap-3" onPaste={onPaste} tabIndex={0} aria-label="Поле загрузки файлов — можно перетащить, выбрать или вставить из буфера Ctrl+V" style={{ outline: 'none' }} onFocus={(event) => event.currentTarget.classList.add('ring-2', 'ring-brand/25')} onBlur={(event) => event.currentTarget.classList.remove('ring-2', 'ring-brand/25')}>
			{label && <div className="text-sm font-bold text-ink">{label}</div>}
			{hint && <p className="text-xs leading-5 text-muted">{hint}</p>}

			<label
				className={`smart-upload-dropzone group flex min-h-[140px] flex-col items-center justify-center gap-1 rounded-control border-2 border-dashed px-5 py-6 text-center transition-all duration-200 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${dragging ? 'scale-[1.01] border-brand bg-brand/10' : 'border-line bg-raised/30 hover:border-brand/55 hover:bg-brand/5'}`}
				onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }}
				onDragOver={(event) => event.preventDefault()}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
			>
				<input ref={fileInputRef} type="file" name="files" multiple={multiple} accept={acceptAttr} required={required} disabled={disabled} className="sr-only" onChange={onInputChange} />
				<div className="grid h-10 w-10 place-items-center rounded-tight bg-brand-soft text-brand-ink transition-transform duration-200 group-hover:-translate-y-0.5"><Icon icon={Upload} size={18} /></div>
				<div className="text-sm font-bold text-ink">Перетащите файлы, нажмите или вставьте (Ctrl+V)</div>
				{accept.length > 0 && <div className="text-xs text-muted">{accept.map((ext) => ext.replace('.', '').toUpperCase()).join(', ')} · до {formatBytes(maxBytes)} на файл</div>}
			</label>

			{showCamera && (
				<>
					<input ref={cameraInputRef} type="file" accept="image/*" capture="environment" disabled={disabled} className="sr-only" onChange={onInputChange} />
					<button type="button" onClick={() => cameraInputRef.current?.click()} disabled={disabled} className="inline-flex h-9 w-fit items-center gap-1.5 self-start rounded-control border border-line bg-surface px-3 text-xs font-semibold text-muted transition hover:border-brand/40 hover:text-brand-ink disabled:opacity-50 sm:hidden">
						<Icon icon={Camera} size={14} />Снять фото
					</button>
				</>
			)}

			{notice && <div role="status" className="rounded-tight border border-warn/25 bg-warn-bg px-2.5 py-1.5 text-xs leading-4 text-warn">{notice}</div>}

			{items.length > 0 && (
				<div className="max-h-64 overflow-y-auto rounded-control border border-line-soft">
					<div className="divide-y divide-line-soft">
						{items.map((item) => <Row key={item.id} item={item} onRemove={() => removeItem(item.id)} disabled={disabled || uploading} />)}
					</div>
				</div>
			)}

			{items.length > 0 && (
				<div className="flex flex-wrap items-center gap-2">
					{!uploading ? (
						<>
							<button type="button" onClick={startUpload} disabled={disabled || pendingCount === 0} className="brand-gradient inline-flex h-9 items-center justify-center rounded-control px-4 text-xs font-bold text-white disabled:opacity-50">
								{pendingCount > 0 ? `${uploadLabel} (${pendingCount})` : 'Загружено'}
							</button>
							<button type="button" onClick={clearAll} disabled={disabled} className="inline-flex h-9 items-center justify-center rounded-control border border-line bg-surface px-3 text-xs font-semibold text-muted transition hover:border-danger/35 hover:text-danger disabled:opacity-50">
								Очистить всё
							</button>
						</>
					) : (
						<>
							<div className="min-w-[140px] flex-1"><ProgressBar percent={progress} /></div>
							<span className="tnum text-xs text-muted">{progress}%</span>
							<button type="button" onClick={cancelUpload} className="inline-flex h-9 items-center justify-center rounded-control border border-danger/30 bg-danger/10 px-3 text-xs font-semibold text-danger">
								Отменить
							</button>
						</>
					)}
				</div>
			)}
		</div>
	)
}
