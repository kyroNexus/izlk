'use client'

import { useEffect } from 'react'

/**
 * Browser cookies are shared by all tabs. If a person signs in as another
 * account in the same profile, refresh the stale tab before it can submit an
 * action on behalf of the newly selected account.
 */
export default function SessionGuard({ userId }: { userId: string }) {
  useEffect(() => {
    let stopped = false
    const verify = async () => {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' })
        const session = await response.json() as { user?: { id?: string } }
        if (stopped) return
        // Cookies are shared by browser tabs. Both a switch to another user and
        // a sign-out must invalidate the stale view before it sends an action.
        if (!session.user?.id) window.location.replace('/login')
        else if (session.user.id !== userId) window.location.replace('/')
      } catch { /* temporary offline state must not break the open page */ }
    }
    const timer = window.setInterval(verify, 12000)
    verify()
    window.addEventListener('focus', verify)
    window.addEventListener('pageshow', verify)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('focus', verify)
      window.removeEventListener('pageshow', verify)
    }
  }, [userId])
  return null
}
