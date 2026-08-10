import type { ContractWorkflowStage } from '@prisma/client'

const NEXT_STAGES: Partial<Record<ContractWorkflowStage, ContractWorkflowStage[]>> = {
	CONTRACT_PREPARATION: ['AWAITING_CONTRACT_SIGNATURE'],
	AWAITING_CONTRACT_SIGNATURE: ['PR1_DEVELOPMENT'],
	PR1_DEVELOPMENT: ['AWAITING_PR1_SIGNATURE'],
	AWAITING_PR1_SIGNATURE: ['DESIGN'],
	DESIGN: ['WAITING_PRODUCTION'],
	WAITING_PRODUCTION: ['PRODUCTION'],
	PRODUCTION: ['AWAITING_SHIPMENT'],
	AWAITING_SHIPMENT: ['INSTALL_KZH', 'INSTALL_KM'],
	INSTALL_KZH: ['INSTALL_KM'],
	INSTALL_KM: ['CLOSED'],
}

export function getNextWorkflowStages(stage: ContractWorkflowStage): ContractWorkflowStage[] {
	return NEXT_STAGES[stage] ?? []
}

export function canTransitionWorkflowStage(from: ContractWorkflowStage, to: ContractWorkflowStage) {
	return from === to || Boolean(NEXT_STAGES[from]?.includes(to))
}
