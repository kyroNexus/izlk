import { Card, CardHeader, EmptyState } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import type { ContractAuditLog } from './shared'

export default function TabHistory({
	contractNumber,
	auditLogs,
	documentNameById,
}: {
	contractNumber: string
	auditLogs: ContractAuditLog[]
	documentNameById: Map<string, string>
}) {
	return (
		<Card id="history" className="order-last" hidden role="tabpanel" aria-labelledby="tab-history">
			<CardHeader title="История действий" extra={`${auditLogs.length} событий`} />
			{auditLogs.length === 0 ? <EmptyState text="История начнёт заполняться после изменений и загрузок" /> : <div>{auditLogs.map((log) => {
				const objectName = documentNameById.get(log.entityId) ?? `договор № ${contractNumber}`
				const actionLabel = log.entityType === 'DocumentArchived' ? 'отправил в архив' : log.entityType === 'DocumentRestored' ? 'восстановил версию' : log.action === 'UPLOAD' ? 'загрузил файл' : log.action === 'DOWNLOAD' ? 'скачал файл' : log.action === 'CREATE' ? 'создал' : log.action === 'DELETE' ? 'удалил' : 'изменил'
				return <div key={log.id} className="flex items-start gap-3 border-b border-line-soft px-4 py-3 last:border-0"><div className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full bg-brand-soft text-brand"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/></svg></div><div className="min-w-0 flex-1"><div className="text-sm"><b>{log.user.name}</b> {actionLabel} <span className="font-medium">{objectName}</span></div><div className="mt-1 text-xs text-faint">{formatDateTime(log.createdAt)}</div></div></div>
			})}</div>}
		</Card>
	)
}
