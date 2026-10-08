/**
 * 行级增益例外 —— 端到端语义验证（真实 fixture，不需要 dev server）。
 *
 * 背景（2026-09-20 用户实测踩坑）：页面上取消某行增益勾选，伤害**不变**。
 * 根因是过滤只挂在"带明细"路径，而页面显示走 numbers-only 路径。
 * 这个脚本从**真实方案**出发，直接盯"伤害数字有没有变"，把那条 bug 钉住。
 *
 * 四个断言：
 * 1. 整行禁用全部效果块 → 该行伤害**必须变**（证明例外真的走到数字）
 * 2. 恢复全局（override = null）→ 伤害**回到原值**（证明无污染）
 * 3. 单块禁用 → 存在能改变伤害的块（证明粒度生效，不是"一刀切全禁"）
 * 4. 跨行隔离：给 A 行设例外，B 行伤害**不变**（证明目录缓存没串味）
 *
 * 用法：npx vite-node scripts/test-buff-row-e2e.mjs [方案JSON]
 */
import fs from 'node:fs'
import path from 'node:path'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import { buildOptimalEvalContext, evaluateOptimalEventDetail } from '../src/utils/optimalAffixAlloc.ts'
import { blockKeyOfCollected, collectAllBuffEffects } from '../src/utils/panelBuffCalc.ts'
import { setFlowBuffEffectDisabled } from '../src/utils/flowBuffTable.ts'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'
import { BUFFS_JSON, FRONTEND_ROOT } from './_paths.mjs'

const SCHEME =
  process.argv[2] || path.join(FRONTEND_ROOT, 'fixtures/pen-rate-alloc/ye-shiyuan-pen-rate.json')
if (!fs.existsSync(SCHEME)) {
  console.error(`方案 JSON 不存在：${SCHEME}`)
  process.exit(1)
}

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

const buffs = JSON.parse(fs.readFileSync(BUFFS_JSON, 'utf8'))
const schemePack = JSON.parse(fs.readFileSync(SCHEME, 'utf8'))
const scheme = Object.values(schemePack.schemes)[0]
const skillById = new Map(
  [...(buffs.skills ?? []), ...(schemePack.customSkills ?? [])].map((s) => [s.id, s]),
)

const flowResult = resolveFlow({
  slots: scheme.slots,
  teamSlots: scheme.teamSlots.map((s) => ({ agentId: s.agentId, rank: s.rank })),
  findSkill: (id) => skillById.get(id) ?? null,
  skillSubcategories: buffs.skillSubcategories,
})

const mainSlotIndex = Number(scheme.activeSlot ?? 0)
const mainSlot = scheme.teamSlots[mainSlotIndex]
const mainAgent = buffs.agents.find((a) => a.id === mainSlot.agentId)

const ctx = buildOptimalEvalContext({
  isMb: mainAgent?.profession === '命破',
  isFengYu: mainAgent?.profession === '锋御',
  teamSlots: scheme.teamSlots,
  agents: buffs.agents,
  wengines: buffs.wengines,
  bangboo: {
    id: 'none',
    name: 'none',
    avatar_image: null,
    effects: [],
    refinementEffects: [],
    fixedMods: {},
    refinementMods: {},
  },
  bangbooRefine: 1,
  driveDiscs: buffs.driveDiscs,
  mainSlotIndex,
  driveDiscMainStats: schemeAffixInputs(scheme, mainSlot.agentId).affixDriveDiscMainStats ?? {
    slot4MainStat: 'mastery',
    slot5MainStat: 'dmgBonus',
    slot6MainStat: 'energyRegen',
  },
  enemyInput: {
    level: 60,
    defense: 953,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1.5,
    specialMultiplier: 1,
  },
  baseDamageSource:
    mainAgent?.profession === '命破' ? 'pierce' : mainAgent?.profession === '锋御' ? 'def' : 'atk',
  buffSelection: null,
  slotBuffSelections: scheme.multiSlotBuffSelection ?? null,
  activeSlotPanels: schemeActivePanels(scheme),
  convertSlotPanels: scheme.convertSlotPanels ?? undefined,
  hits: flowResult.hits,
  resolveSubcategory: (id) => buffs.skillSubcategories.find((x) => x.id === id) ?? null,
  skillSubcategories: buffs.skillSubcategories,
  followUpSkillRules: buffs.followUpSkillRules,
})

function evalPerHit(hit) {
  const detail = evaluateOptimalEventDetail(ctx, null, hit, {})
  return detail ? detail.perHit : null
}

// 勾选情况（诊断信息，方便失败时判断是不是 fixture 本身没勾东西）
const enabledIds = scheme.multiSlotBuffSelection?.team?.enabledIds ?? {}
const enabledTrue = Object.values(enabledIds).filter((v) => v === true).length
const enabledFalse = Object.values(enabledIds).filter((v) => v === false).length

console.log('=== 环境 ===')
console.log(`  方案：${scheme.name ?? '(无名)'}`)
console.log(`  流程命中数：${flowResult.hits.length}`)
console.log(`  全队勾选表：true ${enabledTrue} 条 / false ${enabledFalse} 条`)
const allEffects = collectAllBuffEffects(ctx.panelContext)
const blockKeys = [...new Set(allEffects.map((item) => blockKeyOfCollected(item)))]
console.log(`  效果条目：${allEffects.length} 条 / 效果块：${blockKeys.length} 个`)

// 挑一条能出伤害的命中作为 A 行
let hitA = null
let dA0 = null
for (const hit of flowResult.hits) {
  const value = evalPerHit(hit)
  if (value != null && value > 0) {
    hitA = hit
    dA0 = value
    break
  }
}
check('fixture 里存在能出伤害的流程行', hitA != null)
if (!hitA) {
  console.log(`\n=== 结果：passed = ${passed}, failed = ${failed} ===`)
  process.exit(1)
}
console.log(`  A 行：${hitA.id}（perHit = ${dA0.toFixed(4)}）`)

console.log('=== 1. 整行禁用全部效果块 → 伤害必须变 ===')
hitA.buffOverride = { disabledBlockIds: blockKeys }
const dAAll = evalPerHit(hitA)
console.log(`  禁用后 perHit = ${dAAll == null ? 'null' : dAAll.toFixed(4)}`)
check('整行禁用后伤害发生变化', dAAll !== dA0, `原 ${dA0} / 现 ${dAAll}`)
check('整行禁用后伤害不增加（符合"只做减法"）', dAAll == null || dAAll <= dA0)

console.log('=== 2. 恢复全局 → 回到原值 ===')
hitA.buffOverride = null
const dARestore = evalPerHit(hitA)
check('恢复后与基准逐位相同', dARestore === dA0, `基准 ${dA0} / 恢复 ${dARestore}`)

console.log('=== 3. 单块禁用 → 存在能改变伤害的块 ===')
let foundKey = null
let foundValue = null
for (const key of blockKeys) {
  hitA.buffOverride = { disabledBlockIds: [key] }
  const value = evalPerHit(hitA)
  if (value !== dA0) {
    foundKey = key
    foundValue = value
    break
  }
}
hitA.buffOverride = null
console.log(`  命中块：${foundKey ?? '(无)'}${foundValue == null ? '' : ` → perHit = ${foundValue.toFixed(4)}`}`)
check('存在单块禁用即可改变伤害的块', foundKey != null)

console.log('=== 4. 跨行隔离：给 A 行设例外，B 行不变 ===')
let hitB = null
let dB0 = null
for (const hit of flowResult.hits) {
  if (hit === hitA) continue
  const value = evalPerHit(hit)
  if (value != null && value > 0) {
    hitB = hit
    dB0 = value
    break
  }
}
if (hitB) {
  console.log(`  B 行：${hitB.id}（perHit = ${dB0.toFixed(4)}）`)
  hitA.buffOverride = { disabledBlockIds: [foundKey ?? blockKeys[0]] }
  const dBAfter = evalPerHit(hitB)
  hitA.buffOverride = null
  check('B 行伤害不受 A 行例外影响', dBAfter === dB0, `基准 ${dB0} / 现在 ${dBAfter}`)
} else {
  check('fixture 里存在第二条能出伤害的流程行', false)
}

console.log('=== 5. numbers-only 路径（页面显示走的就是它）也要吃例外 ===')
function evalPerHitNumbers(hit) {
  const detail = evaluateOptimalEventDetail(ctx, null, hit, { includeDetails: false })
  return detail ? detail.perHit : null
}
// 先跑一次"无例外"把目录缓存喂上 —— 旧实现正是在这一步之后失效（缓存命中 → 用没过滤的清单）
hitA.buffOverride = null
const numbersNone = evalPerHitNumbers(hitA)
hitA.buffOverride = { disabledBlockIds: [foundKey ?? blockKeys[0]] }
const numbersSome = evalPerHitNumbers(hitA)
hitA.buffOverride = null
console.log(`  numbers-only：无例外 ${numbersNone} / 有例外 ${numbersSome}`)
check('numbers-only 路径：设例外后伤害变化', numbersSome !== numbersNone)
check('numbers-only 路径：与明细路径的数值一致', numbersSome === foundValue)
const numbersRestore = evalPerHitNumbers(hitA)
check('numbers-only 路径：恢复后逐位回到基准（缓存未被污染）', numbersRestore === numbersNone)

console.log('=== 6. 单次评估耗时（有例外 vs 无例外） ===')
const PERF_N = 100
const PERF_ROUNDS = 5
function timeEvals(override, times) {
  hitA.buffOverride = override
  const t0 = performance.now()
  for (let i = 0; i < times; i += 1) evalPerHit(hitA)
  return (performance.now() - t0) / times
}
const overrideSample = { disabledBlockIds: [foundKey ?? blockKeys[0]] }
timeEvals(null, 10)
timeEvals(overrideSample, 10)
const noneSamples = []
const someSamples = []
for (let round = 0; round < PERF_ROUNDS; round += 1) {
  noneSamples.push(timeEvals(null, PERF_N))
  someSamples.push(timeEvals(overrideSample, PERF_N))
}
hitA.buffOverride = null
const medianOf = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const msNone = medianOf(noneSamples)
const msSome = medianOf(someSamples)
console.log(`  无例外：${msNone.toFixed(3)} ms/次（走目录缓存）`)
console.log(`  有例外：${msSome.toFixed(3)} ms/次（例外已并入缓存键，同一例外命中缓存）`)
console.log(`  倍率：${(msSome / msNone).toFixed(2)}×`)
console.log('  说明：例外进了缓存键 —— 同一例外重复求值命中缓存，不同例外各自成键；不再有"绕开缓存重算本行"的开销')

console.log('=== 7. 行级层数覆盖要走到伤害数字（并且点格不会把它清掉） ===')

const stackedIds = [
  ...new Set(
    allEffects
      .filter(
        (item) =>
          (item.effect.kind === 'stacked' || item.effect.stackable) &&
          (item.effect.valuePerStack ?? 0) !== 0,
      )
      .map((item) => item.effect.id),
  ),
]
let stackId = null
let stackZeroValue = null
for (const id of stackedIds) {
  hitA.buffOverride = { stacksByEffectId: { [id]: 0 } }
  const value = evalPerHit(hitA)
  if (value != null && value !== dA0) {
    stackId = id
    stackZeroValue = value
    break
  }
}
hitA.buffOverride = null
console.log(`  叠层候选 ${stackedIds.length} 条；命中的：${stackId ?? '(无)'}`)
if (stackedIds.length) {
  check('存在「层数清零即改变伤害」的叠层增益', stackId != null)
} else {
  console.log('  （该 fixture 里没有叠层效果，跳过）')
}
if (stackId) {
  check('层数清零后伤害不增加（层数只做加法贡献）', stackZeroValue <= dA0, `基准 ${dA0} / 清零 ${stackZeroValue}`)

  // 流程增益表点一格 = 勾选写回：不得顺手把层数覆盖清掉 —— 清掉了下面这一行就会回到基准
  const flowRow = { id: 'e2e-row', buffOverrides: { stacksByEffectId: { [stackId]: 0 } } }
  setFlowBuffEffectDisabled({
    entry: flowRow,
    effectId: 'e2e-effect',
    blockKey: 'e2e-block',
    siblingEffectIds: [],
    disabled: true,
  })
  check(
    '流程表点格后层数覆盖仍在（写回不吞数值覆盖）',
    flowRow.buffOverrides?.stacksByEffectId?.[stackId] === 0,
    JSON.stringify(flowRow.buffOverrides),
  )
  hitA.buffOverride = flowRow.buffOverrides
  const afterToggle = evalPerHit(hitA)
  hitA.buffOverride = null
  check('点格后仍按行级层数结算（覆盖确实生效）', afterToggle === stackZeroValue, `${stackZeroValue} / ${afterToggle}`)
}

console.log('=== 8. 行级自行转模输入要走到伤害数字 ===')

const manualConvertIds = [
  ...new Set(
    allEffects
      .filter(
        (item) => item.effect.kind === 'convert' && item.effect.convert?.panelSource === 'manual',
      )
      .map((item) => item.effect.id),
  ),
]
let convertId = null
let convertValue = null
for (const id of manualConvertIds) {
  hitA.buffOverride = { convertInputsByEffectId: { [id]: 9999 } }
  const value = evalPerHit(hitA)
  if (value != null && value !== dA0) {
    convertId = id
    convertValue = value
    break
  }
}
hitA.buffOverride = null
console.log(`  自行转模候选 ${manualConvertIds.length} 条；命中的：${convertId ?? '(无)'}`)
if (manualConvertIds.length) {
  check('存在「改自行转模输入即改变伤害」的效果', convertId != null)
} else {
  console.log('  （该 fixture 里没有自行设置（manual）转模效果，跳过）')
}
if (convertId) {
  console.log(`  perHit = ${convertValue.toFixed(4)}（基准 ${dA0.toFixed(4)}）`)
}

console.log('=== 9. 组成员：整组关掉的增益 + 这一段改层数 → 这一段同样不吃（合并语义） ===')

// fixture 里没有技能组流程行 → 用真实招式现造一行（owner 与 A 行同槽，ctx 直接可用）
const slot0 = scheme.slots[0]
const srcEntry = (slot0.flow ?? []).find((item) => item.id === hitA.id)
const srcPrepared = (slot0.prepared ?? []).find((item) => item.id === srcEntry?.preparedId)
const groupMemberSkills = [...new Set(flowResult.hits.map((h) => h.skill.id))].slice(0, 2)
const e2eGroupId = 'e2e-skill-group'
const e2eGroupEntryId = 'e2e-group-row'
const e2eGroupPreparedId = 'e2e-group-prepared'

if (!srcPrepared || groupMemberSkills.length < 2) {
  console.log('  （fixture 缺少可用招式，跳过）')
} else {
  const groupDef = {
    id: e2eGroupId,
    name: 'e2e 技能组',
    members: groupMemberSkills.map((skillId, order) => ({ order, skillId, count: 1 })),
  }
  const groupPrepared = {
    ...srcPrepared,
    id: e2eGroupPreparedId,
    skillId: '',
    skillGroupId: e2eGroupId,
  }
  const groupEntry = {
    ...srcEntry,
    id: e2eGroupEntryId,
    preparedId: e2eGroupPreparedId,
    count: 1,
    buffOverrides: { disabledBlockIds: [foundKey ?? blockKeys[0]] },
    memberOverrides: [
      {
        memberKey: `0:${groupMemberSkills[0]}`,
        skillId: groupMemberSkills[0],
        buffOverrides: stackId ? { stacksByEffectId: { [stackId]: 0 } } : { disabledEffectIds: [] },
      },
    ],
  }
  const groupResult = resolveFlow({
    slots: [{ prepared: [...(slot0.prepared ?? []), groupPrepared], flow: [groupEntry] }, ...scheme.slots.slice(1)],
    teamSlots: scheme.teamSlots.map((s) => ({ agentId: s.agentId, rank: s.rank })),
    findSkill: (id) => skillById.get(id) ?? null,
    findSkillGroup: (id) => (id === e2eGroupId ? groupDef : null),
    skillSubcategories: buffs.skillSubcategories,
  })
  const seg0 = groupResult.hits.find((h) => h.id.startsWith(`${e2eGroupEntryId}#0:`))
  const seg1 = groupResult.hits.find((h) => h.id.startsWith(`${e2eGroupEntryId}#1:`))
  const disabledKey = foundKey ?? blockKeys[0]
  check('组行展开出两段命中', Boolean(seg0 && seg1), groupResult.hits.map((h) => h.id).join(' | '))
  check(
    '改过渡数的那一段：整组关掉的块仍在禁用名单里（没有被"整体替换"放回来）',
    Boolean(seg0?.buffOverride?.disabledBlockIds?.includes(disabledKey)),
    JSON.stringify(seg0?.buffOverride),
  )
  if (stackId) {
    check(
      '改过渡数的那一段：本段的层数覆盖也带上了',
      seg0?.buffOverride?.stacksByEffectId?.[stackId] === 0,
      JSON.stringify(seg0?.buffOverride),
    )
  }
  check(
    '没改的那一段：只继承整组（同样关着）',
    Boolean(seg1?.buffOverride?.disabledBlockIds?.includes(disabledKey)),
    JSON.stringify(seg1?.buffOverride),
  )
  if (seg0) {
    const withDisable = evalPerHit(seg0)
    const withoutDisable = evalPerHit({
      ...seg0,
      buffOverride: seg0.buffOverride?.stacksByEffectId
        ? { stacksByEffectId: seg0.buffOverride.stacksByEffectId }
        : null,
    })
    check(
      '数字层面：这一段改过层数，整组关掉的那块依然在减伤',
      withDisable != null && withoutDisable != null && withDisable < withoutDisable,
      `关着 ${withDisable} / 放开 ${withoutDisable}`,
    )
  }
}

console.log('')
console.log(`=== 结果：passed = ${passed}, failed = ${failed} ===`)
if (failed > 0) process.exit(1)
