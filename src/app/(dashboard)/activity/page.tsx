import Link from 'next/link'
import { redirect } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { Card, EmptyState } from '@/components/ui'
import { isAdmin, requireUser } from '@/lib/access'
import { formatDateTime, initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'

type ActivityFilter = 'all' | 'documents' | 'contracts' | 'workflow'

const FILTERS: Array<{ key: ActivityFilter; label: string }> = [
  { key: 'all', label: 'Все события' },
  { key: 'documents', label: 'Файлы' },
  { key: 'contracts', label: 'Договоры' },
  { key: 'workflow', label: 'Ход работ' },
]

const labels: Record<string, string> = {
  Document: 'загрузил документ', DocumentDeleted: 'переместил документ в корзину', DocumentRestored: 'восстановил документ', DocumentPurged: 'удалил документ безвозвратно',
  DocumentArchived: 'архивировал версию', DocumentRestoredVersion: 'восстановил версию', DocumentPreviewed: 'открыл предпросмотр',
  Contract: 'создал договор', ContractDeleted: 'переместил договор в корзину', ContractRestored: 'восстановил договор', ContractPurged: 'удалил договор безвозвратно',
  ContractWorkflowStage: 'изменил этап договора', ContractPr1Confirmed: 'подтвердил ПР1', ContractPr1Revoked: 'отменил подтверждение ПР1', ContractDemoStep: 'изменил демо-этап',
  ContractImport: 'импортировал договор', ProjectSection: 'изменил раздел проекта', SiteWork: 'добавил дневной отчёт',
}

function groupFor(entityType: string): Exclude<ActivityFilter, 'all'> {
  if (entityType.startsWith('Document')) return 'documents'
  if (entityType.includes('Workflow') || entityType.includes('Pr1') || entityType === 'ProjectSection' || entityType === 'SiteWork') return 'workflow'
  return 'contracts'
}

function Accent({ group }: { group: Exclude<ActivityFilter, 'all'> }) {
  const className = group === 'documents' ? 'bg-ok text-ok' : group === 'workflow' ? 'bg-brand text-brand-ink' : 'bg-warn text-warn'
  const label = group === 'documents' ? 'Файл' : group === 'workflow' ? 'Этап' : 'Договор'
  return <span className={`grid h-8 w-8 flex-none place-items-center rounded-xl text-[9px] font-bold ${className}`}>{label}</span>
}

export default async function ActivityPage({ searchParams }: { searchParams: { type?: string } }) {
  const user = await requireUser()
  if (!isAdmin(user)) redirect('/')
  const filter = FILTERS.some((item) => item.key === searchParams.type) ? searchParams.type as ActivityFilter : 'all'
  const logs = await prisma.auditLog.findMany({ include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 250 })
  const shownLogs = filter === 'all' ? logs : logs.filter((log) => groupFor(log.entityType) === filter)
  const contractIds = [...new Set(logs.filter((log) => groupFor(log.entityType) !== 'documents').map((log) => log.entityId))]
  const documentIds = [...new Set(logs.filter((log) => groupFor(log.entityType) === 'documents').map((log) => log.entityId))]
  const [contracts, documents] = await Promise.all([
    contractIds.length ? prisma.contract.findMany({ where: { id: { in: contractIds } }, select: { id: true, number: true, deletedAt: true } }) : [],
    documentIds.length ? prisma.document.findMany({ where: { id: { in: documentIds } }, select: { id: true, fileName: true, deletedAt: true } }) : [],
  ])
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]))
  const documentById = new Map(documents.map((document) => [document.id, document]))
  const countLabel = filter === 'all' ? `${shownLogs.length} последних событий` : `${shownLogs.length} в выбранной категории`

  return <>
    <Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Последняя активность' }]} userName={(user.name ?? '').split(' ')[0]} initials={initials(user.name ?? user.email ?? 'A')} />
    <div className="mx-auto max-w-[1120px] px-[26px] py-[22px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-[26px] font-bold tracking-[-.02em]">Последняя активность</h1><p className="mt-1 text-[13px] text-muted">Кто и что менял: файлы, договоры, этапы и рабочие отчёты.</p></div>
        <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-semibold text-muted">{countLabel}</span>
      </div>
      <nav aria-label="Фильтр активности" className="mb-4 flex flex-wrap gap-1.5 rounded-xl border border-line bg-surface p-1.5 shadow-sm">
        {FILTERS.map((item) => <Link key={item.key} href={item.key === 'all' ? '/activity' : `/activity?type=${item.key}`} className={`rounded-lg px-3 py-2 text-[11.5px] font-semibold transition ${filter === item.key ? 'bg-brand text-white shadow-sm' : 'text-muted hover:bg-raised hover:text-ink'}`}>{item.label}<span className="ml-1.5 opacity-70">{item.key === 'all' ? logs.length : logs.filter((log) => groupFor(log.entityType) === item.key).length}</span></Link>)}
      </nav>
      <Card className="overflow-hidden">
        {shownLogs.length === 0 ? <EmptyState text="В этой категории событий пока нет" /> : <div>{shownLogs.map((log) => {
          const group = groupFor(log.entityType)
          const document = documentById.get(log.entityId)
          const contract = contractById.get(log.entityId)
          const objectName = document?.fileName ?? (contract ? `Договор № ${contract.number}` : group === 'documents' ? 'Документ был удалён' : 'Объект был удалён')
          const href = document && !document.deletedAt ? `/documents/${document.id}` : contract && !contract.deletedAt ? `/contracts/${contract.id}` : null
          const content = <><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[12.5px]"><b>{log.user.name}</b><span>{labels[log.entityType] ?? 'изменил данные'}</span><span className="max-w-full truncate font-semibold text-brand-ink">{objectName}</span></div><div className="mt-1 flex items-center gap-2 text-[10.5px] text-faint"><span>{formatDateTime(log.createdAt)}</span><span className="h-1 w-1 rounded-full bg-line" /><span>{group === 'documents' ? 'Файлы' : group === 'workflow' ? 'Ход работ' : 'Договоры'}</span></div></div>{href && <span className="flex-none text-[11px] font-semibold text-brand-ink transition group-hover:translate-x-0.5">Открыть →</span>}</>
          return href ? <Link key={log.id} href={href} className="group flex items-start gap-3 border-b border-line-soft px-5 py-3.5 transition hover:bg-raised/70 last:border-0"><Accent group={group} />{content}</Link> : <div key={log.id} className="flex items-start gap-3 border-b border-line-soft px-5 py-3.5 last:border-0"><Accent group={group} />{content}</div>
        })}</div>}
      </Card>
    </div>
  </>
}
