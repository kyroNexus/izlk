'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'

/**
 * Сохранение приоритета пересчитывает сортировку всей очереди — строка
 * может уехать из-под курсора сразу после клика. Мгновенное переупорядочивание
 * не убираем (это реальный, ожидаемый эффект смены приоритета), но объясняем
 * его коротким тостом рядом с кнопкой, а не тихим прыжком без причины.
 */
export default function ProductionRowSaveButton() {
	const { pending } = useFormStatus()
	const wasPending = useRef(false)
	const [showToast, setShowToast] = useState(false)

	useEffect(() => {
		if (wasPending.current && !pending) {
			setShowToast(true)
			const timer = window.setTimeout(() => setShowToast(false), 2500)
			return () => window.clearTimeout(timer)
		}
		wasPending.current = pending
	}, [pending])

	return <div className="relative">
		<button disabled={pending} className="mt-1 w-full rounded bg-brand px-2 py-1.5 text-[10px] font-semibold text-white disabled:opacity-60">{pending ? 'Сохранение…' : 'Сохранить'}</button>
		{showToast && <div role="status" className="animate-[fade-in_.16s_ease-out] absolute left-1/2 top-full z-10 mt-1 w-max max-w-[160px] -translate-x-1/2 rounded-[8px] border border-ok/25 bg-ok-bg px-2 py-1.5 text-center text-[9.5px] leading-tight text-ok shadow-sm">Сохранено — строка могла переместиться в очереди</div>}
	</div>
}
