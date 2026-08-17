import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import Topbar from '@/components/Topbar'
import { Card, Chip } from '@/components/ui'
import { initials, plural } from '@/lib/format'
import type { Prisma, SiteStatus } from '@prisma/client'
import { contractScope, requireUser } from '@/lib/access'
import SiteTableRow from './SiteTableRow'

const SITE_STATUS_META: Record<SiteStatus, { label: string; tone: 'ok' | 'warn' | 'off' | 'danger' }> = {
	READY: { label: '\u0413\u043e\u0442\u043e\u0432\u0430', tone: 'ok' },
	PREPARING: { label: '\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430', tone: 'off' },
	ISSUE: { label: '\u041f\u0440\u043e\u0431\u043b\u0435\u043c\u0430', tone: 'warn' },
	BLOCKED: { label: '\u0417\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d\u0430', tone: 'danger' },
}

const TABS: { key: string; label: string; status?: SiteStatus }[] = [
	{ key: 'all', label: '\u0412\u0441\u0435' },
	{ key: 'ready', label: '\u0413\u043e\u0442\u043e\u0432\u044b\u0435', status: 'READY' },
	{ key: 'preparing', label: '\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430', status: 'PREPARING' },
	{ key: 'issue', label: '\u041f\u0440\u043e\u0431\u043b\u0435\u043c\u043d\u044b\u0435', status: 'ISSUE' },
	{ key: 'blocked', label: '\u0417\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0435', status: 'BLOCKED' },
]

// В Next.js 14 searchParams — ОБЫЧНЫЙ объект, не Promise. Не добавляйте await.
export default async function SitesPage({
	searchParams,
}: {
	searchParams: { tab?: string }
}) {
	const user = await requireUser()

	const tabKey = searchParams.tab ?? 'all'
	const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0]

	const where: Prisma.SiteWhereInput = {
		...(tab.status ? { status: tab.status } : {}),
		contract: { ...contractScope(user), pr1ConfirmedAt: { not: null } },
	}

	const [sites, statusRows] = await Promise.all([
		prisma.site.findMany({
			where,
			include: { contract: { select: { id: true, number: true, cipher: true, contractor: { select: { name: true } } } } },
			orderBy: { address: 'asc' },
			take: 300,
		}),
		prisma.site.findMany({ where: { contract: { ...contractScope(user), pr1ConfirmedAt: { not: null } } }, select: { status: true }, take: 1000 }),
	])
	const statusCount = (status?: SiteStatus) => status ? statusRows.filter((site) => site.status === status).length : statusRows.length

	const name = user.name ?? user.email ?? ''

	return (
		<>
			<Topbar
				crumbs={[{ label: '\u0413\u043b\u0430\u0432\u043d\u0430\u044f', href: '/' }, { label: '\u041f\u043b\u043e\u0449\u0430\u0434\u043a\u0438' }]}
				userName={name.split(' ')[0]}
				initials={initials(name)}
			/>

			<div className="workspace-content">
				<div className="work-hero mb-[20px] px-5 py-4">
					<div>
					<h1 className="text-2xl font-bold tracking-[-0.02em]">
						{'\u041f\u043b\u043e\u0449\u0430\u0434\u043a\u0438'}
					</h1>
					<div className="mt-[5px] text-base text-muted">
						{'\u041f\u043e\u044f\u0432\u043b\u044f\u044e\u0442\u0441\u044f \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u043f\u043e\u0441\u043b\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u043f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u043d\u043e\u0433\u043e \u041f\u04201. \u041d\u0430\u0439\u0434\u0435\u043d\u043e '}
						{plural(sites.length, '\u043f\u043b\u043e\u0449\u0430\u0434\u043a\u0430', '\u043f\u043b\u043e\u0449\u0430\u0434\u043a\u0438', '\u043f\u043b\u043e\u0449\u0430\u0434\u043e\u043a')}
					</div>
				</div>
				</div>

				<div className="work-toolbar mb-[16px] flex max-w-full flex-wrap gap-1 p-1">
					{TABS.map((t) => (
						<Link
							key={t.key}
							href={t.key === 'all' ? '/sites' : `/sites?tab=${t.key}`}
							className={`rounded-tight px-3 py-1.5 text-sm font-medium transition-colors ${
								t.key === tabKey ? 'brand-gradient text-white' : 'text-muted hover:text-ink'
							}`}
						>
							<span>{t.label}</span><span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-2xs ${t.key === tabKey ? 'bg-white/20 text-white' : 'bg-surface text-faint'}`}>{statusCount(t.status)}</span>
						</Link>
					))}
				</div>

				<Card className="overflow-hidden shadow-[0_14px_34px_rgba(25,22,45,.055)]">
					<div className="max-w-full overflow-x-auto">
					<table className="min-w-[580px] w-full border-collapse">
						<thead>
							<tr className="bg-raised">
								<th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted">
									{'\u0414\u043e\u0433\u043e\u0432\u043e\u0440'}
								</th>
								<th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted">
									{'\u041a\u043e\u043d\u0442\u0440\u0430\u0433\u0435\u043d\u0442'}
								</th>
								<th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted">
									{'\u0410\u0434\u0440\u0435\u0441 \u043f\u043b\u043e\u0449\u0430\u0434\u043a\u0438'}
								</th>
								<th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted">
									{'\u0421\u0442\u0430\u0442\u0443\u0441'}
								</th>
							</tr>
						</thead>
						<tbody>
							{sites.map((s) => (
								<SiteTableRow key={s.id} siteId={s.id}>
									<td className="px-4 py-3">
										<span className="text-base font-semibold text-brand-ink">{s.contract.number}</span>
										<div className="mt-[2px] text-xs text-faint">{s.contract.cipher ?? 'Без шифра'}</div>
									</td>
									<td className="px-4 py-3 text-base text-muted">{s.contract.contractor.name}</td>
									<td className="px-4 py-3 text-base">{s.address}</td>
									<td className="px-4 py-3">
										<Chip tone={SITE_STATUS_META[s.status].tone}>{SITE_STATUS_META[s.status].label}</Chip>
									</td>
								</SiteTableRow>
							))}
							{sites.length === 0 && (
								<tr>
									<td colSpan={4} className="px-4 py-10 text-center text-base text-faint">
										{'\u041f\u043b\u043e\u0449\u0430\u0434\u043a\u0438 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u044b'}
									</td>
								</tr>
							)}
						</tbody>
					</table>
					</div>
				</Card>
			</div>
		</>
	)
}
