import Link from 'next/link'
import { Card, Chip } from '@/components/ui'
import { formatDateTime, plural } from '@/lib/format'
import { EVENT_DOT, SITE_STATUS, type ContractWithRelations } from './shared'

export default function TabSite({ site }: { site: ContractWithRelations['sites'][number] }) {
	return (
		<Card id="site" className="overflow-hidden" hidden role="tabpanel" aria-labelledby="tab-site">
			<details open={site.status === 'ISSUE' || site.status === 'BLOCKED'} className="group/site">
				<summary className="flex cursor-pointer list-none items-center gap-3 px-[19px] py-[14px] transition hover:bg-raised/50"><span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand-ink transition-transform group-open/site:rotate-180">⌄</span><span className="min-w-0"><span className="block text-[14px] font-bold tracking-[-.01em]">Площадка</span><span className="mt-0.5 block truncate text-[10.5px] text-faint">{site.address} · {plural(site.events.length, 'запись', 'записи', 'записей')}</span></span><span className="ml-auto"><Chip tone={SITE_STATUS[site.status].tone}>{SITE_STATUS[site.status].label}</Chip></span></summary>
				<div className="border-t border-line-soft p-[18px]">
					<div className="mb-[14px] text-[13px] text-muted">{site.address}</div>
					<div className="relative flex flex-col gap-[16px] before:absolute before:bottom-[10px] before:left-[8px] before:top-[10px] before:w-px before:bg-line">
						{site.events.map((e) => (
							<div key={e.id} className="relative pl-[28px]">
								<span
									className={`absolute left-[2px] top-[3px] h-[13px] w-[13px] rounded-full ring-4 ring-surface ${
										EVENT_DOT[e.type] ?? 'bg-brand'
									}`}
								/>
								<div className="tnum text-[11px] text-faint">{formatDateTime(e.occurredAt)}</div>
								<div className="mt-[3px] text-[12.5px] leading-[1.45]">{e.text}</div>
							</div>
						))}
						{site.events.length === 0 && (
							<div className="pl-[28px] text-[12.5px] text-faint">
								Событий пока нет
							</div>
						)}
					</div>
					<Link
						href={`/sites/${site.id}`}
						className="mt-[14px] inline-flex h-[36px] items-center justify-center rounded-[10px] border border-line bg-surface px-[15px] text-[13px] font-semibold hover:bg-raised"
					>
						Подробнее о площадке
					</Link>
				</div>
			</details>
		</Card>
	)
}
