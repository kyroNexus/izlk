import Link from 'next/link'
import { redirect } from 'next/navigation'
import Topbar from '@/components/Topbar'
import { Card, CardHeader, Chip, EmptyState, KeyValue, StatusChip } from '@/components/ui'
import { canSeeAmounts, canWrite, contractScope, requireUser } from '@/lib/access'
import { CONTRACTOR_TYPE_LABELS, formatDate, formatMoney, initials } from '@/lib/format'
import { WORKFLOW_STAGE_LABEL } from '@/lib/contract-workflow'
import { prisma } from '@/lib/prisma'

const WORKFLOW_STEPS = ['CONTRACT_PREPARATION', 'AWAITING_CONTRACT_SIGNATURE', 'PR1_DEVELOPMENT', 'AWAITING_PR1_SIGNATURE', 'DESIGN', 'WAITING_PRODUCTION', 'PRODUCTION', 'AWAITING_SHIPMENT', 'INSTALL_KZH', 'INSTALL_KM', 'CLOSED'] as const

function workflowProgress(stage: string) {
	const index = WORKFLOW_STEPS.indexOf(stage as (typeof WORKFLOW_STEPS)[number])
	return index < 0 ? 0 : Math.round((index / (WORKFLOW_STEPS.length - 1)) * 100)
}

function workflowTone(stage: string): 'ok' | 'warn' | 'off' | 'brand' {
	if (stage === 'CLOSED') return 'ok'
	if (['INSTALL_KZH', 'INSTALL_KM', 'PRODUCTION'].includes(stage)) return 'warn'
	if (stage === 'DESIGN') return 'brand'
	return 'off'
}

export default async function ContractorPage({ params, searchParams }: { params: { id: string }; searchParams: { from?: string } }) {
	const user = await requireUser()
	const contractor = await prisma.contractor.findFirst({
		where: { id: params.id, deletedAt: null, ...(user.role === 'ADMIN' ? {} : { contracts: { some: contractScope(user) } }) },
		select: {
			id: true, name: true, aliases: true, type: true, inn: true, address: true, phone: true, email: true,
			snils: true, passportSeries: true, passportNumber: true, passportIssuedBy: true, passportIssuedAt: true, passportDeptCode: true,
			contracts: {
				where: contractScope(user), orderBy: { date: 'desc' }, take: 100,
				select: { id: true, number: true, cipher: true, date: true, amount: true, currency: true, status: true, workflowStage: true, objectAddress: true },
			},
		},
	})
	if (!contractor) redirect('/contractors')
	// Ссылка "назад к договору" должна называть договор по номеру, а не общей фразой —
	// иначе на карточке контрагента непонятно, куда именно вернёшься.
	const fromContract = searchParams.from
		? await prisma.contract.findFirst({ where: { id: searchParams.from, ...contractScope(user) }, select: { id: true, number: true } })
		: null
	const active = contractor.contracts.filter((contract) => contract.status === 'ACTIVE')
	const completed = contractor.contracts.filter((contract) => contract.status !== 'ACTIVE')
	const name = user.name ?? user.email ?? ''

	const contractTable = (items: typeof contractor.contracts, empty: string) => items.length === 0 ? <EmptyState text={empty} /> : (
		<div className="overflow-x-auto"><table className="w-full border-collapse text-[12.5px]"><thead><tr className="bg-raised text-left text-[10.5px] uppercase tracking-[0.06em] text-muted"><th className="px-[18px] py-[10px]">Договор</th><th className="px-[10px] py-[10px]">Шифр / объект</th><th className="px-[10px] py-[10px]">Дата</th>{canSeeAmounts(user) && <th className="px-[10px] py-[10px] text-right">Сумма</th>}<th className="px-[18px] py-[10px]">Статус</th></tr></thead><tbody>{items.map((contract) => <tr key={contract.id} className="border-t border-line-soft hover:bg-raised/60"><td className="px-[18px] py-[12px]"><Link href={`/contracts/${contract.id}`} className="font-semibold text-brand-ink hover:underline">№ {contract.number}</Link></td><td className="px-[10px] py-[12px]"><div className="font-medium">{contract.cipher ?? '—'}</div><div className="mt-[2px] text-[11.5px] text-muted">{contract.objectAddress ?? 'Адрес не указан'}</div></td><td className="tnum px-[10px] py-[12px] text-muted">{formatDate(contract.date)}</td>{canSeeAmounts(user) && <td className="tnum px-[10px] py-[12px] text-right font-semibold">{formatMoney(contract.amount, contract.currency)}</td>}<td className="px-[18px] py-[12px]"><StatusChip status={contract.status} /></td></tr>)}</tbody></table></div>
	)

	const contractTableWithFlow = (items: typeof contractor.contracts, empty: string) => items.length === 0 ? <EmptyState text={empty} /> : (
		<div className="divide-y divide-line-soft">
			{items.map((contract) => {
				const percent = workflowProgress(contract.workflowStage)
				return <div key={contract.id} className="flex flex-col gap-[10px] px-[18px] py-[14px] transition-colors hover:bg-raised/50 sm:flex-row sm:items-center">
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 flex-wrap items-center gap-[8px]">
							<Link href={`/contracts/${contract.id}`} className="font-semibold text-brand-ink hover:underline">{`\u0414\u043e\u0433\u043e\u0432\u043e\u0440 \u2116${contract.number}`}</Link>
							<Chip tone={workflowTone(contract.workflowStage)}>{WORKFLOW_STAGE_LABEL[contract.workflowStage]}</Chip>
						</div>
						<div className="mt-[5px] flex min-w-0 flex-wrap gap-x-[14px] gap-y-[3px] text-[11.5px] text-muted">
							<span>{contract.cipher ?? '\u0428\u0438\u0444\u0440 \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d'}</span>
							<span className="truncate">{contract.objectAddress ?? '\u0410\u0434\u0440\u0435\u0441 \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d'}</span>
							<span className="tnum">{formatDate(contract.date)}</span>
						</div>
					</div>
					<div className="w-full sm:w-[180px]">
						<div className="mb-[5px] flex items-center justify-between text-[10.5px] text-muted"><span>{`\u0413\u043e\u0442\u043e\u0432\u043d\u043e\u0441\u0442\u044c \u044d\u0442\u0430\u043f\u043e\u0432`}</span><span className="tnum font-semibold text-ink">{percent}%</span></div>
						<div className="h-[6px] overflow-hidden rounded-full bg-off-bg"><div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} /></div>
					</div>
					{canSeeAmounts(user) && <div className="tnum whitespace-nowrap text-right text-[12.5px] font-semibold sm:w-[132px]">{formatMoney(contract.amount, contract.currency)}</div>}
				</div>
			})}
		</div>
	)

	return <>
		<Topbar crumbs={[{ label: 'Главная', href: '/' }, { label: 'Контрагенты', href: '/contractors' }, { label: contractor.name }]} userName={name.split(' ')[0]} initials={initials(name)} />
		<div className="px-[26px] py-[22px]">
			<div className="mb-[18px] flex flex-wrap items-end justify-between gap-[12px]"><div><div className="mb-[6px] flex items-center gap-[9px]"><h1 className="text-[26px] font-bold tracking-[-0.02em]">{contractor.name}</h1><Chip tone={contractor.type === 'INDIVIDUAL' ? 'off' : 'brand'} dot={false}>{CONTRACTOR_TYPE_LABELS[contractor.type]}</Chip><Chip tone="brand" dot={false}>{active.length} активных</Chip></div><p className="text-[13px] text-muted">Карточка заказчика и история договоров</p></div><div className="flex flex-wrap gap-[9px]">{fromContract && <Link href={`/contracts/${fromContract.id}`} className="inline-flex h-[38px] items-center rounded-[10px] border border-line bg-surface px-[15px] text-[13.5px] font-semibold hover:bg-raised">← К договору №{fromContract.number}</Link>}{canWrite(user) && <><Link href={`/contracts/new?contractor=${contractor.id}`} className="brand-gradient inline-flex h-[38px] items-center rounded-[10px] px-[15px] text-[13.5px] font-semibold text-white">+ Новый договор</Link><Link href={`/contractors/${contractor.id}/edit`} className="inline-flex h-[38px] items-center rounded-[10px] border border-line bg-surface px-[15px] text-[13.5px] font-semibold hover:bg-raised">Редактировать</Link></>}</div></div>
			<div className="grid grid-cols-1 gap-[14px] xl:grid-cols-3"><Card><CardHeader title="Реквизиты" /><div className="px-[18px] py-[8px]"><KeyValue label="ИНН" value={contractor.inn ?? '—'} mono /><KeyValue label="Телефон" value={contractor.phone ?? '—'} /><KeyValue label="Email" value={contractor.email ? <a href={`mailto:${contractor.email}`} className="text-brand-ink hover:underline">{contractor.email}</a> : '—'} /><KeyValue label="Адрес" value={contractor.address ? <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(contractor.address)}`} target="_blank" rel="noreferrer" className="text-brand-ink hover:underline">{contractor.address}</a> : '—'} />{contractor.type === 'INDIVIDUAL' && <><KeyValue label="СНИЛС" value={contractor.snils ?? '—'} mono /><KeyValue label="Паспорт" value={contractor.passportSeries || contractor.passportNumber ? `${contractor.passportSeries ?? ''} ${contractor.passportNumber ?? ''}`.trim() : '—'} mono /><KeyValue label="Кем выдан" value={contractor.passportIssuedBy ?? '—'} /><KeyValue label="Дата выдачи" value={contractor.passportIssuedAt ? formatDate(contractor.passportIssuedAt) : '—'} /><KeyValue label="Код подразделения" value={contractor.passportDeptCode ?? '—'} mono /></>}</div></Card><Card className="xl:col-span-2"><CardHeader title="Варианты названия" extra="используются в поиске" /><div className="flex flex-wrap gap-[7px] p-[18px]">{contractor.aliases.length ? contractor.aliases.map((alias) => <Chip key={alias} tone="off">{alias}</Chip>) : <span className="text-[13px] text-faint">Альтернативные названия не добавлены</span>}</div></Card></div>
			<div className="mt-[14px] flex flex-col gap-[14px]"><Card><CardHeader title="Действующие договоры" extra={`${active.length}`} />{contractTableWithFlow(active, 'Действующих договоров нет')}</Card><Card><CardHeader title="Закрытые и архивные договоры" extra={`${completed.length}`} />{contractTableWithFlow(completed, 'Закрытых договоров пока нет')}</Card></div>
		</div>
	</>
}
