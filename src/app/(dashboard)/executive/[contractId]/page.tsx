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
		<div className="workspace-content px-[26px] py-[22px]">
			<div className="mb-[18px] flex flex-wrap items-end justify-between gap-[12px]"><div><div className="flex items-center gap-[9px]"><h1 className="text-[26px] font-bold">Договор {contract.number}</h1><Chip tone={percent === 100 ? 'ok' : 'warn'}>{percent}%</Chip></div><p className="mt-[5px] text-[13px] text-muted">{contract.contractor.name}{contract.cipher ? ` · ${contract.cipher}` : ''}</p></div><div className="flex gap-[8px]"><Link href="/executive" className="inline-flex h-[38px] items-center rounded-[10px] border border-line px-[14px] text-[13px] font-semibold">← К списку</Link><Link href={`/contracts/${contract.id}`} className="inline-flex h-[38px] items-center rounded-[10px] border border-line px-[14px] text-[13px] font-semibold">← К договору №{contract.number}</Link><a href={`/api/contracts/${contract.id}/download`} className="inline-flex h-[38px] items-center rounded-[10px] border border-line px-[14px] text-[13px] font-semibold">Скачать комплект</a><Link href={`/contracts/${contract.id}/upload`} className="brand-gradient inline-flex h-[38px] items-center rounded-[10px] px-[14px] text-[13px] font-semibold text-white">+ Загрузить документ</Link></div></div>

			<div className="mb-[16px] grid grid-cols-1 gap-[14px] xl:grid-cols-[minmax(0,1fr)_280px]"><Card className="p-[18px]"><div className="grid grid-cols-1 gap-x-[28px] gap-y-[10px] text-[12.5px] sm:grid-cols-2"><div><span className="text-muted">Контрагент</span><div className="mt-[2px] font-semibold">{contract.contractor.name}</div></div><div><span className="text-muted">Шифр</span><div className="mt-[2px] font-semibold">{contract.cipher ?? '—'}</div></div><div><span className="text-muted">Адрес объекта</span><div className="mt-[2px] font-semibold">{contract.objectAddress ?? '—'}</div></div><div><span className="text-muted">Тип договора</span><div className="mt-[2px] font-semibold">{CONTRACT_KIND_LABEL[contract.kind]}</div></div></div></Card><Card className="p-[18px]"><div className="flex items-center justify-between"><div className="text-[13px] font-semibold">Готовность комплекта</div><b className="text-brand-ink">{percent}%</b></div><div className="mt-[12px]"><ProgressBar percent={percent} tone={percent === 100 ? 'ok' : 'warn'} /></div><div className="mt-[10px] text-[11.5px] text-muted">Готово {ready} · В процессе {inProgress} · Файлов {contract._count.documents}</div></Card></div>

			<div className="mb-[13px] flex items-center justify-between"><h2 className="text-[16px] font-bold">Исполнительная документация</h2>{(canWrite(user) || user.role === 'BUILDER') && contract.kind !== 'PROJECT' && <form action={initialize}><button className="rounded-[9px] border border-brand/30 bg-brand/10 px-[13px] py-[7px] text-[12px] font-semibold text-brand-ink">Обновить обязательный комплект</button></form>}</div>
			{contract.kind === 'PROJECT' ? <Card><EmptyState text="Для проектного договора исполнительная документация не требуется" /></Card> : contract.executiveDocs.length === 0 ? <Card><EmptyState text="Нажмите «Обновить обязательный комплект»" /></Card> : <div className="grid grid-cols-1 gap-[14px] md:grid-cols-2 xl:grid-cols-3">{contract.executiveDocs.map((doc, index) => <Card key={doc.id} className="overflow-hidden"><div className="flex items-center gap-[10px] border-b border-line-soft px-[15px] py-[13px]"><div className={`grid h-[32px] w-[32px] place-items-center rounded-[8px] text-[10px] font-bold ${index % 3 === 0 ? 'bg-[#e8f6ed] text-[#1e7a45]' : index % 3 === 1 ? 'bg-[#fdecec] text-[#c0392b]' : 'bg-brand-soft text-brand-ink'}`}>ИД</div><div className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{doc.name}</div><ExecStatusChip status={doc.status} /></div><div className="min-h-[106px] p-[12px]">{doc.documents.length === 0 ? <div className="py-[14px] text-center text-[11.5px] text-faint">Файлы пока не загружены</div> : <div className="flex flex-col gap-[5px]">{doc.documents.slice(0, 4).map((file) => <Link key={file.id} href={`/documents/${file.id}`} className="flex items-center gap-[7px] rounded-[7px] px-[6px] py-[5px] text-[11.5px] hover:bg-raised"><span className="min-w-0 flex-1 truncate font-medium">{file.fileName}</span><span className="flex-none text-[10px] text-faint">{formatBytes(file.sizeBytes)}</span></Link>)}</div>}<Link href={`/contracts/${contract.id}/upload?executive=${doc.id}`} className="mt-[8px] inline-flex text-[11.5px] font-semibold text-brand-ink hover:underline">+ Добавить файл в раздел</Link></div>{(canWrite(user) || user.role === 'BUILDER') && <form action={updateStatus} className="flex items-center gap-[7px] border-t border-line-soft bg-raised/40 px-[12px] py-[10px]"><input type="hidden" name="id" value={doc.id} /><select name="status" defaultValue={doc.status} className="h-[32px] min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-[8px] text-[11px]"><option value="NOT_READY">Не готов</option><option value="IN_PROGRESS">В процессе</option><option value="READY">Готов</option></select><button className="h-[32px] rounded-[8px] bg-brand px-[10px] text-[11px] font-semibold text-white">Сохранить</button></form>}</Card>)}</div>}
		</div></>
}
