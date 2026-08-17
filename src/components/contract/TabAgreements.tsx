import Link from 'next/link'
import { Card, CardHeader, EmptyState } from '@/components/ui'
import { formatDate, formatMoney } from '@/lib/format'
import { agreementTitle, estimateTitle, type ContractWithRelations } from './shared'

export default function TabAgreements({
	contract,
	canEdit,
	canSeeAmounts,
}: {
	contract: ContractWithRelations
	canEdit: boolean
	canSeeAmounts: boolean
}) {
	return (
		<Card id="agreements" hidden role="tabpanel" aria-labelledby="tab-agreements">
			<CardHeader
				title="Дополнительные соглашения"
				extra={
					canEdit ? (
						<span className="flex items-center gap-3 text-sm">
							<Link href={`/contracts/${contract.id}/agreements/new`} className="text-brand-ink hover:underline">
								+ ДС
							</Link>
							<Link href={`/contracts/${contract.id}/estimates/new`} className="text-brand-ink hover:underline">
								+ Смета
							</Link>
							<span className="text-muted">{contract.agreements.length}</span>
						</span>
					) : (
						contract.agreements.length || undefined
					)
				}
			/>
			{contract.agreements.length === 0 ? (
				<EmptyState text="Доп. соглашений нет" />
			) : (
				<div className="px-2.5 py-1.5">
					{contract.agreements.map((a) => {
						const est = a.estimates[0]
						return (
							<div key={a.id} className="flex items-center gap-2.5 rounded-control px-2 py-2 hover:bg-raised">
								<div className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-brand-soft text-2xs font-bold text-brand-ink">
									ДС
								</div>
								<div className="min-w-0">
									<div className="truncate text-base font-medium">
										{agreementTitle(a.number)}
									</div>
									<div className="mt-[2px] text-xs text-faint">
										{est
									? `${estimateTitle(est.number)}${canSeeAmounts && est.amount != null ? ` · ${formatMoney(est.amount)}` : ''}`
											: 'Без сметы'}
									</div>
								</div>
								<div className="tnum ml-auto text-xs text-faint">{formatDate(a.date)}</div>
							</div>
						)
					})}
				</div>
			)}
		</Card>
	)
}
