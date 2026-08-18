'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Задача (2026-08-18, вариант C из макета «Зоны по папкам документов»):
 * пока файл «в воздухе» над вкладкой «Документы», все папки-версии
 * (Подписанные заказчиком / Актуальные исходники / Архив версий) —
 * подсвечиваются как возможные цели одновременно, даже свёрнутые, без
 * необходимости сперва разворачивать нужную. Отпустил над конкретной —
 * файл ушёл с этим state принудительно, не через автоопределение по имени.
 *
 * Свою разметку не рисует: подсвечивает уже существующие <details
 * data-drop-state="SIGNED|SOURCE|ARCHIVE"> через инлайн-стили (не через
 * className/globals.css — вся логика самодостаточна в одном файле, ничего
 * менять в общих токенах не пришлось). Слушает drag-события на window, а
 * не на своём контейнере — иначе подсветка не сработала бы, пока курсор
 * ещё над самим полем загрузки сверху (та же вкладка, другой компонент).
 *
 * Если вариант C окажется неудобным на практике (пользователь явно
 * попросил попробовать сначала его, а не вариант A — зону внутри уже
 * открытой папки) — эту подсветку можно снять одной строкой в
 * TabDocuments.tsx, ничего в самих папках не переделывая: они как были
 * обычной разметкой, так и остались.
 */
export default function DocumentFolderDropOverlay({ contractId }: { contractId: string }) {
	const router = useRouter()
	const [status, setStatus] = useState('')
	const dragDepth = useRef(0)
	const hoveredEl = useRef<HTMLElement | null>(null)

	useEffect(() => {
		function targets(): HTMLElement[] {
			return Array.from(document.querySelectorAll<HTMLElement>('[data-drop-state]'))
		}
		function isFileDrag(event: DragEvent) {
			return Array.from(event.dataTransfer?.types ?? []).includes('Files')
		}
		function paint(el: HTMLElement, hit: boolean) {
			el.style.outline = hit ? '2.5px solid var(--brand)' : '2px dashed color-mix(in srgb, var(--brand) 55%, transparent)'
			el.style.outlineOffset = hit ? '-2.5px' : '-2px'
			el.style.background = hit ? 'color-mix(in srgb, var(--brand) 14%, var(--surface))' : 'color-mix(in srgb, var(--brand) 5%, var(--surface))'
		}
		function clearPaint(el: HTMLElement) {
			el.style.outline = ''
			el.style.outlineOffset = ''
			el.style.background = ''
		}
		function clearAll() {
			for (const el of targets()) clearPaint(el)
			hoveredEl.current = null
		}
		function elementAt(x: number, y: number): HTMLElement | null {
			for (const el of targets()) {
				const rect = el.getBoundingClientRect()
				if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return el
			}
			return null
		}
		function onDragEnter(event: DragEvent) {
			if (!isFileDrag(event)) return
			dragDepth.current += 1
			for (const el of targets()) paint(el, false)
		}
		function onDragOver(event: DragEvent) {
			if (!isFileDrag(event)) return
			event.preventDefault()
			const hit = elementAt(event.clientX, event.clientY)
			if (hit === hoveredEl.current) return
			if (hoveredEl.current) paint(hoveredEl.current, false)
			if (hit) paint(hit, true)
			hoveredEl.current = hit
		}
		function onDragLeave(event: DragEvent) {
			if (!isFileDrag(event)) return
			dragDepth.current = Math.max(0, dragDepth.current - 1)
			if (dragDepth.current === 0) clearAll()
		}
		async function onDrop(event: DragEvent) {
			if (!isFileDrag(event)) return
			const target = elementAt(event.clientX, event.clientY)
			dragDepth.current = 0
			clearAll()
			if (!target) return
			event.preventDefault()
			const state = target.dataset.dropState!
			const files = Array.from(event.dataTransfer?.files ?? [])
			if (!files.length) return
			setStatus('Загрузка…')
			const body = new FormData()
			for (const file of files) body.append('files', file, file.name)
			body.append('state', state)
			try {
				const response = await fetch(`/api/contracts/${contractId}/documents`, { method: 'POST', body, headers: { Accept: 'application/json' } })
				const data = await response.json().catch(() => null)
				if (response.ok && data) {
					setStatus(`Загружено файлов: ${data.uploaded ?? 0}${data.failed ? `. Ошибок: ${data.failed}` : ''}`)
					router.refresh()
				} else {
					setStatus(data?.error || 'Не удалось загрузить файлы')
				}
			} catch {
				setStatus('Не удалось загрузить файлы — проверьте соединение')
			}
			setTimeout(() => setStatus(''), 5000)
		}
		window.addEventListener('dragenter', onDragEnter)
		window.addEventListener('dragover', onDragOver)
		window.addEventListener('dragleave', onDragLeave)
		window.addEventListener('drop', onDrop)
		return () => {
			window.removeEventListener('dragenter', onDragEnter)
			window.removeEventListener('dragover', onDragOver)
			window.removeEventListener('dragleave', onDragLeave)
			window.removeEventListener('drop', onDrop)
			clearAll()
		}
	}, [contractId, router])

	if (!status) return null
	return (
		<div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-[200] flex justify-center px-4">
			<div className="pointer-events-auto rounded-control border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink shadow-[var(--shadow-float)]">{status}</div>
		</div>
	)
}
