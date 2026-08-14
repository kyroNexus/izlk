import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const access = readFileSync('src/lib/chat.ts', 'utf8')
const route = readFileSync('src/app/api/chats/[scope]/[id]/route.ts', 'utf8')

assert.match(access, /findContractInScope\(value, user\)/, 'contract chat must use the contract access scope')
assert.match(access, /user\.role === 'VIEWER'/, 'VIEWER must not access department chats')
assert.match(access, /canWrite\(user\)/, 'message changes must require write access')
assert.match(route, /POST = withApiAuth\(post, \{ access: 'write', csrf: true \}\)/, 'chat POST must use CSRF protection')
assert.match(route, /DELETE = withApiAuth\(remove, \{ access: 'write', csrf: true \}\)/, 'chat DELETE must use CSRF protection')

console.log('Chat access checks passed.')
