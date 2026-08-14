'use client'

import { useState } from 'react'

export type ContractHierarchyNode = {
	id: string
	label: string
	detail?: string
	date?: string
	children?: ContractHierarchyNode[]
}

function Node({ node, depth = 0 }: { node: ContractHierarchyNode; depth?: number }) {
	const [open, setOpen] = useState(true)
	const hasChildren = Boolean(node.children?.length)
	return <li className={depth ? 'ml-4 border-l border-line-soft pl-3' : ''}>
		<div className="flex items-start gap-2 py-2"><button type="button" onClick={() => hasChildren && setOpen((value) => !value)} aria-expanded={hasChildren ? open : undefined} aria-label={hasChildren ? `${open ? 'Свернуть' : 'Развернуть'}: ${node.label}` : undefined} className={`mt-0.5 grid h-5 w-5 flex-none place-items-center rounded text-[11px] ${hasChildren ? 'bg-brand-soft text-brand-ink hover:bg-brand hover:text-white' : 'bg-raised text-faint'}`}>{hasChildren ? (open ? '−' : '+') : '•'}</button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-2"><b className="text-[12px]">{node.label}</b>{node.date && <span className="text-[10.5px] text-faint">{node.date}</span>}</div>{node.detail && <p className="mt-0.5 text-[11px] leading-4 text-muted">{node.detail}</p>}</div></div>
		{hasChildren && open && <ul>{node.children!.map((child) => <Node key={child.id} node={child} depth={depth + 1} />)}</ul>}
	</li>
}

export default function ContractHierarchy({ nodes }: { nodes: ContractHierarchyNode[] }) {
	const [open, setOpen] = useState(false)
	return <><button type="button" onClick={() => setOpen(true)} className="inline-flex h-[38px] items-center gap-2 rounded-[10px] border border-line bg-surface px-[13px] text-[12px] font-semibold hover:bg-raised"><span aria-hidden="true">⌘</span>Структура подчинённости</button>{open && <div className="fixed inset-0 z-[100] grid place-items-center bg-[#151326]/45 p-4 backdrop-blur-[3px]" role="presentation" onMouseDown={() => setOpen(false)}><section role="dialog" aria-modal="true" aria-labelledby="contract-hierarchy-title" onMouseDown={(event) => event.stopPropagation()} className="max-h-[calc(100vh-32px)] w-full max-w-2xl overflow-y-auto rounded-[20px] border border-line bg-surface shadow-[0_28px_90px_rgba(16,12,48,.34)]"><header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur"><div><h2 id="contract-hierarchy-title" className="text-[17px] font-bold">Структура подчинённости</h2><p className="mt-1 text-[11px] text-muted">Связанные документы, этапы и рабочие позиции договора.</p></div><button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-[18px] text-muted hover:bg-raised" aria-label="Закрыть">×</button></header><div className="p-4">{nodes.length ? <ul><Node node={{ id: 'root', label: 'Договор', children: nodes }} /></ul> : <p className="rounded-xl bg-raised px-4 py-6 text-center text-[12px] text-faint">Связанных сущностей пока нет.</p>}</div></section></div>}</>
}
