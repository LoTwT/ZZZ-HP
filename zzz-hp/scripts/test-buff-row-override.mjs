/**
 * 行级增益例外（按流程行禁用增益）的守卫测试。
 *
 * 三件事必须钉住：
 * 1. **展开器**：块禁用 → 该块下所有效果；单条禁用 → 该条；空 → null（调用方据此零开销跳过）
 * 2. **指纹**：`buffOverride` 必须进结算记忆表的键 —— 否则两行会互相命中对方的缓存，
 *    数字看着像对的但是错的，且不会有任何报错
 * 3. **归一**：缺省与显式 null 等价（老数据零迁移）
 *
 * 运行：npx vite-node scripts/test-buff-row-override.mjs
 */
import { expandBuffOverrideToEffectIds } from '../src/utils/buffEffect.ts'
import { buildHitEvalFingerprint } from '../src/utils/hitEvalCache.ts'

let passed = 0
let failed = 0

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

function sorted(set) {
  return set ? [...set].sort().join(',') : 'null'
}

console.log('=== 1. 展开器 expandBuffOverrideToEffectIds ===')

const items = [
  { effect: { id: 'e1' }, blockKey: 'src-a-b1' },
  { effect: { id: 'e2' }, blockKey: 'src-a-b1' },
  { effect: { id: 'e3' }, blockKey: 'src-b-b2' },
]

check(
  '块禁用 → 展开成该块下全部效果',
  sorted(expandBuffOverrideToEffectIds({ disabledBlockIds: ['src-a-b1'] }, items)) === 'e1,e2',
  sorted(expandBuffOverrideToEffectIds({ disabledBlockIds: ['src-a-b1'] }, items)),
)

check(
  '单条禁用 → 只有该条',
  sorted(expandBuffOverrideToEffectIds({ disabledEffectIds: ['e3'] }, items)) === 'e3',
)

check(
  '块 + 单条混合 → 并集',
  sorted(
    expandBuffOverrideToEffectIds({ disabledBlockIds: ['src-b-b2'], disabledEffectIds: ['e1'] }, items),
  ) === 'e1,e3',
)

check('缺省（undefined）→ null', expandBuffOverrideToEffectIds(undefined, items) === null)
check('空对象 → null', expandBuffOverrideToEffectIds({}, items) === null)
check(
  '禁用了不存在的 id → null（调用方零开销跳过）',
  expandBuffOverrideToEffectIds({ disabledEffectIds: ['nope'] }, items) === null,
)
check(
  '没给 blockKey 的条目不会被块禁用误伤',
  sorted(expandBuffOverrideToEffectIds({ disabledBlockIds: ['src-a-b1'] }, [{ effect: { id: 'x' } }])) ===
    'null',
)

console.log('=== 2. 结算指纹必须随行级例外变化 ===')

const baseHit = {
  id: 'flow-1',
  ownerAgentId: 'velina',
  anomalyPowerAgentId: 'piper',
  triggerAgentId: 'remiel',
  count: 3,
  staggerPhase: 'stagger',
  critMode: 'expected',
  anomalySubKind: 'anomaly',
  coords: [],
  isFollowUp: false,
  multOverrides: null,
  panelMods: null,
  effectiveBaseMult: 100,
  skillTalentLevel: 12,
  skill: {
    id: 'dev-1',
    name: '测试招式',
    damageType: 'anomaly',
    baseMult: 100,
    skillTypes: [],
    buffAnchorId: null,
    baseMultFactor: 100,
    settlementMult: 0,
  },
}

const fNone = buildHitEvalFingerprint({ ...baseHit })
const fNull = buildHitEvalFingerprint({ ...baseHit, buffOverride: null })
const fE1 = buildHitEvalFingerprint({ ...baseHit, buffOverride: { disabledEffectIds: ['e1'] } })
const fE1Again = buildHitEvalFingerprint({ ...baseHit, buffOverride: { disabledEffectIds: ['e1'] } })
const fE2 = buildHitEvalFingerprint({ ...baseHit, buffOverride: { disabledEffectIds: ['e2'] } })
const fBlock = buildHitEvalFingerprint({ ...baseHit, buffOverride: { disabledBlockIds: ['src-a-b1'] } })

check('缺省 vs 显式 null → 指纹相同（归一）', fNone === fNull)
check('无例外 vs 有例外 → 指纹不同', fNone !== fE1)
check('相同例外 → 指纹相同（同配置的行仍共用缓存）', fE1 === fE1Again)
check('不同例外 → 指纹不同（两行不互串）', fE1 !== fE2)
check('块禁用 vs 单条禁用 → 指纹不同', fBlock !== fE1)

console.log('')
console.log(`=== 结果：passed = ${passed}, failed = ${failed} ===`)
if (failed > 0) process.exit(1)
