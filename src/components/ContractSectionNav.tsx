'use client'

import { useEffect, useState } from 'react'

type Section = { id: string; label: string }

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
		const syncHash = () => select(window.location.hash.slice(1))
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

	return <nav aria-label="Разделы договора" className="contract-section-nav sticky top-[72px] z-10 flex items-center gap-1 overflow-x-auto border-b border-line bg-surface/95 px-2 py-2 backdrop-blur-xl">
		{sections.map((section) => <button key={section.id} type="button" onClick={() => changeSection(section.id)} aria-current={activeId === section.id ? 'page' : undefined} className={`whitespace-nowrap rounded-[8px] px-3 py-2 text-[11px] transition ${activeId === section.id ? 'bg-brand-soft font-bold text-brand-ink' : 'font-semibold text-muted hover:bg-raised hover:text-ink'}`}>{section.label}</button>)}
	</nav>
}
