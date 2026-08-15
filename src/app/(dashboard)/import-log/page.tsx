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

export default async function ImportLogPage() {
	const user = await requireUser()
	if (!isAdmin(user)) redirect('/')
	const events = await prisma.importEvent.findMany({
		orderBy: { createdAt: 'desc' }, take: 250,
		include: { actor: { select: { name: true, login: true } } },
	})
	const name = user.name ?? user.email ?? ''
	return <>
		<Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Журнал импорта' }]} userName={name.split(' ')[0]} initials={initials(name)} />
		<div className="workspace-content px-[26px] py-[22px]">
			<div className="mb-5">
				<h1 className="text-[26px] font-bold tracking-[-0.02em]">Журнал импорта</h1>
				<p className="mt-1 text-[13px] text-muted">Последние 250 событий: сканирование, автопривязка, действия сотрудников и причины ошибок.</p>
			</div>
			<Card>
				<CardHeader title="События" extra={<span className="text-[12px] text-muted">{events.length}</span>} />
				{events.length === 0 ? <EmptyState text="Событий пока нет — журнал заполнится при следующем сканировании или импорте." /> : <div className="divide-y divide-line-soft">
					{events.map((event) => <div key={event.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-[18px] py-[13px]">
						<div className="min-w-[210px] flex-1"><div className="text-[13px] font-semibold text-ink">{event.fileName}</div><div className="mt-1 text-[11.5px] text-muted">{event.message ?? 'Без дополнительного сообщения'}</div></div>
						<Chip tone={outcomeTone[event.outcome as keyof typeof outcomeTone] ?? 'off'}>{outcomeLabel[event.outcome as keyof typeof outcomeLabel] ?? event.outcome}</Chip>
						{event.contractId && <Link href={`/contracts/${event.contractId}`} className="text-[12px] font-medium text-brand hover:underline">К договору →</Link>}
						<div className="min-w-[155px] text-right text-[11px] text-faint"><div>{event.actor?.name ?? 'Автосканер'}</div><div className="mt-1">{formatDateTime(event.createdAt)}</div></div>
					</div>)}
				</div>}
			</Card>
		</div>
	</>
}
