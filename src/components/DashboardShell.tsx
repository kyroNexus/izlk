'use client'

import { useLayoutEffect, useState, type ReactNode } from 'react'
import Sidebar from '@/components/Sidebar'
import SessionGuard from '@/components/SessionGuard'

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

	/*
	 * Below the tablet breakpoint the full navigation must behave as a drawer.
	 * Keeping it open there used to cover the first third of the dashboard and
	 * made the page feel broken. The icon rail remains available at all times.
	 */
	useLayoutEffect(() => {
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
	return <div className={`workspace-surface min-h-screen bg-canvas pl-16 transition-[padding] duration-300 ease-out ${sidebarOpen && !compactViewport ? 'md:pl-[256px]' : 'md:pl-16'}`}>
		<SessionGuard userId={userId} />
		{compactViewport && sidebarOpen && <button type="button" aria-label="Закрыть меню" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-[#151326]/35 backdrop-blur-[1px] md:hidden" />}
		<Sidebar {...sidebar} isOpen={sidebarOpen} onOpenChange={setSidebarOpen} />
		<main className="min-h-screen min-w-0">{children}</main>
	</div>
}
