'use client'

import { useEffect, useState } from 'react'

type Section = { id: string; label: string; hasFiles?: boolean }

export default function ContractSectionNav({ sections }: { sections: Section[] }) {
	const [activeId, setActiveId] = useState(sections[0]?.id ?? '')

	useEffect(() => {
		const select = (id: string) => {
			const nextId = sections.some((section) => section.id === id) ? id : sections[0]?.id ?? ''
			setActiveId(nextId)
			sections.forEach((section) => {
				const panel = document.getElementById(section.id)
				if (panel) panel.hidden = section.id !== nextId
			})
		}
		const syncHash = () => select(window.location.hash.slice(1) || new URLSearchParams(window.location.search).get('tab') || '')
		syncHash()
		window.addEventListener('hashchange', syncHash)
		return () => window.removeEventListener('hashchange', syncHash)
	}, [sections])

	function changeSection(id: string) {
		setActiveId(id)
		sections.forEach((section) => {
			const panel = document.getElementById(section.id)
			if (panel) panel.hidden = section.id !== id
		})
		window.history.replaceState(null, '', `#${id}`)
	}

	return <nav aria-label="Разделы договора" role="tablist" className="contract-section-nav sticky top-[72px] z-10 flex items-center gap-1 overflow-x-auto border-b border-line bg-surface/95 px-2 py-2 backdrop-blur-xl">
		{sections.map((section) => <button key={section.id} id={`tab-${section.id}`} type="button" role="tab" aria-selected={activeId === section.id} aria-controls={section.id} onClick={() => changeSection(section.id)} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-tight px-3 py-2 text-xs transition ${activeId === section.id ? 'bg-brand-soft font-bold text-brand-ink' : section.hasFiles ? 'font-semibold text-ink hover:bg-raised' : 'font-semibold text-muted hover:bg-raised hover:text-ink'}`}>{section.label}{section.hasFiles && <span aria-label="Есть файлы" title="Есть файлы" className="h-1.5 w-1.5 rounded-full bg-ok" />}</button>)}
	</nav>
}
