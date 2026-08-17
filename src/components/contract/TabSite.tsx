'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, Chip } from '@/components/ui'
import { formatDateTime, plural } from '@/lib/format'
import { EVENT_DOT, SITE_STATUS, type ContractWithRelations } from './shared'

// Хроника площадки может разрастись до десятков записей — в карточке
// договора нужен только последний контекст, полная лента уже есть на /sites/[id].
const VISIBLE_EVENTS = 6

export default function TabSite({ site }: { site: ContractWithRelations['sites'][number] }) {
	const [showAll, setShowAll] = useState(false)
	const hiddenCount = site.events.length - VISIBLE_EVENTS
	const visibleEvents = showAll ? site.events : site.events.slice(0, VISIBLE_EVENTS)
	return (
		<Card id="site" className="overflow-hidden" hidden role="tabpanel" aria-labelledby="tab-site">
			<details open={site.status === 'ISSUE' || site.status === 'BLOCKED'} className="group/site">
				<summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 transition hover:bg-raised/50"><span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand-ink transition-transform group-open/site:rotate-180">⌄</span><span className="min-w-0"><span className="block text-base font-bold tracking-[-.01em]">Площадка</span><span className="mt-0.5 block truncate text-xs text-faint">{site.address} · {plural(site.events.length, 'запись', 'записи', 'записей')}</span></span><span className="ml-auto"><Chip tone={SITE_STATUS[site.status].tone}>{SITE_STATUS[site.status].label}</Chip></span></summary>
				<div className="border-t border-line-soft p-4">
					<div className="mb-[14px] text-base text-muted">{site.address}</div>
					<div className="relative flex flex-col gap-4 before:absolute before:bottom-[10px] before:left-[8px] before:top-2.5 before:w-px before:bg-line">
						{visibleEvents.map((e) => (
							<div key={e.id} className="relative pl-[28px]">
								<span
									className={`absolute left-[2px] top-1 h-[13px] w-[13px] rounded-full ring-4 ring-surface ${
										EVENT_DOT[e.type] ?? 'bg-brand'
									}`}
								/>
								<div className="tnum text-xs text-faint">{formatDateTime(e.occurredAt)}</div>
								<div className="mt-[3px] text-sm leading-[1.45]">{e.text}</div>
							</div>
						))}
						{site.events.length === 0 && (
							<div className="pl-[28px] text-sm text-faint">
								Событий пока нет
							</div>
						)}
					</div>
					{hiddenCount > 0 && (
						<button
							type="button"
							onClick={() => setShowAll((value) => !value)}
							className="mt-3 text-xs font-semibold text-brand-ink hover:underline"
						>
							{showAll ? 'Свернуть' : `Показать ещё ${hiddenCount}`}
						</button>
					)}
					<Link
						href={`/sites/${site.id}`}
						className="mt-[14px] inline-flex h-control items-center justify-center rounded-control border border-line bg-surface px-3.5 text-base font-semibold hover:bg-raised"
					>
						Подробнее о площадке
					</Link>
				</div>
			</details>
		</Card>
	)
}
