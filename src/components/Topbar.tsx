import Link from 'next/link'
import ThemeToggle from './ThemeToggle'
import ProfileMenu from './ProfileMenu'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export type Crumb = { label: string; href?: string }

export default async function Topbar({
	crumbs,
	userName,
	initials,
	notifications = 0,
}: {
	crumbs: Crumb[]
	userName: string
	initials: string
	notifications?: number
}) {
	const session = await auth()
	const userId = session?.user?.id
	const latest = userId ? await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5 }) : []
	const unread = userId ? await prisma.notification.count({ where: { userId, readAt: null } }) : 0
	const notificationCount = Math.max(unread, notifications)
	return (
		<header className="topbar-shell sticky top-0 z-20 flex h-[62px] flex-none items-center gap-2 border-b border-line bg-surface/88 px-[14px] shadow-[0_1px_0_rgba(36,25,96,.025)] backdrop-blur-xl sm:gap-3 sm:px-[26px]">
			<nav aria-label="Хлебные крошки" className="flex min-w-0 flex-1 items-center gap-[7px] overflow-hidden whitespace-nowrap text-[13px] text-muted">
				{crumbs.map((c, i) => {
					const isLast = i === crumbs.length - 1
					return <span key={i} className={`${isLast ? 'flex min-w-0' : 'hidden sm:flex'} items-center gap-[7px]`}>
						{i > 0 && <span className="text-faint">/</span>}
						{c.href ? (
							<Link href={c.href} className={`${isLast ? 'block truncate' : ''} hover:text-ink`}>
								{c.label}
							</Link>
						) : (
							<span className={`${isLast ? 'block truncate' : ''} font-semibold text-ink`}>{c.label}</span>
						)}
					</span>
				})}
			</nav>

			<div className="ml-auto flex flex-none items-center gap-[8px] sm:gap-[10px]">
				<ThemeToggle />

				<details className="notification-menu group relative">
					<summary aria-label={'\u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f'} className="relative grid h-[36px] w-[36px] cursor-pointer list-none place-items-center rounded-[11px] border border-line bg-surface/80 text-muted shadow-[0_1px_2px_rgba(16,24,40,.03)] transition hover:-translate-y-px hover:border-brand/25 hover:bg-brand-soft hover:text-brand-ink">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
						<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M13.7 20a2 2 0 0 1-3.4 0" />
					</svg>
					{notificationCount > 0 && (
						<span className="absolute -right-[3px] -top-[3px] grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[#e5484d] px-[3px] text-[9px] font-bold text-white">
							{notificationCount > 99 ? '99+' : notificationCount}
						</span>
					)}
					</summary>
					<div className="notification-panel absolute right-0 top-[42px] z-50 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-[13px] border border-line bg-surface shadow-2xl">
						<div className="flex items-center justify-between border-b border-line px-4 py-3"><span className="text-[13px] font-bold">Уведомления</span><span className="text-[10.5px] text-faint">{unread} непрочитанных</span></div>
						{latest.length === 0 ? <div className="px-4 py-8 text-center text-[12px] text-faint">Новых событий пока нет</div> : <div>{latest.map((item) => <Link key={item.id} href={item.href ?? '/notifications'} className={`block border-b border-line-soft px-4 py-3 last:border-0 hover:bg-raised ${item.readAt ? '' : 'bg-brand-soft/35'}`}><span className="block text-[12px] font-bold">{item.title}</span>{item.message && <span className="mt-1 block text-[10.5px] leading-4 text-muted">{item.message}</span>}</Link>)}</div>}
						<Link href="/notifications" className="block border-t border-line px-4 py-2.5 text-center text-[11.5px] font-semibold text-brand-ink hover:bg-raised">Показать все</Link>
					</div>
				</details>

				<ProfileMenu userName={userName} initials={initials} />
			</div>
		</header>
	)
}
