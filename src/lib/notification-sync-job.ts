import { acquireRateLimitLock } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { syncAllDeadlineNotifications } from '@/lib/notifications'
import { prisma } from '@/lib/prisma'
import { isNotificationSyncAuthorized } from '@/lib/notification-sync-auth'

const JOB_TYPE = 'notification-deadlines'

export function hasNotificationSyncToken(request: Request) {
  return isNotificationSyncAuthorized(request.headers.get('authorization'))
}

export async function runNotificationSyncJob() {
  const lock = await acquireRateLimitLock(JOB_TYPE, 30 * 60_000)
  if (!lock) return { status: 'locked' as const }

  const startedAt = Date.now()
  let jobId: string | null = null
  try {
    const job = await prisma.backgroundJob.create({ data: { type: JOB_TYPE } })
    jobId = job.id
    const result = await syncAllDeadlineNotifications()
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), processed: result.processed, created: result.created },
    })
    logger.info('notification.sync_completed', { durationMs: Date.now() - startedAt, entityType: 'BackgroundJob', entityId: jobId })
    return { status: 'completed' as const, jobId, ...result }
  } catch (error) {
    if (jobId) await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', finishedAt: new Date(), error: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown error' },
    }).catch((updateError) => logger.error('notification.sync_job_update_failed', { entityType: 'BackgroundJob', entityId: jobId!, error: updateError }))
    logger.error('notification.sync_failed', { durationMs: Date.now() - startedAt, ...(jobId ? { entityType: 'BackgroundJob', entityId: jobId } : {}), error })
    throw error
  } finally {
    await lock.release()
  }
}
