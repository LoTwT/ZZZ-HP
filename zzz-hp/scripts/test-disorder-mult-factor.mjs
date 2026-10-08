/**
 * 紊乱倍率修正作用于「倍率区整体」（基础 + 时间 × 补偿），而不是只作用于基础分量。
 * 运行：npx vite-node scripts/test-disorder-mult-factor.mjs
 */
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { resolveSkillMults } from '../src/utils/skillSubcategoryMult.ts'
import { makePanel } from './_effectPipelineHarness.mjs'

let passed = 0
let failed = 0
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
function section(title) {
  console.log(`\n=== ${title} ===`)
}

const enemy = {
  defense: 794,
  resistanceType: 'normal',
  vulnerableMultiplier: 1,
  staggerMultiplier: 1,
  specialMultiplier: 1,
  level: 60,
}
const combat = {
  combatVulnerable: 0,
  combatStaggerVulnerable: 0,
  combatSpecial: 0,
}

function basePanel(extra = {}) {
  return makePanel({
    atk: 1000,
    dmgBonus: 0,
    penRate: 0,
    pen: 0,
    resPen: 0,
    reduceDefense: 0,
    ignoreDefense: 0,
    mastery: 300,
    ...extra,
  })
}

function runDisorder(panel, extraInput = {}) {
  return computeDamageResult({
    finalPanel: panel,
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: enemy,
    ...combat,
    staggerPhase: 'stagger',
    ownerAgentLevel: 60,
    anomalySubKind: 'disorder',
    triggerFinalPanel: panel,
    triggerAgentElement: '冰',
    triggerAgentLevel: 60,
    ...extraInput,
  })
}

// 面板：紊乱基础倍率 450% · 补偿 7.5%/秒 · 持续时间 9.8 → 冰 floor = 9
const base = { disorderBaseMult: 450, disorderCompMult: 7.5, anomalyDuration: 9.8 }

section('1. 默认修正 ×1：结果与旧口径一致')
{
  const r = runDisorder(basePanel(base))
  check('有效持续时间', r.effectiveAnomalyDuration, 9)
  check('修正默认 1', r.disorderMultFactor, 1)
  check('基础分量 4.5', r.disorderBaseMultRatio, 4.5)
  check('倍率区 = 4.5 + 9 × 0.075', r.disorderZone, 4.5 + 9 * 0.075)
}

section('2. 面板紊乱倍率修正 150%：乘在倍率区上（含时间补偿）')
{
  const r = runDisorder(
    basePanel({ ...base, disorderBaseMultFactor: 150 }),
  )
  const baseOnly = 4.5
  const comp = 9 * 0.075
  check('修正 1.5', r.disorderMultFactor, 1.5)
  check('基础分量不受修正影响', r.disorderBaseMultRatio, baseOnly)
  check('倍率区 = (基础 + 时间 × 补偿) × 1.5', r.disorderZone, (baseOnly + comp) * 1.5)
  check(
    '倍率区不等于「基础 × 1.5 + 补偿」',
    Math.abs(r.disorderZone - (baseOnly * 1.5 + comp)) > 1e-6 ? 1 : 0,
    1,
  )
}

section('3. 招式小类倍率 + 修正：基础分量与修正分离')
{
  const panel = basePanel(base)
  const sub = {
    directDmgMult: 0,
    settlementDmgMult: 0,
    anomalyReleaseMult: 0,
    disorderMult: 600,
    directDmgMultFactor: 100,
    anomalyReleaseMultFactor: 100,
    disorderMultFactor: 200,
  }
  const merged = resolveSkillMults(panel, sub)
  check('基础分量取小类 6', merged.disorderBaseMultRatio, 6)
  check('修正 = 小类 2 × 面板 1', merged.disorderMultFactor, 2)
  const r = runDisorder(panel, { skillSubcategory: sub })
  check('倍率区 = (6 + 9 × 0.075) × 2', r.disorderZone, (6 + 9 * 0.075) * 2)
  check('极性紊乱', r.hasPolarDisorder, true)
}

section('4. 招式手填最终倍率区：修正同样乘在倍率区上')
{
  const panel = basePanel(base)
  const r = runDisorder(panel, {
    disorderZoneMultOverride: 500,
    disorderZoneMultFactorOverride: 120,
  })
  check('修正 = 招式 1.2 × 面板 1', r.disorderMultFactor, 1.2)
  check('倍率区 = 填写值 5 × 1.2', r.disorderZone, 5 * 1.2)
  check('基础分量 = 填写值 − 时间 × 补偿', r.disorderBaseMultRatio, 5 - 9 * 0.075)
}

console.log(`\n${failed === 0 ? 'all passed' : `${failed} failed`}：passed=${passed} failed=${failed}`)
if (failed > 0) process.exit(1)
