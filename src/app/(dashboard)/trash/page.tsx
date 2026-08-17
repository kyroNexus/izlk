import { redirect } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { Card, EmptyState } from '@/components/ui'
import { isAdmin, requireUser } from '@/lib/access'
import { formatDateTime, initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'
import { writeAudit } from '@/lib/audit'
import { permanentlyDeleteContract, permanentlyDeleteDocument } from '@/lib/trash'

const expiration = (date: Date) => new Date(date.getTime() + 30 * 86400000)

export default async function TrashPage() {
  const user = await requireUser()
  if (!isAdmin(user)) redirect('/')
  const [contracts, documents] = await Promise.all([
    prisma.contract.findMany({ where: { deletedAt: { not: null } }, include: { contractor: { select: { name: true } } }, orderBy: { deletedAt: 'desc' }, take: 200 }),
    prisma.document.findMany({ where: { deletedAt: { not: null }, contract: { deletedAt: null } }, include: { contract: { select: { number: true } } }, orderBy: { deletedAt: 'desc' }, take: 300 }),
  ])
  async function restoreContract(form: FormData) { 'use server'; const actor = await requireUser(); if (!isAdmin(actor)) redirect('/'); const id = String(form.get('id') ?? ''); await prisma.contract.updateMany({ where: { id, deletedAt: { not: null } }, data: { deletedAt: null } }); await writeAudit({ userId: actor.id, action: 'UPDATE', entityType: 'ContractRestored', entityId: id }); redirect('/trash') }
  async function purgeContract(form: FormData) { 'use server'; const actor = await requireUser(); if (!isAdmin(actor)) redirect('/'); const id = String(form.get('id') ?? ''); if (await permanentlyDeleteContract(id)) await writeAudit({ userId: actor.id, action: 'DELETE', entityType: 'ContractPurged', entityId: id }); redirect('/trash') }
  async function restoreDocument(form: FormData) { 'use server'; const actor = await requireUser(); if (!isAdmin(actor)) redirect('/'); const id = String(form.get('id') ?? ''); await prisma.document.updateMany({ where: { id, deletedAt: { not: null } }, data: { deletedAt: null } }); await writeAudit({ userId: actor.id, action: 'UPDATE', entityType: 'DocumentRestored', entityId: id }); redirect('/trash') }
  async function purgeDocument(form: FormData) { 'use server'; const actor = await requireUser(); if (!isAdmin(actor)) redirect('/'); const id = String(form.get('id') ?? ''); if (await permanentlyDeleteDocument(id)) await writeAudit({ userId: actor.id, action: 'DELETE', entityType: 'DocumentPurged', entityId: id }); redirect('/trash') }
  const actions = (id: string, restore: (f: FormData) => Promise<void>, purge: (f: FormData) => Promise<void>) => <div className="flex gap-2"><form action={restore}><input type="hidden" name="id" value={id}/><button className="rounded-lg border border-ok/25 bg-ok-bg px-2.5 py-1.5 text-xs font-semibold text-ok">Вернуть</button></form><form action={purge}><input type="hidden" name="id" value={id}/><button className="rounded-lg border border-danger/25 bg-danger/10 px-2.5 py-1.5 text-xs font-semibold text-danger">Удалить навсегда</button></form></div>
  return <><Topbar crumbs={[{label:'Главная',href:'/'},{label:'Корзина'}]} userName={(user.name ?? '').split(' ')[0]} initials={initials(user.name ?? user.email ?? 'A')} /><div className="mx-auto max-w-[1120px] px-[26px] py-[22px]"><div className="mb-5"><h1 className="text-2xl font-bold tracking-[-.02em]">Корзина</h1><p className="mt-1 text-base text-muted">Записи хранятся 30 дней. «Удалить навсегда» убирает их только из системы: физические файлы на сервере не удаляются.</p></div><div className="grid gap-4 lg:grid-cols-2"><Card className="overflow-hidden"><div className="border-b border-line px-4 py-3 text-base font-bold">Договоры · {contracts.length}</div>{contracts.length ? contracts.map(item => <div className="border-b border-line-soft px-4 py-3 last:border-0" key={item.id}><div className="flex items-start justify-between gap-3"><div><b className="text-sm">№ {item.number}</b><div className="mt-1 text-xs text-muted">{item.contractor.name} · до {formatDateTime(expiration(item.deletedAt!))}</div></div>{actions(item.id, restoreContract, purgeContract)}</div></div>) : <EmptyState text="Удалённых договоров нет" />}</Card><Card className="overflow-hidden"><div className="border-b border-line px-4 py-3 text-base font-bold">Файлы · {documents.length}</div>{documents.length ? documents.map(item => <div className="border-b border-line-soft px-4 py-3 last:border-0" key={item.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="block truncate text-sm">{item.fileName}</b><div className="mt-1 text-xs text-muted">Договор № {item.contract.number} · до {formatDateTime(expiration(item.deletedAt!))}</div></div>{actions(item.id, restoreDocument, purgeDocument)}</div></div>) : <EmptyState text="Удалённых файлов нет" />}</Card></div></div></>
}
