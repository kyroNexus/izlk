'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import Icon from '@/components/Icon'
import { Card, Field, inputClass, selectClass, textareaClass } from '@/components/ui'

type Crew = { name: string; days: string; rate: string }
type Cost = { category: 'EQUIPMENT' | 'MATERIAL' | 'OTHER'; name: string; payment: 'CASH' | 'CASHLESS'; quantity: string; unit: string; price: string }
type QueuedPhoto = { id: string; file: File; preview: string; state: 'ready' | 'uploading' | 'failed' | 'done'; error?: string }
type Draft = { fields: Record<string, string>; crew: Crew[]; costs: Cost[]; submissionId: string; reportId?: string; photos: string[] }
const MAX_PHOTOS = 10
const num = (value: string) => Number(value.replace(',', '.')) || 0
const money = (value: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value)
const newId = () => crypto.randomUUID()

async function checksum(file: File) {
	const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
	return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function compress(file: File): Promise<File> {
	if (!file.type.startsWith('image/') || file.type === 'image/heic' || file.size < 1_000_000) return file
	const image = await createImageBitmap(file).catch(() => null)
	if (!image) return file
	const scale = Math.min(1, 1920 / Math.max(image.width, image.height))
	const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale)
	canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height); image.close()
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .82))
	return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file
}

export default function ReportForm({ siteId, today }: { siteId: string; today: string }) {
	const key = `izlk:site-report:${siteId}`
	const formRef = useRef<HTMLFormElement>(null)
	const photosRef = useRef<QueuedPhoto[]>([])
	const [crew, setCrew] = useState<Crew[]>([{ name: '', days: '1', rate: '0' }])
	const [costs, setCosts] = useState<Cost[]>([{ category: 'EQUIPMENT', name: '', payment: 'CASHLESS', quantity: '1', unit: 'смена', price: '0' }])
	const [photos, setPhotos] = useState<QueuedPhoto[]>([])
	const [submissionId, setSubmissionId] = useState('')
	const [reportId, setReportId] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const crewTotal = useMemo(() => crew.reduce((sum, row) => sum + num(row.days) * num(row.rate), 0), [crew])
	const costTotals = useMemo(() => costs.reduce((sum, row) => ({ ...sum, [row.category]: sum[row.category] + num(row.quantity) * num(row.price) }), { EQUIPMENT: 0, MATERIAL: 0, OTHER: 0 }), [costs])
	const uploadedCount = photos.filter((photo) => photo.state === 'done').length
	const updateCrew = (index: number, field: keyof Crew, value: string) => setCrew((rows) => rows.map((row, i) => i === index ? { ...row, [field]: value } : row))
	const updateCost = (index: number, field: keyof Cost, value: string) => setCosts((rows) => rows.map((row, i) => i === index ? { ...row, [field]: value } : row))

	const saveDraft = () => {
		const form = formRef.current; if (!form || !submissionId) return
		const fields = Object.fromEntries([...new FormData(form).entries()].filter(([, value]) => typeof value === 'string') as [string, string][])
		localStorage.setItem(key, JSON.stringify({ fields, crew, costs, submissionId, reportId: reportId ?? undefined, photos: photos.map((photo) => photo.file.name) } satisfies Draft))
	}
	useEffect(() => {
		const raw = localStorage.getItem(key)
		let draft: Draft | null = null
		if (raw) {
			try { draft = JSON.parse(raw) as Draft } catch { localStorage.removeItem(key) }
		}
		setSubmissionId(draft?.submissionId ?? newId()); setReportId(draft?.reportId ?? null)
		if (draft) { setCrew(draft.crew || []); setCosts(draft.costs || []); setMessage(draft.reportId ? 'Черновик восстановлен. Повторите выбор фото и отправку: уже загруженные файлы не задублируются.' : 'Черновик восстановлен.') }
		requestAnimationFrame(() => Object.entries(draft?.fields ?? {}).forEach(([name, value]) => { const item = formRef.current?.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null; if (item) { if (item instanceof HTMLInputElement && item.type === 'checkbox') item.checked = value === 'on'; else item.value = value } }))
	}, [key]) // Draft belongs only to this site.
	useEffect(() => { saveDraft() }, [crew, costs, photos, reportId, submissionId]) // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => { photosRef.current = photos }, [photos])
	useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.preview)), [])

	async function addPhotos(files: FileList | null) {
		if (!files) return
		const available = MAX_PHOTOS - photos.filter((photo) => photo.state !== 'done').length
		if (files.length > available) setMessage(`Можно добавить не более ${MAX_PHOTOS} фотографий.`)
		const prepared = await Promise.all([...files].slice(0, Math.max(0, available)).map(async (file) => { const compressed = await compress(file); return { id: newId(), file: compressed, preview: URL.createObjectURL(compressed), state: 'ready' as const } }))
		setPhotos((current) => [...current, ...prepared])
	}
	async function upload(photo: QueuedPhoto, id: string): Promise<boolean> {
		setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, state: 'uploading', error: undefined } : item))
		try {
			let error: unknown
			for (let attempt = 0; attempt < 2; attempt++) try {
				const body = new FormData(); body.set('photo', photo.file); body.set('checksum', await checksum(photo.file))
				const response = await fetch(`/api/site-reports/${id}/photos`, { method: 'POST', body })
				if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? 'Ошибка загрузки')
				error = undefined; break
			} catch (currentError) { error = currentError }
			if (error) throw error
			setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, state: 'done' } : item))
			return true
		} catch (error) { setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, state: 'failed', error: error instanceof Error ? error.message : 'Ошибка загрузки' } : item)); return false }
	}
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault(); if (submitting) return
		setSubmitting(true); setMessage(null); const form = new FormData(event.currentTarget)
		try {
			let id = reportId
			if (!id) {
				const response = await fetch(`/api/sites/${siteId}/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientSubmissionId: submissionId, direction: form.get('direction'), workDate: form.get('workDate'), stage: form.get('stage'), comment: form.get('comment'), finishDirection: form.get('finishDirection') === 'on', crew: crew.filter((row) => row.name.trim()).map((row) => ({ name: row.name, days: num(row.days), rate: num(row.rate) })), costs: costs.filter((row) => row.name.trim()).map((row) => ({ ...row, quantity: num(row.quantity), price: num(row.price) })) }) })
				if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? 'Не удалось сохранить отчёт')
				id = (await response.json()).reportId as string; setReportId(id)
			}
			const uploaded = await Promise.all(photos.filter((item) => item.state !== 'done').map((photo) => upload(photo, id)))
			if (uploaded.every(Boolean)) { localStorage.removeItem(key); window.location.assign(`/sites/${siteId}`) }
			else setMessage('Отчёт сохранён. Не все фото отправились — нажмите «Повторить» у нужных файлов.')
		} catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось сохранить отчёт') } finally { setSubmitting(false) }
	}

	return <Card className="overflow-hidden border-brand/20 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--brand-soft)_42%,var(--surface)),var(--surface)_34%)] p-3.5 shadow-[0_18px_42px_rgba(34,24,82,.10)] sm:p-[22px]"><form ref={formRef} onSubmit={submit} onInput={saveDraft} className="flex flex-col gap-4">
		{message && <div role="status" className="rounded-control bg-brand-soft px-3 py-2 text-sm text-brand-ink">{message}</div>}
		<div className="grid grid-cols-1 gap-3.5 md:grid-cols-2"><Field label="Направление" required><select name="direction" className={selectClass} defaultValue="KJ"><option value="KJ">Монтаж КЖ</option><option value="KM">Монтаж КМ</option></select></Field><Field label="Дата" required><input type="date" name="workDate" required defaultValue={today} className={inputClass} /></Field></div>
		<Field label="Этап работ" required><input name="stage" required className={inputClass} placeholder="Монтаж колонн, устройство фундамента…" /></Field>
		<Field label="Фотоотчёт" hint="До 10 фотографий по 20 МБ; перед отправкой большие JPG/PNG сжимаются на телефоне"><input type="file" accept="image/*" capture="environment" multiple onChange={(event) => { void addPhotos(event.target.files); event.currentTarget.value = '' }} className="block min-h-[88px] w-full rounded-control border border-dashed border-line bg-raised px-3 py-4 text-base text-muted" /></Field>
		{photos.length > 0 && <><div className="text-sm text-muted">Фото: {uploadedCount} из {photos.length} загружено</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{photos.map((photo) => <div key={photo.id} className="relative overflow-hidden rounded-control border border-line bg-raised"><img src={photo.preview} alt={photo.file.name} className="aspect-square w-full object-cover" /><div className="p-2 text-xs">{photo.state === 'uploading' ? 'Загрузка…' : photo.state === 'done' ? 'Готово' : photo.state === 'failed' ? <button type="button" onClick={() => reportId && void upload(photo, reportId)} className="text-danger underline">Повторить: {photo.error}</button> : 'Готово к отправке'}<button type="button" onClick={() => setPhotos((items) => { URL.revokeObjectURL(photo.preview); return items.filter((item) => item.id !== photo.id) })} className="float-right grid min-h-[28px] min-w-[28px] place-items-center px-1 text-danger" aria-label={`Удалить ${photo.file.name}`}><Icon icon={X} size={14} /></button></div></div>)}</div></>}
		<section className="rounded-[14px] border border-line bg-surface/80 p-3.5"><div className="mb-2 flex items-center justify-between"><div><h2 className="text-base font-semibold">Люди и затраты</h2><p className="text-xs text-muted">Дни × ставка</p></div><button type="button" onClick={() => setCrew((rows) => [...rows, { name: '', days: '1', rate: '0' }])} className="min-h-[44px] rounded-tight border border-line px-2.5 text-sm font-semibold">+ Сотрудник</button></div>{crew.map((row, index) => <div key={index} className="mb-2 grid grid-cols-[1fr_70px_90px_32px] gap-2"><input value={row.name} onChange={(e) => updateCrew(index, 'name', e.target.value)} placeholder="ФИО" className={inputClass} /><input value={row.days} onChange={(e) => updateCrew(index, 'days', e.target.value)} inputMode="decimal" aria-label="Дней" className={inputClass} /><input value={row.rate} onChange={(e) => updateCrew(index, 'rate', e.target.value)} inputMode="decimal" aria-label="Ставка" className={inputClass} /><button type="button" onClick={() => setCrew((rows) => rows.filter((_, i) => i !== index))} className="grid min-h-[44px] place-items-center text-danger" aria-label="Удалить сотрудника"><Icon icon={X} size={15} /></button></div>)}<div className="text-right text-sm font-semibold">Зарплата: {money(crewTotal)}</div></section>
		<section className="rounded-[14px] border border-line bg-surface/80 p-3.5"><div className="mb-2 flex items-center justify-between"><h2 className="text-base font-semibold">Затраты</h2><button type="button" onClick={() => setCosts((rows) => [...rows, { category: 'MATERIAL', name: '', payment: 'CASHLESS', quantity: '1', unit: 'шт.', price: '0' }])} className="min-h-[44px] rounded-tight border border-line px-2.5 text-sm font-semibold">+ Позиция</button></div>{costs.map((row, index) => <div key={index} className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-[130px_1fr_80px_100px_32px]"><select value={row.category} onChange={(e) => updateCost(index, 'category', e.target.value as Cost['category'])} className={selectClass}><option value="EQUIPMENT">Техника</option><option value="MATERIAL">Материал</option><option value="OTHER">Прочее</option></select><input value={row.name} onChange={(e) => updateCost(index, 'name', e.target.value)} placeholder="Наименование" className={inputClass} /><input value={row.quantity} onChange={(e) => updateCost(index, 'quantity', e.target.value)} inputMode="decimal" placeholder="Кол-во" className={inputClass} /><input value={row.price} onChange={(e) => updateCost(index, 'price', e.target.value)} inputMode="decimal" placeholder="Цена" className={inputClass} /><button type="button" onClick={() => setCosts((rows) => rows.filter((_, i) => i !== index))} className="grid min-h-[44px] place-items-center text-danger" aria-label="Удалить позицию"><Icon icon={X} size={15} /></button></div>)}</section>
		<Field label="Комментарий"><textarea name="comment" className={textareaClass} placeholder="Что выполнено, что мешало, важные детали" /></Field><label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-control border border-brand/20 bg-brand-soft/40 px-4 py-3 text-sm"><input type="checkbox" name="finishDirection" className="mt-0.5 h-4 w-4" /><span><b className="block text-ink">Монтаж направления завершён</b><span className="mt-0.5 block text-muted">Стадия договора обновится по текущим правилам.</span></span></label>
		<div className="rounded-control bg-brand/10 p-3 text-right text-base font-bold text-brand-ink">Итого за день: {money(crewTotal + costTotals.EQUIPMENT + costTotals.MATERIAL + costTotals.OTHER)}</div>
		<div className="sticky bottom-0 -mx-[14px] flex gap-2.5 border-t border-line bg-surface/95 px-3.5 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0"><button disabled={submitting} className="brand-gradient inline-flex min-h-[48px] flex-1 items-center justify-center rounded-control px-4 text-base font-semibold text-white disabled:opacity-60">{submitting ? 'Отправляем…' : reportId ? 'Продолжить загрузку' : 'Отправить отчёт'}</button><Link href={`/sites/${siteId}`} className="inline-flex min-h-[48px] items-center rounded-control border border-line px-4 text-base font-semibold">Отмена</Link></div>
	</form></Card>
}
