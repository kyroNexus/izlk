'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, BriefcaseBusiness, CheckSquare, FileText, Inbox, MapPin, Moon, Plus, Search, Sun, Upload } from 'lucide-react'
import Icon from '@/components/Icon'

type Result = { id: string; type: 'contract' | 'contractor' | 'document' | 'task' | 'site'; title: string; subtitle?: string; href: string }
const typeIcon = { contract: BriefcaseBusiness, contractor: Archive, document: FileText, task: CheckSquare, site: MapPin }

export default function CommandPalette({ role }: { role: string }) {
	const router = useRouter(), input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDivElement>(null)
	const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [results, setResults] = useState<Result[]>([]), [loading, setLoading] = useState(false)
	const close = () => { setOpen(false); setQuery(''); setResults([]) }
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(true) }
			if (event.key === 'Escape') close()
		}
		window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown)
	}, [])
	useEffect(() => { if (open) input.current?.focus() }, [open])
	useEffect(() => {
		if (!open || query.length === 1) { setResults([]); return }
		const controller = new AbortController(), timer = window.setTimeout(async () => {
			setLoading(true)
			try { const response = await fetch(`/api/command-palette/search?q=${encodeURIComponent(query)}`, { signal: controller.signal }); if (response.ok) setResults((await response.json()).results) } catch (error) { if ((error as Error).name !== 'AbortError') setResults([]) } finally { if (!controller.signal.aborted) setLoading(false) }
		}, query ? 250 : 0)
		return () => { controller.abort(); window.clearTimeout(timer) }
	}, [open, query])
	const navigate = (href: string) => { close(); router.push(href) }
	const toggleTheme = () => { const dark = !document.documentElement.classList.contains('dark'); document.documentElement.classList.toggle('dark', dark); try { localStorage.setItem('izlk-theme', dark ? 'dark' : 'light') } catch {} }
	const commands = [
		...(role === 'ADMIN' || role === 'MANAGER' ? [{ label: 'Создать договор', href: '/contracts/new', icon: Plus }, { label: 'Загрузить документ', href: '/documents', icon: Upload }, { label: 'Создать задачу', href: '/tasks', icon: CheckSquare }] : []),
		{ label: 'Открыть Inbox', href: '/inbox', icon: Inbox }, { label: 'Открыть отчёты', href: '/reports', icon: BriefcaseBusiness },
	]
	if (!open) return null
	return <div className="fixed inset-0 z-[100] grid place-items-start bg-black/35 p-4 pt-[12vh] backdrop-blur-sm motion-reduce:backdrop-blur-none" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
		<div ref={dialog} role="dialog" aria-modal="true" aria-label="Командная палитра" onKeyDown={(event) => { if (event.key !== 'Tab') return; const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input,[href]'); if (!focusable?.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } }} className="w-full max-w-[680px] overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
			<div className="flex items-center gap-3 border-b border-line px-4"><Icon icon={Search} className="text-faint" /><input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" placeholder="Поиск договоров, документов, задач…" aria-label="Поиск" /><kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-faint">Esc</kbd></div>
			<div className="max-h-[min(60vh,540px)] overflow-y-auto p-2">
				{query.length === 1 && <p className="px-3 py-4 text-[12px] text-muted">Введите ещё один символ</p>}
				{!query && <section><p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-faint">Быстрые команды</p>{commands.map((command) => <button key={command.label} type="button" onClick={() => navigate(command.href)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] hover:bg-raised"><Icon icon={command.icon} className="text-brand" />{command.label}</button>)}<button type="button" onClick={() => { toggleTheme(); close() }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] hover:bg-raised"><Icon icon={document.documentElement.classList.contains('dark') ? Sun : Moon} className="text-brand" />Переключить тему</button></section>}
				{results.length > 0 && <section><p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-faint">{query ? 'Результаты' : 'Недавние сущности'}</p>{results.map((item) => { const Glyph = typeIcon[item.type]; return <button key={`${item.type}-${item.id}`} type="button" onClick={() => navigate(item.href)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-raised"><Icon icon={Glyph} className="text-brand" /><span className="min-w-0"><span className="block truncate text-[13px] font-medium">{item.title}</span>{item.subtitle && <span className="block truncate text-[11px] text-muted">{item.subtitle}</span>}</span></button> })}</section>}
				{loading && <p className="px-3 py-4 text-[12px] text-muted">Поиск…</p>}{query.length >= 2 && !loading && results.length === 0 && <p className="px-3 py-4 text-[12px] text-muted">Ничего не найдено</p>}
			</div>
		</div>
	</div>
}
