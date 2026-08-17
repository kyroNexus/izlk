'use client'

import { useEffect, useState } from 'react'

const KEY = 'izlk-theme'

/**
 * Переключатель светлой / тёмной темы.
 * Ставит класс .dark на <html> и запоминает выбор в localStorage.
 */
export default function ThemeToggle() {
	const [dark, setDark] = useState(false)
	const [mounted, setMounted] = useState(false)

	useEffect(() => {
		setDark(document.documentElement.classList.contains('dark'))
		setMounted(true)
	}, [])

	function toggle() {
		const next = !dark
		setDark(next)
		document.documentElement.classList.toggle('dark', next)
		try {
			localStorage.setItem(KEY, next ? 'dark' : 'light')
		} catch {
			/* localStorage может быть запрещён — не ломаем страницу */
		}
	}

	return (
		<button
			type="button"
			onClick={toggle}
			aria-label={dark ? '\u0421\u0432\u0435\u0442\u043b\u0430\u044f \u0442\u0435\u043c\u0430' : '\u0422\u0451\u043c\u043d\u0430\u044f \u0442\u0435\u043c\u0430'}
			title={dark ? '\u0421\u0432\u0435\u0442\u043b\u0430\u044f \u0442\u0435\u043c\u0430' : '\u0422\u0451\u043c\u043d\u0430\u044f \u0442\u0435\u043c\u0430'}
			className="grid h-[34px] w-[34px] place-items-center rounded-tight border border-line bg-surface text-muted transition-colors hover:bg-raised hover:text-ink"
		>
			{mounted && dark ? (
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
					<circle cx="12" cy="12" r="4" />
					<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
				</svg>
			) : (
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
					<path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7z" />
				</svg>
			)}
		</button>
	)
}

/**
 * Скрипт против мигания белым при загрузке в тёмной теме.
 * Вставляется в <head> корневого layout до отрисовки.
 */
export const themeInitScript = `try{var t=localStorage.getItem('izlk-theme');if(t==='dark'){document.documentElement.classList.add('dark')}}catch(e){}`
