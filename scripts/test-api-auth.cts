import assert from 'node:assert/strict'
import { createApiAuth, type ApiAuthOptions } from '../src/lib/api-auth-core'

type User = { id: string; role: 'ADMIN' | 'VIEWER' }
const admin: User = { id: 'admin', role: 'ADMIN' }
const viewer: User = { id: 'viewer', role: 'VIEWER' }
const request = (headers?: HeadersInit) => new Request('https://izlk.test/api/test', { method: 'POST', headers })

async function statusFor(user: User | null, options: ApiAuthOptions, headers?: HeadersInit) {
	const auth = createApiAuth({
		getUser: async () => user,
		allows: (current: User, access) => access === 'authenticated' || (access === 'write' ? current.role === 'ADMIN' : current.role === 'ADMIN'),
		isSameOrigin: (current: Request) => current.headers.get('origin') !== 'https://attacker.test',
		onUnhandled: () => undefined,
		rateLimit: async () => ({ allowed: false, retryAfter: 42 }),
	})
	return auth(async (_request, context) => new Response(context.user.id), options)(request(headers))
}

async function main() {
	assert.equal((await statusFor(null, { access: 'authenticated' })).status, 401)
	assert.equal((await statusFor(viewer, { access: 'write' })).status, 403)
	assert.equal((await statusFor(admin, { access: 'admin' })).status, 200)
	const crossSite = await statusFor(admin, { access: 'write', csrf: true }, { origin: 'https://attacker.test' })
	assert.equal(crossSite.status, 403)
	assert.ok(crossSite.headers.get('x-request-id'))
	const first = await statusFor(admin, { access: 'authenticated' })
	const second = await statusFor(admin, { access: 'authenticated' })
	assert.notEqual(first.headers.get('x-request-id'), second.headers.get('x-request-id'))
	const limited = await statusFor(admin, { access: 'authenticated', rateLimit: 'contract-parse' })
	assert.equal(limited.status, 429)
	assert.equal(limited.headers.get('retry-after'), '42')
	let attempts = 0
	const repeated = createApiAuth({
		getUser: async () => admin,
		allows: () => true,
		isSameOrigin: () => true,
		onUnhandled: () => undefined,
		rateLimit: async () => ({ allowed: ++attempts === 1, retryAfter: 60 }),
	})(async () => new Response('ok'), { access: 'authenticated', rateLimit: 'contract-parse' })
	assert.equal((await repeated(request())).status, 200)
	const repeatedResponse = await repeated(request())
	assert.equal(repeatedResponse.status, 429)
	assert.equal(repeatedResponse.headers.get('retry-after'), '60')
	let logged = false
	const failing = createApiAuth({
		getUser: async () => admin,
		allows: () => true,
		isSameOrigin: () => true,
		onUnhandled: () => { logged = true },
	})
	assert.equal((await failing(async () => { throw new Error('expected') }, { access: 'authenticated' })(request())).status, 500)
	assert.equal(logged, true)
	console.log('API auth checks passed.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
