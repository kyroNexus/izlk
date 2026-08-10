import Link from 'next/link'
import Topbar from '@/components/Topbar'
import { Card, Chip } from '@/components/ui'
import { canWrite, contractScope, requireUser } from '@/lib/access'
import { initials, plural } from '@/lib/format'
import { prisma } from '@/lib/prisma'

const PAGE_SIZE = 50

export default async function ContractorsPage({ searchParams }: { searchParams: { q?: string; page?: string } }) {
	const user = await requireUser()
	const q = (searchParams.q ?? '').trim()
	const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
	const scope = contractScope(user)
	const where = {
		deletedAt: null,
		...(user.role === 'ADMIN' ? {} : { contracts: { some: scope } }),
		...(q ? { OR: [
			{ name: { contains: q, mode: 'insensitive' as const } },
			{ aliases: { has: q } },
			{ inn: { contains: q, mode: 'insensitive' as const } },
			{ phone: { contains: q, mode: 'insensitive' as const } },
			{ email: { contains: q, mode: 'insensitive' as const } },
		] } : {}),
	}
	const [contractors, total] = await Promise.all([
		prisma.contractor.findMany({
			where,
			include: { _count: { select: { contracts: { where: scope } } } },
			orderBy: { name: 'asc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
		}),
		prisma.contractor.count({ where }),
	])
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
	const name = user.name ?? user.email ?? ''
	const pageHref = (target: number) => `/contractors?page=${target}${q ? `&q=${encodeURIComponent(q)}` : ''}`

	return <>
		<Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Контрагенты' }]} userName={name.split(' ')[0]} initials={initials(name)} />
		<div className="px-[26px] py-[22px]">
			<div className="mb-[18px] flex flex-wrap items-end justify-between gap-[12px]"><div><h1 className="text-[26px] font-bold tracking-[-0.02em]">Контрагенты</h1><p className="mt-[5px] text-[13px] text-muted">{plural(total, 'контрагент', 'контрагента', 'контрагентов')} в доступном реестре</p></div>{canWrite(user) && <Link href="/contractors/new" className="brand-gradient inline-flex h-[40px] items-center rounded-[10px] px-[17px] text-[13.5px] font-semibold text-white">+ Новый контрагент</Link>}</div>
			<form method="get" className="mb-[16px] flex max-w-[680px] gap-[8px]"><input name="q" defaultValue={q} placeholder="Название, другое имя, ИНН, телефон или email" className="h-[40px] flex-1 rounded-[10px] border border-line bg-surface px-[13px] text-[13px] outline-none focus:border-brand focus:ring-[3px] focus:ring-brand/20" /><button className="inline-flex h-[40px] items-center rounded-[10px] border border-line bg-surface px-[16px] text-[13px] font-semibold hover:bg-raised">Найти</button>{q && <Link href="/contractors" className="inline-flex h-[40px] items-center rounded-[10px] px-[10px] text-[13px] text-muted hover:text-ink">Сбросить</Link>}</form>
			<Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full border-collapse"><thead><tr className="bg-raised"><th className="px-[18px] py-[11px] text-left text-[10.5px] uppercase tracking-[0.06em] text-muted">Название</th><th className="px-[18px] py-[11px] text-left text-[10.5px] uppercase tracking-[0.06em] text-muted">ИНН</th><th className="px-[18px] py-[11px] text-left text-[10.5px] uppercase tracking-[0.06em] text-muted">Контакты</th><th className="px-[18px] py-[11px] text-right text-[10.5px] uppercase tracking-[0.06em] text-muted">Договоры</th></tr></thead><tbody>
				{contractors.map((contractor) => <tr key={contractor.id} className="border-t border-line-soft hover:bg-raised/60"><td className="px-[18px] py-[13px]"><Link href={`/contractors/${contractor.id}`} className="text-[13.5px] font-semibold text-brand-ink hover:underline">{contractor.name}</Link>{contractor.aliases.length > 0 && <div className="mt-[3px] max-w-[420px] truncate text-[11.5px] text-faint">Также: {contractor.aliases.join(', ')}</div>}</td><td className="tnum px-[18px] py-[13px] text-[13px] text-muted">{contractor.inn ?? '—'}</td><td className="px-[18px] py-[13px] text-[12.5px] text-muted"><div>{contractor.phone ?? '—'}</div><div className="text-faint">{contractor.email ?? ''}</div></td><td className="px-[18px] py-[13px] text-right"><Chip tone={contractor._count.contracts ? 'brand' : 'off'} dot={false}>{contractor._count.contracts}</Chip></td></tr>)}
				{contractors.length === 0 && <tr><td colSpan={4} className="px-[18px] py-12 text-center text-[13px] text-faint">Ничего не найдено. Проверьте запрос или создайте нового контрагента.</td></tr>}
			</tbody></table></div></Card>
			{pageCount > 1 && <div className="mt-[14px] flex items-center justify-between text-[12.5px] text-muted"><span>Страница {page} из {pageCount}</span><div className="flex gap-[8px]">{page > 1 && <Link href={pageHref(page - 1)} className="rounded-[9px] border border-line bg-surface px-[13px] py-[7px] hover:bg-raised">← Назад</Link>}{page < pageCount && <Link href={pageHref(page + 1)} className="rounded-[9px] border border-line bg-surface px-[13px] py-[7px] hover:bg-raised">Дальше →</Link>}</div></div>}
		</div>
	</>
}
