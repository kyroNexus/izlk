function normalizedOrigin(value: string | null | undefined) {
  if (!value) return null
  try {
    const origin = new URL(value).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

function isLoopbackOrigin(origin: string | null) {
  if (!origin) return false
  try {
    const host = new URL(origin).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

/**
 * Return the browser-facing origin. Docker can expose a request to Next as
 * localhost:3000 even though the visitor opened an IP address or a domain.
 * A real non-loopback AUTH_URL remains authoritative; a stale local AUTH_URL
 * falls back to the Host received by the web server.
 */
export function configuredPublicOrigin(request: Request): string {
  const configured = normalizedOrigin(process.env.AUTH_URL?.trim())
  if (configured && !isLoopbackOrigin(configured)) return configured

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host')?.trim()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  const protocol = forwardedProto === 'https' || forwardedProto === 'http'
    ? forwardedProto
    : new URL(request.url).protocol.replace(':', '')

  // Host header must be a hostname/IP with an optional port. Reject a URL,
  // whitespace or user-info so it cannot turn redirects into open redirects.
  const safeHost = host && (
    /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(host) ||
    /^\[[0-9a-fA-F:]+\](?::\d{1,5})?$/.test(host)
  )
  if (safeHost && host) {
    const requestOrigin = normalizedOrigin(`${protocol}://${host}`)
    if (requestOrigin) return requestOrigin
  }
  return configured ?? new URL(request.url).origin
}

/**
 * Custom cookie-authenticated POST endpoints do not need to accept cross-site
 * form submissions. Requests without Origin are allowed for server jobs using
 * bearer tokens (such as the inbox watcher).
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !origin || origin === configuredPublicOrigin(request)
}
