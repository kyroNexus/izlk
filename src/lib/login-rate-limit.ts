/**
 * Small in-process brake for password guessing.  It deliberately does not
 * disclose whether a login exists: both an unknown login and a bad password
 * consume the same budget.  For a multi-instance production deployment this
 * should be replaced with a Redis-backed limiter.
 */
type Attempt = { count: number; resetAt: number }

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 8
const attempts = new Map<string, Attempt>()

function keyFor(login: string) {
  return login.trim().toLowerCase().slice(0, 160)
}

export function loginAllowed(login: string): boolean {
  const key = keyFor(login)
  const entry = attempts.get(key)
  if (!entry) return true
  if (entry.resetAt <= Date.now()) {
    attempts.delete(key)
    return true
  }
  return entry.count < MAX_FAILURES
}

export function recordFailedLogin(login: string) {
  const key = keyFor(login)
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return
  }
  entry.count += 1
}

export function clearFailedLogins(login: string) {
  attempts.delete(keyFor(login))
}
