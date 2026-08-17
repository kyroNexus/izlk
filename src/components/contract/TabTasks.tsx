import Link from 'next/link'
import { Card, CardHeader, Chip, EmptyState } from '@/components/ui'
import { formatDate } from '@/lib/format'
import type { ContractWithRelations } from './shared'

export default function TabTasks({
	contractId,
	openTasks,
}: {
	contractId: string
	openTasks: ContractWithRelations['tasks']
}) {
	return (
		<Card id="tasks" hidden role="tabpanel" aria-labelledby="tab-tasks">
			<CardHeader title="Задачи" extra={openTasks.length || undefined} />
			{openTasks.length === 0 ? (
				<EmptyState text="Открытых задач по договору нет" />
			) : (
				<div className="flex flex-col p-2.5">
					{openTasks.map((task) => {
						const overdue = Boolean(task.dueDate && task.dueDate < new Date())
						return (
							<Link key={task.id} href={`/tasks/${task.id}`} className="flex items-center gap-3 rounded-control px-2 py-2 hover:bg-raised">
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-semibold">{task.title}</div>
									<div className="mt-[2px] truncate text-xs text-muted">{task.assignee.name}{task.category ? ` · ${task.category}` : ''}</div>
								</div>
								<span className={`text-xs ${overdue ? 'font-semibold text-danger' : 'text-muted'}`}>{formatDate(task.dueDate)}</span>
								<Chip tone={task.status === 'IN_PROGRESS' ? 'brand' : 'off'}>{task.status === 'IN_PROGRESS' ? 'В работе' : 'Не начато'}</Chip>
							</Link>
						)
					})}
					<Link href={`/tasks?contract=${contractId}`} className="mt-[6px] rounded-tight border border-line px-3 py-2 text-center text-xs font-semibold hover:bg-raised">Все задачи и создание новой →</Link>
				</div>
			)}
		</Card>
	)
}
