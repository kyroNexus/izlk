'use client'

import { useEffect, useState } from 'react'

const KEY = 'izlk-table-density'
type Density = 'comfortable' | 'compact'

/**
 * Плотность таблиц — раньше жила плавающей кнопкой поверх каждого экрана,
 * теперь один раз настраивается в Настройках. Значение остаётся в
 * localStorage и применяется атрибутом data-table-density на .workspace-surface
 * (см. DashboardShell), поэтому переключатель обновляет DOM напрямую —
 * без общего состояния между компонентами.
 */
export default function TableDensityToggle() {
	const [density, setDensity] = useState<Density>('comfortable')

	useEffect(() => {
		try {
			const saved = window.localStorage.getItem(KEY)
			if (saved === 'compact' || saved === 'comfortable') setDensity(saved)
		} catch { /* localStorage может быть запрещён — не ломаем страницу */ }
	}, [])

	function change(next: Density) {
		setDensity(next)
		try { window.localStorage.setItem(KEY, next) } catch { /* игнорируем */ }
		document.querySelector('.workspace-surface')?.setAttribute('data-table-density', next)
	}

	return (
		<div className="inline-flex rounded-control border border-line bg-raised p-1" role="group" aria-label="Плотность таблиц">
			<button type="button" onClick={() => change('comfortable')} aria-pressed={density === 'comfortable'} className={`rounded-tight px-3 py-1.5 text-sm font-semibold transition ${density === 'comfortable' ? 'bg-brand text-white shadow-sm' : 'text-muted hover:text-ink'}`}>Комфортно</button>
			<button type="button" onClick={() => change('compact')} aria-pressed={density === 'compact'} className={`rounded-tight px-3 py-1.5 text-sm font-semibold transition ${density === 'compact' ? 'bg-brand text-white shadow-sm' : 'text-muted hover:text-ink'}`}>Компактно</button>
		</div>
	)
}
