'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BarChart3, CheckSquare, ChevronDown, ChevronLeft, ClipboardList, FileCheck2, FileText, FolderOpen, History, Home, Inbox, Layers, MapPin, MessageSquare, Settings, Trash2, Users, type LucideIcon } from 'lucide-react'
import Icon from '@/components/Icon'

type Item = { href: string; label: string; icon: LucideIcon; nested?: boolean }

const primary: Item[] = [
	{ href: '/', label: 'Главная', icon: Home },
	{ href: '/contracts', label: 'Договоры', icon: FileText },

]

const work: Item[] = [
	{ href: '/projects', label: 'Проектирование и графики', icon: BarChart3, nested: true },
	{ href: '/production-schedule', label: 'График производства', icon: Layers, nested: true },
	{ href: '/departments', label: 'Отделы и чаты', icon: MessageSquare, nested: true },
	{ href: '/tasks', label: 'Задачи', icon: CheckSquare, nested: true },
	{ href: '/sites', label: 'Площадки', icon: MapPin, nested: true },
	{ href: '/executive', label: 'Исполнительная документация', icon: FileCheck2, nested: true },
]

const resources: Item[] = [
	{ href: '/inbox', label: 'Импорт файлов', icon: Inbox },
	{ href: '/documents', label: 'Все документы', icon: FolderOpen },
	{ href: '/contractors', label: 'Контрагенты', icon: Users },
]

const admin: Item[] = [
	{ href: '/activity', label: 'Последняя активность', icon: History },
	{ href: '/import-log', label: 'Журнал импорта', icon: ClipboardList },
	{ href: '/trash', label: 'Корзина', icon: Trash2 },
	{ href: '/settings', label: 'Настройки', icon: Settings },
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
	// grid-template-rows: 0fr не схлопывается внутри overflow-y:auto контейнера (особенность браузера),
	// поэтому высоту меряем сами и анимируем max-height — надёжно в любом контексте.
	const groupContentRefs = useRef<Partial<Record<GroupKey, HTMLDivElement | null>>>({})
	const [groupHeights, setGroupHeights] = useState<Partial<Record<GroupKey, number>>>({})
	useLayoutEffect(() => {
		const next: Partial<Record<GroupKey, number>> = {}
		for (const key of ['work', 'resources', 'admin'] as GroupKey[]) {
			const el = groupContentRefs.current[key]
			if (el) next[key] = el.scrollHeight
		}
		setGroupHeights(next)
	}, [])
	// График производства видят только те же роли, что и на самой странице (lib/access.ts canSeeSchedules).
	const canSeeSchedules = role === 'ADMIN' || role === 'BUILDER' || role === 'PRODUCTION'
	const workItems = work.filter((entry) => entry.href !== '/production-schedule' || canSeeSchedules)
	const active = (href: string) => href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
	const textMotion = `origin-left overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out ${isOpen ? 'max-w-[188px] translate-x-0 opacity-100' : 'max-w-0 -translate-x-1 opacity-0'}`
	const closeMobileDrawer = () => {
		if (window.matchMedia('(max-width: 767px)').matches) onOpenChange(false)
	}
	const item = (entry: Item) => {
		const isActive = active(entry.href)
		return <Link key={entry.href} href={entry.href} onClick={closeMobileDrawer} title={!isOpen ? entry.label : undefined} aria-label={entry.label} aria-current={isActive ? 'page' : undefined} className={`group relative flex h-control items-center gap-3 overflow-hidden rounded-control px-3 text-base font-medium transition-[transform,background-color,color,box-shadow] duration-200 ${entry.nested && isOpen ? 'ml-2 h-[34px] rounded-tight px-2.5 text-sm' : ''} ${isActive ? 'brand-gradient text-white shadow-[0_9px_20px_rgba(91,55,214,.28)] ring-1 ring-inset ring-white/15' : 'text-muted hover:translate-x-px hover:bg-brand-soft/70 hover:text-brand-ink'}`}>
			<span className={`grid flex-none place-items-center rounded-tight transition-[background-color,transform] duration-200 group-hover:scale-105 ${entry.nested && isOpen ? 'h-[22px] w-[22px]' : 'h-7 w-7'} ${isActive ? 'bg-white/15' : 'bg-transparent group-hover:bg-brand-soft'}`}>
				<Icon icon={entry.icon} size={entry.nested && isOpen ? 15 : 17} />
			</span>
			<span className={`${textMotion} flex-1`}>{entry.label}</span>
			{isActive && isOpen && <span className="h-[6px] w-[6px] flex-none rounded-full bg-white/85" aria-hidden="true" />}
		</Link>
	}
	const section = (label: string, entries: Item[], groupKey?: GroupKey) => {
		// В свёрнутом рельсе (isOpen=false) группировка не нужна — иконки видны всегда.
		const collapsed = Boolean(groupKey && isOpen && collapsedGroups[groupKey])
		return <div key={label}>
			<div className={`mb-1.5 px-1 ${textMotion}`}>
				{groupKey ? <button type="button" onClick={() => toggleGroup(groupKey)} aria-expanded={!collapsed} className="group/head -mx-1 flex w-[calc(100%+8px)] items-center gap-2 rounded-tight px-1.5 py-1.5 text-2xs font-bold uppercase tracking-[.14em] text-faint transition-colors duration-200 hover:bg-raised/70 hover:text-brand-ink">
					<span className="flex-1 text-left">{label}</span>
					<span className="grid h-[15px] min-w-[15px] place-items-center rounded-full bg-raised px-1 text-[9px] font-bold leading-none text-faint transition-colors duration-200 group-hover/head:bg-brand-soft group-hover/head:text-brand-ink">{entries.length}</span>
					<Icon icon={ChevronDown} size={12} strokeWidth={2.6} className={`flex-none transition-transform duration-300 ease-[var(--ease-ui)] ${collapsed ? '-rotate-90' : ''}`} />
				</button> : <span className="px-1 text-2xs font-bold uppercase tracking-[.14em] text-faint">{label}</span>}
			</div>
			{groupKey ? (
				<div
					style={{ maxHeight: collapsed ? '0px' : groupHeights[groupKey] != null ? `${groupHeights[groupKey]}px` : 'none' }}
					className="overflow-hidden transition-[max-height] duration-300 ease-[var(--ease-ui)]"
				>
					<div ref={(el) => { groupContentRefs.current[groupKey] = el }} className={`flex flex-col gap-1 pb-0.5 pt-0.5 transition-opacity duration-200 ${collapsed ? 'opacity-0' : 'opacity-100 delay-100'}`}>{entries.map(item)}</div>
				</div>
			) : <div className="flex flex-col gap-1">{entries.map(item)}</div>}
		</div>
	}

	return <aside className={`app-sidebar fixed inset-y-0 left-0 z-50 flex h-screen flex-col overflow-visible border-r border-line bg-sidebar/92 shadow-[8px_0_32px_rgba(27,20,76,.07)] backdrop-blur-2xl transition-[width,box-shadow] duration-300 ease-out ${isOpen ? 'w-[256px] shadow-[8px_0_32px_rgba(27,20,76,.09)]' : 'w-16'}`}>
		<header className={`relative flex flex-none items-center overflow-hidden border-b border-line bg-gradient-to-br from-brand-soft/60 via-sidebar to-sidebar ${isOpen ? 'h-[88px] px-4' : 'h-[72px] justify-center px-0'}`}>
			<div className="pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full bg-brand/10 blur-2xl" aria-hidden="true" />
			{isOpen && <Link href="/" className="relative min-w-0 flex-1" aria-label="ИЗЛК — главная">
				<Image src="/logo/logo-light.png" alt="ИЗЛК RUS" width={640} height={47} priority className="h-auto w-full max-w-[174px] dark:hidden" />
				<Image src="/logo/logo-dark.png" alt="" width={640} height={47} priority className="hidden h-auto w-full max-w-[174px] dark:block" />
				<span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-ok-bg px-2 py-0.5 text-[8px] font-bold uppercase tracking-[.12em] text-ok"><i className="relative h-1.5 w-1.5 rounded-full bg-ok"><i className="absolute inset-0 animate-ping rounded-full bg-ok opacity-75" /></i>система онлайн</span>
			</Link>}
			{!isOpen && <Link href="/" title="ИЗЛК — главная" aria-label="ИЗЛК — главная" className="group relative grid h-10 w-10 place-items-center rounded-[13px] border border-brand/20 bg-brand-soft/65 shadow-[0_6px_18px_rgba(73,47,175,.12)] transition duration-200 hover:-translate-y-px hover:border-brand/45 hover:bg-brand hover:shadow-[0_9px_22px_rgba(73,47,175,.24)]">
				<Image src="/logo/collapsed-z-mark.jpg" alt="" width={640} height={640} priority className="h-7 w-7 rounded-tight object-cover transition-transform duration-200 group-hover:scale-105" />
			</Link>}
		</header>
		<button type="button" onClick={() => onOpenChange(!isOpen)} title={isOpen ? 'Свернуть меню' : 'Открыть меню'} aria-label={isOpen ? 'Свернуть меню' : 'Открыть меню'} className="sidebar-toggle group absolute -right-[18px] top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-brand/35 bg-surface text-brand shadow-[0_5px_18px_rgba(73,47,175,.28)] transition-[transform,box-shadow,background-color] duration-300 hover:scale-110 hover:bg-brand hover:text-white hover:shadow-[0_8px_24px_rgba(73,47,175,.42)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/20">
			<Icon icon={ChevronLeft} size={17} strokeWidth={2.4} className={`transition-transform duration-300 ${isOpen ? '' : 'rotate-180'}`} />
		</button>
		<nav className="flex min-h-0 flex-1 flex-col px-2 py-4">
			<div className="app-scrollbar flex min-h-0 flex-col gap-3 overflow-x-hidden overflow-y-auto">
				{section('Рабочее пространство', primary)}
				{section('Работа', workItems, 'work')}
				{section('Документы и данные', resources, 'resources')}
			</div>
			{role === 'ADMIN' && <div className="mt-auto pt-4">{section('Управление', admin, 'admin')}</div>}
		</nav>
		<Link href="/settings" title={!isOpen ? 'Настройки профиля' : undefined} aria-label="Настройки профиля" className="group m-2 flex h-[54px] flex-none items-center gap-2 overflow-hidden rounded-panel border border-line bg-surface/75 p-2 shadow-[0_3px_12px_rgba(31,22,85,.03)] transition duration-200 hover:-translate-y-px hover:border-brand/25 hover:bg-brand-soft/45">
			<span className="relative grid h-8 w-8 flex-none place-items-center rounded-full text-xs font-bold text-white shadow-sm ring-2 ring-brand/20 transition-[box-shadow] duration-200 group-hover:ring-brand/45">
				<span className="brand-gradient absolute inset-0 rounded-full" aria-hidden="true" />
				<span className="relative">{initials}</span>
			</span>
			<span className={`${textMotion} flex-1`}><b className="block truncate text-sm text-ink">{userName}</b><span className="block truncate text-2xs text-faint">{roleLabel}</span></span>
			{isOpen && <Icon icon={ChevronLeft} size={14} strokeWidth={2.4} className="flex-none rotate-180 text-faint opacity-0 transition-opacity duration-200 group-hover:opacity-100" />}
		</Link>
	</aside>
}
