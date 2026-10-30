/**
 * 等价性：同组 N 条（带 groupId）vs 拆成 N 条独立行（无 groupId）结算完全一致。
 *
 * 覆盖：
 * - 类2 异常族 3 条同组；
 * - 类3 一条 stat + conditions（跨类多选）；
 * - groupId 完全不参与引擎；
 * - 面板 + 直伤/异常伤害数字逐项一致。
 *
 * 运行：npx vite-node scripts/test-buff-group-equivalence.mjs
 */
import { computeFinalPanel } from '../src/utils/panelBuffCalc.ts'
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import {
  dummyBangboo,
  makePanel,
  makePanelCtx,
  mindscapeWithEffects,
  testAgent,
  testSlot,
} from './_effectPipelineHarness.mjs'

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function fx(stat, value, extra = {}) {
  return createEmptyBuffEffect({
    id: extra.id,
    stat,
    value,
    applyTarget: extra.applyTarget ?? 'self',
    conditions: extra.conditions,
    groupId: extra.groupId,
    skillTargets: extra.skillTargets,
  })
}

function ctxFor(kind, subKind = 'attributeAnomaly', element = '电') {
  return {
    damageKind: kind,
    categoryId: 'basic',
    subcategoryId: null,
    coords: [],
    element,
    staggerPhase: 'stagger',
    isFollowUp: false,
    anomalySubKind: subKind,
    directSubKind: kind === 'direct' ? (subKind === 'pierce' ? 'pierce' : 'normal') : 'normal',
  }
}

let panelSeq = 0
function panelFor(effects, skillContext) {
  panelSeq += 1
  const agentId = `a-${panelSeq}`
  const agent = testAgent(agentId, { mindscapeBuffs: mindscapeWithEffects(effects) })
  const ctx = makePanelCtx({
    teamSlots: [testSlot(agentId)],
    agents: [agent],
    bangboo: dummyBangboo(),
    skillContext,
  })
  return computeFinalPanel(makePanel({ atk: 2000, critRate: 20, critDmg: 100 }), ctx)
    .finalPanel
}

function damageFor(panel, kind, subKind) {
  return computeDamageResult({
    finalPanel: panel,
    piercePower: 1000,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: {
      defense: 953,
      level: 70,
      resistanceType: 'normal',
      vulnerabilityMultiplier: 1,
      staggerMultiplier: 1.5,
      specialMultiplier: 1,
    },
    combatVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatSpecial: 0,
    staggerPhase: 'normal',
    useSharpenFormula: false,
    anomalySubKind: subKind,
    combatDmgPenalty: 0,
  })
}

function samePanel(a, b) {
  const keys = Object.keys(a)
  for (const key of keys) {
    const av = Number(a[key] ?? 0)
    const bv = Number(b[key] ?? 0)
    if (Math.abs(av - bv) > 1e-9) return `${key}: ${av} vs ${bv}`
  }
  return null
}

function sameDamage(a, b) {
  for (const key of ['directDamageExpected', 'attributeAnomalyExpected', 'disorderExpected', 'turbulenceExpected', 'radianceExpected', 'anomalyReleaseExpected']) {
    if (Math.abs(Number(a[key] ?? 0) - Number(b[key] ?? 0)) > 1e-9) {
      return `${key}: ${a[key]} vs ${b[key]}`
    }
  }
  return null
}

console.log('\n[1] 类2 三条同组 vs 三条独立（异常）')
{
  const grouped = [
    fx('attributeAnomalyDmgBonus', 12, { id: 'g-anom', groupId: 'grp-1' }),
    fx('disorderDmgBonus', 12, { id: 'g-dis', groupId: 'grp-1' }),
    fx('radianceDmgBonus', 12, { id: 'g-rad', groupId: 'grp-1' }),
  ]
  const independent = grouped.map((effect) => {
    const copy = { ...effect }
    delete copy.groupId
    return copy
  })
  for (const sub of ['attributeAnomaly', 'disorder', 'radiance']) {
    const g = panelFor(grouped, ctxFor('anomaly', sub))
    const i = panelFor(independent, ctxFor('anomaly', sub))
    const diff = samePanel(g, i)
    check(`异常子类 ${sub} 面板一致`, diff == null, diff || '')
  }
  const gDirect = panelFor(grouped, ctxFor('direct', 'normal'))
  const iDirect = panelFor(independent, ctxFor('direct', 'normal'))
  check('直伤上下文一致（异常族条件不进直伤）', samePanel(gDirect, iDirect) == null)

  const gPanel = panelFor(grouped, ctxFor('anomaly', 'attributeAnomaly'))
  const iPanel = panelFor(independent, ctxFor('anomaly', 'attributeAnomaly'))
  check(
    '异常伤害数字一致',
    sameDamage(damageFor(gPanel, 'anomaly', 'attributeAnomaly'), damageFor(iPanel, 'anomaly', 'attributeAnomaly')) == null,
  )
}

console.log('\n[2] 类3 一条 stat + conditions（跨类多选）vs 同一条无 groupId')
{
  const grouped = [
    fx('atk', 30, {
      id: 'g-atk',
      groupId: 'grp-2',
      conditions: { damageTypes: ['normal', 'pierce'] },
    }),
  ]
  const independent = grouped.map((effect) => {
    const copy = { ...effect }
    delete copy.groupId
    return copy
  })
  const gNormal = panelFor(grouped, ctxFor('direct', 'normal'))
  const iNormal = panelFor(independent, ctxFor('direct', 'normal'))
  check('普通直伤面板一致', samePanel(gNormal, iNormal) == null)
  const gPierce = panelFor(grouped, ctxFor('direct', 'pierce'))
  const iPierce = panelFor(independent, ctxFor('direct', 'pierce'))
  check('命破面板一致', samePanel(gPierce, iPierce) == null)
  const gAnomaly = panelFor(grouped, ctxFor('anomaly', 'attributeAnomaly'))
  const iAnomaly = panelFor(independent, ctxFor('anomaly', 'attributeAnomaly'))
  check('异常上下文不吃直伤条件', samePanel(gAnomaly, iAnomaly) == null)

  // 条件只影响命中，不改字段：atk 仍进攻击力
  check('普通直伤下 atk 生效 +30', Math.abs(gNormal.atk - iNormal.atk) < 1e-9 && gNormal.atk === 2030, `${gNormal.atk}`)
  check(
    '直伤伤害数字一致',
    sameDamage(damageFor(gNormal, 'direct', 'normal'), damageFor(iNormal, 'direct', 'normal')) == null,
  )
}

console.log('\n[3] groupId 本身不参与引擎')
{
  const base = [fx('attributeAnomalyDmgBonus', 12, { id: 'x1' })]
  const withGroup = [{ ...base[0], groupId: 'arbitrary' }]
  const p1 = panelFor(base, ctxFor('anomaly', 'attributeAnomaly'))
  const p2 = panelFor(withGroup, ctxFor('anomaly', 'attributeAnomaly'))
  check('加任意 groupId 面板不变', samePanel(p1, p2) == null)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
