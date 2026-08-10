'use client'

import { signOut } from 'next-auth/react'

export default function ProfileMenu({ userName, initials }: { userName: string; initials: string }) {
	return (
		<details className="group relative">
			<summary aria-label="Меню профиля" className="flex cursor-pointer list-none items-center gap-[8px] rounded-[9px] py-[4px] pl-[4px] pr-[8px] text-[13px] font-medium transition-all duration-200 hover:bg-raised hover:shadow-sm">
				<div className="brand-gradient grid h-[26px] w-[26px] flex-none place-items-center rounded-full text-[10px] font-bold text-white">{initials}</div>
				<span className="hidden max-w-[120px] truncate sm:block">{userName}</span>
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="hidden text-faint transition-transform group-open:rotate-180 sm:block"><path d="m6 9 6 6 6-6" /></svg>
			</summary>
			<div className="absolute right-0 top-[42px] z-50 w-[min(220px,calc(100vw-24px))] overflow-hidden rounded-[13px] border border-line bg-surface p-[6px] shadow-2xl">
				<div className="border-b border-line-soft px-[10px] py-[9px]"><div className="truncate text-[12.5px] font-semibold">{userName}</div><div className="mt-[2px] text-[10.5px] text-muted">{`\u0420\u0430\u0431\u043e\u0447\u0430\u044f \u0443\u0447\u0451\u0442\u043d\u0430\u044f \u0437\u0430\u043f\u0438\u0441\u044c`}</div></div>
				<a href="/notifications" className="mt-[4px] flex items-center gap-[8px] rounded-[8px] px-[10px] py-[8px] text-[12px] hover:bg-raised">{`\u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f`}</a>
				<button type="button" onClick={() => signOut({ callbackUrl: '/login' })} className="flex w-full items-center gap-[8px] rounded-[8px] px-[10px] py-[8px] text-left text-[12px] font-semibold text-danger hover:bg-danger/10">{`\u0412\u044b\u0439\u0442\u0438 \u0438\u0437 \u0441\u0438\u0441\u0442\u0435\u043c\u044b`}</button>
			</div>
		</details>
	)
}
