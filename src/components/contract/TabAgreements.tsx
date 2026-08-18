import Link from 'next/link'
import { Card, CardHeader, EmptyState } from '@/components/ui'
import { formatBytes, formatDate, formatMoney } from '@/lib/format'
import { agreementTitle, estimateTitle, type ContractWithRelations } from './shared'
import InlineDocumentUpload from './InlineDocumentUpload'

const INVOICE_STATUS_LABEL: Record<string, string> = {
	UNPAID: 'Не оплачен',
	PARTIALLY_PAID: 'Частично оплачен',
	PAID: 'Оплачен',
	OVERDUE: 'Просрочен',
	CANCELLED: 'Отменён',
}

export default function TabAgreements({
	contract,
	canEdit,
	canEditInvoices,
	canSeeAmounts,
}: {
	contract: ContractWithRelations
	canEdit: boolean
	/** Задача C2: у ACCOUNTING нет canEdit (canWrite — только ADMIN/MANAGER),
	 *  но работа со счетами — её прямая задача, поэтому отдельный флаг. */
	canEditInvoices: boolean
	canSeeAmounts: boolean
}) {
	// Оба Card ниже — один таб-панель "agreements": ContractSectionNav
	// переключает видимость по document.getElementById(section.id), то есть
	// РОВНО по одному элементу на id. Разместить id/hidden/role на каждом
	// Card по отдельности означало бы, что второй (Счета) никогда не
	// покажется — переключатель о нём просто не знает.
	return (
		<div id="agreements" hidden role="tabpanel" aria-labelledby="tab-agreements" className="flex flex-col gap-3.5">
			<Card>
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
				{canEdit && <div className="border-b border-line-soft px-3 py-3"><InlineDocumentUpload contractId={contract.id} extraFields={{ kind: 'AGREEMENT' }} /></div>}
				{contract.agreements.length === 0 ? (
					<EmptyState text="Доп. соглашений нет" />
				) : (
					<div className="px-2.5 py-1.5">
						{contract.agreements.map((a) => {
							const est = a.estimates[0]
							// Задача C2: скан ДС — обычный Document со связью agreementId,
							// не отдельная сущность файлов — та же таблица, что и у всех
							// остальных документов договора.
							const scans = contract.documents.filter((document) => document.agreementId === a.id)
							return (
								<div key={a.id} className="flex flex-col gap-1.5 rounded-control px-2 py-2 hover:bg-raised">
									<div className="flex items-center gap-2.5">
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
									{scans.length > 0 && (
										<div className="ml-[42px] flex flex-wrap items-center gap-2 text-xs">
											{scans.map((document) => (
												<a key={document.id} href={`/api/documents/${document.id}`} className="flex items-center gap-1 rounded-tight border border-line-soft bg-surface px-2 py-1 text-faint hover:border-brand/40 hover:text-brand-ink">
													<span className="max-w-[180px] truncate">{document.fileName}</span>
													<span className="tnum">{formatBytes(document.sizeBytes)}</span>
												</a>
											))}
										</div>
									)}
									{canEdit && (
										<div className="ml-[42px]">
											<InlineDocumentUpload contractId={contract.id} extraFields={{ agreementId: a.id, kind: 'AGREEMENT' }} maxFiles={5} />
										</div>
									)}
								</div>
							)
						})}
					</div>
				)}
			</Card>

			{/* Задача C2: счета (ACCOUNTING) — в той же вкладке, что и ДС, а не
			    отдельным разделом навигации: экран и так посвящён финансовым
			    документам договора, дублировать структуру ради одной таблицы
			    лишнее. */}
			<Card>
				<CardHeader
					title="Счета"
					extra={
						canEditInvoices ? (
							<span className="flex items-center gap-3 text-sm">
								<Link href={`/contracts/${contract.id}/invoices/new`} className="text-brand-ink hover:underline">
									+ Счёт
								</Link>
								<span className="text-muted">{contract.invoices.length}</span>
							</span>
						) : (
							contract.invoices.length || undefined
						)
					}
				/>
				{canEdit && <div className="border-b border-line-soft px-3 py-3"><InlineDocumentUpload contractId={contract.id} extraFields={{ kind: 'INVOICE' }} /></div>}
				{contract.invoices.length === 0 ? (
					<EmptyState text="Счетов нет" />
				) : (
					<div className="px-2.5 py-1.5">
						{contract.invoices.map((invoice) => {
							const scans = contract.documents.filter((document) => document.invoiceId === invoice.id)
							return (
								<div key={invoice.id} className="flex flex-col gap-1.5 rounded-control px-2 py-2 hover:bg-raised">
									<div className="flex items-center gap-2.5">
										<div className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-brand-soft text-2xs font-bold text-brand-ink">
											{'₽'}
										</div>
										<div className="min-w-0">
											<div className="truncate text-base font-medium">
												{`Счёт №${invoice.number}`}
											</div>
											<div className="mt-[2px] text-xs text-faint">
												{INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}
												{canSeeAmounts ? ` · ${formatMoney(invoice.amount, contract.currency)}` : ''}
											</div>
										</div>
										<div className="tnum ml-auto text-xs text-faint">{formatDate(invoice.date)}</div>
									</div>
									{scans.length > 0 && (
										<div className="ml-[42px] flex flex-wrap items-center gap-2 text-xs">
											{scans.map((document) => (
												<a key={document.id} href={`/api/documents/${document.id}`} className="flex items-center gap-1 rounded-tight border border-line-soft bg-surface px-2 py-1 text-faint hover:border-brand/40 hover:text-brand-ink">
													<span className="max-w-[180px] truncate">{document.fileName}</span>
													<span className="tnum">{formatBytes(document.sizeBytes)}</span>
												</a>
											))}
										</div>
									)}
									{canEditInvoices && (
										<div className="ml-[42px]">
											<InlineDocumentUpload contractId={contract.id} extraFields={{ invoiceId: invoice.id, kind: 'INVOICE' }} maxFiles={5} />
										</div>
									)}
								</div>
							)
						})}
					</div>
				)}
			</Card>
		</div>
	)
}
