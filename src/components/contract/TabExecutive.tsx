import { Card, CardHeader, EmptyState, ExecStatusChip } from '@/components/ui'
import type { ContractWithRelations } from './shared'
import InlineDocumentUpload from './InlineDocumentUpload'
import RenameFileButton from '@/components/RenameFileButton'

export default function TabExecutive({ contractId, executiveDocs, documents, canUpload }: { contractId: string; executiveDocs: ContractWithRelations['executiveDocs']; documents: ContractWithRelations['documents']; canUpload: boolean }) {
	return (
		<Card id="executive" hidden role="tabpanel" aria-labelledby="tab-executive">
			<CardHeader title="Исполнительная документация" extra={executiveDocs.length || undefined} />
			{executiveDocs.length === 0 ? (
				<EmptyState text="Список пуст" />
			) : (
				<div className="flex flex-col gap-0.5 p-2.5">
					{executiveDocs.map((ed) => {
						const files = documents.filter((document) => document.executiveDocId === ed.id)
						return (
						<div key={ed.id} className="rounded-control px-2 py-2 hover:bg-raised">
							<div className="flex items-center gap-3"><span className="min-w-0 flex-1 truncate text-base">{ed.name}</span><ExecStatusChip status={ed.status} /></div>
							{files.length > 0 && <div className="mt-2 space-y-1">{files.map((file) => <div key={file.id} className="flex items-center gap-1 rounded-tight border border-line-soft bg-surface px-2 py-1.5 text-xs"><a href={`/api/documents/${file.id}`} className="min-w-0 flex-1 break-all font-semibold text-brand-ink hover:underline">{file.fileName}</a>{canUpload && <RenameFileButton type="document" id={file.id} fileName={file.fileName} />}</div>)}</div>}
							{canUpload && <div className="mt-2"><InlineDocumentUpload contractId={contractId} extraFields={{ executiveDocId: ed.id }} /></div>}
						</div>
					)})}
				</div>
			)}
		</Card>
	)
}
