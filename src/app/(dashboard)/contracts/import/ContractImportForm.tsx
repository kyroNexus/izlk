'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Field, inputClass, ProgressBar, selectClass } from '@/components/ui'
import ContractorTypeFields from '@/components/ContractorTypeFields'
import { collectEntries, readEntriesFromDataTransfer } from '@/lib/file-system-entries'
import { formatBytes } from '@/lib/format'
import { MAX_UPLOAD_BYTES } from '@/lib/upload-constants'
import type { FolderParseReport, ParsedContract } from '@/lib/contract-parser'

type Mode = 'file' | 'folder' | 'attach'
/** file + путь внутри выбранной папки. Не берём file.webkitRelativePath —
 *  браузер выставляет его только для файлов из <input webkitdirectory>,
 *  а не для тех, что пришли через drag&drop (задача: подключить drag&drop
 *  к этой же папочной области — раньше там не было ни одного обработчика,
 *  несмотря на то что рамка выглядела как настоящая дропзона). */
type FolderFile = { file: File; relativePath: string }

const MAX_FOLDER_FILES = 1000
const MAX_FOLDER_BYTES = 750 * 1024 * 1024
// Общий потолок на обход перетащенной папки — защита от случайно
// перетащенной гигантской директории. Чуть щедрее MAX_FOLDER_FILES, чтобы
// усечение до реального лимита с понятным сообщением происходило ниже
// (folderHasLimitIssue), а не тихо на середине обхода.
const MAX_TRAVERSED_ENTRIES = MAX_FOLDER_FILES + 100
// Режим "Один файл" — это ОСНОВНОЙ читаемый документ договора, не архив и не
// чертёж (для них — "Новый договор"/папка). Единственный источник для accept
// у input'а и для реальной проверки ниже — раньше accept был только у
// input'а, а сам браузер его не обязан соблюдать: пользователь легко выбирает
// файл любого формата (drag&drop, "Все файлы" в диалоге ОС), и до этой правки
// ничего не мешало отправить 200 МБ архив через всю сеть только затем, чтобы
// получить 400 с сервера — задача найдена по жалобе "0% минуту, потом бабах".
const SINGLE_FILE_EXTENSIONS = ['.doc', '.docx', '.xlsx', '.xls', '.pdf', '.txt', '.csv', '.jpg', '.jpeg', '.png']

function chooseMainFile(files: FolderFile[]) {
	const parsable = files.filter(({ file }) => /\.(doc|docx|xlsx?|pdf|txt|csv|png|jpe?g)$/i.test(file.name))
	return (parsable.find(({ file }) => /договор|контракт/i.test(file.name)) ?? parsable[0] ?? files[0])?.file
}

/**
 * И "Распознать папку", и "Создать договор" отправляют весь комплект файлов
 * (payload() ниже включает все folderFiles в обоих случаях) — на большой
 * папке это ощутимая по времени сетевая передача, а fetch() не даёт следить
 * за её прогрессом (нет upload.onprogress). XHR — тот же приём, что уже
 * используется в FileDropField (задача A1). Отдельно от процента показываем
 * фазу "Обрабатываю на сервере…" после того как тело запроса ушло целиком —
 * реального прогресса разбора на сервере без очереди (задача D1, не сделана)
 * нет, но человек хотя бы видит, что дело не в зависшей загрузке.
 */
function submitWithProgress(url: string, body: FormData, onProgress: (percent: number) => void, onUploaded: () => void): Promise<any> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest()
		xhr.open('POST', url)
		xhr.setRequestHeader('Accept', 'application/json')
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
		}
		xhr.upload.onload = () => { onProgress(100); onUploaded() }
		xhr.onload = () => {
			let data: unknown
			try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {} }
			catch { reject(new Error('Распознавание не завершилось: сервер вернул неполный ответ. Повторите попытку — повреждённые файлы будут пропущены, остальные сохранятся.')); return }
			if (xhr.status < 200 || xhr.status >= 300) { reject(new Error((data as { error?: string })?.error || 'Запрос не выполнен')); return }
			resolve(data)
		}
		xhr.onerror = () => reject(new Error('Сбой сети — повторите попытку'))
		xhr.send(body)
	})
}

export default function ContractImportForm() {
	const router = useRouter()
	const formRef = useRef<HTMLFormElement>(null)
	const [mode, setMode] = useState<Mode>('folder')
	const [folderFiles, setFolderFiles] = useState<FolderFile[]>([])
	const [parsed, setParsed] = useState<ParsedContract | null>(null)
	const [folderReport, setFolderReport] = useState<FolderParseReport | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [dragging, setDragging] = useState(false)
	const [reading, setReading] = useState(false)
	const [uploadPercent, setUploadPercent] = useState(0)
	const [uploaded, setUploaded] = useState(false)

	// Общий текст для кнопки, пока идёт запрос: сначала реальный процент
	// передачи файлов, после — что сервер уже читает/сохраняет присланное.
	function busyLabel(base: string) {
		if (!busy) return base
		return uploaded ? 'Обрабатываю на сервере…' : `Загружаю: ${uploadPercent}%`
	}

	function fillManually() {
		setParsed({ fileName: 'manual-entry', contractNumber: '', contractDate: '', amount: '', currency: 'RUB', contractorName: '', contractorType: '', inn: '', cipher: '', objectAddress: '', confidence: 0, foundFields: [], warnings: ['Автораспознавание пропущено. Заполните реквизиты по документу вручную и сохраните файл.'], preview: '' })
		setError('')
	}

	function switchMode(next: Mode) { setMode(next); setParsed(null); setFolderReport(null); setError(''); setFolderFiles([]) }

	// accept у input — только подсказка диалогу ОС, браузер её не навязывает:
	// drag&drop или "Все файлы" в диалоге легко проносят мимо неё что угодно.
	// Раньше здесь не было никакой реальной проверки — несовместимый или
	// слишком большой файл целиком уезжал на сервер по сети и только там
	// получал отказ, вместо мгновенного сообщения на месте.
	function onSingleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
		setParsed(null); setFolderReport(null)
		const file = event.target.files?.[0]
		if (!file) { setError(''); return }
		const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
		if (!SINGLE_FILE_EXTENSIONS.includes(ext)) {
			setError(`Формат ${ext || '?'} здесь не подходит — нужен DOC, DOCX, XLSX, XLS, PDF, TXT, CSV или скан JPG/PNG. Для архива или папки с документами используйте «Новый договор» слева.`)
			event.target.value = ''
			return
		}
		if (file.size > MAX_UPLOAD_BYTES) {
			setError(`Файл больше допустимых ${formatBytes(MAX_UPLOAD_BYTES)}`)
			event.target.value = ''
			return
		}
		setError('')
	}

	function acceptFolderFiles(files: FolderFile[]) {
		setFolderFiles(files)
		setParsed(null); setFolderReport(null); setError('')
	}

	// Область "Выбрать папку" визуально выглядела как настоящая дропзона
	// (пунктирная рамка, как у FileDropField), но drag&drop сюда не был
	// подключён вообще — перетаскивание либо ничего не делало, либо браузер
	// пытался открыть папку как обычную навигацию. Тот же приём обхода папки,
	// что и в FileDropField (задача A1), теперь общий модуль
	// src/lib/file-system-entries.ts.
	async function onFolderDrop(event: React.DragEvent<HTMLLabelElement>) {
		event.preventDefault()
		setDragging(false)
		if (reading) return
		const entries = readEntriesFromDataTransfer(event.dataTransfer.items)
		if (entries) {
			setReading(true)
			try {
				const collected = await collectEntries(entries, MAX_TRAVERSED_ENTRIES)
				acceptFolderFiles(collected.map(({ file, relativePath }) => ({ file, relativePath })))
			} finally {
				setReading(false)
			}
			return
		}
		// Браузер не поддерживает entries API или перетащили не файлы/папку из
		// проводника (например, содержимое другой вкладки) — плоский список
		// без раскрытия структуры, как максимум, на который тут можно рассчитывать.
		acceptFolderFiles(Array.from(event.dataTransfer.files).map((file) => ({ file, relativePath: file.name })))
	}

	function payload(form: HTMLFormElement) {
		const data = new FormData(form)
		if (mode === 'folder' || mode === 'attach') {
			const main = folderReport ? folderFiles.find((item) => item.relativePath === folderReport.primaryFile)?.file ?? chooseMainFile(folderFiles) : chooseMainFile(folderFiles)
			data.delete('file')
			if (mode === 'folder' && main) data.append('file', main, main.name)
			if (mode === 'attach') data.set('operation', 'attach')
			for (const { file, relativePath } of folderFiles) {
				data.append('files', file, file.name)
				data.append('relativePaths', relativePath)
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
		setBusy(true); setError(''); setParsed(null); setFolderReport(null); setUploadPercent(0); setUploaded(false)
		try {
			const data = payload(form)
			if (mode !== 'folder') for (const key of ['files', 'relativePaths']) data.delete(key)
			const result = await submitWithProgress('/api/contracts/parse', data, setUploadPercent, () => setUploaded(true)) as Partial<ParsedContract> & { error?: string; parsed?: ParsedContract; folder?: FolderParseReport }
			setParsed(result.parsed ?? result as ParsedContract)
			setFolderReport(result.folder ?? null)
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Ошибка распознавания') } finally { setBusy(false) }
	}

	async function create(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (isFolder && folderHasLimitIssue && folderFiles.length > MAX_FOLDER_FILES) { setError(`В одной папке можно загрузить до ${MAX_FOLDER_FILES} файлов.`); return }
		if (isFolder && folderTotalBytes > MAX_FOLDER_BYTES) { setError('Папка больше 750 МБ. Перенесите её в Inbox на сервере.'); return }
		setBusy(true); setError(''); setUploadPercent(0); setUploaded(false)
		try {
			const data = await submitWithProgress('/api/contracts/import', payload(event.currentTarget), setUploadPercent, () => setUploaded(true))
			const imported = Number(data.importedFiles ?? 0)
			const skipped = Number(data.skippedFiles ?? 0)
			const summary = `Загружено файлов: ${imported}${skipped ? `. Пропущено: ${skipped}; причины есть в журнале импорта.` : ''}${data.contractorMatched ? '. Контрагент найден в базе и повторно не создан.' : ''}`
			const params = new URLSearchParams({ success: summary })
			router.push(`/contracts/${data.contractId}?${params}`); router.refresh()
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Ошибка загрузки') } finally { setBusy(false) }
	}

	const isFolder = mode === 'folder' || mode === 'attach'
	const folderTotalBytes = folderFiles.reduce((total, { file }) => total + file.size, 0)
	const folderHasLimitIssue = folderFiles.length > MAX_FOLDER_FILES || folderTotalBytes > MAX_FOLDER_BYTES
	return <form ref={formRef} onSubmit={create} className="grid gap-4 xl:grid-cols-[420px_1fr]">
		<Card className="h-fit p-5">
			<div className="text-md font-semibold">1. Что вы хотите загрузить?</div>
			<div className="mt-[12px] grid grid-cols-3 rounded-control bg-raised p-1">
				<button type="button" onClick={() => switchMode('file')} className={`h-control rounded-tight text-xs font-semibold ${mode === 'file' ? 'bg-surface text-brand-ink shadow-sm' : 'text-muted'}`}>Один файл</button>
				<button type="button" onClick={() => switchMode('folder')} className={`h-control rounded-tight text-xs font-semibold ${mode === 'folder' ? 'bg-surface text-brand-ink shadow-sm' : 'text-muted'}`}>Новый договор</button>
				<button type="button" onClick={() => switchMode('attach')} className={`h-control rounded-tight text-xs font-semibold ${mode === 'attach' ? 'bg-surface text-brand-ink shadow-sm' : 'text-muted'}`}>К существующему</button>
			</div>
			{!isFolder ? <><div className="mt-[14px] text-sm leading-5 text-muted">Загрузите основной договор в DOC, DOCX, XLSX, PDF, TXT, CSV или скан JPG/PNG.</div><input name="file" type="file" required accept={SINGLE_FILE_EXTENSIONS.join(',')} onChange={onSingleFileChange} className="mt-[14px] block w-full rounded-control border border-dashed border-line bg-raised p-3.5 text-sm" /></> : <>
				<div className="mt-[14px] rounded-control border border-brand/20 bg-brand/5 p-3 text-sm leading-5 text-muted">{mode === 'attach' ? 'Положите в папку документы с номером договора в названии: «765 — смета.xlsx», «765 — ДС №1.docx», «765 — КМ.dwg». Система найдёт договор и разложит файлы сама.' : 'Выберите папку нового договора. Система найдёт основной файл, распознает реквизиты и распределит остальные документы.'}</div>
				<label
					className={`group mt-[14px] flex min-h-[112px] items-center gap-3 rounded-[12px] border-2 border-dashed px-4 py-4 transition-all duration-200 ${reading ? 'cursor-wait opacity-70' : 'cursor-pointer'} ${dragging ? 'scale-[1.01] border-brand bg-brand/10 shadow-[0_10px_26px_rgba(93,63,210,.08)]' : 'border-line bg-raised/45 hover:border-brand/50 hover:bg-brand/5 hover:shadow-[0_10px_26px_rgba(93,63,210,.08)]'}`}
					onDragEnter={(event) => { event.preventDefault(); if (!reading) setDragging(true) }}
					onDragOver={(event) => event.preventDefault()}
					onDragLeave={() => setDragging(false)}
					onDrop={onFolderDrop}
				>
					<input ref={(element) => { if (element) { element.setAttribute('webkitdirectory', ''); element.setAttribute('directory', '') } }} type="file" multiple disabled={reading} className="sr-only" onChange={(event) => acceptFolderFiles(Array.from(event.target.files ?? []).map((file) => ({ file, relativePath: file.webkitRelativePath || file.name })))} />
					<span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-brand-soft text-brand-ink transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-105">{reading ? <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-9-9" strokeLinecap="round" /></svg> : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" /><path d="M12 9v6m0-6-2 2m2-2 2 2" /></svg>}</span>
					<span className="min-w-0"><b className="block text-base text-ink">{reading ? 'Читаю папку…' : mode === 'attach' ? 'Перетащите или выберите папку для прикрепления' : 'Перетащите или выберите папку нового договора'}</b><span className="mt-1 block text-xs leading-4 text-muted">До {MAX_FOLDER_FILES} файлов и 750 МБ. Структура папок и названия файлов сохраняются для автоматического распределения.</span>{!reading && <span className="mt-2 inline-flex rounded-md bg-surface px-2 py-1 text-xs font-semibold text-brand-ink shadow-sm">Открыть проводник →</span>}</span>
				</label>
				{folderFiles.length > 0 && <div className="mt-[10px] rounded-tight bg-ok-bg px-2.5 py-2 text-sm font-medium text-ok">Выбрано файлов: {folderFiles.length} из 1000<br/><span className="font-normal">{mode === 'attach' ? 'Автопоиск номера по названиям файлов' : `Предварительный основной: ${chooseMainFile(folderFiles)?.name}`}</span></div>}
			</>}
			{mode !== 'attach' && <button type="button" disabled={busy} onClick={parse} className="brand-gradient mt-[12px] h-control w-full rounded-control text-base font-semibold text-white disabled:opacity-60">{busyLabel(mode === 'folder' ? 'Распознать папку' : 'Распознать реквизиты')}</button>}
			{busy && <div className="mt-2"><ProgressBar percent={uploaded ? 100 : uploadPercent} tone={uploaded ? 'muted' : 'brand'} /></div>}
			{error && <div className="mt-[12px] rounded-control border border-danger-bd bg-danger-bg p-2.5 text-sm text-danger">{error}</div>}
			{mode !== 'attach' && !parsed && <button type="button" onClick={fillManually} className="mt-[9px] text-sm font-semibold text-brand hover:underline">Заполнить реквизиты вручную →</button>}
			{parsed && <div className="mt-[14px] rounded-control border border-line bg-raised p-3"><div className="flex items-center justify-between"><span className="text-sm font-semibold">Распознано: {parsed.confidence}%</span><span className="text-xs text-muted">{parsed.foundFields.length} полей</span></div><div className="mt-[8px] text-xs leading-5 text-muted">{parsed.foundFields.join(' · ') || 'Поля не найдены'}</div>{parsed.warnings.map((warning) => <div key={warning} className="mt-[5px] text-xs text-warn">• {warning}</div>)}</div>}
			{folderReport && <div className="mt-[10px] rounded-control border border-ok-bd bg-ok-bg p-3 text-xs leading-5 text-ok"><div className="font-semibold">Папка проверена: {folderReport.totalFiles} файлов</div><div>Основной файл: {folderReport.primaryFile}</div><div>Текстовых файлов найдено: {folderReport.textCandidates}; разобрано: {folderReport.parsedFiles}</div><div className="mt-2 grid gap-1.5 sm:grid-cols-2">{folderReport.categories.map((item) => <details key={item.key} className="rounded-tight border border-ok-bd/70 bg-surface/65 px-2.5 py-1.5 text-muted"><summary className="flex cursor-pointer list-none items-center gap-2"><span className="min-w-0 flex-1 truncate font-semibold text-ink">{item.label}</span><span className="rounded-full bg-ok-bg px-1.5 text-2xs font-bold text-ok">{item.count}</span></summary><div className="mt-1 border-t border-ok-bd/50 pt-1 text-xs leading-4 text-faint">{item.files.slice(0, 4).join(' · ')}{item.files.length > 4 ? ` и ещё ${item.files.length - 4}` : ''}</div></details>)}</div>{folderReport.skippedFiles.length > 0 && <div className="mt-2 text-warn">Не прошли автообработку: {folderReport.skippedFiles.length}. Безопасные файлы будут приложены, подозрительные — пропущены.</div>}</div>}
		</Card>

		<Card className="p-5">
			<div className="mb-[16px]"><div className="text-md font-semibold">2. {mode === 'attach' ? 'Проверить привязку файлов' : 'Проверить и сохранить'}</div><div className="mt-[4px] text-sm text-muted">{mode === 'attach' ? 'Номер можно оставить пустым: система найдёт его в названиях файлов.' : 'Система заполнила реквизиты из файлов. Перед сохранением их можно поправить.'}</div></div>
			{mode === 'attach' ? <div className="flex min-h-[300px] flex-col justify-center gap-3.5 rounded-control border border-dashed border-brand/30 bg-brand/5 p-6"><div><div className="text-md font-semibold text-brand-ink">Автопривязка папки</div><p className="mt-2 text-sm leading-5 text-muted">Система проверяет названия, находит существующий договор и присваивает документам типы: смета, ДС, счёт, КМ/КЖ/АР, акты и исполнительная документация. Копии пропускаются.</p></div><Field label="Номер договора, если хотите указать вручную"><input name="targetContractNumber" placeholder="Например, 765 или ТЕСТ-701" className={inputClass} /></Field><button type="submit" disabled={busy || !folderFiles.length} className="brand-gradient h-[42px] rounded-control px-4 text-base font-semibold text-white disabled:opacity-60">{busyLabel(`Прикрепить ${folderFiles.length} файлов автоматически`)}</button>{busy && <ProgressBar percent={uploaded ? 100 : uploadPercent} tone={uploaded ? 'muted' : 'brand'} />}</div> : !parsed ? <div className="grid min-h-[300px] place-items-center rounded-[12px] border border-dashed border-brand/20 bg-[radial-gradient(circle_at_top,rgba(112,71,232,.08),transparent_55%)] px-6 text-center"><div className="max-w-[360px]"><div className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-brand-soft text-xl text-brand-ink">✦</div><b className="mt-4 block text-base text-ink">Карточка появится здесь</b><p className="mt-2 text-sm leading-5 text-muted">Выберите файл или папку слева, запустите распознавание и проверьте найденные реквизиты перед сохранением.</p><div className="mt-4 grid grid-cols-3 gap-2 text-2xs font-semibold text-muted"><span className="rounded-lg bg-surface/85 px-2 py-2">1. Выбрать</span><span className="rounded-lg bg-surface/85 px-2 py-2">2. Проверить</span><span className="rounded-lg bg-surface/85 px-2 py-2">3. Сохранить</span></div></div></div> : <div className="flex flex-col gap-3.5" key={`${parsed.fileName}-${parsed.confidence}`}>
				<div className="grid gap-3.5 md:grid-cols-2"><Field label="Номер договора" required><input name="contractNumber" required defaultValue={parsed.contractNumber} className={inputClass} /></Field><Field label="Дата договора" required><input name="contractDate" type="date" required defaultValue={parsed.contractDate} className={inputClass} /></Field></div>
				<div className="grid gap-3.5 md:grid-cols-[1fr_120px]"><Field label="Сумма" required><input name="amount" required defaultValue={parsed.amount} className={inputClass} /></Field><Field label="Валюта"><select name="currency" defaultValue={parsed.currency} className={selectClass}><option>RUB</option><option>USD</option><option>EUR</option><option>CNY</option></select></Field></div>
				<div className="grid gap-3.5 md:grid-cols-2"><Field label="Контрагент" required><input name="contractorName" defaultValue={parsed.contractorName} className={inputClass} /></Field><Field label="ИНН"><input name="inn" defaultValue={parsed.inn} className={inputClass} inputMode="numeric" /></Field></div>
				<ContractorTypeFields defaultType={parsed.contractorType || 'LEGAL'} />
				<div className="grid gap-3.5 md:grid-cols-2"><Field label="Телефон контрагента"><input name="contractorPhone" defaultValue={parsed.phone} className={inputClass} inputMode="tel" /></Field><Field label="Email контрагента"><input name="contractorEmail" defaultValue={parsed.email} className={inputClass} inputMode="email" /></Field></div>
				<div className="grid gap-3.5 md:grid-cols-2"><Field label="Шифр"><input name="cipher" defaultValue={parsed.cipher} className={inputClass} /></Field><Field label="Тип договора"><select name="kind" defaultValue="SMR" className={selectClass}><option value="SMR">СМР</option><option value="MK">МК</option><option value="PROJECT">Проектный</option></select></Field></div>
				<Field label="Адрес объекта"><input name="objectAddress" defaultValue={parsed.objectAddress} className={inputClass} /></Field><button type="submit" disabled={busy} className="brand-gradient mt-[4px] h-[42px] rounded-control px-4 text-base font-semibold text-white disabled:opacity-60">{busyLabel(mode === 'folder' ? `Создать договор и загрузить ${folderFiles.length} файлов` : 'Создать договор и прикрепить файл')}</button>
				{busy && <ProgressBar percent={uploaded ? 100 : uploadPercent} tone={uploaded ? 'muted' : 'brand'} />}
			</div>}
		</Card>
	</form>
}
