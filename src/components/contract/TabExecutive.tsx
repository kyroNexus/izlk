import { Card, CardHeader, EmptyState, ExecStatusChip } from '@/components/ui'
import type { ContractWithRelations } from './shared'
import InlineDocumentUpload from './InlineDocumentUpload'

export default function TabExecutive({ contractId, executiveDocs, canUpload }: { contractId: string; executiveDocs: ContractWithRelations['executiveDocs']; canUpload: boolean }) {
	return (
		<Card id="executive" hidden role="tabpanel" aria-labelledby="tab-executive">
			<CardHeader title="Исполнительная документация" extra={executiveDocs.length || undefined} />
			{executiveDocs.length === 0 ? (
				<EmptyState text="Список пуст" />
			) : (
				<div className="flex flex-col gap-0.5 p-2.5">
					{executiveDocs.map((ed) => (
						<div key={ed.id} className="rounded-control px-2 py-2 hover:bg-raised">
							<div className="flex items-center gap-3"><span className="min-w-0 flex-1 truncate text-base">{ed.name}</span><ExecStatusChip status={ed.status} /></div>
							{canUpload && <div className="mt-2"><InlineDocumentUpload contractId={contractId} extraFields={{ executiveDocId: ed.id }} /></div>}
						</div>
					))}
				</div>
			)}
		</Card>
	)
}
