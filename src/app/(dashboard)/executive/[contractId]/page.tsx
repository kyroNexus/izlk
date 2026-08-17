import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ExecStatus } from '@prisma/client'
import Topbar from '@/components/Topbar'
import { Card, Chip, EmptyState, ExecStatusChip, ProgressBar } from '@/components/ui'
import { canWrite, contractScope, requireUser } from '@/lib/access'
import { CONTRACT_KIND_LABEL, EXEC_TEMPLATES } from '@/lib/executive'
import { formatBytes, initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { closeAfterExecutiveDocsReady } from '@/lib/contract-workflow'

export default async function ExecutiveContractPage({ params }: { params: { contractId: string } }) {
	const user = await requireUser()
	const contract = await prisma.contract.findFirst({
		where: { id: params.contractId, ...contractScope(user) },
		select: { id: true, number: true, cipher: true, kind: true, objectAddress: true, contractor: { select: { name: true } }, executiveDocs: { where: { deletedAt: null }, orderBy: { name: 'asc' }, include: { documents: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } } } }, _count: { select: { documents: true } } },
	})
	if (!contract) redirect('/executive')

	async function initialize() {
		'use server'
		const acting = await requireUser(); if (!canWrite(acting) && acting.role !== 'BUILDER') redirect(`/executive/${params.contractId}`)
		const current = await prisma.contract.findFirst({ where: { id: params.contractId, ...contractScope(acting) }, select: { id: true, kind: true, executiveDocs: { where: { deletedAt: null }, select: { name: true } } } })
		if (!current) redirect('/executive')
		const existing = new Set(current.executiveDocs.map((doc) => doc.name))
		const missing = EXEC_TEMPLATES[current.kind].filter((name) => !existing.has(name))
		if (missing.length) await prisma.executiveDoc.createMany({ data: missing.map((name) => ({ contractId: current.id, name })) })
		redirect(`/executive/${current.id}`)
	}

	async function updateStatus(formData: FormData) {
		'use server'
		const acting = await requireUser(); if (!canWrite(acting) && acting.role !== 'BUILDER') redirect(`/executive/${params.contractId}`)
		const id = String(formData.get('id') ?? ''), status = String(formData.get('status') ?? '') as ExecStatus
		if (!['READY', 'IN_PROGRESS', 'NOT_READY'].includes(status)) redirect(`/executive/${params.contractId}`)
		const doc = await prisma.executiveDoc.findFirst({ where: { id, contractId: params.contractId, contract: contractScope(acting), deletedAt: null }, select: { id: true } })
		if (doc) {
			await prisma.executiveDoc.update({ where: { id: doc.id }, data: { status } })
			if (status === 'READY') await closeAfterExecutiveDocsReady({ contractId: params.contractId, actorId: acting.id })
		}
		redirect(`/executive/${params.contractId}`)
	}

	const ready = contract.executiveDocs.filter((doc) => doc.status === 'READY').length
	const inProgress = contract.executiveDocs.filter((doc) => doc.status === 'IN_PROGRESS').length
	const percent = contract.executiveDocs.length ? Math.round(ready / contract.executiveDocs.length * 100) : contract.kind === 'PROJECT' ? 100 : 0
	const name = user.name ?? user.email ?? ''
	return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Исполнительная документация', href: '/executive' }, { label: `Договор №${contract.number}` }]} userName={name.split(' ')[0]} initials={initials(name)} />
		<div className="workspace-content">
			<div className="mb-[18px] flex flex-wrap items-end justify-between gap-3"><div><div className="flex items-center gap-2"><h1 className="text-2xl font-bold">Договор {contract.number}</h1><Chip tone={percent === 100 ? 'ok' : 'warn'}>{percent}%</Chip></div><p className="mt-[5px] text-base text-muted">{contract.contractor.name}{contract.cipher ? ` · ${contract.cipher}` : ''}</p></div><div className="flex gap-2"><Link href="/executive" className="inline-flex h-control items-center rounded-control border border-line px-3.5 text-base font-semibold">← К списку</Link><Link href={`/contracts/${contract.id}`} className="inline-flex h-control items-center rounded-control border border-line px-3.5 text-base font-semibold">← К договору №{contract.number}</Link><a href={`/api/contracts/${contract.id}/download`} className="inline-flex h-control items-center rounded-control border border-line px-3.5 text-base font-semibold">Скачать комплект</a><Link href={`/contracts/${contract.id}/upload`} className="brand-gradient inline-flex h-control items-center rounded-control px-3.5 text-base font-semibold text-white">+ Загрузить документ</Link></div></div>

			<div className="mb-[16px] grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1fr)_280px]"><Card className="p-4"><div className="grid grid-cols-1 gap-x-[28px] gap-y-[10px] text-sm sm:grid-cols-2"><div><span className="text-muted">Контрагент</span><div className="mt-[2px] font-semibold">{contract.contractor.name}</div></div><div><span className="text-muted">Шифр</span><div className="mt-[2px] font-semibold">{contract.cipher ?? '—'}</div></div><div><span className="text-muted">Адрес объекта</span><div className="mt-[2px] font-semibold">{contract.objectAddress ?? '—'}</div></div><div><span className="text-muted">Тип договора</span><div className="mt-[2px] font-semibold">{CONTRACT_KIND_LABEL[contract.kind]}</div></div></div></Card><Card className="p-4"><div className="flex items-center justify-between"><div className="text-base font-semibold">Готовность комплекта</div><b className="text-brand-ink">{percent}%</b></div><div className="mt-[12px]"><ProgressBar percent={percent} tone={percent === 100 ? 'ok' : 'warn'} /></div><div className="mt-[10px] text-xs text-muted">Готово {ready} · В процессе {inProgress} · Файлов {contract._count.documents}</div></Card></div>

			<div className="mb-[13px] flex items-center justify-between"><h2 className="text-md font-bold">Исполнительная документация</h2>{(canWrite(user) || user.role === 'BUILDER') && contract.kind !== 'PROJECT' && <form action={initialize}><button className="rounded-tight border border-brand/30 bg-brand/10 px-3 py-1.5 text-sm font-semibold text-brand-ink">Обновить обязательный комплект</button></form>}</div>
			{contract.kind === 'PROJECT' ? <Card><EmptyState text="Для проектного договора исполнительная документация не требуется" /></Card> : contract.executiveDocs.length === 0 ? <Card><EmptyState text="Нажмите «Обновить обязательный комплект»" /></Card> : <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">{contract.executiveDocs.map((doc, index) => <Card key={doc.id} className="overflow-hidden"><div className="flex items-center gap-2.5 border-b border-line-soft px-3.5 py-3"><div className={`grid h-[32px] w-[32px] place-items-center rounded-tight text-2xs font-bold ${index % 3 === 0 ? 'bg-[#e8f6ed] text-[#1e7a45]' : index % 3 === 1 ? 'bg-[#fdecec] text-[#c0392b]' : 'bg-brand-soft text-brand-ink'}`}>ИД</div><div className="min-w-0 flex-1 truncate text-base font-bold">{doc.name}</div><ExecStatusChip status={doc.status} /></div><div className="min-h-[106px] p-3">{doc.documents.length === 0 ? <div className="py-3.5 text-center text-xs text-faint">Файлы пока не загружены</div> : <div className="flex flex-col gap-1">{doc.documents.slice(0, 4).map((file) => <Link key={file.id} href={`/documents/${file.id}`} className="flex items-center gap-1.5 rounded-tight px-1.5 py-1 text-xs hover:bg-raised"><span className="min-w-0 flex-1 truncate font-medium">{file.fileName}</span><span className="flex-none text-2xs text-faint">{formatBytes(file.sizeBytes)}</span></Link>)}</div>}<Link href={`/contracts/${contract.id}/upload?executive=${doc.id}`} className="mt-[8px] inline-flex text-xs font-semibold text-brand-ink hover:underline">+ Добавить файл в раздел</Link></div>{(canWrite(user) || user.role === 'BUILDER') && <form action={updateStatus} className="flex items-center gap-1.5 border-t border-line-soft bg-raised/40 px-3 py-2.5"><input type="hidden" name="id" value={doc.id} /><select name="status" defaultValue={doc.status} className="h-[32px] min-w-0 flex-1 rounded-tight border border-line bg-surface px-2 text-xs"><option value="NOT_READY">Не готов</option><option value="IN_PROGRESS">В процессе</option><option value="READY">Готов</option></select><button className="h-[32px] rounded-tight bg-brand px-2.5 text-xs font-semibold text-white">Сохранить</button></form>}</Card>)}</div>}
		</div></>
}
