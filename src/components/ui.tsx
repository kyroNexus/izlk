import type { ReactNode } from 'react'
import type { ContractStatus, ExecStatus } from '@prisma/client'
import { Inbox } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Icon from '@/components/Icon'

export function RichEmptyState({ title, description, icon = Inbox, primaryAction, secondaryAction }: { title: string; description: ReactNode; icon?: LucideIcon; primaryAction?: ReactNode; secondaryAction?: ReactNode }) {
	return <div className="ui-empty-state mx-3 my-3 rounded-[14px] border border-dashed border-line px-4 py-8 text-center"><span aria-hidden="true" className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-brand-ink"><Icon icon={icon} size={18} /></span><h2 className="text-base font-semibold text-ink">{title}</h2><p className="mx-auto mt-1 max-w-md text-sm leading-5 text-muted">{description}</p>{(primaryAction || secondaryAction) && <div className="mt-4 flex flex-wrap justify-center gap-2">{primaryAction}{secondaryAction}</div>}</div>
}

/* ---------------- Карточка ---------------- */

export function Card({ children, className = '', id, ...rest }: { children: ReactNode; className?: string; id?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, 'id' | 'className' | 'children'>) {
	return (
		<div
			id={id}
			className={`rounded-[18px] border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_rgba(43,31,102,.035)] transition-[border-color,box-shadow] duration-200 ease-out hover:border-brand/20 hover:shadow-[0_2px_4px_rgba(16,24,40,.05),0_14px_32px_rgba(72,50,154,.09)] ${className}`}
			{...rest}
		>
			{children}
		</div>
	)
}

export function CardHeader({ title, extra, className = '' }: { title: string; extra?: ReactNode; className?: string }) {
	return (
		<div className={`flex items-center gap-3 border-b border-line-soft px-5 py-3.5 ${className}`}>
			<div className="text-base font-bold tracking-[-.01em]">{title}</div>
			{extra != null && <div className="ml-auto text-sm text-faint">{extra}</div>}
		</div>
	)
}

/* ---------------- Чипы статусов ---------------- */

type ChipTone = 'ok' | 'warn' | 'off' | 'brand' | 'danger'

const CHIP_TONE: Record<ChipTone, string> = {
	ok: 'bg-ok-bg text-ok border-ok-bd',
	warn: 'bg-warn-bg text-warn border-warn-bd',
	off: 'bg-off-bg text-off border-off-bd',
	brand: 'bg-brand text-white border-transparent',
	danger: 'bg-danger-bg text-danger border-danger-bd',
}

export function Chip({ tone, children, dot = true }: { tone: ChipTone; children: ReactNode; dot?: boolean }) {
	return (
		<span
			className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 text-xs font-medium ${CHIP_TONE[tone]}`}
		>
			{dot && tone !== 'brand' && <span className="h-[5px] w-[5px] rounded-full bg-current opacity-80" />}
			{children}
		</span>
	)
}

/** Статус договора: ACTIVE / CLOSED / ARCHIVED */
export function StatusChip({ status }: { status: ContractStatus }) {
	if (status === 'ACTIVE') return <Chip tone="ok">{'\u0410\u043a\u0442\u0438\u0432\u0435\u043d'}</Chip>
	if (status === 'CLOSED') return <Chip tone="off">{'\u0417\u0430\u043a\u0440\u044b\u0442'}</Chip>
	return <Chip tone="warn">{'\u0412 \u0430\u0440\u0445\u0438\u0432\u0435'}</Chip>
}

/** Статус исполнительного документа: READY / NOT_READY / IN_PROGRESS */
export function ExecStatusChip({ status }: { status: ExecStatus }) {
	if (status === 'READY') return <Chip tone="ok">{'\u0413\u043e\u0442\u043e\u0432'}</Chip>
	if (status === 'IN_PROGRESS')
		return (
			<Chip tone="brand" dot={false}>
				{'\u0412 \u043f\u0440\u043e\u0446\u0435\u0441\u0441\u0435'}
			</Chip>
		)
	return <Chip tone="off">{'\u041d\u0435 \u0433\u043e\u0442\u043e\u0432'}</Chip>
}

/* ---------------- Иконка файла по расширению ---------------- */

const FILE_TONE: Record<string, string> = {
	pdf: 'bg-[#fdecec] text-[#c0392b] dark:bg-[rgba(220,90,90,.16)] dark:text-[#f3a2a2]',
	xls: 'bg-[#e8f6ed] text-[#1e7a45] dark:bg-[rgba(114,188,143,.16)] dark:text-[#86d4a5]',
	doc: 'bg-[#e8effd] text-[#2454b8] dark:bg-[rgba(90,140,220,.16)] dark:text-[#9dbcf5]',
	dwg: 'bg-[#e6f4fa] text-[#17708f] dark:bg-[rgba(80,170,200,.16)] dark:text-[#8ed3e8]',
	other: 'bg-raised text-muted',
}

function fileTone(fileName: string) {
	const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
	if (ext === 'pdf') return { tone: FILE_TONE.pdf, label: 'PDF' }
	if (['xls', 'xlsx', 'csv'].includes(ext)) return { tone: FILE_TONE.xls, label: ext.toUpperCase() }
	if (['doc', 'docx', 'rtf'].includes(ext)) return { tone: FILE_TONE.doc, label: ext.toUpperCase() }
	if (['dwg', 'dxf'].includes(ext)) return { tone: FILE_TONE.dwg, label: ext.toUpperCase() }
	return { tone: FILE_TONE.other, label: (ext || '?').slice(0, 4).toUpperCase() }
}

export function FileIcon({ fileName }: { fileName: string }) {
	const { tone, label } = fileTone(fileName)
	return (
		<div className={`grid h-8 w-8 flex-none place-items-center rounded-lg text-2xs font-bold ${tone}`}>{label}</div>
	)
}

/* ---------------- Кнопки ---------------- */

const BTN_BASE =
	'inline-flex h-control min-h-[44px] items-center gap-1.5 rounded-control px-3.5 text-base font-semibold transition-[transform,box-shadow,background-color,border-color] duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0'

export function PrimaryButton({
	children,
	className = '',
	...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button {...rest} className={`${BTN_BASE} brand-gradient text-white shadow-[0_6px_14px_rgba(91,55,214,.22)] hover:shadow-[0_10px_20px_rgba(91,55,214,.28)] ${className}`}>
			{children}
		</button>
	)
}

export function SecondaryButton({
	children,
	className = '',
	...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			{...rest}
			className={`${BTN_BASE} border border-line bg-surface text-ink shadow-[0_1px_2px_rgba(16,24,40,.03)] hover:bg-raised hover:shadow-sm ${className}`}
		>
			{children}
		</button>
	)
}

/* ---------------- Пара «лейбл — значение» ---------------- */

export function KeyValue({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
	return (
		<div className="flex items-baseline gap-3 border-b border-line-soft py-2 last:border-b-0">
			<span className="text-sm text-muted">{label}</span>
			<span className={`ml-auto text-right text-base font-medium ${mono ? 'tnum' : ''}`}>{value}</span>
		</div>
	)
}

/* ---------------- Пустое состояние ---------------- */

export function EmptyState({ text }: { text: string }) {
	return <div className="ui-empty-state mx-3 my-3 rounded-[14px] border border-dashed border-line px-4 py-8 text-center text-base text-faint"><span aria-hidden="true" className="mx-auto mb-2 grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-brand-ink">—</span>{text}</div>
}

/* ---------------- Плитка показателя (дашборд) ---------------- */

type TileTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'brand'

const TILE_ACCENT: Record<TileTone, string> = {
	neutral: 'text-ink',
	ok: 'text-ok',
	warn: 'text-warn',
	danger: 'text-danger',
	brand: 'text-brand-ink',
}

export function StatTile({
	label,
	value,
	hint,
	tone = 'neutral',
	href,
}: {
	label: string
	value: ReactNode
	hint?: ReactNode
	tone?: TileTone
	href?: string
}) {
	const body = (
		<div className="flex h-full flex-col rounded-[14px] border border-line bg-surface p-4 transition-[border-color,box-shadow] duration-200 hover:border-brand/25 hover:shadow-[0_12px_28px_rgba(69,48,160,.10)]">
			<div className="text-xs font-medium uppercase tracking-[0.06em] text-faint">{label}</div>
			<div className={`tnum mt-[8px] text-2xl font-bold leading-none tracking-[-0.02em] ${TILE_ACCENT[tone]}`}>
				{value}
			</div>
			{hint != null && <div className="mt-[7px] text-sm text-muted">{hint}</div>}
		</div>
	)

	if (!href) return body
	return (
		<a href={href} className="block h-full">
			{body}
		</a>
	)
}

/* ---------------- Полоса прогресса ---------------- */

const BAR_TONE: Record<'brand' | 'ok' | 'warn' | 'danger' | 'muted', string> = {
	brand: 'bg-brand',
	ok: 'bg-ok',
	warn: 'bg-warn',
	danger: 'bg-danger',
	muted: 'bg-faint',
}

export function ProgressBar({
	percent,
	tone = 'brand',
	height = 8,
}: {
	percent: number
	tone?: 'brand' | 'ok' | 'warn' | 'danger' | 'muted'
	height?: number
}) {
	const safe = Math.max(0, Math.min(100, Math.round(percent)))
	return (
		<div
			className="w-full overflow-hidden rounded-full bg-raised"
			style={{ height }}
			role="progressbar"
			aria-valuenow={safe}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			<div className={`h-full rounded-full ${BAR_TONE[tone]} transition-[width] duration-700 ease-out`} style={{ width: `${safe}%` }} />
		</div>
	)
}

/* ---------------- Строка списка «Требуют внимания» ---------------- */

const ROW_DOT: Record<'danger' | 'warn' | 'off', string> = {
	danger: 'bg-danger',
	warn: 'bg-warn',
	off: 'bg-faint',
}

export function AttentionRow({
	tone,
	title,
	detail,
	group,
	href,
}: {
	tone: 'danger' | 'warn' | 'off'
	title: string
	detail?: string
	group?: string
	href: string
}) {
	return (
		<a
			href={href}
			className="flex items-start gap-2.5 border-b border-line-soft px-4 py-2.5 transition-colors last:border-b-0 hover:bg-raised"
		>
			<span className={`mt-[6px] h-[7px] w-[7px] flex-none rounded-full ${ROW_DOT[tone]}`} />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-base font-medium text-ink">{title}</span>
				{detail && <span className="mt-[2px] block truncate text-sm text-muted">{detail}</span>}
			</span>
			{group && <span className="flex-none text-xs text-faint">{group}</span>}
		</a>
	)
}

/* ---------------- Поля форм ---------------- */

export function Field({
	label,
	hint,
	required = false,
	children,
	labelClassName,
}: {
	label: string
	hint?: string
	required?: boolean
	children: ReactNode
	/** Точечная замена вида подписи поля в конкретном месте (например,
	 *  внутри .filter-panel) — вместо контекстного CSS-селектора вида
	 *  ".filter-panel label > span". */
	labelClassName?: string
}) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className={labelClassName ?? 'text-sm font-medium text-muted'}>
				{label}
				{required && <span className="ml-[3px] text-danger">*</span>}
			</span>
			{children}
			{hint && <span className="text-xs text-faint">{hint}</span>}
		</label>
	)
}

export const inputClass =
	'h-control min-h-[44px] w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition-[border-color,box-shadow,background-color] placeholder:text-faint hover:border-brand/25 focus:border-brand focus:bg-surface focus:ring-[3px] focus:ring-brand/16 sm:min-h-0'

export const selectClass = inputClass

export const textareaClass =
	'min-h-[84px] w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink outline-none transition-[border-color,box-shadow,background-color] placeholder:text-faint hover:border-brand/25 focus:border-brand focus:bg-surface focus:ring-[3px] focus:ring-brand/16'

/** Сообщение об ошибке валидации над формой. */
export function FormError({ message }: { message?: string | null }) {
	if (!message) return null
	return (
		<div role="alert" className="flex items-start gap-2 rounded-control border border-danger-bd bg-danger-bg px-3 py-2 text-sm text-danger">
			<span aria-hidden="true" className="mt-px grid h-4 w-4 flex-none place-items-center rounded-full border border-current text-2xs font-bold">!</span>{message}
		</div>
	)
}
