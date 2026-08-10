import { z } from 'zod'

const nonNegative = z.coerce.number().finite().min(0)
export const siteReportPayloadSchema = z.object({
	clientSubmissionId: z.string().uuid(), direction: z.enum(['KJ', 'KM']), workDate: z.string().date(), stage: z.string().trim().min(1).max(500), comment: z.string().trim().max(5000).optional(), finishDirection: z.boolean().optional(),
	crew: z.array(z.object({ name: z.string().trim().min(1).max(200), days: nonNegative, rate: nonNegative })).max(100),
	costs: z.array(z.object({ category: z.enum(['EQUIPMENT', 'MATERIAL', 'OTHER']), name: z.string().trim().min(1).max(300), payment: z.enum(['CASH', 'CASHLESS']), quantity: nonNegative, unit: z.string().trim().max(40).optional(), price: nonNegative })).max(200),
})
