'use client'

import { useLayoutEffect, useState, type ReactNode } from 'react'
import Sidebar from '@/components/Sidebar'
import SessionGuard from '@/components/SessionGuard'
import CommandPalette from '@/components/CommandPalette'

type Props = {
	children: ReactNode
	userName: string
	roleLabel: string
	initials: string
	role: string
	userId: string
}

/** Keeps page width and the navigation rail in one layout state. */
export default function DashboardShell({ children, userId, ...sidebar }: Props) {
	const [sidebarOpen, setSidebarOpen] = useState(true)
	const [compactViewport, setCompactViewport] = useState(false)
	const [tableDensity, setTableDensity] = useState<'comfortable' | 'compact'>('comfortable')

	/*
	 * Below the tablet breakpoint the full navigation must behave as a drawer.
	 * Keeping it open there used to cover the first third of the dashboard and
	 * made the page feel broken. The icon rail remains available at all times.
	 */
	useLayoutEffect(() => {
		setTableDensity(window.localStorage.getItem('izlk-table-density') === 'compact' ? 'compact' : 'comfortable')
		const query = window.matchMedia('(max-width: 767px)')
		const syncViewport = () => {
			setCompactViewport(query.matches)
			if (query.matches) setSidebarOpen(false)
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && query.matches) setSidebarOpen(false)
		}
		syncViewport()
		query.addEventListener('change', syncViewport)
		window.addEventListener('keydown', closeOnEscape)
		return () => {
			query.removeEventListener('change', syncViewport)
			window.removeEventListener('keydown', closeOnEscape)
		}
	}, [])
	/*
	 * The rail is fixed, so the content must reserve its width at tablet/desktop
	 * breakpoints as well. Previously this only happened from `lg`, which made
	 * an open menu cover the page on common 1000px/125% Windows layouts.
	 */
	const changeDensity = (density: 'comfortable' | 'compact') => {
		setTableDensity(density)
		window.localStorage.setItem('izlk-table-density', density)
	}
	return <div data-table-density={tableDensity} className={`workspace-surface min-h-screen bg-canvas pl-16 transition-[padding] duration-300 ease-out ${sidebarOpen && !compactViewport ? 'md:pl-[256px]' : 'md:pl-16'}`}>
		<SessionGuard userId={userId} />
		<CommandPalette role={sidebar.role} />
		{compactViewport && sidebarOpen && <button type="button" aria-label="Закрыть меню" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-[#151326]/35 backdrop-blur-[1px] md:hidden" />}
		<Sidebar {...sidebar} isOpen={sidebarOpen} onOpenChange={setSidebarOpen} />
		<div className="fixed bottom-3 right-3 z-30 hidden rounded-lg border border-line bg-surface/95 p-1 shadow-lg backdrop-blur sm:flex" role="group" aria-label="Плотность таблиц">
			<button type="button" onClick={() => changeDensity('comfortable')} aria-pressed={tableDensity === 'comfortable'} className={`rounded-md px-2 py-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${tableDensity === 'comfortable' ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:bg-raised'}`}>Комфортно</button>
			<button type="button" onClick={() => changeDensity('compact')} aria-pressed={tableDensity === 'compact'} className={`rounded-md px-2 py-1 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${tableDensity === 'compact' ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:bg-raised'}`}>Компактно</button>
		</div>
		<main className="min-h-screen min-w-0">{children}</main>
	</div>
}
