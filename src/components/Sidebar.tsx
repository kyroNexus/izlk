'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

type Item = { href: string; label: string; icon: string; nested?: boolean }

const icon = (path: string) => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>

const primary: Item[] = [
	{ href: '/', label: 'Главная', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
	{ href: '/contracts', label: 'Договоры', icon: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6' },

]

const work: Item[] = [
	{ href: '/projects', label: 'Проектирование и графики', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2', nested: true },
	{ href: '/production-schedule', label: 'График производства', icon: 'M12 2 3 7l9 5 9-5-9-5zM3 7v10l9 5 9-5V7M12 12v10', nested: true },
	{ href: '/departments/production', label: 'Рабочие зоны и чаты', icon: 'M4 5h16v11H8l-4 4V5zM8 10h.01M12 10h.01M16 10h.01', nested: true },
	{ href: '/tasks', label: 'Задачи', icon: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 12l2.5 2.5L16 9', nested: true },
	{ href: '/sites', label: 'Площадки', icon: 'M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11zm0-8.4a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z', nested: true },
	{ href: '/executive', label: 'Исполнительная документация', icon: 'M7 3h7l4 4v14H7zM14 3v4h4M10 13h5M10 17h5', nested: true },
]

const resources: Item[] = [
	{ href: '/inbox', label: 'Импорт файлов', icon: 'M4 13h4l2 3h4l2-3h4M6.5 6h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5z' },
	{ href: '/documents', label: 'Все документы', icon: 'M4 6a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z' },
	{ href: '/contractors', label: 'Контрагенты', icon: 'M16 20v-1.6a3.4 3.4 0 0 0-3.4-3.4H7.4A3.4 3.4 0 0 0 4 18.4V20M13.4 8a3.4 3.4 0 1 1-6.8 0' },
]

const admin: Item[] = [
	{ href: '/activity', label: 'Последняя активность', icon: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0' },
	{ href: '/import-log', label: 'Журнал импорта', icon: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5' },
	{ href: '/trash', label: 'Корзина', icon: 'M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3' },
	{ href: '/settings', label: 'Настройки', icon: 'M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5zM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56v.08h-3v-.08a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.06 15 1.7 1.7 0 0 0 5.5 14h-.08v-3h.08A1.7 1.7 0 0 0 7.06 9.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.1-2.1.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56v-.08h3v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.5 11h.08v3h-.08A1.7 1.7 0 0 0 19.4 15z' },
]

type GroupKey = 'work' | 'resources' | 'admin'
const GROUPS_KEY = 'izlk-sidebar-groups'

export default function Sidebar({ userName, roleLabel, initials, role, isOpen, onOpenChange }: { userName: string; roleLabel: string; initials: string; role: string; documentsCount?: number; isOpen: boolean; onOpenChange: (value: boolean) => void }) {
	const pathname = usePathname()
	// Свёрнутые разделы запоминаются на устройстве — раздельно от темы и плотности таблиц.
	const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<GroupKey, boolean>>>({})
	useEffect(() => {
		try {
			const saved = window.localStorage.getItem(GROUPS_KEY)
			if (saved) setCollapsedGroups(JSON.parse(saved))
		} catch { /* localStorage может быть запрещён — не ломаем страницу */ }
	}, [])
	const toggleGroup = (key: GroupKey) => setCollapsedGroups((current) => {
		const next = { ...current, [key]: !current[key] }
		try { window.localStorage.setItem(GROUPS_KEY, JSON.stringify(next)) } catch { /* игнорируем */ }
		return next
	})
	const active = (href: string) => href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
	const textMotion = `origin-left overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out ${isOpen ? 'max-w-[188px] translate-x-0 opacity-100' : 'max-w-0 -translate-x-1 opacity-0'}`
	const closeMobileDrawer = () => {
		if (window.matchMedia('(max-width: 767px)').matches) onOpenChange(false)
	}
	const item = (entry: Item) => <Link key={entry.href} href={entry.href} onClick={closeMobileDrawer} title={!isOpen ? entry.label : undefined} aria-label={entry.label} aria-current={active(entry.href) ? 'page' : undefined} className={`group flex h-[43px] items-center gap-3 overflow-hidden rounded-[13px] px-3 text-[13px] transition-[transform,background-color,color,box-shadow,margin] duration-200 ${entry.nested && isOpen ? 'ml-2 h-[39px] rounded-[10px] px-2.5 text-[12px]' : ''} ${active(entry.href) ? 'brand-gradient text-white shadow-[0_9px_20px_rgba(91,55,214,.24)]' : 'text-muted hover:translate-x-px hover:bg-brand-soft/70 hover:text-brand-ink'}`}><span className="flex-none transition-transform duration-200 group-hover:scale-105">{icon(entry.icon)}</span><span className={textMotion}>{entry.label}</span></Link>
	const section = (label: string, entries: Item[], nested = false, groupKey?: GroupKey) => {
		// В свёрнутом рельсе (isOpen=false) группировка не нужна — иконки видны всегда.
		const collapsed = Boolean(groupKey && isOpen && collapsedGroups[groupKey])
		return <>
			<div className={`mb-2 px-2 ${nested ? 'mt-4' : ''} ${textMotion}`}>
				{groupKey ? <button type="button" onClick={() => toggleGroup(groupKey)} aria-expanded={!collapsed} className="-mx-1 flex w-[calc(100%+8px)] items-center justify-between gap-1 rounded-[8px] px-1 py-1 text-[9px] font-bold uppercase tracking-[.14em] text-faint transition-colors duration-200 hover:bg-raised/70 hover:text-brand-ink"><span>{label}</span><svg className={`h-3 w-3 flex-none transition-transform duration-300 ease-[var(--ease-ui)] ${collapsed ? '-rotate-90' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg></button> : <span className="text-[9px] font-bold uppercase tracking-[.14em] text-faint">{label}</span>}
			</div>
			{groupKey ? (
				<div className={`grid transition-[grid-template-rows] duration-300 ease-[var(--ease-ui)] ${collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}>
					<div className={`overflow-hidden transition-opacity duration-200 ${collapsed ? 'opacity-0' : 'opacity-100 delay-100'}`}>
						<div className="space-y-1 pb-0.5 pt-0.5">{entries.map(item)}</div>
					</div>
				</div>
			) : <div className="space-y-1">{entries.map(item)}</div>}
		</>
	}

	return <aside className={`app-sidebar fixed inset-y-0 left-0 z-50 flex h-screen flex-col overflow-visible border-r border-line bg-sidebar/92 shadow-[8px_0_32px_rgba(27,20,76,.07)] backdrop-blur-2xl transition-[width,box-shadow] duration-300 ease-out ${isOpen ? 'w-[256px] shadow-[8px_0_32px_rgba(27,20,76,.09)]' : 'w-16'}`}>
		<header className={`flex flex-none items-center overflow-hidden border-b border-line bg-gradient-to-br from-brand-soft/60 via-sidebar to-sidebar ${isOpen ? 'h-[88px] px-4' : 'h-[72px] justify-center px-0'}`}>
			{isOpen && <Link href="/" className="relative min-w-0 flex-1" aria-label="ИЗЛК — главная">
				<Image src="/logo/logo-light.png" alt="ИЗЛК RUS" width={640} height={47} priority className="h-auto w-full max-w-[174px] dark:hidden" />
				<Image src="/logo/logo-dark.png" alt="" width={640} height={47} priority className="hidden h-auto w-full max-w-[174px] dark:block" />
				<span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-ok-bg px-2 py-0.5 text-[8px] font-bold uppercase tracking-[.12em] text-ok"><i className="h-1.5 w-1.5 rounded-full bg-ok" />система онлайн</span>
			</Link>}
			{!isOpen && <Link href="/" title="ИЗЛК — главная" aria-label="ИЗЛК — главная" className="group grid h-10 w-10 place-items-center rounded-[13px] border border-brand/20 bg-brand-soft/65 shadow-[0_6px_18px_rgba(73,47,175,.12)] transition duration-200 hover:-translate-y-px hover:border-brand/45 hover:bg-brand hover:shadow-[0_9px_22px_rgba(73,47,175,.24)]">
				<Image src="/logo/collapsed-z-mark.jpg" alt="" width={640} height={640} priority className="h-7 w-7 rounded-[8px] object-cover transition-transform duration-200 group-hover:scale-105" />
			</Link>}
		</header>
		<button type="button" onClick={() => onOpenChange(!isOpen)} title={isOpen ? 'Свернуть меню' : 'Открыть меню'} aria-label={isOpen ? 'Свернуть меню' : 'Открыть меню'} className="group absolute -right-[18px] top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-brand/35 bg-surface text-brand shadow-[0_5px_18px_rgba(73,47,175,.28)] transition-[transform,box-shadow,background-color] duration-300 hover:scale-110 hover:bg-brand hover:text-white hover:shadow-[0_8px_24px_rgba(73,47,175,.42)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/20">
			<svg className={`transition-transform duration-300 ${isOpen ? '' : 'rotate-180'}`} width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m14 6-6 6 6 6" /></svg>
		</button>
		<nav className="flex min-h-0 flex-1 flex-col px-2 py-4"><div className="app-scrollbar min-h-0 overflow-x-hidden overflow-y-auto">{section('Рабочее пространство', primary)}{section('Работа', work, true, 'work')}{section('Документы и данные', resources, true, 'resources')}</div>{role === 'ADMIN' && <div className="mt-auto pt-5">{section('Управление', admin, false, 'admin')}</div>}</nav>
		<Link href="/settings" title={!isOpen ? 'Настройки профиля' : undefined} aria-label="Настройки профиля" className="m-2 flex h-[54px] flex-none items-center gap-2 overflow-hidden rounded-[14px] border border-line bg-surface/75 p-2 shadow-[0_3px_12px_rgba(31,22,85,.03)] transition duration-200 hover:-translate-y-px hover:border-brand/25 hover:bg-brand-soft/45"><span className="brand-gradient grid h-8 w-8 flex-none place-items-center rounded-full text-[11px] font-bold text-white shadow-sm">{initials}</span><span className={textMotion}><b className="block truncate text-[12px] text-ink">{userName}</b><span className="block truncate text-[10px] text-faint">{roleLabel}</span></span></Link>
	</aside>
}
