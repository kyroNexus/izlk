import bcrypt from 'bcryptjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { redirect } from 'next/navigation'
import type { Role } from '@prisma/client'
import Topbar from '@/components/Topbar'
import { Card, Chip, Field, FormError, inputClass, selectClass } from '@/components/ui'
import { isAdmin, requireUser } from '@/lib/access'
import { initials, ROLE_LABELS } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { getSystemHealth } from '@/lib/system-health'
import { formatBytes, formatDateTime } from '@/lib/format'
import TableDensityToggle from '@/components/TableDensityToggle'

export default async function SettingsPage({ searchParams }: { searchParams: { error?: string; success?: string } }) {
	const user = await requireUser()
	const name = user.name ?? user.email ?? ''
	if (!isAdmin(user)) redirect('/')
	const [users, health] = await Promise.all([
		prisma.user.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
		getSystemHealth(),
	])

	async function createUser(formData: FormData) {
		'use server'
		const acting = await requireUser(); if (!isAdmin(acting)) redirect('/')
		const name = String(formData.get('name') ?? '').trim(), login = String(formData.get('login') ?? '').trim().toLowerCase(), email = String(formData.get('email') ?? '').trim().toLowerCase(), password = String(formData.get('password') ?? ''), role = String(formData.get('role') ?? 'MANAGER') as Role
		const fail: (message: string) => never = (message) => redirect(`/settings?error=${encodeURIComponent(message)}`)
		if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !['ADMIN','MANAGER','DESIGNER','BUILDER','PRODUCTION','ACCOUNTING','VIEWER_DESIGN','VIEWER'].includes(role)) fail('Укажите имя, корректный email и пароль не короче 8 символов')
		if (!/^[a-z0-9._@-]{3,64}$/.test(login)) fail('Логин: от 3 до 64 символов (латиница, цифры, точка, дефис или подчёркивание)')
		if (await prisma.user.findUnique({ where: { login }, select: { id: true } })) fail('Этот логин уже занят')
		const created = await prisma.user.create({ data: { name, login, email, passwordHash: await bcrypt.hash(password, 12), role }, select: { id: true } })
		await writeAudit({ userId: acting.id, action: 'CREATE', entityType: 'User', entityId: created.id })
		redirect('/settings?success=Пользователь добавлен')
	}

	async function toggleUser(formData: FormData) {
		'use server'
		const acting = await requireUser(); if (!isAdmin(acting)) redirect('/')
		const id = String(formData.get('id') ?? ''); if (!id || id === acting.id) redirect('/settings?error=Нельзя отключить собственную учётную запись')
		const target = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true, isActive: true } })
		if (target) { await prisma.user.update({ where: { id }, data: { isActive: !target.isActive } }); await writeAudit({ userId: acting.id, action: 'UPDATE', entityType: 'UserAccess', entityId: id }) }
		redirect('/settings')
	}

	async function resetPassword(formData: FormData) {
		'use server'
		const acting = await requireUser(); if (!isAdmin(acting)) redirect('/')
		const id = String(formData.get('id') ?? ''), password = String(formData.get('password') ?? '')
		if (password.length < 8) redirect('/settings?error=Новый пароль должен содержать минимум 8 символов')
		const target = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true } })
		if (target) { await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 12) } }); await writeAudit({ userId: acting.id, action: 'UPDATE', entityType: 'UserPassword', entityId: id }) }
		redirect('/settings?success=Пароль обновлён')
	}

	async function prepareDemo() {
		'use server'
		const acting = await requireUser(); if (!isAdmin(acting)) redirect('/')
		try {
			const run = promisify(execFile)
			await run(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/setup-presentation.ts'], {
				cwd: process.cwd(),
				env: { ...process.env, NODE_ENV: 'production' },
				timeout: 120000,
			})
			await writeAudit({ userId: acting.id, action: 'CREATE', entityType: 'PresentationData', entityId: 'demo-2026' })
		} catch (error) {
			console.error('Не удалось подготовить демо-данные:', error)
			redirect(`/settings?error=${encodeURIComponent('Не удалось подготовить демо-данные. Проверьте журнал сервера')}`)
		}
		redirect(`/contracts?success=${encodeURIComponent('Демо-данные готовы: 4 договора на разных стадиях')}`)
	}

	return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Настройки' }]} userName={name.split(' ')[0]} initials={initials(name)} />
		<div className="workspace-content"><div className="mb-[18px]"><h1 className="text-2xl font-bold">Настройки</h1><div className="mt-[4px] text-base text-muted">Пользователи, права доступа и состояние системы</div></div><div className="mb-[12px] max-w-[760px]"><FormError message={searchParams.error} />{searchParams.success && <div className="rounded-control border border-ok-bd bg-ok-bg px-3 py-2 text-sm text-ok">{searchParams.success}</div>}</div>
			<Card className="mb-[14px] overflow-hidden">
				<div className="flex items-center border-b border-line-soft px-4 py-3"><div><div className="text-base font-bold">Состояние системы</div><div className="mt-0.5 text-xs text-faint">Проверено {formatDateTime(health.checkedAt)}</div></div><Chip tone={health.storage.available && health.inbox.available ? 'ok' : 'danger'}>{health.storage.available && health.inbox.available ? 'Всё работает' : 'Требует внимания'}</Chip></div>
				<div className="grid grid-cols-2 gap-px bg-line-soft md:grid-cols-4">
					<div className="bg-surface p-3.5"><div className="text-xs uppercase tracking-wide text-faint">База данных</div><div className="mt-2 flex items-center gap-2 text-base font-semibold"><span className="h-2 w-2 rounded-full bg-ok" />Подключена</div><div className="mt-1 text-xs text-muted">Ответ {health.database.latencyMs} мс · {health.counts.contracts} договоров</div></div>
					<div className="bg-surface p-3.5"><div className="text-xs uppercase tracking-wide text-faint">Файлы</div><div className="mt-2 flex items-center gap-2 text-base font-semibold"><span className={`h-2 w-2 rounded-full ${health.storage.available ? 'bg-ok' : 'bg-danger'}`} />{health.storage.available ? 'Хранилище доступно' : 'Нет доступа'}</div><div className="mt-1 text-xs text-muted">{health.storage.files} файлов · {formatBytes(BigInt(health.storage.bytes))}</div></div>
					<div className="bg-surface p-3.5"><div className="text-xs uppercase tracking-wide text-faint">Папка импорта</div><div className="mt-2 flex items-center gap-2 text-base font-semibold"><span className={`h-2 w-2 rounded-full ${health.inbox.available ? 'bg-ok' : 'bg-danger'}`} />{health.inbox.available ? 'Готова к сканированию' : 'Нет доступа'}</div><div className="mt-1 text-xs text-muted">{health.inbox.files} файлов · в очереди {health.counts.pendingImports}</div></div>
					<div className="bg-surface p-3.5"><div className="text-xs uppercase tracking-wide text-faint">Данные</div><div className="mt-2 text-base font-semibold">{health.counts.documents} документов</div><div className="mt-1 text-xs text-muted">{health.counts.users} активных пользователей</div></div>
				</div>
			</Card>
			<Card className="mb-[14px] overflow-hidden border-brand/20 bg-gradient-to-r from-brand/10 via-surface to-surface">
				<div className="flex flex-wrap items-center gap-4 px-4 py-4">
					<div className="min-w-0 flex-1"><div className="text-base font-bold">Режим презентации</div><div className="mt-1 text-xs leading-5 text-muted">Создаёт или обновляет четыре демонстрационных договора: новый, подписанный, в работе и почти закрытый. Остальные договоры не удаляются.</div></div>
					<form action={prepareDemo}><button className="brand-gradient h-control rounded-tight px-4 text-sm font-semibold text-white">Подготовить демо-данные</button></form>
				</div>
			</Card>
			<Card className="mb-[14px] overflow-hidden">
				<div className="flex flex-wrap items-center gap-4 px-4 py-4">
					<div className="min-w-0 flex-1"><div className="text-base font-bold">Плотность таблиц</div><div className="mt-1 text-xs leading-5 text-muted">Применяется сразу ко всем реестрам: договорам, документам, задачам и площадкам.</div></div>
					<TableDensityToggle />
				</div>
			</Card>
			<div className="side-panel-grid grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_360px]"><Card className="side-panel-grid-primary overflow-x-auto"><div className="settings-users-row grid grid-cols-[1fr_1.2fr_120px_110px_100px] gap-3 bg-raised px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-faint"><span>Имя</span><span>Email</span><span>Роль</span><span>Статус</span><span></span></div>{users.map((item) => <div key={item.id} className="settings-users-row grid grid-cols-[1fr_1.2fr_120px_110px_100px] items-center gap-3 border-t border-line-soft px-4 py-3"><span className="truncate text-base font-semibold">{item.name}{item.id === user.id ? ' · вы' : ''}</span><span className="truncate text-sm text-muted">{item.email}</span><span className="text-sm">{ROLE_LABELS[item.role]}</span><Chip tone={item.isActive ? 'ok' : 'off'}>{item.isActive ? 'Активен' : 'Отключён'}</Chip><form action={toggleUser}><input type="hidden" name="id" value={item.id} /><button disabled={item.id === user.id} className="w-full rounded-tight border border-line px-1.5 py-1 text-xs font-semibold disabled:opacity-30">{item.isActive ? 'Отключить' : 'Включить'}</button></form><details className="col-span-5"><summary className="cursor-pointer text-xs text-brand-ink">Сменить пароль</summary><form action={resetPassword} className="mt-[7px] flex max-w-[360px] gap-1.5"><input type="hidden" name="id" value={item.id} /><input type="password" name="password" required minLength={8} placeholder="Новый пароль" className={`${inputClass} h-[34px]`} /><button className="rounded-tight bg-brand px-2.5 text-xs font-semibold text-white">Сохранить</button></form></details></div>)}</Card>
				<Card className="p-4"><div className="mb-[14px] text-md font-bold">Добавить сотрудника</div><form action={createUser} className="flex flex-col gap-3"><Field label="Имя" required><input name="name" required className={inputClass} /></Field><Field label="Логин для входа" required hint="Уникальный: например, ivan.petrov"><input name="login" required autoComplete="username" className={inputClass} /></Field><Field label="Рабочий email" required hint="Может быть общим для отдела"><input type="email" name="email" required className={inputClass} /></Field><Field label="Временный пароль" required hint="Минимум 8 символов"><input type="password" name="password" required minLength={8} className={inputClass} /></Field><Field label="Роль"><select name="role" defaultValue="MANAGER" className={selectClass}><option value="MANAGER">Менеджер</option><option value="DESIGNER">Проектировщик (Конструктор)</option><option value="BUILDER">Строитель</option><option value="PRODUCTION">Производство</option><option value="ACCOUNTING">Бухгалтерия</option><option value="VIEWER_DESIGN">Дизайнер</option><option value="VIEWER">Наблюдатель</option><option value="ADMIN">Администратор</option></select></Field><button className="brand-gradient h-control rounded-tight text-sm font-semibold text-white">Создать пользователя</button></form></Card></div>
		</div></>
}
