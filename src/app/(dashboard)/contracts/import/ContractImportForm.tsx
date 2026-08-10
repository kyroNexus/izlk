'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Field, inputClass, selectClass } from '@/components/ui'
import type { FolderParseReport, ParsedContract } from '@/lib/contract-parser'

type Mode = 'file' | 'folder' | 'attach'

const MAX_FOLDER_FILES = 1000
const MAX_FOLDER_BYTES = 750 * 1024 * 1024

function chooseMainFile(files: File[]) {
	const parsable = files.filter((file) => /\.(doc|docx|xlsx?|pdf|txt|csv|png|jpe?g)$/i.test(file.name))
	return parsable.find((file) => /договор|контракт/i.test(file.name)) ?? parsable[0] ?? files[0]
}

export default function ContractImportForm() {
	const router = useRouter()
	const formRef = useRef<HTMLFormElement>(null)
	const [mode, setMode] = useState<Mode>('folder')
	const [folderFiles, setFolderFiles] = useState<File[]>([])
	const [parsed, setParsed] = useState<ParsedContract | null>(null)
	const [folderReport, setFolderReport] = useState<FolderParseReport | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')

	function fillManually() {
		setParsed({ fileName: 'manual-entry', contractNumber: '', contractDate: '', amount: '', currency: 'RUB', contractorName: '', inn: '', cipher: '', objectAddress: '', confidence: 0, foundFields: [], warnings: ['Автораспознавание пропущено. Заполните реквизиты по документу вручную и сохраните файл.'], preview: '' })
		setError('')
	}

	function switchMode(next: Mode) { setMode(next); setParsed(null); setFolderReport(null); setError(''); setFolderFiles([]) }

	function payload(form: HTMLFormElement) {
		const data = new FormData(form)
		if (mode === 'folder' || mode === 'attach') {
			const main = folderReport ? folderFiles.find((item) => (item.webkitRelativePath || item.name) === folderReport.primaryFile) ?? chooseMainFile(folderFiles) : chooseMainFile(folderFiles)
			data.delete('file')
			if (mode === 'folder' && main) data.append('file', main, main.name)
			if (mode === 'attach') data.set('operation', 'attach')
			for (const file of folderFiles) {
				data.append('files', file, file.name)
				data.append('relativePaths', file.webkitRelativePath || file.name)
			}
		}
		return data
	}

	async function parse() {
		const form = formRef.current
		if (!form || mode === 'attach') return
		if (mode === 'folder' && !folderFiles.length) { setError('Выберите папку договора'); return }
		if (folderHasLimitIssue && folderFiles.length > MAX_FOLDER_FILES) { setError(`В одной папке можно проверить до ${MAX_FOLDER_FILES} файлов. Для большей базы используйте Inbox на сервере.`); return }
		if (folderTotalBytes > MAX_FOLDER_BYTES) { setError('Папка больше 750 МБ. Для такого архива используйте Inbox на сервере.'); return }
		setBusy(true); setError(''); setParsed(null); setFolderReport(null)
		try {
			const data = payload(form)
			if (mode !== 'folder') for (const key of ['files', 'relativePaths']) data.delete(key)
			const response = await fetch('/api/contracts/parse', { method: 'POST', body: data })
			const responseText = await response.text()
			let result: Partial<ParsedContract> & { error?: string; parsed?: ParsedContract; folder?: FolderParseReport }
			try { result = responseText ? JSON.parse(responseText) : {} }
			catch { throw new Error('Распознавание не завершилось: сервер вернул неполный ответ. Повторите попытку — повреждённые файлы будут пропущены, остальные сохранятся.') }
			if (!response.ok) throw new Error(result.error || 'Не удалось распознать основной договор')
			setParsed(result.parsed ?? result as ParsedContract)
			setFolderReport(result.folder ?? null)
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Ошибка распознавания') } finally { setBusy(false) }
	}

	async function create(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (isFolder && folderHasLimitIssue && folderFiles.length > MAX_FOLDER_FILES) { setError(`В одной папке можно загрузить до ${MAX_FOLDER_FILES} файлов.`); return }
		if (isFolder && folderTotalBytes > MAX_FOLDER_BYTES) { setError('Папка больше 750 МБ. Перенесите её в Inbox на сервере.'); return }
		setBusy(true); setError('')
		try {
			const response = await fetch('/api/contracts/import', { method: 'POST', body: payload(event.currentTarget) })
			const data = await response.json()
			if (!response.ok) throw new Error(data.error || 'Не удалось обработать документы')
			const imported = Number(data.importedFiles ?? 0)
			const skipped = Number(data.skippedFiles ?? 0)
			const summary = `Загружено файлов: ${imported}${skipped ? `. Пропущено: ${skipped}; причины есть в журнале импорта.` : ''}${data.contractorMatched ? '. Контрагент найден в базе и повторно не создан.' : ''}`
			const params = new URLSearchParams({ success: summary })
			router.push(`/contracts/${data.contractId}?${params}`); router.refresh()
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Ошибка загрузки') } finally { setBusy(false) }
	}

	const isFolder = mode === 'folder' || mode === 'attach'
	const folderTotalBytes = folderFiles.reduce((total, file) => total + file.size, 0)
	const folderHasLimitIssue = folderFiles.length > MAX_FOLDER_FILES || folderTotalBytes > MAX_FOLDER_BYTES
	return <form ref={formRef} onSubmit={create} className="grid gap-[16px] xl:grid-cols-[420px_1fr]">
		<Card className="h-fit p-[20px]">
			<div className="text-[15px] font-semibold">1. Что вы хотите загрузить?</div>
			<div className="mt-[12px] grid grid-cols-3 rounded-[10px] bg-raised p-1">
				<button type="button" onClick={() => switchMode('file')} className={`h-[36px] rounded-[8px] text-[11.5px] font-semibold ${mode === 'file' ? 'bg-surface text-brand-ink shadow-sm' : 'text-muted'}`}>Один файл</button>
				<button type="button" onClick={() => switchMode('folder')} className={`h-[36px] rounded-[8px] text-[11.5px] font-semibold ${mode === 'folder' ? 'bg-surface text-brand-ink shadow-sm' : 'text-muted'}`}>Новый договор</button>
				<button type="button" onClick={() => switchMode('attach')} className={`h-[36px] rounded-[8px] text-[11.5px] font-semibold ${mode === 'attach' ? 'bg-surface text-brand-ink shadow-sm' : 'text-muted'}`}>К существующему</button>
			</div>
			{!isFolder ? <><div className="mt-[14px] text-[12.5px] leading-5 text-muted">Загрузите основной договор в DOC, DOCX, XLSX, PDF, TXT, CSV или скан JPG/PNG.</div><input name="file" type="file" required accept=".doc,.docx,.xlsx,.xls,.pdf,.txt,.csv,.jpg,.jpeg,.png" onChange={() => { setParsed(null); setFolderReport(null) }} className="mt-[14px] block w-full rounded-[10px] border border-dashed border-line bg-raised p-[14px] text-[12.5px]" /></> : <>
				<div className="mt-[14px] rounded-[10px] border border-brand/20 bg-brand/5 p-[12px] text-[12px] leading-5 text-muted">{mode === 'attach' ? 'Положите в папку документы с номером договора в названии: «765 — смета.xlsx», «765 — ДС №1.docx», «765 — КМ.dwg». Система найдёт договор и разложит файлы сама.' : 'Выберите папку нового договора. Система найдёт основной файл, распознает реквизиты и распределит остальные документы.'}</div>
				<label className="group mt-[14px] flex min-h-[112px] cursor-pointer items-center gap-3 rounded-[12px] border-2 border-dashed border-line bg-raised/45 px-4 py-4 transition-all duration-200 hover:border-brand/50 hover:bg-brand/5 hover:shadow-[0_10px_26px_rgba(93,63,210,.08)]">
					<input ref={(element) => { if (element) { element.setAttribute('webkitdirectory', ''); element.setAttribute('directory', '') } }} type="file" multiple className="sr-only" onChange={(event) => { setFolderFiles(Array.from(event.target.files ?? [])); setParsed(null); setFolderReport(null); setError('') }} />
					<span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-brand-soft text-brand-ink transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-105"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" /><path d="M12 9v6m0-6-2 2m2-2 2 2" /></svg></span>
					<span className="min-w-0"><b className="block text-[13px] text-ink">{mode === 'attach' ? 'Выбрать папку для прикрепления' : 'Выбрать папку нового договора'}</b><span className="mt-1 block text-[11.5px] leading-4 text-muted">До {MAX_FOLDER_FILES} файлов и 750 МБ. Структура папок и названия файлов сохраняются для автоматического распределения.</span><span className="mt-2 inline-flex rounded-md bg-surface px-2 py-1 text-[10.5px] font-semibold text-brand-ink shadow-sm">Открыть проводник →</span></span>
				</label>
				{folderFiles.length > 0 && <div className="mt-[10px] rounded-[9px] bg-ok-bg px-[11px] py-[9px] text-[12px] font-medium text-ok">Выбрано файлов: {folderFiles.length} из 1000<br/><span className="font-normal">{mode === 'attach' ? 'Автопоиск номера по названиям файлов' : `Предварительный основной: ${chooseMainFile(folderFiles)?.name}`}</span></div>}
			</>}
			{mode !== 'attach' && <button type="button" disabled={busy} onClick={parse} className="brand-gradient mt-[12px] h-[40px] w-full rounded-[10px] text-[13.5px] font-semibold text-white disabled:opacity-60">{busy ? 'Читаю комплект…' : mode === 'folder' ? 'Распознать папку' : 'Распознать реквизиты'}</button>}
			{error && <div className="mt-[12px] rounded-[10px] border border-danger-bd bg-danger-bg p-[11px] text-[12.5px] text-danger">{error}</div>}
			{mode !== 'attach' && !parsed && <button type="button" onClick={fillManually} className="mt-[9px] text-[12px] font-semibold text-brand hover:underline">Заполнить реквизиты вручную →</button>}
			{parsed && <div className="mt-[14px] rounded-[10px] border border-line bg-raised p-[12px]"><div className="flex items-center justify-between"><span className="text-[12.5px] font-semibold">Распознано: {parsed.confidence}%</span><span className="text-[11px] text-muted">{parsed.foundFields.length} полей</span></div><div className="mt-[8px] text-[11.5px] leading-5 text-muted">{parsed.foundFields.join(' · ') || 'Поля не найдены'}</div>{parsed.warnings.map((warning) => <div key={warning} className="mt-[5px] text-[11.5px] text-warn">• {warning}</div>)}</div>}
			{folderReport && <div className="mt-[10px] rounded-[10px] border border-ok-bd bg-ok-bg p-[12px] text-[11.5px] leading-5 text-ok"><div className="font-semibold">Папка проверена: {folderReport.totalFiles} файлов</div><div>Основной файл: {folderReport.primaryFile}</div><div>Текстовых файлов найдено: {folderReport.textCandidates}; разобрано: {folderReport.parsedFiles}</div><div className="mt-2 grid gap-1.5 sm:grid-cols-2">{folderReport.categories.map((item) => <details key={item.key} className="rounded-[7px] border border-ok-bd/70 bg-surface/65 px-2.5 py-1.5 text-muted"><summary className="flex cursor-pointer list-none items-center gap-2"><span className="min-w-0 flex-1 truncate font-semibold text-ink">{item.label}</span><span className="rounded-full bg-ok-bg px-1.5 text-[10px] font-bold text-ok">{item.count}</span></summary><div className="mt-1 border-t border-ok-bd/50 pt-1 text-[10.5px] leading-4 text-faint">{item.files.slice(0, 4).join(' · ')}{item.files.length > 4 ? ` и ещё ${item.files.length - 4}` : ''}</div></details>)}</div>{folderReport.skippedFiles.length > 0 && <div className="mt-2 text-warn">Не прошли автообработку: {folderReport.skippedFiles.length}. Безопасные файлы будут приложены, подозрительные — пропущены.</div>}</div>}
		</Card>

		<Card className="p-[20px]">
			<div className="mb-[16px]"><div className="text-[15px] font-semibold">2. {mode === 'attach' ? 'Проверить привязку файлов' : 'Проверить и сохранить'}</div><div className="mt-[4px] text-[12.5px] text-muted">{mode === 'attach' ? 'Номер можно оставить пустым: система найдёт его в названиях файлов.' : 'Система заполнила реквизиты из файлов. Перед сохранением их можно поправить.'}</div></div>
			{mode === 'attach' ? <div className="flex min-h-[300px] flex-col justify-center gap-[14px] rounded-[10px] border border-dashed border-brand/30 bg-brand/5 p-6"><div><div className="text-[16px] font-semibold text-brand-ink">Автопривязка папки</div><p className="mt-2 text-[12.5px] leading-5 text-muted">Система проверяет названия, находит существующий договор и присваивает документам типы: смета, ДС, счёт, КМ/КЖ/АР, акты и исполнительная документация. Копии пропускаются.</p></div><Field label="Номер договора, если хотите указать вручную"><input name="targetContractNumber" placeholder="Например, 765 или ТЕСТ-701" className={inputClass} /></Field><button type="submit" disabled={busy || !folderFiles.length} className="brand-gradient h-[42px] rounded-[10px] px-[18px] text-[13.5px] font-semibold text-white disabled:opacity-60">{busy ? 'Распределяю файлы…' : `Прикрепить ${folderFiles.length} файлов автоматически`}</button></div> : !parsed ? <div className="grid min-h-[300px] place-items-center rounded-[12px] border border-dashed border-brand/20 bg-[radial-gradient(circle_at_top,rgba(112,71,232,.08),transparent_55%)] px-6 text-center"><div className="max-w-[360px]"><div className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-brand-soft text-[20px] text-brand-ink">✦</div><b className="mt-4 block text-[14px] text-ink">Карточка появится здесь</b><p className="mt-2 text-[12px] leading-5 text-muted">Выберите файл или папку слева, запустите распознавание и проверьте найденные реквизиты перед сохранением.</p><div className="mt-4 grid grid-cols-3 gap-2 text-[10px] font-semibold text-muted"><span className="rounded-lg bg-surface/85 px-2 py-2">1. Выбрать</span><span className="rounded-lg bg-surface/85 px-2 py-2">2. Проверить</span><span className="rounded-lg bg-surface/85 px-2 py-2">3. Сохранить</span></div></div></div> : <div className="flex flex-col gap-[14px]" key={`${parsed.fileName}-${parsed.confidence}`}>
				<div className="grid gap-[14px] md:grid-cols-2"><Field label="Номер договора" required><input name="contractNumber" required defaultValue={parsed.contractNumber} className={inputClass} /></Field><Field label="Дата договора" required><input name="contractDate" type="date" required defaultValue={parsed.contractDate} className={inputClass} /></Field></div>
				<div className="grid gap-[14px] md:grid-cols-[1fr_120px]"><Field label="Сумма" required><input name="amount" required defaultValue={parsed.amount} className={inputClass} /></Field><Field label="Валюта"><select name="currency" defaultValue={parsed.currency} className={selectClass}><option>RUB</option><option>USD</option><option>EUR</option><option>CNY</option></select></Field></div>
				<div className="grid gap-[14px] md:grid-cols-2"><Field label="Контрагент" required><input name="contractorName" defaultValue={parsed.contractorName} className={inputClass} /></Field><Field label="ИНН"><input name="inn" defaultValue={parsed.inn} className={inputClass} inputMode="numeric" /></Field></div>
				<div className="grid gap-[14px] md:grid-cols-2"><Field label="Телефон контрагента"><input name="contractorPhone" defaultValue={parsed.phone} className={inputClass} inputMode="tel" /></Field><Field label="Email контрагента"><input name="contractorEmail" defaultValue={parsed.email} className={inputClass} inputMode="email" /></Field></div>
				<div className="grid gap-[14px] md:grid-cols-2"><Field label="Шифр"><input name="cipher" defaultValue={parsed.cipher} className={inputClass} /></Field><Field label="Тип договора"><select name="kind" defaultValue="SMR" className={selectClass}><option value="SMR">СМР</option><option value="MK">МК</option><option value="PROJECT">Проектный</option></select></Field></div>
				<Field label="Адрес объекта"><input name="objectAddress" defaultValue={parsed.objectAddress} className={inputClass} /></Field><button type="submit" disabled={busy} className="brand-gradient mt-[4px] h-[42px] rounded-[10px] px-[18px] text-[13.5px] font-semibold text-white disabled:opacity-60">{busy ? 'Создаю…' : mode === 'folder' ? `Создать договор и загрузить ${folderFiles.length} файлов` : 'Создать договор и прикрепить файл'}</button>
			</div>}
		</Card>
	</form>
}
