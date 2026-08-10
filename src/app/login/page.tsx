'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import ThemeToggle from '@/components/ThemeToggle'

export default function LoginPage() {
	const router = useRouter()
	const [login, setLogin] = useState('')
	const [password, setPassword] = useState('')
	const [showPassword, setShowPassword] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setError(null)
		setLoading(true)
		try {
			const result = await signIn('credentials', { login: login.trim().toLowerCase(), password, redirect: false })
			if (result?.error) {
				setError('Проверьте логин и пароль')
				return
			}
			router.replace('/')
			router.refresh()
		} catch {
			setError('Сервис временно недоступен. Попробуйте ещё раз')
		} finally {
			setLoading(false)
		}
	}

	return (
		<main className="relative min-h-screen overflow-hidden bg-[#f5f4fa] px-4 py-6 dark:bg-[#0c0c14] sm:grid sm:place-items-center">
			<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(117,73,238,.14),transparent_32%),radial-gradient(circle_at_85%_90%,rgba(69,42,154,.10),transparent_30%)]" />
			<div className="absolute right-5 top-5 z-20"><ThemeToggle /></div>

			<section className="relative mx-auto grid w-full max-w-[940px] overflow-hidden rounded-[26px] border border-white/70 bg-white shadow-[0_28px_80px_rgba(33,24,68,.16)] dark:border-white/10 dark:bg-[#151520] md:grid-cols-[.92fr_1.08fr]">
				<div className="relative flex min-h-[270px] flex-col overflow-hidden bg-[#26145f] p-8 text-white sm:p-10 md:min-h-[610px] md:p-12">
					<div className="absolute -right-24 -top-24 h-72 w-72 rounded-full border border-white/10" />
					<div className="absolute -bottom-36 -left-24 h-96 w-96 rounded-full bg-[#7447ed]/40 blur-2xl" />
					<div className="absolute bottom-20 right-[-75px] h-48 w-48 rotate-12 rounded-[42px] border border-white/10" />

					<div className="relative z-10">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src="/logo/izlk-brand-white-wide.png" alt="ИЗЛК RUS" className="h-auto w-[265px] max-w-full object-contain" />
						<div className="mt-2 text-[10px] uppercase tracking-[.18em] text-white/45">рабочее пространство</div>
					</div>

					<div className="relative z-10 mt-auto hidden md:block">
						<div className="mb-5 h-1 w-12 rounded-full bg-[#8b63f4]" />
						<h1 className="max-w-[360px] text-[34px] font-bold leading-[1.08] tracking-[-0.035em]">Все договоры и проекты — в одном месте</h1>
						<p className="mt-5 max-w-[355px] text-[14px] leading-6 text-white/65">Контролируйте документы, площадки, задачи и исполнительную документацию без лишних таблиц.</p>
						<div className="mt-8 flex gap-5 text-[11px] text-white/55"><span>Договоры</span><span>•</span><span>Площадки</span><span>•</span><span>ИД</span></div>
					</div>
				</div>

				<div className="flex min-h-[440px] flex-col justify-center px-7 py-10 sm:px-12 md:px-16">
					<div className="mb-8">
						<div className="text-[11px] font-bold uppercase tracking-[.16em] text-brand">Корпоративный доступ</div>
						<h2 className="mt-3 text-[29px] font-bold tracking-[-.03em] text-ink">Добро пожаловать</h2>
						<p className="mt-2 text-[13.5px] text-muted">Войдите с помощью рабочей учётной записи</p>
					</div>

					{error && <div role="alert" aria-live="assertive" className="mb-5 flex items-center gap-2 rounded-[11px] border border-danger-bd bg-danger-bg px-3 py-2.5 text-[12.5px] font-medium text-danger"><span className="grid h-5 w-5 place-items-center rounded-full bg-danger text-[11px] text-white">!</span>{error}</div>}

					<form onSubmit={onSubmit} className="flex flex-col gap-5">
						<label className="flex flex-col gap-2">
							<span className="text-[12px] font-semibold text-ink">Логин</span>
							<div className="relative">
								<svg className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
								<input type="text" name="login" value={login} onChange={(event) => setLogin(event.target.value)} required autoFocus autoComplete="username" placeholder="ivan.petrov или name@izlk.ru" className="h-[48px] w-full rounded-[12px] border border-line bg-canvas/40 pl-11 pr-4 text-[14px] text-ink outline-none transition focus:border-brand focus:bg-surface focus:ring-[3px] focus:ring-brand/15" />
							</div>
						</label>

						<label className="flex flex-col gap-2">
							<span className="text-[12px] font-semibold text-ink">Пароль</span>
							<div className="relative">
								<svg className="absolute left-4 top-1/2 -translate-y-1/2 text-faint" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
								<input type={showPassword ? 'text' : 'password'} name="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" placeholder="Введите пароль" className="h-[48px] w-full rounded-[12px] border border-line bg-canvas/40 pl-11 pr-12 text-[14px] text-ink outline-none transition focus:border-brand focus:bg-surface focus:ring-[3px] focus:ring-brand/15" />
								<button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-faint hover:bg-raised hover:text-ink" aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}>
									<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>
								</button>
							</div>
						</label>

						<button type="submit" disabled={loading} className="brand-gradient mt-1 flex h-[48px] items-center justify-center rounded-[12px] text-[14px] font-bold text-white shadow-[0_9px_24px_rgba(103,64,226,.25)] transition hover:-translate-y-px hover:shadow-[0_12px_28px_rgba(103,64,226,.32)] disabled:translate-y-0 disabled:cursor-wait disabled:opacity-65">
							{loading ? <><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />Входим…</> : 'Войти в систему'}
						</button>
					</form>

					<div className="mt-7 flex items-start gap-2 border-t border-line-soft pt-5 text-[11.5px] leading-5 text-faint">
						<svg className="mt-0.5 flex-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>
						<span>Доступ предоставляется администратором компании. Данные защищены внутренней системой доступа.</span>
					</div>
				</div>
			</section>
			<div className="relative mx-auto mt-4 text-center text-[10.5px] text-faint">© 2026 Инновационный завод лёгких конструкций</div>
		</main>
	)
}
