import { redirect } from 'next/navigation'
import Topbar from '@/components/Topbar'
import DocumentRulesSettings from '@/components/DocumentRulesSettings'
import { isAdmin, requireUser } from '@/lib/access'
import { initials } from '@/lib/format'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function DocumentRulesPage() {
	const user = await requireUser()
	if (!isAdmin(user)) redirect('/')
	const rules = await prisma.documentRouteRule.findMany({ orderBy: [{ target: 'asc' }, { sortOrder: 'asc' }] })
	const name = user.name ?? user.email ?? ''
	return <><Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Настройки', href: '/settings' }, { label: 'Правила документов' }]} userName={name.split(' ')[0]} initials={initials(name)} /><div className="workspace-content"><div className="mb-4"><h1 className="text-2xl font-bold">Правила раскладки документов</h1><p className="mt-1 text-sm text-muted">Шаблоны применяются по порядку; выключенные правила пропускаются.</p></div><DocumentRulesSettings initialRules={rules} /></div></>
}
