'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'

type ExecutiveDoc = { id: string; name: string }

type Props = {
	contractId: string
	projectSection?: { id: string; code: string } | null
	executiveDocs: ExecutiveDoc[]
	requestedExecutive?: string
	requestedState?: string
	requestedKind?: string
	pr1Mode?: boolean
}

const MAX_FILES = 100

export default function SmartDocumentUpload({
	contractId,
	projectSection = null,
	executiveDocs,
	requestedExecutive = '',
	requestedState = 'SOURCE',
	requestedKind = '',
	pr1Mode = false,
}: Props) {
	const inputRef = useRef<HTMLInputElement>(null)
	const [files, setFiles] = useState<File[]>([])
	const [limitNotice, setLimitNotice] = useState('')
	const [dragging, setDragging] = useState(false)
	const [advanced, setAdvanced] = useState(false)
	const [confirmPr1, setConfirmPr1] = useState(pr1Mode)
	const isProject = Boolean(projectSection)

	function setSelected(next: FileList | File[]) {
		const source = Array.from(next)
		const list = source.slice(0, MAX_FILES)
		setFiles(list)
		setLimitNotice(source.length > MAX_FILES ? `Выбрано ${source.length} файлов: в одну загрузку добавлены первые ${MAX_FILES}. Остальные можно загрузить следующей пачкой.` : '')
		// FileList в input должен совпадать с тем, что показано человеку.
		// Иначе при выборе 160 файлов UI показывал 100, а сервер получал 160 и отклонял всю пачку.
		if (inputRef.current) {
			const transfer = new DataTransfer()
			list.forEach((file) => transfer.items.add(file))
			inputRef.current.files = transfer.files
		}
	}

	function clearFiles() {
		setFiles([])
		setLimitNotice('')
		if (inputRef.current) inputRef.current.value = ''
	}

	return (
		<form action={`/api/contracts/${contractId}/documents`} method="post" encType="multipart/form-data" className="smart-upload-form flex flex-col gap-4">
			{projectSection && <input type="hidden" name="projectSectionId" value={projectSection.id} />}
			{pr1Mode && <input type="hidden" name="confirmPr1Signed" value="on" />}
			{pr1Mode && <input type="hidden" name="kind" value="APPENDIX" />}

			<div className="rounded-[14px] border border-brand/20 bg-[linear-gradient(135deg,rgba(112,71,232,.10),rgba(112,71,232,.025))] px-4 py-3">
				<div className="text-[13px] font-bold text-ink">{pr1Mode ? 'Подписанное Приложение №1' : 'Добавьте файлы к договору'}</div>
				<p className="mt-1 text-[11.5px] leading-5 text-muted">{pr1Mode ? 'Загрузите подписанный заказчиком файл. После отправки договор перейдёт в проектирование, а площадка создастся автоматически.' : <>Перетащите файл или папку документов в область ниже. Для полной папки система сама распределит договор, сметы и проектные файлы через <Link href="/contracts/import" className="font-semibold text-brand-ink hover:underline">умный импорт</Link>.</>}</p>
			</div>

			<label
				className={`smart-upload-dropzone group flex min-h-[196px] cursor-pointer flex-col items-center justify-center rounded-[14px] border-2 border-dashed px-5 py-7 text-center transition-all duration-200 ${dragging ? 'scale-[1.01] border-brand bg-brand/10 shadow-[0_12px_30px_rgba(112,71,232,.12)]' : files.length ? 'border-ok/45 bg-ok/5' : 'border-line bg-raised/30 hover:border-brand/55 hover:bg-brand/5'}`}
				onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
				onDragOver={(event) => event.preventDefault()}
				onDragLeave={() => setDragging(false)}
				onDrop={(event) => { event.preventDefault(); setDragging(false); setSelected(event.dataTransfer.files) }}
			>
				<input ref={inputRef} type="file" name="files" required multiple className="sr-only" onChange={(event) => setSelected(event.currentTarget.files ?? [])} />
				<div className={`grid h-11 w-11 place-items-center rounded-[13px] text-xl transition-transform duration-200 ${files.length ? 'bg-ok/15 text-ok' : 'bg-brand-soft text-brand-ink group-hover:-translate-y-0.5'}`}>{files.length ? '✓' : '↑'}</div>
				{files.length ? <>
					<div className="mt-3 text-[14px] font-bold text-ink">Выбрано файлов: {files.length}</div>
					<div className="mt-1 max-w-full truncate text-[11.5px] text-muted">{files.slice(0, 3).map((file) => file.name).join(' · ')}{files.length > 3 ? ` и ещё ${files.length - 3}` : ''}</div>
					{limitNotice && <div role="status" className="mt-2 max-w-[520px] rounded-[8px] border border-warn/25 bg-warn-bg px-2.5 py-1.5 text-[10.5px] leading-4 text-warn">{limitNotice}</div>}
					<button type="button" onClick={(event) => { event.preventDefault(); clearFiles() }} className="mt-3 rounded-[8px] border border-line bg-surface px-3 py-1.5 text-[11px] font-semibold text-muted transition hover:border-danger/35 hover:text-danger">Очистить</button>
				</> : <>
					<div className="mt-3 text-[14px] font-bold text-ink">Перетащите файлы сюда или нажмите для выбора</div>
					<div className="mt-1 text-[11.5px] text-muted">До 100 файлов за раз · PDF, DOCX, XLSX, DWG, изображения и архивы</div>
				</>}
			</label>

			{!isProject && !pr1Mode && <div className="grid gap-3 sm:grid-cols-2">
				<label className="grid gap-1.5"><span className="text-[11px] font-semibold text-muted">Что загружаем</span><select name="kind" defaultValue={requestedKind || (requestedExecutive ? 'EXECUTIVE' : 'CONTRACT')} className="h-10 rounded-[10px] border border-line bg-surface px-3 text-[12.5px] font-medium outline-none transition focus:border-brand/60">{[['CONTRACT', 'Договор / приложение'], ['ESTIMATE', 'Смета'], ['SOURCE_DATA', 'Исходные данные от заказчика'], ['EXECUTIVE', 'Исполнительная документация'], ['OTHER', 'Другой документ']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
				{executiveDocs.length > 0 && <label className="grid gap-1.5"><span className="text-[11px] font-semibold text-muted">Раздел исполнительной документации</span><select name="executiveDocId" defaultValue={requestedExecutive} className="h-10 rounded-[10px] border border-line bg-surface px-3 text-[12.5px] outline-none transition focus:border-brand/60"><option value="">Не привязывать к разделу</option>{executiveDocs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
			</div>}

			{isProject && <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5"><span className="text-[11px] font-semibold text-muted">Формат проектного файла</span><select name="kind" defaultValue="PROJECT_PDF" className="h-10 rounded-[10px] border border-line bg-surface px-3 text-[12.5px] font-medium outline-none transition focus:border-brand/60"><option value="PROJECT_PDF">Итоговая версия PDF</option><option value="PROJECT_DWG">Исходник DWG</option></select></label><div className="rounded-[10px] border border-brand/15 bg-brand/5 px-3 py-2.5 text-[11.5px] leading-4 text-muted">Раздел {projectSection!.code}. После итогового PDF его можно подтвердить готовым в графике проектов.</div></div>}

			{!isProject && !requestedExecutive && !pr1Mode && <label className={`rounded-[13px] border p-4 transition-all duration-200 ${confirmPr1 ? 'border-ok/40 bg-ok/5 shadow-[0_8px_24px_rgba(40,150,90,.08)]' : 'border-brand/22 bg-brand/5 hover:border-brand/45'}`}>
				<span className="flex items-start gap-3"><input type="checkbox" name="confirmPr1Signed" checked={confirmPr1} onChange={(event) => setConfirmPr1(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand" /><span><b className="block text-[12.5px] text-ink">Это подписанное заказчиком Приложение №1</b><span className="mt-1 block text-[11.5px] leading-5 text-muted">После загрузки система создаст площадку и поставит договор в очередь проектирования КМ/КЖ.</span></span></span>
				{confirmPr1 && <span className="mt-3 grid gap-2 sm:grid-cols-2"><label className="grid gap-1"><span className="text-[10.5px] font-semibold text-muted">Дата подписания ПР1</span><input type="date" name="signedAt" required className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[12px]" /></label><label className="grid gap-1"><span className="text-[10.5px] font-semibold text-muted">Рабочих дней из сметы</span><input type="number" name="workingDays" min="1" max="730" placeholder="Например, 55" className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[12px]" /></label></span>}
			</label>}
			{pr1Mode && <div className="rounded-[13px] border border-ok/30 bg-ok/5 p-4">
				<div className="text-[12.5px] font-bold text-ink">Данные для запуска договора</div>
				<div className="mt-1 text-[11.5px] leading-5 text-muted">Дата подтверждения и срок нужны, чтобы система рассчитала дедлайн. Если срок пока неизвестен, его можно внести позже.</div>
				<div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1"><span className="text-[10.5px] font-semibold text-muted">Дата подписания ПР1</span><input type="date" name="signedAt" required className="h-10 rounded-[9px] border border-line bg-surface px-3 text-[12px]" /></label><label className="grid gap-1"><span className="text-[10.5px] font-semibold text-muted">Рабочих дней из сметы</span><input type="number" name="workingDays" min="1" max="730" placeholder="Например, 55" className="h-10 rounded-[9px] border border-line bg-surface px-3 text-[12px]" /></label></div>
			</div>}

			{!pr1Mode && <details open={advanced} onToggle={(event) => setAdvanced((event.target as HTMLDetailsElement).open)} className="rounded-[11px] border border-line bg-raised/35 px-3 py-2.5">
				<summary className="cursor-pointer list-none text-[11.5px] font-semibold text-muted">Дополнительно: версия и доступ <span className="ml-1 text-brand-ink">{advanced ? '−' : '+'}</span></summary>
				<div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5"><span className="text-[10.5px] font-semibold text-muted">Версия документа</span><select name="state" defaultValue={requestedState} className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[11.5px]"><option value="SOURCE">Актуальный исходник</option><option value="SIGNED">Подписанная версия</option><option value="ARCHIVE">Архивная версия</option></select></label>{!isProject && <label className="flex items-center gap-2 pt-5 text-[11.5px] text-muted"><input type="checkbox" name="isConfidential" className="h-4 w-4 accent-brand" />Конфиденциально — не выдавать наблюдателям</label>}</div>
			</details>
			}

			<div className="flex flex-wrap gap-2 pt-1"><button type="submit" className="brand-gradient inline-flex h-11 items-center justify-center rounded-[10px] px-5 text-[13px] font-bold text-white shadow-[0_8px_20px_rgba(112,71,232,.2)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(112,71,232,.28)]">{confirmPr1 ? 'Загрузить и запустить договор' : 'Загрузить файлы'}</button><a href={isProject ? `/projects?section=${projectSection!.code}` : `/contracts/${contractId}`} className="inline-flex h-11 items-center justify-center rounded-[10px] border border-line bg-surface px-4 text-[12.5px] font-semibold transition hover:bg-raised">Вернуться к договору</a></div>
		</form>
	)
}
