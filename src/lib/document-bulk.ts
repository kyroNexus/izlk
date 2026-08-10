import { z } from 'zod'

export const DOCUMENT_BATCH_MAX = 50
export const documentBulkInput = z.object({
	action: z.enum(['kind', 'state', 'confidential', 'archive', 'restore', 'download']),
	ids: z.array(z.string().cuid()).min(1).max(DOCUMENT_BATCH_MAX).refine((ids) => new Set(ids).size === ids.length, 'IDs must be unique'),
	kind: z.string().optional(),
	state: z.string().optional(),
	isConfidential: z.boolean().optional(),
})

export type DocumentBulkInput = z.infer<typeof documentBulkInput>
