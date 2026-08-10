import Link from 'next/link'
import type { Metadata } from 'next'
import type { SiteStatus } from '@prisma/client'
import Topbar from '@/components/Topbar'
import {
	AttentionRow,
	Card,
	CardHeader,
	Chip,
	EmptyState,
	ProgressBar,
} from '@/components/ui'
import { requireUser } from '@/lib/access'
import { loadDashboard } from '@/lib/dashboard'
import { formatDate, formatDateTime, formatMoney, initials, plural } from '@/lib/format'
import { syncDeadlineNotifications } from '@/lib/notifications'
import DepartmentBoard from '@/components/DepartmentBoard'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
	title: 'Главная | ИЗЛК RUS',
	description: 'Рабочая сводка по договорам, отделам, срокам и задачам ИЗЛК.',
}

const SITE_STATUS_LABEL: Record<SiteStatus, string> = {
	PREPARING: 'Подготовка',
	ISSUE: 'Проблема',
	READY: 'Готова',
	BLOCKED: 'Заблокирована',
}

const SITE_STATUS_TONE: Record<SiteStatus, 'ok' | 'warn' | 'off' | 'danger'> = {
	PREPARING: 'off',
	ISSUE: 'warn',
	READY: 'ok',
	BLOCKED: 'danger',
}

export default async function DashboardPage() {
	const user = await requireUser()
	await syncDeadlineNotifications(user.id).catch(() => undefined)
	const data = await loadDashboard(user)

	const sectionsPercent =
		data.design.totalCount > 0
			? Math.round((data.design.readyCount / data.design.totalCount) * 100)
			: 0

	const collectedPercent =
		data.finance.invoicedAmount > 0
			? Math.round((data.finance.paidAmount / data.finance.invoicedAmount) * 100)
			: 0

	const attentionTotal = data.attentionCounts.danger + data.attentionCounts.warn
	const firstName = (user.name ?? user.email ?? 'коллега').split(/[\s@]/)[0]
	const actionLabel: Record<string, string> = { CREATE: 'Создано', UPDATE: 'Обновлено', UPLOAD: 'Загружен файл', DOWNLOAD: 'Скачан файл', DELETE: 'Удалено', VIEW: 'Просмотрено', LOGIN: 'Вход в систему' }
	const entityLabel: Record<string, string> = { Contract: 'договор', ContractImport: 'договор из файла', ContractDemoStep: 'демо-этап договора', Document: 'документ', Task: 'задача', User: 'пользователь', Session: 'сеанс работы', PresentationData: 'демо-данные' }
	const recentPrimary = data.recentActivity.slice(0, 3)
	const recentRest = data.recentActivity.slice(3)

	return (
		<>
			<Topbar
				crumbs={[{ label: 'Главная' }]}
				userName={user.name ?? user.email ?? 'Пользователь'}
				initials={initials(user.name ?? user.email ?? 'ПП')}
				notifications={data.attentionCounts.danger}
			/>

			<div className="px-[26px] py-[22px]">
			<DepartmentBoard departments={data.departmentProgress} flows={data.departmentFlow} totalContracts={data.totals.contracts} closedContracts={data.totals.closedContracts} attentionCount={attentionTotal} createdToday={data.totals.createdToday} funnel={data.funnel} timeline={data.activityTimeline} departmentTimeline={data.departmentTimeline} attentionItems={data.attention.slice(0, 6)} userName={firstName} role={user.role} />
				<div className="mt-[14px] grid grid-cols-1 gap-[14px] xl:grid-cols-2">
					<Card>
						<CardHeader title="Мой день" extra={<Link href="/tasks" className="text-[12px] font-semibold text-brand-ink hover:underline">Все задачи</Link>} />
						{data.myTasks.length === 0 ? <EmptyState text="На сегодня открытых задач нет" /> : <div>{data.myTasks.map((task) => { const overdue = task.dueDate != null && task.dueDate.getTime() < Date.now(); return <Link key={task.id} href={`/tasks/${task.id}`} className="flex items-center gap-3 border-t border-line-soft px-[18px] py-[11px] first:border-t-0 transition-colors hover:bg-raised"><span className={`h-2.5 w-2.5 flex-none rounded-full ${overdue ? 'bg-danger' : task.priority === 'HIGH' ? 'bg-warn' : 'bg-brand'}`} /><span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-semibold text-ink">{task.title}</span><span className="mt-0.5 block text-[10.5px] text-faint">{task.contractNumber ? `Договор № ${task.contractNumber}` : 'Без договора'}</span></span><span className={`flex-none text-[10.5px] font-semibold ${overdue ? 'text-danger' : 'text-muted'}`}>{task.dueDate ? formatDate(task.dueDate) : 'Без срока'}</span></Link> })}</div>}
					</Card>
					<Card>
						<CardHeader title="Последние действия" extra={<span className="text-[11px] text-muted">ваша активность</span>} />
						{data.recentActivity.length === 0 ? <EmptyState text="История действий пока пуста" /> : <div>{recentPrimary.map((item) => <div key={item.id} className="flex items-center gap-3 border-t border-line-soft px-[18px] py-[11px] first:border-t-0"><span className="grid h-8 w-8 flex-none place-items-center rounded-[9px] bg-brand-soft text-[12px] font-bold text-brand-ink">{item.action === 'UPLOAD' ? '↑' : item.action === 'CREATE' ? '+' : '•'}</span><span className="min-w-0 flex-1"><span className="block text-[12.5px] font-semibold text-ink">{actionLabel[item.action] ?? item.action}</span><span className="block text-[10.5px] text-faint">{entityLabel[item.entityType] ?? item.entityType}</span></span><span className="tnum flex-none text-[10px] text-faint">{formatDateTime(item.createdAt)}</span></div>)}{recentRest.length > 0 && <details className="border-t border-line-soft"><summary className="cursor-pointer px-[18px] py-[10px] text-[12px] font-semibold text-brand-ink hover:bg-raised">Показать ещё {recentRest.length}</summary>{recentRest.map((item) => <div key={item.id} className="flex items-center gap-3 border-t border-line-soft px-[18px] py-[11px]"><span className="grid h-8 w-8 flex-none place-items-center rounded-[9px] bg-raised text-[12px] font-bold text-muted">{item.action === 'UPLOAD' ? '↑' : item.action === 'CREATE' ? '+' : '•'}</span><span className="min-w-0 flex-1"><span className="block text-[12.5px] font-semibold text-ink">{actionLabel[item.action] ?? item.action}</span><span className="block text-[10.5px] text-faint">{entityLabel[item.entityType] ?? item.entityType}</span></span><span className="tnum flex-none text-[10px] text-faint">{formatDateTime(item.createdAt)}</span></div>)}</details>}</div>}
					</Card>
				</div>

				<div className="mt-[14px] grid grid-cols-1 gap-[14px] xl:grid-cols-3">
					{/* Требуют внимания */}
					<div className="hidden xl:col-span-2">
						<Card>
							<CardHeader
								title="Требуют внимания"
								extra={
									attentionTotal > 0 ? (
										<Chip tone={data.attentionCounts.danger > 0 ? 'danger' : 'warn'}>
											{attentionTotal}
										</Chip>
									) : (
										<Chip tone="ok">Чисто</Chip>
									)
								}
							/>
							{data.attention.length === 0 ? (
								<EmptyState text="Нет открытых проблем — все сроки и оплаты в норме" />
							) : (
								<div>
									{data.attention.map((item) => (
										<AttentionRow
											key={item.id}
											tone={item.tone}
											title={item.title}
											detail={item.detail}
											group={item.group}
											href={item.href}
										/>
									))}
								</div>
							)}
						</Card>
					</div>

					{/* Воронка этапов */}
					<Card>
						<CardHeader title="Этапы договоров" />
						<div className="flex flex-col gap-[11px] px-[18px] py-[14px]">
							{data.funnel.map((stage) => (
								<Link key={stage.key} href={`/contracts?stage=${stage.key}`} className="group block rounded-[9px] px-1 py-0.5 transition hover:bg-raised">
									<div className="mb-[5px] flex items-baseline justify-between gap-[10px]">
										<span className="truncate text-[12.5px] text-muted group-hover:text-brand-ink">{stage.label}</span>
										<span className="tnum flex-none text-[12.5px] font-semibold text-ink">
											{stage.count}
										</span>
									</div>
									<ProgressBar
										percent={stage.share}
										tone={stage.count === 0 ? 'muted' : stage.key === 'CLOSED' ? 'ok' : 'brand'}
										height={6}
									/>
								</Link>
							))}
						</div>
					</Card>

					{/* Проектирование */}
					<div className="flex h-full flex-col xl:col-span-2">
						<Card className="flex h-full flex-col overflow-hidden">
							<CardHeader
								title="Проектирование: ближайшие сроки"
								extra={
									<span className="text-[12px] text-muted">
										Готовность {sectionsPercent}%
									</span>
								}
							/>
							<div className="px-[18px] pt-[14px]">
								<ProgressBar
									percent={sectionsPercent}
									tone={sectionsPercent >= 80 ? 'ok' : sectionsPercent >= 40 ? 'brand' : 'warn'}
								/>
							</div>
							{data.design.overdue.length === 0 && data.design.upcoming.length === 0 ? (
								<EmptyState text="Нет разделов с ближайшими или просроченными сроками" />
							) : (
								<div className="mt-[12px] overflow-x-auto">
									<table className="w-full border-collapse text-[12.5px]">
										<thead>
											<tr className="border-y border-line-soft text-left text-[11.5px] uppercase tracking-[0.05em] text-faint">
												<th className="px-[18px] py-[8px] font-medium">Договор</th>
												<th className="px-[10px] py-[8px] font-medium">Раздел</th>
												<th className="px-[10px] py-[8px] font-medium">Ответственный</th>
												<th className="px-[10px] py-[8px] font-medium">Срок</th>
												<th className="px-[18px] py-[8px] font-medium">Статус</th>
											</tr>
										</thead>
										<tbody>
											{[...data.design.overdue, ...data.design.upcoming].map((row) => (
												<tr key={row.id} className="border-b border-line-soft last:border-b-0">
													<td className="px-[18px] py-[9px]">
														<Link
															href={`/contracts/${row.contractId}`}
															className="font-medium text-ink hover:text-brand-ink"
														>
															{row.contractNumber}
														</Link>
													</td>
													<td className="px-[10px] py-[9px] text-muted">{row.label}</td>
													<td className="px-[10px] py-[9px] text-muted">{row.responsible ?? '—'}</td>
													<td className="tnum px-[10px] py-[9px] text-muted">
														{row.dateTo ? formatDate(row.dateTo) : '—'}
													</td>
													<td className="px-[18px] py-[9px]">
													{row.overdue && (row.daysLeft ?? 0) < 0 ? (
														<Chip tone="danger">
															Просрочено на {plural(Math.abs(row.daysLeft ?? 0), 'день', 'дня', 'дней')}
														</Chip>
													) : row.overdue ? (
														<Chip tone="warn">Срок сегодня</Chip>
													) : (
															<Chip tone={(row.daysLeft ?? 99) <= 5 ? 'warn' : 'off'}>
																Осталось {plural(row.daysLeft ?? 0, 'день', 'дня', 'дней')}
															</Chip>
														)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
							<div className="mt-auto grid grid-cols-2 gap-2 border-t border-line-soft bg-raised/35 p-[14px] sm:grid-cols-4">
								<div className="rounded-[10px] bg-surface px-3 py-2.5"><span className="block text-[10px] font-semibold uppercase tracking-wide text-faint">Просрочено</span><b className="mt-1 block text-[19px] leading-none text-danger">{data.design.overdue.length}</b></div>
								<div className="rounded-[10px] bg-surface px-3 py-2.5"><span className="block text-[10px] font-semibold uppercase tracking-wide text-faint">Ближайшие сроки</span><b className="mt-1 block text-[19px] leading-none text-warn">{data.design.upcoming.length}</b></div>
								<div className="rounded-[10px] bg-surface px-3 py-2.5"><span className="block text-[10px] font-semibold uppercase tracking-wide text-faint">Готово разделов</span><b className="mt-1 block text-[19px] leading-none text-ok">{data.design.readyCount} / {data.design.totalCount}</b></div>
								<Link href="/projects" className="flex items-center justify-center rounded-[10px] border border-brand/20 bg-brand-soft px-3 py-2.5 text-center text-[11.5px] font-semibold text-brand-ink transition hover:-translate-y-px hover:border-brand/40">Открыть графики →</Link>
							</div>
						</Card>
					</div>

					{/* Оперативная сводка под ближайшими сроками */}
					<div className="grid gap-[14px] sm:grid-cols-2 xl:col-span-3 xl:grid-cols-3">
						{data.canSeeAmounts && (
							<Card>
								<CardHeader
									title="Финансы"
									extra={<span className="text-[12px] text-muted">Собрано {collectedPercent}%</span>}
								/>
								<div className="px-[18px] py-[14px]">
									<ProgressBar
										percent={collectedPercent}
										tone={data.finance.overdueAmount > 0 ? 'warn' : 'ok'}
									/>
									<div className="mt-[13px] flex flex-col gap-[7px] text-[12.5px]">
										<div className="flex justify-between">
											<span className="text-muted">Выставлено</span>
											<span className="tnum font-semibold text-ink">
												{formatMoney(data.finance.invoicedAmount)}
											</span>
										</div>
										<div className="flex justify-between">
											<span className="text-muted">Оплачено</span>
											<span className="tnum font-semibold text-ok">
												{formatMoney(data.finance.paidAmount)}
											</span>
										</div>
										<div className="flex justify-between">
											<span className="text-muted">Просрочено</span>
											<span
												className={`tnum font-semibold ${
													data.finance.overdueAmount > 0 ? 'text-danger' : 'text-ink'
												}`}
											>
												{formatMoney(data.finance.overdueAmount)}
											</span>
										</div>
									</div>

									{data.finance.debtors.length > 0 && (
										<div className="mt-[14px] border-t border-line-soft pt-[11px]">
											<div className="mb-[7px] text-[11.5px] uppercase tracking-[0.06em] text-faint">
												Ожидаем оплату
											</div>
											<div className="flex flex-col gap-[6px]">
												{data.finance.debtors.map((d) => (
													<Link
														key={d.contractId}
														href={`/contracts/${d.contractId}`}
														className="flex items-center justify-between gap-[10px] rounded-[8px] px-[6px] py-[4px] transition-colors hover:bg-raised"
													>
														<span className="min-w-0 flex-1">
															<span className="block truncate text-[12.5px] text-ink">
																{d.contractorName}
															</span>
															<span className="block truncate text-[11.5px] text-faint">
																{d.contractNumber}
															</span>
														</span>
														<span
															className={`tnum flex-none text-[12.5px] font-semibold ${
																d.overdueAmount > 0 ? 'text-danger' : 'text-ink'
															}`}
														>
															{formatMoney(d.amount)}
														</span>
													</Link>
												))}
											</div>
										</div>
									)}
								</div>
							</Card>
						)}

						<Card>
							<CardHeader
								title="Площадки"
								extra={<span className="text-[12px] text-muted">Всего {data.sites.total}</span>}
							/>
							{data.sites.total === 0 ? (
								<EmptyState text="Площадки не добавлены" />
							) : (
								<div className="flex flex-wrap gap-[7px] px-[18px] py-[14px]">
									{data.sites.byStatus.map((s) => (
										<Chip key={s.status} tone={SITE_STATUS_TONE[s.status]}>
											{SITE_STATUS_LABEL[s.status]}: {s.count}
										</Chip>
									))}
								</div>
							)}
						</Card>

						{data.showInbox && (
							<Card>
								<CardHeader
									title="Очередь импорта"
									extra={
										<Link href="/inbox" className="text-[12px] text-brand-ink hover:underline">
											Открыть
										</Link>
									}
								/>
								<div className="flex flex-col gap-[7px] px-[18px] py-[14px] text-[12.5px]">
									<div className="flex justify-between">
										<span className="text-muted">Ждёт подтверждения</span>
										<span className="tnum font-semibold text-ink">{data.inbox.suggested}</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted">Не распознано</span>
										<span className="tnum font-semibold text-ink">{data.inbox.pending}</span>
									</div>
									<div className="flex justify-between">
										<span className="text-muted">Ошибки разбора</span>
										<span
											className={`tnum font-semibold ${
												data.inbox.failed > 0 ? 'text-danger' : 'text-ink'
											}`}
										>
											{data.inbox.failed}
										</span>
									</div>
								</div>
							</Card>
						)}
					</div>
				</div>

				<p className="mt-[16px] text-[11.5px] text-faint">
					Этапы договоров вычисляются по факту: подписанным сканам, загруженным разделам КМ/АР/КЖ,
					статусу площадки и готовности исполнительной документации.
				</p>
			</div>
		</>
	)
}
