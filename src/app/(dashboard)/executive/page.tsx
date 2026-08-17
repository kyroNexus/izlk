import Link from 'next/link'
import Topbar from '@/components/Topbar'
import { Card, Chip, EmptyState, ProgressBar, StatTile } from '@/components/ui'
import { contractScope, requireUser } from '@/lib/access'
import { CONTRACT_KIND_LABEL } from '@/lib/executive'
import { initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'

const PAGE_SIZE = 50
type Filter = '' | 'ready' | 'attention' | 'not-required'

export default async function ExecutivePage({ searchParams }: { searchParams: { q?: string; page?: string; filter?: Filter } }) {
	const user = await requireUser()
	const q = (searchParams.q ?? '').trim()
	const filter: Filter = ['ready', 'attention', 'not-required'].includes(searchParams.filter ?? '') ? searchParams.filter as Filter : ''
	const page = Math.max(1, Number(searchParams.page) || 1)
	const where = { ...contractScope(user), ...(q ? { OR: [{ number: { contains: q, mode: 'insensitive' as const } }, { cipher: { contains: q, mode: 'insensitive' as const } }, { contractor: { name: { contains: q, mode: 'insensitive' as const } } }] } : {}) }
	const rawContracts = await prisma.contract.findMany({ where, select: { id: true, number: true, cipher: true, kind: true, contractor: { select: { name: true } }, executiveDocs: { where: { deletedAt: null }, select: { id: true, name: true, status: true, _count: { select: { documents: { where: { deletedAt: null } } } } } } }, orderBy: { date: 'desc' }, take: 500 })
	const summary = (contract: typeof rawContracts[number]) => {
		const required = contract.executiveDocs.length
		const ready = contract.executiveDocs.filter((item) => item.status === 'READY').length
		const files = contract.executiveDocs.reduce((sum, item) => sum + item._count.documents, 0)
		const percent = contract.kind === 'PROJECT' ? 100 : required ? Math.round(ready / required * 100) : 0
		return { required, ready, files, percent, isReady: contract.kind === 'PROJECT' || (required > 0 && ready === required) }
	}
	const complete = rawContracts.filter((contract) => summary(contract).isReady && contract.kind !== 'PROJECT').length
	const incomplete = rawContracts.filter((contract) => contract.kind !== 'PROJECT' && !summary(contract).isReady).length
	const notRequired = rawContracts.filter((contract) => contract.kind === 'PROJECT').length
	const filtered = rawContracts.filter((contract) => filter === 'ready' ? summary(contract).isReady && contract.kind !== 'PROJECT' : filter === 'attention' ? contract.kind !== 'PROJECT' && !summary(contract).isReady : filter === 'not-required' ? contract.kind === 'PROJECT' : true)
	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
	const contracts = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
	const name = user.name ?? user.email ?? ''
	const filterHref = (value: Filter) => { const params = new URLSearchParams(); if (q) params.set('q', q); if (value) params.set('filter', value); const result = params.toString(); return result ? `/executive?${result}` : '/executive' }

	return <>
		<Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Исполнительная документация' }]} userName={name.split(' ')[0]} initials={initials(name)} notifications={incomplete} />
		<div className="workspace-content">
			<div className="work-hero mb-[18px] px-5 py-4"><h1 className="text-2xl font-bold">Исполнительная документация</h1><p className="mt-[5px] max-w-[820px] text-base leading-5 text-muted">Один список по всем договорам: сразу видно, где комплект готов, где не хватает файлов и куда перейти для загрузки.</p></div>
			<div className="mb-[14px] grid grid-cols-2 gap-2.5 lg:grid-cols-4"><Link href={filterHref('')}><StatTile label="Договоров" value={rawContracts.length} tone="brand" /></Link><Link href={filterHref('ready')}><StatTile label="Комплект готов" value={complete} tone="ok" /></Link><Link href={filterHref('attention')}><StatTile label="Требуют внимания" value={incomplete} tone="danger" /></Link><Link href={filterHref('not-required')}><StatTile label="Не требуется" value={notRequired} /></Link></div>
			<form className="work-toolbar mb-[14px] flex max-w-[720px] gap-2 p-2"><input name="q" defaultValue={q} placeholder="Договор, шифр или контрагент" className="h-control flex-1 rounded-control border border-line bg-surface px-3 text-base" />{filter && <input type="hidden" name="filter" value={filter} />}<button className="rounded-control border border-line bg-surface px-3.5 text-base font-semibold">Найти</button>{(q || filter) && <Link href="/executive" className="inline-flex items-center px-2 text-sm text-muted">Сбросить</Link>}</form>
			<Card className="overflow-hidden">{contracts.length === 0 ? <EmptyState text="Договоры по выбранному фильтру не найдены" /> : <div><div className="hidden grid-cols-[minmax(220px,1.3fr)_120px_minmax(180px,1fr)_140px] gap-3 border-b border-line-soft bg-raised px-4 py-2 text-xs font-semibold uppercase tracking-wide text-faint md:grid"><span>Договор</span><span>Тип</span><span>Комплект</span><span>Статус</span></div>{contracts.map((contract) => { const item = summary(contract); return <Link key={contract.id} href={`/executive/${contract.id}`} className="grid grid-cols-1 gap-2.5 border-b border-line-soft px-4 py-3.5 last:border-b-0 transition-colors hover:bg-raised/60 md:grid-cols-[minmax(220px,1.3fr)_120px_minmax(180px,1fr)_140px] md:items-center"><div><div className="font-semibold text-brand-ink">№ {contract.number}{contract.cipher ? ` · ${contract.cipher}` : ''}</div><div className="mt-[2px] text-xs text-muted">{contract.contractor.name}</div></div><div className="text-xs text-muted">{CONTRACT_KIND_LABEL[contract.kind]}</div><div><div className="mb-[5px] flex justify-between text-xs text-muted"><span>{contract.kind === 'PROJECT' ? 'Не требуется' : `${item.ready} из ${item.required} разделов · ${item.files} файлов`}</span><span>{item.percent}%</span></div><ProgressBar percent={item.percent} tone={item.isReady ? 'ok' : item.files ? 'warn' : 'danger'} height={6} /></div><Chip tone={contract.kind === 'PROJECT' ? 'off' : item.isReady ? 'ok' : item.files ? 'warn' : 'danger'}>{contract.kind === 'PROJECT' ? 'Не требуется' : item.isReady ? 'Комплект готов' : item.files ? 'Нужно проверить' : 'Нет файлов'}</Chip></Link> })}</div>}</Card>
			{pageCount > 1 && <div className="mt-[14px] flex justify-end gap-2">{page > 1 && <Link href={`/executive?page=${page - 1}${filter ? `&filter=${filter}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="rounded-tight border border-line px-3 py-1.5 text-sm">← Назад</Link>}{page < pageCount && <Link href={`/executive?page=${page + 1}${filter ? `&filter=${filter}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="rounded-tight border border-line px-3 py-1.5 text-sm">Дальше →</Link>}</div>}
		</div>
	</>
}
