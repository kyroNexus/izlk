import { redirect } from 'next/navigation'
import Link from 'next/link'
import Topbar from '@/components/Topbar'
import { Card, CardHeader, Chip, EmptyState } from '@/components/ui'
import { isAdmin, requireUser } from '@/lib/access'
import { formatDateTime, initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const outcomeTone = { SUCCESS: 'ok', FAILED: 'danger', IGNORED: 'off', QUEUED: 'brand' } as const
const outcomeLabel = { SUCCESS: 'Успешно', FAILED: 'Ошибка', IGNORED: 'Пропущено', QUEUED: 'В очереди' } as const
// Задача D4: BackgroundJob была в схеме с самого начала (напоминания о сроках
// писали сюда каждый запуск), но нигде в интерфейсе не показывалась — если бы
// джоба стала молча падать каждый раз, никто бы не узнал.
const jobStatusTone = { RUNNING: 'brand', SUCCEEDED: 'ok', FAILED: 'danger' } as const
const jobStatusLabel = { RUNNING: 'Выполняется', SUCCEEDED: 'Успешно', FAILED: 'Ошибка' } as const
const jobTypeLabel: Record<string, string> = { 'notification-deadlines': 'Напоминания о сроках' }

export default async function ImportLogPage() {
	const user = await requireUser()
	if (!isAdmin(user)) redirect('/')
	const [events, jobs] = await Promise.all([
		prisma.importEvent.findMany({
			orderBy: { createdAt: 'desc' }, take: 250,
			include: { actor: { select: { name: true, login: true } } },
		}),
		prisma.backgroundJob.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
	])
	const name = user.name ?? user.email ?? ''
	return <>
		<Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Журнал импорта' }]} userName={name.split(' ')[0]} initials={initials(name)} />
		<div className="workspace-content">
			<div className="mb-5">
				<h1 className="text-2xl font-bold tracking-[-0.02em]">Журнал импорта</h1>
				<p className="mt-1 text-base text-muted">Последние 250 событий: сканирование, автопривязка, действия сотрудников и причины ошибок.</p>
			</div>
			{jobs.length > 0 && <Card className="mb-4">
				<CardHeader title="Фоновые задачи" extra={<span className="text-sm text-muted">{jobs.length}</span>} />
				<div className="divide-y divide-line-soft">
					{jobs.map((job) => <div key={job.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
						<div className="min-w-[210px] flex-1">
							<div className="text-base font-semibold text-ink">{jobTypeLabel[job.type] ?? job.type}</div>
							<div className="mt-1 text-xs text-muted">{job.error ?? (job.status === 'RUNNING' ? 'Ещё выполняется…' : `Обработано: ${job.processed} · создано: ${job.created}`)}</div>
						</div>
						<Chip tone={jobStatusTone[job.status]}>{jobStatusLabel[job.status]}</Chip>
						<div className="min-w-[155px] text-right text-xs text-faint"><div>{formatDateTime(job.startedAt)}</div>{job.finishedAt && <div className="mt-1">до {formatDateTime(job.finishedAt)}</div>}</div>
					</div>)}
				</div>
			</Card>}
			<Card>
				<CardHeader title="События" extra={<span className="text-sm text-muted">{events.length}</span>} />
				{events.length === 0 ? <EmptyState text="Событий пока нет — журнал заполнится при следующем сканировании или импорте." /> : <div className="divide-y divide-line-soft">
					{events.map((event) => <div key={event.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
						<div className="min-w-[210px] flex-1"><div className="text-base font-semibold text-ink">{event.fileName}</div><div className="mt-1 text-xs text-muted">{event.message ?? 'Без дополнительного сообщения'}</div></div>
						<Chip tone={outcomeTone[event.outcome as keyof typeof outcomeTone] ?? 'off'}>{outcomeLabel[event.outcome as keyof typeof outcomeLabel] ?? event.outcome}</Chip>
						{event.contractId && <Link href={`/contracts/${event.contractId}`} className="text-sm font-medium text-brand hover:underline">К договору →</Link>}
						<div className="min-w-[155px] text-right text-xs text-faint"><div>{event.actor?.name ?? 'Автосканер'}</div><div className="mt-1">{formatDateTime(event.createdAt)}</div></div>
					</div>)}
				</div>}
			</Card>
		</div>
	</>
}
