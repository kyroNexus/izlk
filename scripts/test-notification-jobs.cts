import assert from 'node:assert/strict'
import { isNotificationSyncAuthorized } from '../src/lib/notification-sync-auth'

async function main() {
  assert.equal(isNotificationSyncAuthorized(null, 'notification-test-token'), false)
  assert.equal(isNotificationSyncAuthorized('Bearer wrong', 'notification-test-token'), false)
  assert.equal(isNotificationSyncAuthorized('Bearer notification-test-token', 'notification-test-token'), true)
  assert.equal(isNotificationSyncAuthorized('Bearer notification-test-token', 'notification-test-token'), true)
  console.log('Notification job checks passed: bearer authentication.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
