'use client'

import { useMemo, useState } from 'react'
import { DOCUMENT_RULE_TARGETS, testDocumentRoute, type DocumentRouteRuleInput } from '@/lib/document-route-rules'
import { DOCUMENT_KIND_LABELS } from '@/lib/format'
import { inputClass, selectClass, textareaClass } from '@/components/ui'

const TARGET_LABELS: Record<string, string> = {
	INVOICE: 'Счёт', AGREEMENT: 'Доп. соглашение', ESTIMATE_TO_AGREEMENT: 'Смета к ДС', APPENDIX_TO_AGREEMENT: 'Приложение к ДС', PR1_SIGNED: 'Подписанное ПР1',
	'SOURCE_DATA:IGI': 'Исходные: ИГИ', 'SOURCE_DATA:GPZU': 'Исходные: ГПЗУ', 'SOURCE_DATA:GEOBASE': 'Исходные: геоподоснова', 'SOURCE_DATA:TOPO': 'Исходные: топосъёмка', 'SOURCE_DATA:CONSTRAINTS': 'Исходные: ограничения',
	'PROJECT:KZH': 'Проект: КЖ', 'PROJECT:KM': 'Проект: КМ', 'PROJECT:AR': 'Проект: АР', 'PROJECT:CIPHER': 'Проект: шифр',
}

async function api(method: string, body?: unknown, id?: string) {
	const response = await fetch(`/api/settings/document-rules${id ? `?id=${encodeURIComponent(id)}` : ''}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
	const result = await response.json().catch(() => null)
	if (!response.ok) throw new Error(result?.error ?? 'Не удалось сохранить правило')
	return result
}

function RuleRow({ rule, onChange, onDelete }: { rule: DocumentRouteRuleInput; onChange: (rule: DocumentRouteRuleInput) => void; onDelete: (id: string) => void }) {
	const [draft, setDraft] = useState(rule)
	const [error, setError] = useState('')
	const [saving, setSaving] = useState(false)
	async function save(next = draft) {
		setSaving(true); setError('')
		try { const saved = await api('PATCH', next); setDraft(saved); onChange(saved) } catch (value) { setError(value instanceof Error ? value.message : 'Ошибка') } finally { setSaving(false) }
	}
	return <div className="grid gap-2 border-t border-line-soft p-3 first:border-t-0 lg:grid-cols-[170px_minmax(240px,1fr)_90px_110px]">
		<select value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value })} className={selectClass}>{DOCUMENT_RULE_TARGETS.map((target) => <option key={target} value={target}>{TARGET_LABELS[target]}</option>)}</select>
		<div><textarea value={draft.pattern} onChange={(event) => setDraft({ ...draft, pattern: event.target.value })} className={`${textareaClass} min-h-[64px] font-mono text-xs`} /><input value={draft.note ?? ''} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Заметка" maxLength={300} className={`${inputClass} mt-1.5 text-xs`} />{error && <div className="mt-1 text-xs text-danger">{error}</div>}</div>
		<input type="number" min={0} max={100000} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} className={inputClass} aria-label="Порядок" />
		<div className="flex flex-col gap-1.5"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.enabled} onChange={(event) => { const next = { ...draft, enabled: event.target.checked }; setDraft(next); void save(next) }} /> Включено</label><button type="button" disabled={saving} onClick={() => void save()} className="rounded-tight border border-line px-2 py-1.5 text-xs font-semibold hover:bg-raised">Сохранить</button><button type="button" onClick={async () => { if (!window.confirm('Удалить шаблон?')) return; try { await api('DELETE', undefined, rule.id); onDelete(rule.id) } catch (value) { setError(value instanceof Error ? value.message : 'Ошибка') } }} className="text-xs font-semibold text-danger">Удалить</button></div>
	</div>
}

export default function DocumentRulesSettings({ initialRules }: { initialRules: DocumentRouteRuleInput[] }) {
	const [rules, setRules] = useState(initialRules)
	const [fileName, setFileName] = useState('Счёт на оплату №326 от 29.06.26.pdf')
	const [target, setTarget] = useState<string>('INVOICE')
	const [pattern, setPattern] = useState('')
	const [note, setNote] = useState('')
	const [error, setError] = useState('')
	const result = useMemo(() => testDocumentRoute(fileName, rules), [fileName, rules])
	const groups = DOCUMENT_RULE_TARGETS.map((key) => ({ key, rules: rules.filter((rule) => rule.target === key).sort((a, b) => a.sortOrder - b.sortOrder) })).filter((group) => group.rules.length)
	return <div className="space-y-4">
		<div className="rounded-[18px] border border-line bg-surface p-4"><div className="text-base font-bold">Тестер имени файла</div><input value={fileName} onChange={(event) => setFileName(event.target.value)} className={`${inputClass} mt-3`} /><div className="mt-3 grid gap-2 text-sm sm:grid-cols-4"><div><span className="text-faint">Вид</span><b className="block">{DOCUMENT_KIND_LABELS[result.kind]}</b></div><div><span className="text-faint">Подтип</span><b className="block">{result.sourceDataKind ?? '—'}</b></div><div><span className="text-faint">Привязка к ДС</span><b className="block">{result.agreementNumber ? `№${result.agreementNumber}` : '—'}</b></div><div><span className="text-faint">Шаблон</span>{result.matchedRule ? <><b className="block break-words">{result.matchedRule.note ?? result.matchedRule.id}</b><code className="mt-1 block break-all text-[11px] text-muted">/{result.matchedRule.pattern}/iu</code></> : <b className="block">Встроенный классификатор</b>}</div></div></div>
		<div className="rounded-[18px] border border-line bg-surface"><div className="border-b border-line-soft px-4 py-3 text-base font-bold">Добавить шаблон</div><form className="grid gap-2 p-4 lg:grid-cols-[200px_1fr_1fr_auto]" onSubmit={async (event) => { event.preventDefault(); setError(''); try { const created = await api('POST', { target, pattern, note, enabled: true, sortOrder: (rules.at(-1)?.sortOrder ?? 0) + 10 }); setRules((current) => [...current, created]); setPattern(''); setNote('') } catch (value) { setError(value instanceof Error ? value.message : 'Ошибка') } }}><select value={target} onChange={(event) => setTarget(event.target.value)} className={selectClass}>{DOCUMENT_RULE_TARGETS.map((key) => <option key={key} value={key}>{TARGET_LABELS[key]}</option>)}</select><input value={pattern} onChange={(event) => setPattern(event.target.value)} required placeholder="Регулярное выражение" className={`${inputClass} font-mono text-xs`} /><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Заметка" maxLength={300} className={inputClass} /><button className="brand-gradient rounded-tight px-4 text-sm font-semibold text-white">Добавить</button>{error && <div className="text-xs text-danger lg:col-span-4">{error}</div>}</form></div>
		{groups.map((group) => <section key={group.key} className="overflow-hidden rounded-[18px] border border-line bg-surface"><div className="bg-raised px-4 py-2.5 text-sm font-bold">{TARGET_LABELS[group.key]} · {group.rules.length}</div>{group.rules.map((rule) => <RuleRow key={rule.id} rule={rule} onChange={(saved) => setRules((current) => current.map((item) => item.id === saved.id ? saved : item))} onDelete={(id) => setRules((current) => current.filter((item) => item.id !== id))} />)}</section>)}
	</div>
}
