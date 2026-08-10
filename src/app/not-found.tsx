import Link from 'next/link'

export default function NotFound() {
	return (
		<main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top_left,rgba(124,89,255,.17),transparent_35%),#11101c] px-5 text-white">
			<section className="w-full max-w-[510px] rounded-3xl border border-white/10 bg-white/[.055] p-7 shadow-2xl backdrop-blur-xl sm:p-9">
				<div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#7449ef] text-lg font-bold shadow-[0_10px_28px_rgba(116,73,239,.42)]">404</div>
				<h1 className="mt-6 text-[26px] font-bold tracking-[-.035em]">Страница не найдена</h1>
				<p className="mt-3 text-[14px] leading-6 text-white/65">Возможно, ссылка устарела или у вас нет доступа к этому разделу.</p>
				<Link href="/" className="mt-7 inline-flex rounded-xl bg-[#7449ef] px-5 py-3 text-[13px] font-semibold text-white shadow-[0_8px_20px_rgba(116,73,239,.32)] transition hover:brightness-110">На главную</Link>
			</section>
		</main>
	)
}
