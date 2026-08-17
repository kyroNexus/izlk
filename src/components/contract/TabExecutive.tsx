import { Card, CardHeader, EmptyState, ExecStatusChip } from '@/components/ui'
import type { ContractWithRelations } from './shared'

export default function TabExecutive({ executiveDocs }: { executiveDocs: ContractWithRelations['executiveDocs'] }) {
	return (
		<Card id="executive" hidden role="tabpanel" aria-labelledby="tab-executive">
			<CardHeader title="Исполнительная документация" extra={executiveDocs.length || undefined} />
			{executiveDocs.length === 0 ? (
				<EmptyState text="Список пуст" />
			) : (
				<div className="flex flex-col gap-0.5 p-2.5">
					{executiveDocs.map((ed) => (
						<div key={ed.id} className="flex items-center gap-3 rounded-control px-2 py-2 hover:bg-raised">
							<span className="min-w-0 flex-1 truncate text-base">{ed.name}</span>
							<ExecStatusChip status={ed.status} />
						</div>
					))}
				</div>
			)}
		</Card>
	)
}
