/**
 * 增益字段表与「零表」必须对齐，且缺键不能变成 NaN。
 *
 * 2026-10-18 事故：`buffEffect.BUFF_STAT_KEYS`（造零表 / 扁平↔效果 的字段来源）漏了
 * `turbulenceCritRate` 等 6 个子类暴击字段，而 `calculatorUi.BUFF_STAT_FIELDS`（合并时的
 * 遍历表）有它们 → `0 + undefined = NaN` → 局内面板 turbulenceCrit* 变 NaN →
 * 乱流期望伤害整条 NaN（页面显示「—」，且「乱流暴击区」被当成未启用而隐藏）。
 *
 * 运行：npm run test:buff-stat-keys
 */
import {
  fixedEffect,
  makePanel,
  makePanelCtx,
  mindscapeWithEffects,
  testAgent,
} from './_effectPipelineHarness.mjs'
import {
  effectsToFlatMods,
  flatModsToEffects,
  resolveEffectsToMods,
} from '../src/utils/buffEffect.ts'
import {
  BUFF_STAT_FIELDS,
  createEmptyBuffStatModifiers,
  mergeBuffStatModifiers,
} from '../src/utils/calculatorUi.ts'
import { computeFinalPanel } from '../src/utils/panelBuffCalc.ts'
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { buildAlignedAnomalyFormulaGroups } from '../src/utils/anomalyFormulaDisplay.ts'

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

const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const fieldKeys = BUFF_STAT_FIELDS.map((field) => field.key)

console.log('\n[1] 「零表」覆盖所有可配增益字段')
{
  const zero = resolveEffectsToMods([], {})
  const missing = fieldKeys.filter((key) => !(key in zero))
  check('BUFF_STAT_FIELDS 每个键都在零表里', missing.length === 0, missing.join(', ') || '无缺键')

  const nanKeys = fieldKeys.filter((key) => !finite(zero[key]))
  check('零表每格都是有限数字', nanKeys.length === 0, nanKeys.join(', ') || '全部有限')
}

console.log('\n[2] 每个可配字段都能通过效果解析生效')
{
  const bad = []
  for (const key of fieldKeys) {
    const mods = resolveEffectsToMods([fixedEffect(`eff-${key}`, key, 30)], {})
    if (mods[key] !== 30) bad.push(`${key}=${mods[key]}`)
  }
  check('每个字段都能被 fixed 效果写入 30', bad.length === 0, bad.join(', ') || '全部命中')
}

console.log('\n[3] 源对象缺键时合并按 0 处理（不产生 NaN）')
{
  const full = resolveEffectsToMods([fixedEffect('eff-dmg', 'dmgBonus', 20)], {})
  const partial = { ...full }
  delete partial.turbulenceCritDmg
  delete partial.radianceCritRate
  const merged = mergeBuffStatModifiers(createEmptyBuffStatModifiers(), partial)
  check('缺键合并后 dmgBonus 仍 +20', merged.dmgBonus === 20, `${merged.dmgBonus}`)
  check('缺键合并后 turbulenceCritDmg = 0', merged.turbulenceCritDmg === 0, `${merged.turbulenceCritDmg}`)
  check('缺键合并后 radianceCritRate = 0', merged.radianceCritRate === 0, `${merged.radianceCritRate}`)
  const nanKeys = fieldKeys.filter((key) => !finite(merged[key]))
  check('合并结果没有任何 NaN', nanKeys.length === 0, nanKeys.join(', ') || '全部有限')
}

console.log('\n[4] 扁平 mods ↔ 效果往返不丢子类暴击')
{
  const flat = { ...createEmptyBuffStatModifiers(), turbulenceCritDmg: 30, disorderCritRate: 12 }
  const roundTrip = effectsToFlatMods(flatModsToEffects(flat, 'self'))
  check('turbulenceCritDmg 往返仍是 30', roundTrip.turbulenceCritDmg === 30, `${roundTrip.turbulenceCritDmg}`)
  check('disorderCritRate 往返仍是 12', roundTrip.disorderCritRate === 12, `${roundTrip.disorderCritRate}`)
}

console.log('\n[5] 端到端：面板带一条 Buff 时五类异常都出有限伤害')
{
  const ctx = makePanelCtx({
    agents: [
      testAgent('a', {
        mindscapeBuffs: mindscapeWithEffects([fixedEffect('eff-dmg', 'dmgBonus', 20)]),
      }),
    ],
  })
  const external = makePanel({
    atk: 2000,
    mastery: 100,
    dmgBonus: 10,
    turbulenceBaseMult: 800,
    turbulenceCompMult: 7.5,
    anomalyDuration: 10,
    anomalyMult: 713,
  })
  const { finalPanel } = computeFinalPanel(external, ctx)

  check('局内 turbulenceCritRate 是 0 不是 NaN', finalPanel.turbulenceCritRate === 0, `${finalPanel.turbulenceCritRate}`)
  check('局内 turbulenceCritDmg 是 0 不是 NaN', finalPanel.turbulenceCritDmg === 0, `${finalPanel.turbulenceCritDmg}`)
  const nanPanelKeys = fieldKeys.filter((key) => key in finalPanel && !finite(finalPanel[key]))
  check(
    '局内面板里所有增益字段都是有限数字',
    nanPanelKeys.length === 0,
    nanPanelKeys.join(', ') || '全部有限',
  )

  const enemy = {
    level: 60,
    defense: 953,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1,
    specialMultiplier: 1,
  }
  const input = {
    finalPanel,
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: enemy,
    combatVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatSpecial: 0,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
    triggerFinalPanel: finalPanel,
    triggerAgentLevel: 60,
    anomalyTriggerPanel: finalPanel,
  }
  const turbulence = computeDamageResult({ ...input, anomalySubKind: 'turbulence' })
  check('乱流期望伤害是有限数字', finite(turbulence.turbulenceExpected), `${turbulence.turbulenceExpected}`)
  check('乱流期望伤害 > 0', turbulence.turbulenceExpected > 0, `${turbulence.turbulenceExpected}`)
  check('乱流倍率区 = 800% + 10×0.075×100', Math.abs(turbulence.turbulenceZone - 8.75) < 1e-9, `${turbulence.turbulenceZone}`)

  for (const kind of ['anomaly', 'disorder', 'anomalyRelease', 'radiance']) {
    const r = computeDamageResult({ ...input, anomalySubKind: kind })
    const value =
      kind === 'anomaly'
        ? r.anomalyExpected
        : kind === 'disorder'
          ? r.disorderExpected
          : kind === 'anomalyRelease'
            ? r.anomalyReleaseExpected
            : r.radianceExpected
    check(`${kind} 期望伤害是有限数字`, finite(value), `${value}`)
  }
}

console.log('\n[6] 乱流暴击区：没爆伤时 = 1（不展示），有爆伤时按爆伤放大')
{
  const enemy = {
    level: 60,
    defense: 953,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1,
    specialMultiplier: 1,
  }
  const base = (extra) => {
    const panel = makePanel({
      atk: 2000,
      mastery: 100,
      turbulenceBaseMult: 800,
      turbulenceCompMult: 7.5,
      anomalyDuration: 10,
      ...extra,
    })
    return computeDamageResult({
      finalPanel: panel,
      piercePower: 0,
      baseDamageSource: 'atk',
      isMbMainAgent: false,
      enemyInput: enemy,
      combatVulnerable: 0,
      combatStaggerVulnerable: 0,
      combatSpecial: 0,
      staggerPhase: 'normal',
      ownerAgentLevel: 60,
      triggerFinalPanel: panel,
      triggerAgentLevel: 60,
      anomalyTriggerPanel: panel,
      anomalySubKind: 'turbulence',
    })
  }
  const none = base({})
  check('无乱流爆伤 → 乱流暴击区 = 1', none.turbulenceFullCritZone === 1, `${none.turbulenceFullCritZone}`)
  check('无乱流爆伤 → 期望 = 不暴击期望', none.turbulenceExpected === none.turbulenceExpectedNoCrit, `${none.turbulenceExpected}`)
  const withCrit = base({ turbulenceCritRate: 100, turbulenceCritDmg: 50 })
  check('乱流爆伤 50 → 暴击区 1.5', withCrit.turbulenceFullCritZone === 1.5, `${withCrit.turbulenceFullCritZone}`)
  check(
    '乱流暴击 100% / 爆伤 50 → 期望 = 不暴击 × 1.5',
    Math.abs(withCrit.turbulenceExpected - withCrit.turbulenceExpectedNoCrit * 1.5) < 1,
    `${withCrit.turbulenceExpected} vs ${withCrit.turbulenceExpectedNoCrit}`,
  )
}

console.log('\n[7] 伤害详情公式表：乱流那一格读乱流暴击区，不是异常暴击区')
{
  const enemy = {
    level: 60,
    defense: 953,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1,
    specialMultiplier: 1,
  }
  const panel = makePanel({
    atk: 2000,
    mastery: 100,
    turbulenceBaseMult: 800,
    turbulenceCompMult: 7.5,
    anomalyDuration: 10,
    anomalyCritRate: 30,
    anomalyCritDmg: 90,
    turbulenceCritRate: 100,
    turbulenceCritDmg: 50,
  })
  const input = {
    finalPanel: panel,
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: enemy,
    combatVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatSpecial: 0,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
    triggerFinalPanel: panel,
    triggerAgentLevel: 60,
    anomalyTriggerPanel: panel,
  }
  const fmt = (v) => String(Math.round(v * 1000) / 1000)
  const turbulence = computeDamageResult({ ...input, anomalySubKind: 'turbulence' })
  const [, turbulenceGroup] = buildAlignedAnomalyFormulaGroups(
    turbulence,
    'turbulence',
    '紊乱',
    fmt,
    (v) => String(v),
  )
  const critTerm = turbulenceGroup.terms.find((term) => term.tipsKey === 'turbulenceCritZone')
  check('乱流公式里有「乱流暴击区」这一项', Boolean(critTerm), critTerm?.label ?? '缺失')
  check('乱流暴击区标签不是「异常暴击区」', critTerm?.label === '乱流暴击区', critTerm?.label)
  check('乱流暴击区取 turbulenceFullCritZone（1.5）', critTerm?.value === '1 / 1.5', critTerm?.value)

  const anomaly = computeDamageResult({ ...input, anomalySubKind: 'anomaly' })
  const [, anomalyGroup] = buildAlignedAnomalyFormulaGroups(
    anomaly,
    'anomaly',
    '紊乱',
    fmt,
    (v) => String(v),
  )
  const anomalyTerm = anomalyGroup.terms.find((term) => term.tipsKey === 'anomalyCritZone')
  check('属性异常仍用「异常暴击区」', anomalyTerm?.label === '异常暴击区', anomalyTerm?.label)
  check('属性异常取 anomalyFullCritZone（1.9）', anomalyTerm?.value === '1 / 1.9', anomalyTerm?.value)
}

console.log(`\n${failed ? `❌ ${failed} failed, ${passed} passed` : `✅ all passed（${passed}）`}`)
if (failed) process.exit(1)