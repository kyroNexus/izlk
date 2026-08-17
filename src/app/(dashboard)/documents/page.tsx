import Link from 'next/link'
import type { DocumentKind, DocumentState, Prisma } from '@prisma/client'
import Topbar from '@/components/Topbar'
import FilterSelect from '@/components/FilterSelect'
import { Card, Chip, EmptyState, Field, FileIcon, inputClass } from '@/components/ui'
import { DOCUMENT_KIND_LABELS, DOCUMENT_KIND_ORDER, formatBytes, formatDate, initials, plural } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { canWrite, contractScope, requireUser } from '@/lib/access'
import DocumentBulkTable from '@/components/DocumentBulkTable'

export const dynamic = 'force-dynamic'

const DOCUMENT_STATE_META: Record<DocumentState, { label: string; tone: 'brand' | 'ok' | 'off' }> = {
	SOURCE: { label: '\u0418\u0441\u0445\u043e\u0434\u043d\u0438\u043a', tone: 'brand' },
	SIGNED: { label: '\u041f\u043e\u0434\u043f\u0438\u0441\u0430\u043d', tone: 'ok' },
	ARCHIVE: { label: '\u0410\u0440\u0445\u0438\u0432', tone: 'off' },
}

const PAGE_SIZE = 50
const compactContractChoice = (number: string) => number.length > 34 ? `${number.slice(0, 31)}…` : number

export default async function DocumentsPage({ searchParams }: { searchParams: { q?: string; kind?: string; contract?: string; state?: string; page?: string } }) {
	const user = await requireUser()
	const q = (searchParams.q ?? '').trim(), kind = searchParams.kind ?? '', contractId = searchParams.contract ?? ''
	const state = ['SOURCE', 'SIGNED', 'ARCHIVE'].includes(searchParams.state ?? '') ? searchParams.state as DocumentState : ''
	const requestedPage = Number(searchParams.page ?? '1')
	const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
	const visibleContracts = contractScope(user)
	// «Все документы» должен означать все документы. Большие комплекты чертежей
	// не перегружают страницу: реестр уже разбит на страницы по 50 файлов.
	const where: Prisma.DocumentWhereInput = { deletedAt: null, contract: visibleContracts, ...(kind ? { kind: kind as DocumentKind } : {}), ...(state ? { state } : {}), ...(contractId ? { contractId } : {}), ...(q ? { fileName: { contains: q, mode: 'insensitive' } } : {}), ...(['VIEWER','DESIGNER'].includes(user.role) ? { isConfidential: false } : {}) }
	const [documents, total, contracts] = await Promise.all([
		prisma.document.findMany({ where, include: { contract: { select: { id: true, number: true, contractor: { select: { name: true } } } }, executiveDoc: { select: { name: true } }, uploadedBy: { select: { name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
		prisma.document.count({ where }),
		prisma.contract.findMany({ where: visibleContracts, select: { id: true, number: true, contractor: { select: { name: true } }, _count: { select: { documents: { where: { deletedAt: null } } } } }, orderBy: { date: 'desc' }, take: 300 }),
	])
	const selected = contracts.find((item) => item.id === contractId)
	const name = user.name ?? user.email ?? ''
	const filterUrl = (nextState: DocumentState | '', nextPage = 1) => {
		const params = new URLSearchParams()
		if (q) params.set('q', q)
		if (kind) params.set('kind', kind)
		if (contractId) params.set('contract', contractId)
		if (nextState) params.set('state', nextState)
		if (nextPage > 1) params.set('page', String(nextPage))
		const query = params.toString()
		return query ? `/documents?${query}` : '/documents'
	}
	return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Документы' }]} userName={name.split(' ')[0]} initials={initials(name)} />
		<div className="workspace-content">
			<div className="mb-[16px] flex items-start gap-4"><div><h1 className="text-2xl font-bold">Документы</h1><div className="mt-[4px] text-base text-muted">Найдено {plural(total, 'документ', 'документа', 'документов')}</div></div>{selected && canWrite(user) && <Link href={`/contracts/${selected.id}/upload`} className="brand-gradient ml-auto inline-flex h-control items-center rounded-control px-4 text-base font-semibold text-white">+ Загрузить документ</Link>}</div>
			<div className="mb-[14px] inline-flex flex-wrap gap-1 rounded-control border border-line bg-raised p-1">
				{([{ key: '', label: '\u0412\u0441\u0435 \u0432\u0435\u0440\u0441\u0438\u0438' }, ...Object.entries(DOCUMENT_STATE_META).map(([key, meta]) => ({ key, label: meta.label }))] as { key: string; label: string }[]).map((tab) => <Link key={tab.key || 'all'} href={filterUrl(tab.key as DocumentState | '')} className={`rounded-tight px-3 py-1.5 text-sm font-semibold transition-colors ${state === tab.key ? 'brand-gradient text-white' : 'text-muted hover:bg-surface hover:text-ink'}`}>{tab.label}</Link>)}
			</div>
			<div className="documents-responsive-shell">
				<div className="three-col-panel grid grid-cols-[250px_minmax(0,1fr)_250px] gap-3.5">
				<Card className="min-h-[650px] overflow-hidden"><div className="documents-panel-header border-b border-line px-3.5 py-3.5 text-base font-semibold">Каталог</div><div className="p-2"><Link href="/documents" className={`flex items-center justify-between rounded-tight px-2 py-2 text-sm hover:bg-raised ${!contractId ? 'bg-brand-soft font-semibold text-brand-ink' : ''}`}><span>Все документы</span><b>{contracts.reduce((sum, item) => sum + item._count.documents, 0)}</b></Link><div className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-faint">Договоры</div>{contracts.map((contract) => <Link key={contract.id} href={`/documents?contract=${contract.id}`} title={contract.contractor.name} className={`flex items-center justify-between rounded-tight px-2 py-2 text-sm hover:bg-raised ${contractId === contract.id ? 'bg-brand-soft font-semibold text-brand-ink' : ''}`}><span className="min-w-0 truncate">№ {contract.number}</span><span className="ml-2 text-faint">{contract._count.documents}</span></Link>)}</div></Card>

				<Card className="three-col-panel-main documents-main-card min-h-[650px] overflow-hidden"><div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3"><form method="get" className="flex flex-1 gap-2">{contractId && <input type="hidden" name="contract" value={contractId} />}{kind && <input type="hidden" name="kind" value={kind} />}<input name="q" defaultValue={q} placeholder="Поиск по документам" className={`${inputClass} max-w-[360px]`} /><button className="rounded-tight border border-line px-3 font-semibold hover:bg-raised">Найти</button></form><span className="text-xs text-muted">{documents.length} из {total}</span></div>{documents.length === 0 ? <EmptyState text="Документы не найдены" /> : <div><DocumentBulkTable key={`${q}:${kind}:${contractId}:${state}:${page}`} canEdit={canWrite(user)} documents={documents.map((document) => ({ ...document, sizeBytes: Number(document.sizeBytes) }))} /><div className="documents-pagination-bar flex items-center justify-between gap-3 border-t border-line px-3.5 py-3 text-sm"><span className="text-muted">Страница {page} из {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span><div className="flex gap-2">{page > 1 && <Link href={filterUrl(state, page - 1)} className="rounded-tight border border-line px-3 py-1.5 font-semibold hover:bg-raised">← Назад</Link>}{page * PAGE_SIZE < total && <Link href={filterUrl(state, page + 1)} className="rounded-tight border border-line px-3 py-1.5 font-semibold hover:bg-raised">Вперёд →</Link>}</div></div></div>}</Card>

				<Card className="filter-panel h-fit 2xl:sticky 2xl:top-[78px]"><div className="documents-panel-header border-b border-line px-3.5 py-3.5 text-base font-semibold">Фильтры</div><form method="get" className="filter-panel-form flex flex-col gap-3 p-3.5"><Field label="Договор" labelClassName="filter-field-label"><FilterSelect name="contract" defaultValue={contractId} placeholder="Все договоры" options={[{ value: '', label: 'Все договоры' }, ...contracts.map((contract) => ({ value: contract.id, label: `№ ${compactContractChoice(contract.number)}` }))]} /></Field><Field label="Тип документа" labelClassName="filter-field-label"><FilterSelect name="kind" defaultValue={kind} placeholder="Все типы" options={[{ value: '', label: 'Все типы' }, ...DOCUMENT_KIND_ORDER.map((key) => ({ value: key, label: DOCUMENT_KIND_LABELS[key] }))]} /></Field>{q && <input type="hidden" name="q" value={q} />}<button className="brand-gradient h-control rounded-tight text-sm font-semibold text-white">Применить фильтры</button><Link href="/documents" className="text-center text-sm text-muted hover:text-ink">Сбросить всё</Link></form>{selected && <div className="border-t border-line p-3.5"><div className="text-xs text-muted">Выбран договор</div><div className="mt-[3px] text-sm font-semibold">№ {selected.number}</div><div className="mt-[2px] text-xs text-faint">{selected.contractor.name}</div><a href={`/api/contracts/${selected.id}/download`} className="mt-[10px] block rounded-tight border border-line px-2.5 py-1.5 text-center text-xs font-semibold hover:bg-raised">Скачать все файлы</a></div>}</Card>
				</div>
			</div>
		</div></>
}
