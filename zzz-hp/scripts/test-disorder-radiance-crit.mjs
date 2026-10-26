/**
 * 紊乱 / 耀变补「异常类暴击区」：四个面板属性 disorderCritRate/disorderCritDmg、
 * radianceCritRate/radianceCritDmg 真正参与结算。
 *
 * 口径（用户 2026-10-19 定稿）：
 * - 暴击区与既有 turbulenceCrit* 完全同构：critRate 不 clamp，critDmg clamp 0~20；
 *   期望 = preCrit × (1 + 率 × 爆伤)；暴击率=0 → preCrit；暴击率=1 → preCrit × (1 + 爆伤)。
 * - 暴击率 / 爆伤取 bonusPanel（异常类触发者面板），不蹭 anomalyCrit*、turbulenceCrit*。
 * - 耀变普通链与蕾米埃尔本人耀变链都乘同一暴击区（触发者是不是蕾米都允许暴击）。
 *
 * 运行：npm run test:disorder-radiance-crit
 */
import { makePanel } from './_effectPipelineHarness.mjs'
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { pickEventDamage, resolveFlowHitCritMode } from '../src/utils/damageEvent.ts'
import { buildSkillCalcZoneRows } from '../src/utils/skillCalcZones.ts'
import { buildAlignedAnomalyFormulaGroups } from '../src/utils/anomalyFormulaDisplay.ts'
import { buildStatSourceGroups } from '../src/utils/statSourceTips.ts'
import {
  buildRemielSelfAtkProcessItems,
  buildRemielSelfAtkTipGroups,
  buildRemielSelfMasteryProcessItems,
} from '../src/utils/zoneSourceTips.ts'

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

const enemy = {
  level: 60,
  defense: 953,
  resistanceType: 'normal',
  vulnerableMultiplier: 1,
  staggerMultiplier: 1,
  specialMultiplier: 1,
}

/** 最小蕾米埃尔本人耀变输入（字段语义见 RemielSelfRadianceCalcInput） */
const remielSelf = {
  agentLevel: 60,
  inCombatAtk: 2500,
  inCombatMastery: 300,
  mutationZone: 1,
  penRate: 0,
  pen: 0,
  resPen: 0,
  radianceResPen: 0,
  radianceDmgBonus: 0,
  anomalyDmgBonus: 0,
  resistanceElement: null,
  isMb: false,
}

function run(extraPanel, subKind, extraInput = {}) {
  const panel = makePanel({
    atk: 2000,
    mastery: 100,
    anomalyMult: 713,
    anomalyDuration: 10,
    disorderBaseMult: 450,
    disorderCompMult: 7.5,
    radianceMult: 360,
    ...extraPanel,
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
    anomalySubKind: subKind,
    ...extraInput,
  })
}

const near = (a, b, eps = 1) => Math.abs(a - b) <= eps

console.log('\n[1] 紊乱暴击区：暴击率=0 → 区 1，期望 = 不暴击')
{
  const r = run({}, 'disorder')
  check('紊乱暴击区 = 1', r.disorderCritZone === 1, `${r.disorderCritZone}`)
  check('紊乱暴击区（必暴）= 1', r.disorderFullCritZone === 1, `${r.disorderFullCritZone}`)
  check(
    '期望 = 不暴击 = 必暴击',
    r.disorderExpected === r.disorderExpectedNoCrit && r.disorderExpected === r.disorderExpectedFullCrit,
    `${r.disorderExpected} / ${r.disorderExpectedNoCrit} / ${r.disorderExpectedFullCrit}`,
  )
  check('紊乱期望 > 0', r.disorderExpected > 0, `${r.disorderExpected}`)
}

console.log('\n[2] 紊乱暴击区：暴击率 100% / 爆伤 50 → 区 1.5，期望 = 不暴击 × 1.5')
{
  const r = run({ disorderCritRate: 100, disorderCritDmg: 50 }, 'disorder')
  check('紊乱暴击区（必暴）= 1.5', r.disorderFullCritZone === 1.5, `${r.disorderFullCritZone}`)
  check('紊乱暴击区（期望）= 1.5', r.disorderCritZone === 1.5, `${r.disorderCritZone}`)
  check(
    '期望 = 不暴击 × 1.5',
    near(r.disorderExpected, r.disorderExpectedNoCrit * 1.5),
    `${r.disorderExpected} vs ${r.disorderExpectedNoCrit * 1.5}`,
  )
  check(
    '期望 / 不暴击 = 1.5',
    Math.abs(r.disorderExpected / r.disorderExpectedNoCrit - 1.5) < 1e-3,
    `${(r.disorderExpected / r.disorderExpectedNoCrit).toFixed(4)}`,
  )
  check(
    '必暴击 = 不暴击 × 1.5',
    near(r.disorderExpectedFullCrit, r.disorderExpectedNoCrit * 1.5),
    `${r.disorderExpectedFullCrit}`,
  )
}

console.log('\n[3] 紊乱暴击区只吃紊乱字段，不蹭异常 / 乱流暴击')
{
  const r = run(
    {
      disorderCritRate: 100,
      disorderCritDmg: 50,
      anomalyCritRate: 30,
      anomalyCritDmg: 200,
      turbulenceCritRate: 80,
      turbulenceCritDmg: 300,
    },
    'disorder',
  )
  check(
    '紊乱暴击区仍是 1.5（不受异常/乱流爆伤影响）',
    r.disorderFullCritZone === 1.5 && r.disorderCritZone === 1.5,
    `full=${r.disorderFullCritZone} expected=${r.disorderCritZone}`,
  )
}

console.log('\n[4] 紊乱：pickEventDamage 三档 critMode 取到三个不同值')
{
  const r = run({ disorderCritRate: 50, disorderCritDmg: 100 }, 'disorder')
  const expected = pickEventDamage(r, 'disorder', 'expected')
  const noCrit = pickEventDamage(r, 'disorder', 'noCrit')
  const fullCrit = pickEventDamage(r, 'disorder', 'fullCrit')
  check('expected = disorderExpected', expected === r.disorderExpected, `${expected}`)
  check('noCrit = disorderExpectedNoCrit', noCrit === r.disorderExpectedNoCrit, `${noCrit}`)
  check('fullCrit = disorderExpectedFullCrit', fullCrit === r.disorderExpectedFullCrit, `${fullCrit}`)
  check(
    '三档互不相同',
    new Set([expected, noCrit, fullCrit]).size === 3,
    `${noCrit} / ${expected} / ${fullCrit}`,
  )
  check(
    'noCrit < expected < fullCrit',
    noCrit < expected && expected < fullCrit,
    `${noCrit} < ${expected} < ${fullCrit}`,
  )
  check(
    '流程汇总：紊乱按期望',
    resolveFlowHitCritMode() === 'expected',
    resolveFlowHitCritMode(),
  )
  check(
    '流程不允许指定必暴击（传 fullCrit 也仍是期望）',
    resolveFlowHitCritMode('disorder', 'fullCrit') === 'expected',
    resolveFlowHitCritMode('disorder', 'fullCrit'),
  )
}

console.log('\n[5] 耀变（普通链）暴击区：0% → 1；100% / 爆伤 50 → 1.5')
{
  const none = run({}, 'radiance')
  check('耀变暴击区 = 1', none.radianceCritZone === 1, `${none.radianceCritZone}`)
  check('耀变暴击区（必暴）= 1', none.radianceFullCritZone === 1, `${none.radianceFullCritZone}`)
  check(
    '期望 = 不暴击 = 必暴击',
    none.radianceExpected === none.radianceExpectedNoCrit &&
      none.radianceExpected === none.radianceExpectedFullCrit,
    `${none.radianceExpected} / ${none.radianceExpectedNoCrit} / ${none.radianceExpectedFullCrit}`,
  )

  const crit = run({ radianceCritRate: 100, radianceCritDmg: 50 }, 'radiance')
  check('耀变暴击区（必暴）= 1.5', crit.radianceFullCritZone === 1.5, `${crit.radianceFullCritZone}`)
  check(
    '期望 / 不暴击 = 1.5',
    Math.abs(crit.radianceExpected / crit.radianceExpectedNoCrit - 1.5) < 1e-3,
    `${(crit.radianceExpected / crit.radianceExpectedNoCrit).toFixed(4)}`,
  )
  check(
    '必暴击 = 不暴击 × 1.5',
    near(crit.radianceExpectedFullCrit, crit.radianceExpectedNoCrit * 1.5),
    `${crit.radianceExpectedFullCrit} vs ${crit.radianceExpectedNoCrit * 1.5}`,
  )

  const pickNoCrit = pickEventDamage(crit, 'radiance', 'noCrit')
  const pickExpected = pickEventDamage(crit, 'radiance', 'expected')
  const pickFullCrit = pickEventDamage(crit, 'radiance', 'fullCrit')
  check(
    '暴击率=100% 时期望 = 必暴击（区已满）',
    pickExpected === pickFullCrit && pickNoCrit < pickExpected,
    `${pickNoCrit} / ${pickExpected} / ${pickFullCrit}`,
  )
  // 半暴击率才让三档互不相同
  const half = run({ radianceCritRate: 50, radianceCritDmg: 100 }, 'radiance')
  const halfValues = [
    pickEventDamage(half, 'radiance', 'noCrit'),
    pickEventDamage(half, 'radiance', 'expected'),
    pickEventDamage(half, 'radiance', 'fullCrit'),
  ]
  check(
    '耀变三档 critMode 互不相同',
    new Set(halfValues).size === 3,
    halfValues.join(' / '),
  )
  check(
    '流程汇总：耀变按期望',
    resolveFlowHitCritMode() === 'expected',
    resolveFlowHitCritMode(),
  )
  check(
    '流程不允许指定必暴击（传 fullCrit 也仍是期望）',
    resolveFlowHitCritMode('radiance', 'fullCrit') === 'expected',
    resolveFlowHitCritMode('radiance', 'fullCrit'),
  )
  check(
    '所有伤害类型流程口径一律期望（含属性异常/乱流/异放）',
    ['direct', 'sharpen', 'anomaly', 'disorder', 'turbulence', 'anomalyRelease', 'radiance'].every(
      (kind) => resolveFlowHitCritMode(kind, 'expected') === 'expected',
    ),
    ['direct', 'sharpen', 'anomaly', 'disorder', 'turbulence', 'anomalyRelease', 'radiance']
      .map((kind) => `${kind}=${resolveFlowHitCritMode(kind, 'expected')}`)
      .join(' '),
  )
}

console.log('\n[6] 耀变（蕾米埃尔本人链）同样乘暴击区')
{
  const none = run({}, 'radiance', { remielSelfRadianceCalc: remielSelf })
  check('本人链已启用', none.remielSelfRadianceActive === true, `${none.remielSelfRadianceActive}`)
  check('本人链耀变暴击区 = 1', none.radianceCritZone === 1, `${none.radianceCritZone}`)
  check(
    '本人链期望 = 不暴击',
    none.radianceExpected === none.radianceExpectedNoCrit,
    `${none.radianceExpected} / ${none.radianceExpectedNoCrit}`,
  )

  const crit = run({ radianceCritRate: 100, radianceCritDmg: 50 }, 'radiance', {
    remielSelfRadianceCalc: remielSelf,
  })
  check('本人链耀变暴击区（必暴）= 1.5', crit.radianceFullCritZone === 1.5, `${crit.radianceFullCritZone}`)
  check(
    '本人链期望 / 不暴击 = 1.5',
    Math.abs(crit.radianceExpected / crit.radianceExpectedNoCrit - 1.5) < 1e-3,
    `${(crit.radianceExpected / crit.radianceExpectedNoCrit).toFixed(4)}`,
  )
}

console.log('\n[7] 触发者是蕾米还是别人都允许耀变暴击')
{
  // 蕾米埃尔本人作异常类触发者（流明）与非蕾米触发者，两种链路各自都吃暴击区
  const asRemiel = run({ radianceCritRate: 100, radianceCritDmg: 50 }, 'radiance', {
    anomalyTriggerElement: '流明',
    triggerAgentElement: '流明',
  })
  const asOther = run({ radianceCritRate: 100, radianceCritDmg: 50 }, 'radiance', {
    anomalyTriggerElement: '火',
    triggerAgentElement: '火',
  })
  check('蕾米触发：耀变暴击区 = 1.5', asRemiel.radianceFullCritZone === 1.5, `${asRemiel.radianceFullCritZone}`)
  check('非蕾米触发：耀变暴击区 = 1.5', asOther.radianceFullCritZone === 1.5, `${asOther.radianceFullCritZone}`)
  check(
    '蕾米触发：期望 / 不暴击 = 1.5',
    Math.abs(asRemiel.radianceExpected / asRemiel.radianceExpectedNoCrit - 1.5) < 1e-3,
    `${(asRemiel.radianceExpected / asRemiel.radianceExpectedNoCrit).toFixed(4)}`,
  )
  check(
    '非蕾米触发：期望 / 不暴击 = 1.5',
    Math.abs(asOther.radianceExpected / asOther.radianceExpectedNoCrit - 1.5) < 1e-3,
    `${(asOther.radianceExpected / asOther.radianceExpectedNoCrit).toFixed(4)}`,
  )

  // 本人蕾米链 + 非蕾米触发者属性的组合也允许暴击
  const remielChainOtherTrigger = run({ radianceCritRate: 100, radianceCritDmg: 50 }, 'radiance', {
    remielSelfRadianceCalc: remielSelf,
    anomalyTriggerElement: '火',
    triggerAgentElement: '火',
  })
  check(
    '本人链 + 非蕾米触发属性仍暴击 1.5',
    remielChainOtherTrigger.radianceFullCritZone === 1.5,
    `${remielChainOtherTrigger.radianceFullCritZone}`,
  )
}

console.log('\n[8] 招式详情「计算过程」出现暴击区行，且带三档伤害')
{
  const noCrit = run({}, 'disorder')
  const disorderRows = buildSkillCalcZoneRows(noCrit, 'disorder')
  check(
    '无紊乱爆伤 → 不出「紊乱暴击区」行',
    !disorderRows.some((row) => row.label === '紊乱暴击区'),
    disorderRows.map((row) => row.label).join(' / '),
  )
  check(
    '无紊乱爆伤 → 只有「期望伤害」一行',
    !disorderRows.some((row) => row.label === '暴击伤害' || row.label === '不暴击伤害'),
    disorderRows.map((row) => row.label).join(' / '),
  )

  const crit = run({ disorderCritRate: 100, disorderCritDmg: 50 }, 'disorder')
  const critRows = buildSkillCalcZoneRows(crit, 'disorder')
  const critRow = critRows.find((row) => row.label === '紊乱暴击区')
  check('出「紊乱暴击区」行', Boolean(critRow), critRow?.value ?? '缺失')
  check('紊乱暴击区取值 1.5', critRow?.value === '1.5', critRow?.value)
  check(
    '三档伤害行齐备（暴击/期望/不暴击）',
    ['暴击伤害', '期望伤害', '不暴击伤害'].every((label) =>
      critRows.some((row) => row.label === label),
    ),
    critRows.map((row) => `${row.label}=${row.value}`).join(' / '),
  )

  const radianceCrit = run({ radianceCritRate: 100, radianceCritDmg: 50 }, 'radiance')
  const radianceRows = buildSkillCalcZoneRows(radianceCrit, 'radiance')
  const radianceRow = radianceRows.find((row) => row.label === '耀变暴击区')
  check('普通耀变链出「耀变暴击区」行', Boolean(radianceRow), radianceRow?.value ?? '缺失')
  check('耀变暴击区取值 1.5', radianceRow?.value === '1.5', radianceRow?.value)

  const remielResult = run({ radianceCritRate: 100, radianceCritDmg: 50 }, 'radiance', {
    remielSelfRadianceCalc: remielSelf,
  })
  const remielRows = buildSkillCalcZoneRows(remielResult, 'radiance')
  const remielRow = remielRows.find((row) => row.label === '耀变暴击区')
  check('蕾米本人耀变链也出「耀变暴击区」行', Boolean(remielRow), remielRow?.value ?? '缺失')
  check('本人链耀变暴击区取值 1.5', remielRow?.value === '1.5', remielRow?.value)
  check(
    '本人链不再显示合成项「蕾米埃尔异常基础」',
    !remielRows.some((row) => row.label === '蕾米埃尔异常基础'),
    remielRows.map((row) => row.label).join(' / '),
  )
  check(
    '本人链保留 5 个基础乘区（局内攻击力/局内精通区/特殊等级区/异化系数区/等级区）',
    ['局内攻击力', '局内精通区', '特殊等级区', '异化系数区', '等级区'].every((label) =>
      remielRows.some((row) => row.label === label),
    ),
    remielRows.map((row) => row.label).join(' / '),
  )
  const baseProduct =
    (remielResult.remielSelfInCombatAtk ?? 0) *
    (remielResult.remielSelfInCombatMasteryZone ?? 0) *
    (remielResult.remielSelfSpecialLevelZone ?? 1) *
    (remielResult.remielSelfMutationZone ?? 1) *
    (remielResult.remielSelfStandardLevelZone ?? 1)
  check(
    '5 个基础乘区连乘 = 结算用的异常基础（去掉合成项不丢因子）',
    near(baseProduct, remielResult.anomalyBaseExpected, remielResult.anomalyBaseExpected * 1e-3),
    `${baseProduct} vs ${remielResult.anomalyBaseExpected}`,
  )
}

console.log('\n[9] 底部伤害详情公式表：紊乱 / 耀变各多「暴击区」一项，结果只显示当前口径一档')
{
  const fmt = (v) => String(Math.round(v * 1000) / 1000)
  const num = (v) => String(v)

  const disorder = run({ disorderCritRate: 100, disorderCritDmg: 50 }, 'disorder')
  const [, disorderGroup] = buildAlignedAnomalyFormulaGroups(disorder, 'disorder', '紊乱伤害', fmt, num)
  const disorderTerm = disorderGroup.terms.find((term) => term.tipsKey === 'disorderCritZone')
  check('紊乱公式有「紊乱暴击区」一项', Boolean(disorderTerm), disorderTerm?.label ?? '缺失')
  check('紊乱暴击区标签正确', disorderTerm?.label === '紊乱暴击区', disorderTerm?.label)
  // 2026-10-18：乘区显示**期望**（暴击率 100% × 爆伤 50% → 1 + 0.5 = 1.5），不再是「1 / 1.5」两档
  check('紊乱暴击区取值 = 期望 1.5', disorderTerm?.value === '1.5', disorderTerm?.value)
  // 2026-10-22（用户）：公式行不再重复「期望 / 不暴击 / 暴击」三档 —— 下方明细已有三档，
  // 公式行只保留当前暴击口径的一档结果，避免同一行出现多种风格。
  check(
    '紊乱公式行不再重复三档（dualResults 已移除）',
    disorderGroup.dualResults === undefined,
    disorderGroup.dualResults === undefined ? '无三档块' : '仍有三档块',
  )
  check(
    '紊乱结果 = 当前口径（期望）伤害',
    Number(disorderGroup.result) === Number(pickEventDamage(disorder, 'disorder', 'expected')),
    `${disorderGroup.result} vs ${pickEventDamage(disorder, 'disorder', 'expected')}`,
  )
  check(
    '三档数值仍可算且不暴击 < 期望 ≤ 暴击',
    pickEventDamage(disorder, 'disorder', 'noCrit') <
      pickEventDamage(disorder, 'disorder', 'expected') &&
      pickEventDamage(disorder, 'disorder', 'expected') <=
        pickEventDamage(disorder, 'disorder', 'fullCrit'),
    `${pickEventDamage(disorder, 'disorder', 'noCrit')} / ${pickEventDamage(disorder, 'disorder', 'expected')} / ${pickEventDamage(disorder, 'disorder', 'fullCrit')}`,
  )

  for (const [label, extra] of [
    ['普通耀变链', {}],
    ['蕾米本人链', { remielSelfRadianceCalc: remielSelf }],
  ]) {
    const radiance = run({ radianceCritRate: 100, radianceCritDmg: 50 }, 'radiance', extra)
    const [, group] = buildAlignedAnomalyFormulaGroups(radiance, 'radiance', '紊乱伤害', fmt, num)
    const term = group.terms.find((item) => item.tipsKey === 'radianceCritZone')
    check(`${label}：公式有「耀变暴击区」一项`, Boolean(term), term?.label ?? '缺失')
    check(`${label}：耀变暴击区取值 = 期望 1.5`, term?.value === '1.5', term?.value)
    check(
      `${label}：公式行不再重复三档（dualResults 已移除）`,
      group.dualResults === undefined,
      group.dualResults === undefined ? '无三档块' : '仍有三档块',
    )
    check(
      `${label}：结果 = 当前口径（期望）伤害`,
      Number(group.result) === Number(pickEventDamage(radiance, 'radiance', 'expected')),
      `${group.result} vs ${pickEventDamage(radiance, 'radiance', 'expected')}`,
    )
  }
}

console.log('\n[10] 本人耀变局内攻/精与特殊倍率乘区：弹窗计算过程与来源')
{
  const atkProcess = buildRemielSelfAtkProcessItems({
    externalAtk: 2000,
    inCombatAtk: 2500,
    sourceItems: ['影画2 攻击力转模 +500'],
  })
  check(
    '局内攻击计算过程给出 局外 + 转模 = 局内',
    atkProcess.includes('2,000 + 500 = 2,500'),
    atkProcess.join(' | '),
  )
  check(
    '局内攻击计算过程标注特殊口径（不含局内攻击%）',
    atkProcess.some((item) => item.startsWith('仅：局外攻击')),
    atkProcess.join(' | '),
  )

  const masteryProcess = buildRemielSelfMasteryProcessItems({
    externalMastery: 200,
    inCombatMasteryZone: 3,
    sourceItems: ['4件套 +100'],
  })
  check(
    '局内精通计算过程给出 ÷100 得区',
    masteryProcess.includes('局内精通区 ÷100 → 3'),
    masteryProcess.join(' | '),
  )

  const atkGroups = buildRemielSelfAtkTipGroups({
    externalAtk: 2000,
    inCombatAtk: 2500,
    sourceItems: ['影画2 攻击力转模 +500'],
    fullPanelAtk: 3000,
  })
  check(
    '局内攻击弹窗含 来源 / 对照 / 加减过程',
    ['来源', '对照（本人耀变不用）', '加减过程'].every((label) =>
      atkGroups.some((group) => group.label === label),
    ),
    atkGroups.map((group) => group.label).join(' / '),
  )

  const specialSourceGroups = buildStatSourceGroups({
    keys: ['specialMult', 'specialMultFactor'],
    externalPanel: makePanel({ specialMult: 120, specialMultFactor: 110 }),
    sources: [
      { id: 'special-buff', label: '测试特殊倍率', mods: { specialMult: 20, specialMultFactor: 10 } },
    ],
    showAdditiveProcess: false,
  })
  check(
    '特殊倍率来源能列出局外面板与增益条目',
    specialSourceGroups.some((group) =>
      group.items.some((item) => item.includes('特殊倍率%')),
    ) && specialSourceGroups.some((group) => group.label === '测试特殊倍率'),
    specialSourceGroups.map((group) => `${group.label}：${group.items.join('，')}`).join(' / '),
  )

  const specialPanel = makePanel({ specialMult: 120, specialMultFactor: 110 })
  const specialResult = computeDamageResult({
    finalPanel: specialPanel,
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: enemy,
    combatVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatSpecial: 0,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
    triggerFinalPanel: specialPanel,
    triggerAgentLevel: 60,
    anomalyTriggerPanel: specialPanel,
    anomalySubKind: 'radiance',
    remielSelfRadianceCalc: remielSelf,
  })
  check(
    '特殊倍率乘区 = max(0, 120%) × 修正 110% = 1.32',
    Math.abs(specialResult.specialMultZone - 1.32) < 1e-6,
    `${specialResult.specialMultZone}`,
  )
}

console.log(`\n${failed ? `❌ ${failed} failed, ${passed} passed` : `✅ all passed（${passed}）`}`)
if (failed) process.exit(1)
