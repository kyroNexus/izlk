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
				<div className="flex flex-col p-[10px]">
					{openTasks.map((task) => {
						const overdue = Boolean(task.dueDate && task.dueDate < new Date())
						return (
							<Link key={task.id} href={`/tasks/${task.id}`} className="flex items-center gap-[12px] rounded-[10px] px-[9px] py-[9px] hover:bg-raised">
								<div className="min-w-0 flex-1">
									<div className="truncate text-[12.5px] font-semibold">{task.title}</div>
									<div className="mt-[2px] truncate text-[11px] text-muted">{task.assignee.name}{task.category ? ` · ${task.category}` : ''}</div>
								</div>
								<span className={`text-[11.5px] ${overdue ? 'font-semibold text-danger' : 'text-muted'}`}>{formatDate(task.dueDate)}</span>
								<Chip tone={task.status === 'IN_PROGRESS' ? 'brand' : 'off'}>{task.status === 'IN_PROGRESS' ? 'В работе' : 'Не начато'}</Chip>
							</Link>
						)
					})}
					<Link href={`/tasks?contract=${contractId}`} className="mt-[6px] rounded-[9px] border border-line px-[12px] py-[8px] text-center text-[11.5px] font-semibold hover:bg-raised">Все задачи и создание новой →</Link>
				</div>
			)}
		</Card>
	)
}
