import type { ContractWorkflowStage } from '@prisma/client'
import { WORKFLOW_STAGE_LABEL, WORKFLOW_STAGE_ORDER } from '@/lib/contract-workflow'

export default function ContractStageStepper({ stage }: { stage: ContractWorkflowStage }) {
	const workflowStageIndex = WORKFLOW_STAGE_ORDER.indexOf(stage)
	return (
		<div className="mt-[12px] max-w-[520px]">
			<div className="flex items-center gap-1" role="img" aria-label={`Стадия ${workflowStageIndex + 1} из ${WORKFLOW_STAGE_ORDER.length}: ${WORKFLOW_STAGE_LABEL[stage]}`}>
				{WORKFLOW_STAGE_ORDER.map((s, index) => <span key={s} title={WORKFLOW_STAGE_LABEL[s]} className={`h-[6px] flex-1 rounded-full transition-colors ${index < workflowStageIndex ? 'bg-brand/55' : index === workflowStageIndex ? 'bg-brand ring-2 ring-brand/25' : 'bg-line'}`} />)}
			</div>
			<div className="mt-[6px] text-xs text-faint">{`Этап ${workflowStageIndex + 1} из ${WORKFLOW_STAGE_ORDER.length}`}</div>
		</div>
	)
}
