'use client'

import { useState } from 'react'

/** Small shared selection state for future Inbox and task batch actions. */
export function useBulkSelection(ids: string[]) {
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const toggle = (id: string) => setSelected((current) => {
		const next = new Set(current)
		next.has(id) ? next.delete(id) : next.add(id)
		return next
	})
	const togglePage = () => setSelected((current) => current.size === ids.length ? new Set() : new Set(ids))
	return { selected: [...selected], has: (id: string) => selected.has(id), toggle, togglePage, clear: () => setSelected(new Set()), allSelected: ids.length > 0 && selected.size === ids.length }
}
