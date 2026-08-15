import Link from 'next/link'
import { Card, CardHeader, Chip } from '@/components/ui'
import SubmitButton from '@/components/SubmitButton'
import { formatDateTime } from '@/lib/format'
import { WORKFLOW_STAGE_LABEL } from '@/lib/contract-workflow'
import type { ContractWorkflowStage } from '@prisma/client'
import type { ContractWithRelations } from './shared'

export default function TabWorkflow({
	contract,
	canEdit,
	isAdminUser,
	latestPr1,
	nextWorkflowStages,
	workflowError,
	confirmPr1,
	revokePr1,
	moveWorkflowStage,
	applyDemoStep,
}: {
	contract: ContractWithRelations
	canEdit: boolean
	isAdminUser: boolean
	latestPr1: ContractWithRelations['documents'][number] | undefined
	nextWorkflowStages: ContractWorkflowStage[]
	workflowError: boolean
	confirmPr1: (formData: FormData) => Promise<void>
	revokePr1: (formData: FormData) => Promise<void>
	moveWorkflowStage: (formData: FormData) => Promise<void>
	applyDemoStep: (formData: FormData) => Promise<void>
}) {
	return (
		<Card id="workflow" role="tabpanel" aria-labelledby="tab-workflow">
			<CardHeader title="Ход договора" extra={<Chip tone={contract.workflowStage === 'CLOSED' ? 'ok' : contract.workflowStage === 'DESIGN' ? 'brand' : 'off'}>{WORKFLOW_STAGE_LABEL[contract.workflowStage]}</Chip>} />
			<div className="p-[18px]">
				{!contract.pr1ConfirmedAt && (latestPr1 ? (
					<form action={confirmPr1} className="rounded-[11px] border border-brand/25 bg-brand/5 p-[12px]">
						<div className="text-[12.5px] font-bold">Подтвердить подписанное Приложение №1</div>
						<div className="mt-1 text-[11.5px] leading-5 text-muted">Система создаст нужные разделы, задачи и площадку для СМР.</div>
						<div className="mt-3 grid gap-[8px] sm:grid-cols-[1fr_140px_auto]"><input name="signedAt" type="date" defaultValue={(latestPr1.signedAt ?? new Date()).toISOString().slice(0, 10)} className="h-[35px] rounded-[8px] border border-line bg-surface px-[9px] text-[12px]" /><input name="workingDays" type="number" min="1" max="730" defaultValue={contract.workingDays ?? ''} placeholder="Рабочих дней" className="h-[35px] rounded-[8px] border border-line bg-surface px-[9px] text-[12px]" /><SubmitButton pendingText="Подтверждение…" className="brand-gradient rounded-[8px] px-[12px] text-[12px] font-semibold text-white">Подтвердить ПР1</SubmitButton></div>
					</form>
				) : <div className="flex flex-wrap items-center justify-between gap-[10px] rounded-[11px] border border-warn/25 bg-warn-bg p-[12px]"><div><div className="text-[12.5px] font-bold">Нужен подписанный файл ПР1</div><div className="mt-1 text-[11.5px] text-muted">Откройте отдельную зону, перетащите файл и подтвердите дату.</div></div>{canEdit && <Link href={`/contracts/${contract.id}/upload?pr1=1`} className="rounded-[8px] border border-line bg-surface px-[11px] py-[7px] text-[11.5px] font-semibold">Загрузить ПР1</Link>}</div>)}

				{isAdminUser && contract.pr1ConfirmedAt && <form action={revokePr1} className="mt-[12px] flex flex-wrap items-center gap-[8px] border-t border-line-soft pt-[12px]"><span className="text-[11.5px] text-faint">Админ: отмена ошибочного ПР1</span><input name="reason" required placeholder="Причина отмены" className="h-[34px] min-w-[180px] flex-1 rounded-[8px] border border-danger/25 bg-surface px-[9px] text-[12px]" /><SubmitButton pendingText="Отмена…" className="h-[34px] rounded-[8px] border border-danger/30 bg-danger/10 px-[11px] text-[12px] font-semibold text-danger">Отменить ПР1</SubmitButton></form>}
				{canEdit && nextWorkflowStages.length > 0 && <form action={moveWorkflowStage} className="mt-[12px] flex flex-wrap items-center gap-[8px] border-t border-line-soft pt-[12px]"><span className="text-[11.5px] text-muted">Следующий шаг:</span><select name="toStage" className="h-[34px] rounded-[8px] border border-line bg-surface px-[9px] text-[12px]">{nextWorkflowStages.map((stage) => <option key={stage} value={stage}>{WORKFLOW_STAGE_LABEL[stage]}</option>)}</select><input name="comment" placeholder="Комментарий (необязательно)" className="h-[34px] min-w-[180px] flex-1 rounded-[8px] border border-line bg-surface px-[9px] text-[12px]" /><SubmitButton pendingText="Перевод…" className="h-[34px] rounded-[8px] border border-brand/30 bg-brand/10 px-[11px] text-[12px] font-semibold text-brand-ink">Перевести</SubmitButton></form>}
				{workflowError && <div className="mt-[10px] flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-warn/30 bg-warn-bg px-[11px] py-[9px] text-[11.5px] text-warn"><span><b>Передача в цех пока заблокирована.</b> Нужны: готовый раздел КМ и итоговый PDF.</span><Link href={`/projects?view=production`} className="font-semibold text-brand-ink hover:underline">Открыть буфер цеха →</Link></div>}

				{isAdminUser && <details className="group mt-[12px] overflow-hidden rounded-[11px] border border-dashed border-brand/35 bg-gradient-to-r from-brand/10 via-brand-soft/45 to-surface"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-[12px] py-[10px]"><span><b className="block text-[11.5px] text-brand-ink">Демо-панель администратора</b><span className="mt-0.5 block text-[10.5px] text-muted">Тестовые переходы без загрузки файлов</span></span><span className="grid h-7 w-7 place-items-center rounded-lg bg-surface text-brand-ink transition-transform group-open:rotate-180">⌄</span></summary><div className="grid gap-2 border-t border-brand/15 p-[10px] sm:grid-cols-2"><form action={applyDemoStep} className="rounded-[9px] border border-line bg-surface/85 p-[10px]"><input type="hidden" name="step" value="pr1" /><b className="block text-[11px]">1. Подтвердить ПР1</b><span className="mt-1 block text-[10px] leading-4 text-muted">Создаст площадку, проектные разделы и задачи.</span><button className="mt-2 rounded-lg bg-brand px-2.5 py-1.5 text-[10.5px] font-semibold text-white transition hover:brightness-110">Сделать ПР1 подписанным</button></form><form action={applyDemoStep} className="rounded-[9px] border border-line bg-surface/85 p-[10px]"><input type="hidden" name="step" value="production" /><b className="block text-[11px]">2. Завершить проектирование</b><span className="mt-1 block text-[10px] leading-4 text-muted">Переведёт договор в ожидание производства только для демонстрации.</span><button className="mt-2 rounded-lg border border-brand/30 bg-brand-soft px-2.5 py-1.5 text-[10.5px] font-semibold text-brand-ink transition hover:bg-brand hover:text-white">КМ готов → в буфер</button></form></div></details>}
				{contract.stageHistory.length > 0 && <div className="mt-[14px] border-t border-line-soft pt-[12px]"><div className="mb-[7px] text-[10.5px] font-bold uppercase tracking-[0.07em] text-faint">Последние изменения</div><div className="flex flex-col gap-[6px]">{contract.stageHistory.slice(0, 5).map((item) => <div key={item.id} className="flex items-start justify-between gap-3 text-[11.5px]"><div><span className="font-medium">{item.fromStage ? `${WORKFLOW_STAGE_LABEL[item.fromStage]} → ` : ''}{WORKFLOW_STAGE_LABEL[item.toStage]}</span>{item.comment ? <span className="text-muted"> · {item.comment}</span> : null}<span className="text-faint"> · {item.isAutomatic ? 'автоматически' : item.changedBy?.name ?? 'система'}</span></div><span className="flex-none text-faint">{formatDateTime(item.createdAt)}</span></div>)}</div></div>}
			</div>
		</Card>
	)
}
