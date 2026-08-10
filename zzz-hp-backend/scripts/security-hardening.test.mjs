import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeAvatarSourceUrl,
  resolveExistingAvatarFile,
} from '../src/utils/calculatorPublicAsset.js'
import { detectImageKind } from '../src/utils/imageMagic.js'
import { createEmptyBuffStatModifiers } from '../src/utils/calculatorBuffFields.js'

test('avatar URL 拒绝穿越与未知前缀', () => {
  assert.equal(normalizeAvatarSourceUrl('/character/foo.webp'), '/character/foo.webp')
  assert.equal(normalizeAvatarSourceUrl('/character/../.env'), null)
  assert.equal(normalizeAvatarSourceUrl('/character/%2e%2e/secret'), null)
  assert.equal(normalizeAvatarSourceUrl('/etc/passwd'), null)
  assert.equal(normalizeAvatarSourceUrl('C:\\Windows\\win.ini'), null)
  assert.equal(resolveExistingAvatarFile('/character/../../package.json'), null)
})

test('魔数识别与空 Buff factor 默认为 0', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  assert.equal(detectImageKind(png), 'png')
  assert.equal(detectImageKind(Buffer.from('not-an-image')), null)

  const empty = createEmptyBuffStatModifiers()
  assert.equal(empty.directDmgMultFactor, 0)
  assert.equal(empty.radianceMultFactor, 0)
  assert.equal(empty.specialMultFactor, 0)
})
