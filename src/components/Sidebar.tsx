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
	const textMotion = `origin-left overflow-hidden text-ellipsis whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out ${isOpen ? 'max-w-[188px] translate-x-0 opacity-100' : 'max-w-0 -translate-x-1 opacity-0'}`
	// Заголовки разделов — целая строка (лейбл + счётчик + шеврон), а не однострочный текст:
	// сворачиваем по высоте, а не по ширине (как textMotion), иначе overflow-hidden обрезает
	// шеврон у длинных названий раздела.
	const headerMotion = `overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${isOpen ? 'mb-1 max-h-8 opacity-100' : 'mb-0 max-h-0 opacity-0'}`
	const closeMobileDrawer = () => {
		if (window.matchMedia('(max-width: 767px)').matches) onOpenChange(false)
	}
	const item = (entry: Item) => {
		const isActive = active(entry.href)
		return <Link key={entry.href} href={entry.href} onClick={closeMobileDrawer} title={entry.label} aria-label={entry.label} aria-current={isActive ? 'page' : undefined} className={`group relative flex h-control items-center rounded-control text-base font-medium transition-colors duration-200 ${isOpen ? 'gap-3 px-3' : 'justify-center gap-0 px-0'} ${entry.nested && isOpen ? 'ml-2 h-[33px] rounded-tight px-2.5 text-sm' : ''} ${isActive ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-muted hover:bg-raised hover:text-ink'}`}>
			{isActive && <span className={`absolute left-[-6px] top-1/2 -translate-y-1/2 rounded-full bg-brand transition-[height] duration-200 ${entry.nested ? 'h-4 w-[3px]' : 'h-5 w-[3px]'}`} aria-hidden="true" />}
			<span className={`grid flex-none place-items-center rounded-tight transition-colors duration-200 ${entry.nested && isOpen ? 'h-[21px] w-[21px]' : 'h-7 w-7'} ${isActive ? 'bg-brand/12 text-brand-ink' : 'text-faint group-hover:text-muted'}`}>
				<Icon icon={entry.icon} size={entry.nested && isOpen ? 15 : 17} />
			</span>
			<span className={textMotion}>{entry.label}</span>
		</Link>
	}
	const section = (label: string, entries: Item[], groupKey?: GroupKey) => {
		// В свёрнутом рельсе (isOpen=false) группировка не нужна — иконки видны всегда.
		const collapsed = Boolean(groupKey && isOpen && collapsedGroups[groupKey])
		return <div key={label}>
			<div className={`px-2 ${headerMotion}`}>
				{groupKey ? <button type="button" onClick={() => toggleGroup(groupKey)} aria-expanded={!collapsed} className="group/head flex w-full items-center gap-1.5 py-1 text-2xs font-bold uppercase tracking-[.09em] text-faint transition-colors duration-200 hover:text-brand-ink">
					{/* Невидимый зеркальный спейсер справа-налево — без него flex-1 центрирует
					   лейбл только в урезанной части строки (после счётчика и шеврона). */}
					<span className="invisible flex flex-none items-center gap-1.5" aria-hidden="true">
						<span className="tnum text-[10px] font-bold leading-none">{entries.length}</span>
						<Icon icon={ChevronDown} size={11} strokeWidth={2.6} />
					</span>
					<span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-center">{label}</span>
					<span className="tnum text-[10px] font-bold leading-none text-faint transition-colors duration-200 group-hover/head:text-brand-ink">{entries.length}</span>
					<Icon icon={ChevronDown} size={11} strokeWidth={2.6} className={`flex-none transition-transform duration-300 ease-[var(--ease-ui)] ${collapsed ? '-rotate-90' : ''}`} />
				</button> : <span className="block py-1 text-2xs font-bold uppercase tracking-[.09em] text-faint">{label}</span>}
			</div>
			{groupKey ? (
				<div
					style={{ maxHeight: collapsed ? '0px' : groupHeights[groupKey] != null ? `${groupHeights[groupKey]}px` : 'none' }}
					className="overflow-hidden transition-[max-height] duration-300 ease-[var(--ease-ui)]"
				>
					<div ref={(el) => { groupContentRefs.current[groupKey] = el }} className={`flex flex-col gap-0.5 pb-0.5 pt-0.5 transition-opacity duration-200 ${collapsed ? 'opacity-0' : 'opacity-100 delay-100'}`}>{entries.map(item)}</div>
				</div>
			) : <div className="flex flex-col gap-0.5">{entries.map(item)}</div>}
		</div>
	}

	return <aside className={`app-sidebar fixed inset-y-0 left-0 z-50 flex h-screen flex-col overflow-visible border-r border-line-soft bg-sidebar/94 shadow-[10px_0_36px_rgba(24,17,66,.08)] backdrop-blur-2xl transition-[width,box-shadow] duration-300 ease-out ${isOpen ? 'w-[260px]' : 'w-16'}`}>
		<header className={`relative flex flex-none items-center overflow-hidden ${isOpen ? 'h-[92px] px-5' : 'h-[72px] justify-center px-0'}`}>
			<div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-brand-soft/70 to-transparent" aria-hidden="true" />
			{isOpen && <Link href="/" className="relative min-w-0 flex-1" aria-label="ИЗЛК — главная">
				<Image src="/logo/logo-light.png" alt="ИЗЛК RUS" width={640} height={47} priority className="h-auto w-full max-w-[168px] dark:hidden" />
				<Image src="/logo/logo-dark.png" alt="" width={640} height={47} priority className="hidden h-auto w-full max-w-[168px] dark:block" />
				<span className="mt-2.5 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.1em] text-ok"><i className="relative h-[7px] w-[7px] rounded-full bg-ok"><i className="absolute inset-0 rounded-full bg-ok opacity-70 [animation:ping_2.4s_cubic-bezier(0,0,.2,1)_infinite]" /></i>система онлайн</span>
			</Link>}
			{!isOpen && <Link href="/" title="ИЗЛК — главная" aria-label="ИЗЛК — главная" className="group relative grid h-10 w-10 place-items-center rounded-[13px] border border-brand/20 bg-brand-soft/65 shadow-[0_6px_18px_rgba(73,47,175,.12)] transition duration-200 hover:-translate-y-px hover:border-brand/45 hover:bg-brand hover:shadow-[0_9px_22px_rgba(73,47,175,.24)]">
				<Image src="/logo/collapsed-z-mark.jpg" alt="" width={640} height={640} priority className="h-7 w-7 rounded-tight object-cover transition-transform duration-200 group-hover:scale-105" />
			</Link>}
		</header>
		<div className={`mx-4 flex-none border-t border-line-soft ${isOpen ? '' : 'mx-3'}`} />
		<button type="button" onClick={() => onOpenChange(!isOpen)} title={isOpen ? 'Свернуть меню' : 'Открыть меню'} aria-label={isOpen ? 'Свернуть меню' : 'Открыть меню'} className="sidebar-toggle group grid place-items-center border border-brand/35 bg-gradient-to-b from-surface to-raised text-brand shadow-[0_5px_18px_rgba(73,47,175,.28)] transition-[transform,box-shadow,background-color] duration-300 hover:scale-110 hover:bg-brand hover:text-white hover:shadow-[0_8px_24px_rgba(73,47,175,.42)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/20">
			<Icon icon={ChevronLeft} size={17} strokeWidth={2.4} className={`transition-transform duration-300 ${isOpen ? '' : 'rotate-180'}`} />
		</button>
		<nav className="flex min-h-0 flex-1 flex-col px-3 py-4">
			<div className="app-scrollbar flex min-h-0 flex-col gap-4 overflow-x-hidden overflow-y-auto">
				{section('Рабочее пространство', primary)}
				{section('Работа', workItems, 'work')}
				{section('Документы и данные', resources, 'resources')}
			</div>
			{role === 'ADMIN' && <div className="mt-auto pt-4">{section('Управление', admin, 'admin')}</div>}
		</nav>
		<div className={`mt-0 flex-none ${isOpen ? 'm-3' : 'mx-2 mb-3'}`}>
			<Link href="/settings" title={!isOpen ? 'Настройки профиля' : undefined} aria-label="Настройки профиля" className={`group flex h-[58px] items-center overflow-hidden rounded-panel bg-raised/70 transition-colors duration-200 hover:bg-brand-soft/60 ${isOpen ? 'gap-2.5 p-2.5' : 'justify-center p-0'}`}>
				<span className="brand-gradient grid h-9 w-9 flex-none place-items-center rounded-full text-xs font-bold text-white shadow-[0_4px_10px_rgba(91,55,214,.28)]">{initials}</span>
				<span className={`${textMotion} flex-1`}><b className="block truncate text-sm text-ink">{userName}</b><span className="block truncate text-2xs text-faint">{roleLabel}</span></span>
				{isOpen && <Icon icon={ChevronLeft} size={14} strokeWidth={2.4} className="flex-none rotate-180 text-faint opacity-0 transition-opacity duration-200 group-hover:opacity-100" />}
			</Link>
		</div>
	</aside>
}
