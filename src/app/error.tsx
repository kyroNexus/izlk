'use client'

import Link from 'next/link'
import { useEffect } from 'react'

/**
 * A deployment can invalidate a Server Action kept by an old browser tab.
 * Do not show an opaque Next.js error in that normal situation: the user only
 * needs a fresh page, and their saved data has not been affected.
 */
export default function AppError({ error }: { error: Error & { digest?: string } }) {
	useEffect(() => {
		console.error('Application route error:', error)
	}, [error])

	return (
		<main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,rgba(124,89,255,.17),transparent_35%),#11101c] px-5 text-white">
			<section className="w-full max-w-[510px] rounded-3xl border border-white/10 bg-white/[.055] p-7 shadow-2xl backdrop-blur-xl sm:p-9">
				<div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#7449ef] text-xl font-bold shadow-[0_10px_28px_rgba(116,73,239,.42)]">↻</div>
				<div className="mt-6 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[.09em] text-amber-200"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" />Нужна свежая версия</div>
				<h1 className="mt-4 text-[26px] font-bold tracking-[-.035em]">Страница обновилась</h1>
				<p className="mt-3 max-w-[430px] text-[14px] leading-6 text-white/65">Открыта вкладка предыдущей версии системы. Данные не потеряны — достаточно обновить страницу и продолжить работу.</p>
				<div className="mt-7 flex flex-wrap gap-3">
					<button onClick={() => window.location.reload()} className="rounded-xl bg-[#7449ef] px-5 py-3 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(116,73,239,.32)] transition hover:brightness-110">Обновить страницу</button>
					<Link href="/" className="rounded-xl border border-white/14 px-5 py-3 text-[13px] font-semibold text-white/85 transition hover:bg-white/10">На главную</Link>
				</div>
				<p className="mt-6 text-[11px] text-white/35">Если ошибка повторится после обновления, сообщите администратору.</p>
			</section>
		</main>
	)
}
