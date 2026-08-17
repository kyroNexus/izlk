'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import FileDropField, { type FileDropFieldResult } from '@/components/FileDropField'
import { DOCUMENT_EXTENSIONS } from '@/lib/upload-constants'

/**
 * Задача A2: выбор/список/прогресс файлов теперь ведёт FileDropField —
 * здесь остаются только поля, специфичные для загрузки в договор
 * (вид документа, раздел исполнительной, ПР1, версия/доступ).
 *
 * Форма (<form action=...>) и её скрытые поля/name-атрибуты остаются
 * настоящими — это fallback без JavaScript: без гидратации сработает
 * обычная нативная отправка через кнопку в <noscript> внизу. С JS кнопка
 * загрузки внутри FileDropField отправляет те же данные через XHR
 * (extraFields), сервер отвечает JSON (задача A3), а onDone переходит
 * по redirectUrl из ответа — туда же, куда ушла бы обычная форма.
 */

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

// Задача B1: AUTO — новое значение по умолчанию, сервер определяет вид
// каждого файла отдельно через classifyDocumentPath. Любой другой явный
// выбор здесь — переопределение на всю пачку, как и раньше.
const KIND_OPTIONS: [string, string][] = [
	['AUTO', 'Определить автоматически'],
	['CONTRACT', 'Договор / приложение'],
	['ESTIMATE', 'Смета'],
	['SOURCE_DATA', 'Исходные данные от заказчика'],
	['EXECUTIVE', 'Исполнительная документация'],
	['OTHER', 'Другой документ'],
]

export default function SmartDocumentUpload({
	contractId,
	projectSection = null,
	executiveDocs,
	requestedExecutive = '',
	requestedState = '',
	requestedKind = '',
	pr1Mode = false,
}: Props) {
	const router = useRouter()
	const isProject = Boolean(projectSection)
	const endpoint = `/api/contracts/${contractId}/documents`

	const [advanced, setAdvanced] = useState(false)
	const [confirmPr1, setConfirmPr1] = useState(pr1Mode)
	const [kind, setKind] = useState(() => (isProject ? 'PROJECT_PDF' : requestedKind || (requestedExecutive ? 'EXECUTIVE' : 'AUTO')))
	const [executiveDocId, setExecutiveDocId] = useState(pr1Mode ? '' : requestedExecutive)
	const [signedAt, setSignedAt] = useState('')
	const [workingDays, setWorkingDays] = useState('')
	const [state, setState] = useState(requestedState || 'AUTO')
	const [isConfidential, setIsConfidential] = useState(false)
	const [status, setStatus] = useState('')

	// required у обычного <input type=date> действует только при нативной
	// отправке — кнопка загрузки внутри FileDropField её не проходит, поэтому
	// то же условие (дата обязательна, если подтверждаем ПР1) проверяем и тут.
	function beforeUpload(): string | null {
		if (!confirmPr1) return null
		if (!signedAt) return 'Укажите дату подписания ПР1'
		if (workingDays.trim()) {
			const parsed = Number.parseInt(workingDays, 10)
			if (!Number.isInteger(parsed) || parsed < 1 || parsed > 730) return 'Срок — целое число от 1 до 730 рабочих дней'
		}
		return null
	}

	function onDone(result: FileDropFieldResult) {
		// С задачи A3 эндпоинт отвечает JSON напрямую (200, без редиректа) —
		// redirectUrl в теле ответа несёт тот же адрес, куда ушла бы обычная
		// форма: карточка договора, /projects?section=... или снова эта
		// страница с ?error=. responseUrl (xhr.responseURL) — запасной вариант
		// для эндпоинтов, которые пока просто редиректят и JSON не отдают.
		const raw = result.raw as { redirectUrl?: string; error?: string } | undefined
		const target = raw?.redirectUrl ?? result.responseUrl
		if (target) { router.push(target); router.refresh(); return }
		setStatus(raw?.error || (result.ok ? `Загружено файлов: ${result.uploadedCount}` : 'Не удалось загрузить файлы. Повторите попытку.'))
	}

	const extraFields: Record<string, string> = {
		projectSectionId: projectSection?.id ?? '',
		confirmPr1Signed: confirmPr1 ? 'on' : '',
		kind: pr1Mode ? 'APPENDIX' : kind,
		executiveDocId,
		signedAt,
		workingDays,
		state,
		isConfidential: isConfidential ? 'on' : '',
	}

	return (
		<form action={endpoint} method="post" encType="multipart/form-data" className="smart-upload-form flex flex-col gap-4">
			{projectSection && <input type="hidden" name="projectSectionId" value={projectSection.id} />}
			{pr1Mode && <input type="hidden" name="confirmPr1Signed" value="on" />}
			{pr1Mode && <input type="hidden" name="kind" value="APPENDIX" />}

			<div className="smart-upload-intro rounded-[14px] border border-brand/20 bg-[linear-gradient(135deg,rgba(112,71,232,.10),rgba(112,71,232,.025))] px-4 py-3">
				<div className="text-base font-bold text-ink">{pr1Mode ? 'Подписанное Приложение №1' : 'Добавьте файлы к договору'}</div>
				<p className="mt-1 text-xs leading-5 text-muted">{pr1Mode ? 'Загрузите подписанный заказчиком файл. После отправки договор перейдёт в проектирование, а площадка создастся автоматически.' : <>Перетащите файл или папку документов в область ниже. Для полной папки система сама распределит договор, сметы и проектные файлы через <Link href="/contracts/import" className="font-semibold text-brand-ink hover:underline">умный импорт</Link>.</>}</p>
			</div>

			<FileDropField
				endpoint={endpoint}
				accept={DOCUMENT_EXTENSIONS}
				maxFiles={100}
				multiple
				required
				extraFields={extraFields}
				beforeUpload={beforeUpload}
				onDone={onDone}
				uploadLabel={confirmPr1 ? 'Загрузить и запустить договор' : 'Загрузить файлы'}
				hint="До 100 файлов за раз · PDF, DOCX, XLSX, DWG, изображения и архивы"
			/>
			{status && <div role="status" className="rounded-tight border border-line bg-raised px-2.5 py-1.5 text-xs text-muted">{status}</div>}

			{!isProject && !pr1Mode && <div className="grid gap-3 sm:grid-cols-2">
				<label className="grid gap-1.5"><span className="text-xs font-semibold text-muted">Что загружаем</span><select name="kind" value={kind} onChange={(event) => setKind(event.target.value)} className="h-10 rounded-control border border-line bg-surface px-3 text-sm font-medium outline-none transition focus:border-brand/60">{KIND_OPTIONS.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}</select></label>
				{executiveDocs.length > 0 && <label className="grid gap-1.5"><span className="text-xs font-semibold text-muted">Раздел исполнительной документации</span><select name="executiveDocId" value={executiveDocId} onChange={(event) => setExecutiveDocId(event.target.value)} className="h-10 rounded-control border border-line bg-surface px-3 text-sm outline-none transition focus:border-brand/60"><option value="">Не привязывать к разделу</option>{executiveDocs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
			</div>}

			{isProject && <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5"><span className="text-xs font-semibold text-muted">Формат проектного файла</span><select name="kind" value={kind} onChange={(event) => setKind(event.target.value)} className="h-10 rounded-control border border-line bg-surface px-3 text-sm font-medium outline-none transition focus:border-brand/60"><option value="PROJECT_PDF">Итоговая версия PDF</option><option value="PROJECT_DWG">Исходник DWG</option></select></label><div className="rounded-control border border-brand/15 bg-brand/5 px-3 py-2.5 text-xs leading-4 text-muted">Раздел {projectSection!.code}. После итогового PDF его можно подтвердить готовым в графике проектов.</div></div>}

			{!isProject && !requestedExecutive && !pr1Mode && <label className={`rounded-[13px] border p-4 transition-all duration-200 ${confirmPr1 ? 'border-ok/40 bg-ok/5 shadow-[0_8px_24px_rgba(40,150,90,.08)]' : 'border-brand/22 bg-brand/5 hover:border-brand/45'}`}>
				<span className="flex items-start gap-3"><input type="checkbox" name="confirmPr1Signed" checked={confirmPr1} onChange={(event) => setConfirmPr1(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand" /><span><b className="block text-sm text-ink">Это подписанное заказчиком Приложение №1</b><span className="mt-1 block text-xs leading-5 text-muted">После загрузки система создаст площадку и поставит договор в очередь проектирования КМ/КЖ.</span></span></span>
				{confirmPr1 && <span className="mt-3 grid gap-2 sm:grid-cols-2"><label className="grid gap-1"><span className="text-xs font-semibold text-muted">Дата подписания ПР1</span><input type="date" name="signedAt" required value={signedAt} onChange={(event) => setSignedAt(event.target.value)} className="h-9 rounded-tight border border-line bg-surface px-2.5 text-sm" /></label><label className="grid gap-1"><span className="text-xs font-semibold text-muted">Рабочих дней из сметы</span><input type="number" name="workingDays" min="1" max="730" placeholder="Например, 55" value={workingDays} onChange={(event) => setWorkingDays(event.target.value)} className="h-9 rounded-tight border border-line bg-surface px-2.5 text-sm" /></label></span>}
			</label>}
			{pr1Mode && <div className="rounded-[13px] border border-ok/30 bg-ok/5 p-4">
				<div className="text-sm font-bold text-ink">Данные для запуска договора</div>
				<div className="mt-1 text-xs leading-5 text-muted">Дата подтверждения и срок нужны, чтобы система рассчитала дедлайн. Если срок пока неизвестен, его можно внести позже.</div>
				<div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1"><span className="text-xs font-semibold text-muted">Дата подписания ПР1</span><input type="date" name="signedAt" required value={signedAt} onChange={(event) => setSignedAt(event.target.value)} className="h-10 rounded-tight border border-line bg-surface px-3 text-sm" /></label><label className="grid gap-1"><span className="text-xs font-semibold text-muted">Рабочих дней из сметы</span><input type="number" name="workingDays" min="1" max="730" placeholder="Например, 55" value={workingDays} onChange={(event) => setWorkingDays(event.target.value)} className="h-10 rounded-tight border border-line bg-surface px-3 text-sm" /></label></div>
			</div>}

			{!pr1Mode && <details open={advanced} onToggle={(event) => setAdvanced((event.target as HTMLDetailsElement).open)} className="rounded-control border border-line bg-raised/35 px-3 py-2.5">
				<summary className="cursor-pointer list-none text-xs font-semibold text-muted">Дополнительно: версия и доступ <span className="ml-1 text-brand-ink">{advanced ? '−' : '+'}</span></summary>
				<div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5"><span className="text-xs font-semibold text-muted">Версия документа</span><select name="state" value={state} onChange={(event) => setState(event.target.value)} className="h-9 rounded-tight border border-line bg-surface px-2.5 text-xs"><option value="AUTO">Определить автоматически</option><option value="SOURCE">Актуальный исходник</option><option value="SIGNED">Подписанная версия</option><option value="ARCHIVE">Архивная версия</option></select></label>{!isProject && <label className="flex items-center gap-2 pt-5 text-xs text-muted"><input type="checkbox" name="isConfidential" checked={isConfidential} onChange={(event) => setIsConfidential(event.target.checked)} className="h-4 w-4 accent-brand" />Конфиденциально — не выдавать наблюдателям</label>}</div>
			</details>
			}

			<div className="flex flex-wrap gap-2 pt-1">
				{/* Кнопка внутри FileDropField — основной путь с JS. Эта — единственный
				    способ отправить форму без JavaScript, поэтому вне <noscript> её
				    показывать не нужно: с гидратацией она была бы вторым, путающим
				    «главным действием» на экране рядом с кнопкой самого поля. */}
				<noscript>
					<button type="submit" className="brand-gradient inline-flex h-11 items-center justify-center rounded-control px-5 text-base font-bold text-white shadow-[0_8px_20px_rgba(112,71,232,.2)]">
						{confirmPr1 ? 'Загрузить и запустить договор' : 'Загрузить файлы'}
					</button>
				</noscript>
				<a href={isProject ? `/projects?section=${projectSection!.code}` : `/contracts/${contractId}`} className="inline-flex h-11 items-center justify-center rounded-control border border-line bg-surface px-4 text-sm font-semibold transition hover:bg-raised">Вернуться к договору</a>
			</div>
		</form>
	)
}
