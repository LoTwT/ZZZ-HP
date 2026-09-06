// Run: npx vite-node scripts/test-guestbook-upload-session.mjs
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { uploadGuestbookImage } from '../src/api/guestbook'
import { useUserAuthStore } from '../src/stores/userAuth'

const originalFetch = globalThis.fetch
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const storedValues = new Map()
const pendingUploads = []
const storage = {
  getItem: (key) => storedValues.get(key) ?? null,
  setItem: (key, value) => storedValues.set(key, String(value)),
  removeItem: (key) => storedValues.delete(key),
}
const userA = { id: 1, nickname: 'Account A', mihoyoAid: 'test-a' }
const userB = { id: 2, nickname: 'Account B', mihoyoAid: 'test-b' }

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
globalThis.fetch = async (input, init) => {
  if (input === '/api/auth/me') {
    assert.equal(init.headers.Authorization, 'Bearer valid-B')
    return Response.json({ code: 200, data: userB })
  }
  assert.equal(input, '/api/upload/guestbook')
  assert.ok(init.body instanceof FormData)
  assert.equal(new Headers(init.headers).has('Content-Type'), false)
  return new Promise((resolve) => pendingUploads.push({ init, resolve }))
}

function startUpload() {
  const promise = uploadGuestbookImage(new File(['image'], 'test.png'))
  // Observe rejection immediately; the test controls when the response arrives.
  const result = promise.then(
    (data) => ({ data }),
    (error) => ({ error }),
  )
  const request = pendingUploads.at(-1)
  return { ...request, result }
}

async function rejectUpload(request) {
  request.resolve(Response.json({ code: 401, message: '登录已失效，请重新登录', data: null }, { status: 401 }))
  const result = await request.result
  assert.equal(result.error?.message, '登录已失效，请重新登录')
}

try {
  setActivePinia(createPinia())
  const auth = useUserAuthStore()

  // The first expired request still prompts login; its sibling must preserve the new account.
  auth.setSession('expired-A', userA)
  const first = startUpload()
  const late = startUpload()
  assert.equal(first.init.headers.Authorization, 'Bearer expired-A')
  assert.equal(late.init.headers.Authorization, 'Bearer expired-A')
  await rejectUpload(first)
  assert.equal(auth.token, '')
  assert.equal(storage.getItem('zzz-hp-user-token'), null)
  assert.equal(auth.loginDialogOpen, true)
  await auth.switchAccount({ token: 'valid-B', userId: 2, nickname: userB.nickname })
  await rejectUpload(late)
  assert.equal(auth.token, 'valid-B')
  assert.equal(auth.user.id, 2)
  assert.equal(storage.getItem('zzz-hp-user-token'), 'valid-B')
  assert.equal(auth.loginDialogOpen, false)

  // Another tab can update storage while this tab's Pinia store still contains A.
  auth.setSession('expired-A', userA)
  const otherTab = startUpload()
  storage.setItem('zzz-hp-user-token', 'valid-B')
  await rejectUpload(otherTab)
  assert.equal(storage.getItem('zzz-hp-user-token'), 'valid-B')
  assert.equal(auth.token, 'expired-A')
  assert.equal(auth.loginDialogOpen, false)

  // A request without a token must not clear a session created while it was pending.
  auth.clearSession()
  const anonymous = startUpload()
  assert.equal(anonymous.init.headers.Authorization, undefined)
  auth.setSession('valid-B', userB)
  await rejectUpload(anonymous)
  assert.equal(auth.token, 'valid-B')
  assert.equal(auth.loginDialogOpen, false)

  // Successful uploads keep the response contract and the current session.
  const successful = startUpload()
  successful.resolve(Response.json({ code: 201, data: { url: '/guestbook_image/test.png', filename: 'test.png' } }, { status: 201 }))
  assert.deepEqual((await successful.result).data, { url: '/guestbook_image/test.png', filename: 'test.png' })
  assert.equal(auth.token, 'valid-B')
  assert.equal(auth.loginDialogOpen, false)
  assert.equal(pendingUploads.length, 5)
  console.log('Guestbook upload session checks passed (expired, switched, other tab, anonymous, success).')
} finally {
  globalThis.fetch = originalFetch
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else delete globalThis.localStorage
}
