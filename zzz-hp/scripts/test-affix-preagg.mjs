/**
 * 局外固定底 + 词条增量 须与整表重算一致。
 * 运行：npx vite-node scripts/test-affix-preagg.mjs
 */
import { createEmptyAffixCounts, createDefaultAffixDriveDiscMainStats, createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import { createEmptyAgentBasePanel, createEmptyWengineAdvancedStats, createEmptyBuffStatModifiers, createEmptyRefinementMods } from '../src/utils/calculatorUi.ts'
import {
  AFFIX_VALUE_PER_COUNT,
  applyAffixCountsToFixedParts,
  buildAffixExternalFixedParts,
  computeExternalPanelFromAffixes,
} from '../src/utils/affixPanelCalc.ts'
import { computeFinalPanel } from '../src/utils/panelBuffCalc.ts'

let failed = 0
let passed = 0

function nearly(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps
}

function check(name, actual, expected, eps = 1e-9) {
  const ok = nearly(actual, expected, eps)
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}: ${actual} == ${expected}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}: actual=${actual} expected=${expected}`)
  }
}

function checkPanel(name, actual, expected) {
  const keys = Object.keys(expected)
  let ok = true
  for (const key of keys) {
    const a = actual[key]
    const e = expected[key]
    if (typeof a === 'number' && typeof e === 'number') {
      if (!nearly(a, e, 1e-6)) {
        ok = false
        console.log(`  FAIL  ${name}.${key}: actual=${a} expected=${e}`)
      }
    } else if (a !== e) {
      ok = false
      console.log(`  FAIL  ${name}.${key}: actual=${a} expected=${e}`)
    }
  }
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failed += 1
  }
}

const baseInput = {
  agentBase: {
    ...createEmptyAgentBasePanel(),
    hp: 8000,
    atk: 1200,
    def: 600,
    critRate: 5,
    critDmg: 50,
    mastery: 90,
  },
  wengineBaseAtk: 684,
  wengineAdvanced: {
    ...createEmptyWengineAdvancedStats(),
    critRate: 24,
  },
  driveDiscSelection: {
    twoPieceDriveDiscId: 'none',
    fourPieceDriveDiscId: 'none',
  },
  driveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
  driveDiscs: [],
}

const countsA = {
  ...createEmptyAffixCounts(),
  atkPercent: 10,
  critRate: 8,
  critDmg: 12,
  mastery: 4,
}

const countsB = {
  ...countsA,
  atkPercent: 11,
  critRate: 8,
}

const fullA = computeExternalPanelFromAffixes({ ...baseInput, affixCounts: countsA })
const parts = buildAffixExternalFixedParts(baseInput)
const splitA = applyAffixCountsToFixedParts(parts, countsA)
const splitB = applyAffixCountsToFixedParts(parts, countsB)
const fullB = computeExternalPanelFromAffixes({ ...baseInput, affixCounts: countsB })

console.log('\n=== 局外固定底与整表重算 ===')
checkPanel('countsA 拆底 == 整表', splitA, fullA)
checkPanel('countsB 拆底 == 整表', splitB, fullB)
check(
  '攻击% +1 条局外攻击增量',
  splitB.atk - splitA.atk,
  fullB.atk - fullA.atk,
)
check(
  '暴击条不变',
  splitB.critRate,
  splitA.critRate,
)
check(
  '每条大攻击折算',
  AFFIX_VALUE_PER_COUNT.atkPercent,
  3,
)

console.log('\n=== 改局外后局内不能冻在旧缓存 ===')
const emptyBangboo = {
  id: 'none',
  name: '未选择',
  avatar_image: null,
  effects: [],
  refinementEffects: createEmptyRefinementMods().map(() => []),
  fixedMods: createEmptyBuffStatModifiers(),
  refinementMods: createEmptyRefinementMods(),
}
const panelCtx = {
  teamSlots: [{ agentId: '', rank: 0, wengineId: 'none', wengineRefine: 1, twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' }],
  agents: [],
  wengines: [],
  bangboo: emptyBangboo,
  bangbooRefine: 1,
  mainSlotIndex: 0,
  driveDiscs: [],
}
const ext1 = { ...createDefaultExternalPanel(), atk: 1000, critRate: 20 }
const ext2 = { ...createDefaultExternalPanel(), atk: 1300, critRate: 20 }
const p1 = computeFinalPanel(ext1, panelCtx, { includeDetails: false })
const p2 = computeFinalPanel(ext2, panelCtx, { includeDetails: false })
check('第一次局内攻击跟随局外', p1.finalPanel.atk, 1000)
check('第二次局内攻击跟随新局外（非转模缓存不得冻死）', p2.finalPanel.atk, 1300)
check('暴击不随攻击词条变', p2.finalPanel.critRate, p1.finalPanel.critRate)

if (failed) {
  console.log(`\n${failed} failed, ${passed} passed`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
