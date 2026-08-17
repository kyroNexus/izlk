'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type Option = { key: string; label: string; count: number }

function values(search: URLSearchParams, name: string) {
  return new Set((search.get(name) ?? '').split(',').filter(Boolean))
}

export default function ContractFilters({ kinds, sections }: { kinds: Option[]; sections: Option[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentSearch = searchParams.toString()
  const [isNavigating, setIsNavigating] = useState(false)
  const navigationLock = useRef(false)

  useEffect(() => {
    navigationLock.current = false
    setIsNavigating(false)
  }, [currentSearch])
  const activeKinds = values(new URLSearchParams(currentSearch), 'kind')
  const activeSections = values(new URLSearchParams(currentSearch), 'section')

  const navigate = (next: URLSearchParams) => {
    if (navigationLock.current) return
    navigationLock.current = true
    setIsNavigating(true)
    router.push(`${pathname}${next.size ? `?${next}` : ''}`)
  }

  const toggle = (name: 'kind' | 'section', key: string) => {
    const next = new URLSearchParams(searchParams.toString())
    const set = values(next, name)
    set.has(key) ? set.delete(key) : set.add(key)
    if (set.size) next.set(name, [...set].join(','))
    else next.delete(name)
    // Project sections are independent from the contract type: KM/KZH/AR are
    // valid filters for SMR, MK and project contracts.
    navigate(next)
  }

  const clear = (name: 'kind' | 'section') => {
    const next = new URLSearchParams(searchParams.toString())
    next.delete(name)
    navigate(next)
  }

  const button = (option: Option, active: boolean, onClick: () => void) => (
    <button
      key={option.key}
      type="button"
      aria-pressed={active}
      disabled={isNavigating}
      onClick={onClick}
      className={`contract-filter-button rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-65 ${active ? 'border-brand bg-brand text-white shadow-sm' : 'border-line bg-surface text-muted hover:border-brand/40 hover:text-ink'}`}
    >
      {option.label} <span className="ml-1 opacity-70">{option.count}</span>
    </button>
  )

  return (
    <div className="mt-3 space-y-2">
      <div className="contract-filter-group flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-faint">Тип:</span>
        {kinds.map((item) => button(item, activeKinds.has(item.key), () => toggle('kind', item.key)))}
        {activeKinds.size > 0 && <button type="button" onClick={() => clear('kind')} className="px-2 py-1.5 text-xs font-semibold text-brand-ink hover:underline">Сбросить</button>}
      </div>
      <div className="contract-filter-group flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-faint">Раздел проекта:</span>
        {sections.map((item) => button(item, activeSections.has(item.key), () => toggle('section', item.key)))}
        {activeSections.size > 0 && <button type="button" onClick={() => clear('section')} className="px-2 py-1.5 text-xs font-semibold text-brand-ink hover:underline">Сбросить</button>}
      </div>
    </div>
  )
}
