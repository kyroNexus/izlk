import { timingSafeEqual } from 'node:crypto'

export function isNotificationSyncAuthorized(authorization: string | null, configuredToken = process.env.NOTIFICATION_SYNC_TOKEN?.trim()) {
  const token = authorization?.replace(/^Bearer\s+/i, '')
  if (!configuredToken || !token) return false
  const expected = Buffer.from(configuredToken)
  const actual = Buffer.from(token)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
