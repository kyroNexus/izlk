'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

export default function SiteTableRow({ siteId, children }: { siteId: string; children: ReactNode }) {
	const router = useRouter()
	function open() { router.push(`/sites/${siteId}`) }
	return <tr tabIndex={0} role="link" aria-label="Открыть площадку" onClick={open} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } }} className="cursor-pointer border-t border-line-soft transition-colors hover:bg-raised/70 focus:bg-brand-soft focus:outline-none">{children}</tr>
}
