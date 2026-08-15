import Link from 'next/link'
import { redirect } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { Card, Chip } from '@/components/ui'
import { requireUser } from '@/lib/access'
import { formatDate, initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const TYPE = {
  INFO: { label: 'Событие', tone: 'off' as const },
  ASSIGNMENT: { label: 'Назначение', tone: 'brand' as const },
  DEADLINE: { label: 'Срок', tone: 'warn' as const },
  READY: { label: 'Готово', tone: 'ok' as const },
  WARNING: { label: 'Внимание', tone: 'danger' as const },
}

export default async function NotificationsPage() {
  const user = await requireUser()
  const items = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 200 })

  async function markAllRead() {
    'use server'
    const acting = await requireUser()
    await prisma.notification.updateMany({ where: { userId: acting.id, readAt: null }, data: { readAt: new Date() } })
    redirect('/notifications')
  }

  const name = user.name ?? user.email ?? ''
  return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Уведомления' }]} userName={name.split(' ')[0]} initials={initials(name)} />
    <div className="workspace-content px-[26px] py-[22px]">
      <div className="mb-[16px] flex items-end justify-between"><div><h1 className="text-[26px] font-bold">Уведомления</h1><p className="mt-1 text-[13px] text-muted">Назначения, сроки и важные изменения по работе</p></div>{items.some((item) => !item.readAt) && <form action={markAllRead}><button className="rounded-[9px] border border-line bg-surface px-4 py-2 text-[12px] font-semibold hover:bg-raised">Отметить всё прочитанным</button></form>}</div>
      <Card className="overflow-hidden">{items.length === 0 ? <div className="py-20 text-center text-[13px] text-faint">Уведомлений пока нет</div> : items.map((item) => { const meta = TYPE[item.type]; const content = <div className={`flex items-start gap-4 border-b border-line-soft px-5 py-4 last:border-0 ${item.readAt ? '' : 'bg-brand-soft/25'}`}><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-[13px] font-bold">{item.title}</span>{!item.readAt && <span className="h-2 w-2 rounded-full bg-brand" />}</div>{item.message && <p className="mt-1 text-[12px] text-muted">{item.message}</p>}<span className="mt-2 block text-[10.5px] text-faint">{formatDate(item.createdAt)}</span></div><Chip tone={meta.tone}>{meta.label}</Chip></div>; return item.href ? <Link key={item.id} href={item.href}>{content}</Link> : <div key={item.id}>{content}</div> })}</Card>
    </div></>
}
