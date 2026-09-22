/**
 * 跨槽位行级例外 —— 命门验证（真实 fixture，只读）。
 *
 * 背景（2026-09-22 用户提）：异常行里「强度提供者」是另一个角色，他的**个人**增益参与这一行结算，
 * 但当前表的列只取"编辑中角色"的收集结果，看不到、也关不掉它。
 *
 * 设计口径：列 = 「所有角色的 team 增益 + 参与角色的 self 增益」——
 * 做法是对每个参与角色各跑一次 `collectAllBuffEffects`（把该角色当主槽）再按 effect.id 去重合并。
 *
 * 本脚本验两件事（不通就得换设计）：
 * 1. **并集口径成立**：把 B 当主槽收集，能拿到 B 的 self 增益；A 当主槽时拿不到（队友只收 team）
 * 2. **命门**：B 的 self 增益 id，在"B 自己的上下文"里能被行级例外**关掉**
 *    （即 `rowBuffOverride` 的过滤按 id 命中）—— 关不掉就会出现"表里关得掉、数字不变"
 *
 * 用法：npx vite-node scripts/probe-cross-slot-row-override.mjs [方案JSON]
 */
import fs from 'node:fs'
import path from 'node:path'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import { buildOptimalEvalContext, evaluateOptimalEventDetail } from '../src/utils/optimalAffixAlloc.ts'
import {
  collectAllBuffEffects,
  collectPanelBuffMods,
  invalidateBuffCatalogCache,
  parseSourceKeySlotIndex,
} from '../src/utils/panelBuffCalc.ts'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'
import { BUFFS_JSON, FRONTEND_ROOT } from './_paths.mjs'

const SCHEME =
  process.argv[2] || path.join(FRONTEND_ROOT, 'fixtures/pen-rate-alloc/ye-shiyuan-pen-rate.json')
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

const evalCtx = buildOptimalEvalContext({
  isMb: mainAgent?.profession === '命破',
  isFengYu: mainAgent?.profession === '锋御',
  teamSlots: scheme.teamSlots,
  agents: buffs.agents,
  wengines: buffs.wengines,
  bangboo: {
    id: 'none', name: 'none', avatar_image: null, effects: [],
    refinementEffects: [], fixedMods: {}, refinementMods: {},
  },
  bangbooRefine: 1,
  driveDiscs: buffs.driveDiscs,
  mainSlotIndex,
  driveDiscMainStats: schemeAffixInputs(scheme, mainSlot.agentId).affixDriveDiscMainStats ?? {
    slot4MainStat: 'mastery', slot5MainStat: 'dmgBonus', slot6MainStat: 'energyRegen',
  },
  enemyInput: {
    level: 60, defense: 953, resistanceType: 'normal',
    vulnerableMultiplier: 1, staggerMultiplier: 1.5, specialMultiplier: 1,
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

const base = evalCtx.panelContext
const slotCount = base.teamSlots.length
const agentName = (i) => base.agents.find((a) => a.id === base.teamSlots[i]?.agentId)?.name ?? `槽${i}`

console.log('=== 场景 ===')
console.log(`  方案：${scheme.name ?? '(无名)'}`)
console.log(`  队伍：${[...Array(slotCount)].map((_, i) => `${i}=${agentName(i)}`).join('  ')}`)

// ---------- 1. 并集口径 ----------
console.log('\n=== 1. 各槽位当主槽时收到的效果（self / team 计数）===')
const perMain = []
for (let i = 0; i < slotCount; i += 1) {
  const items = collectAllBuffEffects({ ...base, mainSlotIndex: i })
  const selfBySlot = new Map()
  const teamCount = items.filter((it) => it.effect.applyTarget === 'team').length
  for (const it of items) {
    if (it.effect.applyTarget !== 'self') continue
    const s = parseSourceKeySlotIndex(it.sourceKey)
    selfBySlot.set(s, (selfBySlot.get(s) ?? 0) + 1)
  }
  perMain.push(items)
  console.log(
    `  主槽=${i}(${agentName(i)})：共 ${items.length} 条；team ${teamCount} 条；self 分布 ` +
      `${[...selfBySlot.entries()].map(([s, n]) => `槽${s}:${n}`).join(' ')}`,
  )
}

const mainA = mainSlotIndex
const otherSlot = [...Array(slotCount).keys()].find((i) => i !== mainA)
console.log(`\n  取 A=槽${mainA}(${agentName(mainA)})，B=槽${otherSlot}(${agentName(otherSlot)})`)
const aItems = perMain[mainA] ?? []
const bItems = perMain[otherSlot] ?? []
const bSelfInA = aItems.filter(
  (it) => it.effect.applyTarget === 'self' && parseSourceKeySlotIndex(it.sourceKey) === otherSlot,
)
const bSelfInB = bItems.filter(
  (it) => it.effect.applyTarget === 'self' && parseSourceKeySlotIndex(it.sourceKey) === otherSlot,
)
console.log(`  A 当主槽时，B 的 self 效果：${bSelfInA.length} 条（期望 0）`)
console.log(`  B 当主槽时，B 的 self 效果：${bSelfInB.length} 条（期望 > 0）`)

// ---------- 2. 命门：B 的 self 增益能不能在 B 的上下文里被行级例外关掉 ----------
console.log('\n=== 2. 命门：B 的 self 增益能否被行级例外关掉（逐个试）===')
invalidateBuffCatalogCache()
const bCtx = { ...base, mainSlotIndex: otherSlot }
const modsBefore = collectPanelBuffMods(bCtx)

if (!bSelfInB.length) {
  console.log('  fixture 里 B 没有 self 增益，无法验证（换 fixture 再跑）')
} else {
  let anyChanged = false
  for (const it of bSelfInB) {
    // 对照 A：全局关掉它（走 buffSelection）—— 能变，说明这条效果本来就有贡献
    invalidateBuffCatalogCache()
    const globallyOff = {
      ...bCtx,
      buffSelection: { enabledIds: { [it.effect.id]: false } },
    }
    const modsGlobalOff = collectPanelBuffMods(globallyOff)
    const globalChanged = JSON.stringify(modsBefore) !== JSON.stringify(modsGlobalOff)

    // 对照 B：行级关掉它（走 rowBuffOverride）
    invalidateBuffCatalogCache()
    const offCtx = { ...bCtx, rowBuffOverride: { disabledEffectIds: [it.effect.id] } }
    const modsOff = collectPanelBuffMods(offCtx)
    const changed = JSON.stringify(modsBefore) !== JSON.stringify(modsOff)
    if (changed) anyChanged = true
    console.log(
      `  ${it.effect.id}\n    全局关 → ${globalChanged ? 'mods 变化（有贡献）' : 'mods 无变化（本来不贡献）'}` +
        `　行级关 → ${changed ? 'mods 变化' : 'mods 无变化'}`,
    )
  }
  console.log(
    `  结论：${anyChanged ? '至少一条能关掉 → 命门通过' : '全部无变化 → 要么命门不通，要么这些效果在本上下文本来不贡献'}`,
  )
  const teamItem = aItems.find((it) => it.effect.applyTarget === 'team')
  if (teamItem) {
    invalidateBuffCatalogCache()
    const offTeam = { ...bCtx, rowBuffOverride: { disabledEffectIds: [teamItem.effect.id] } }
    const modsOffTeam = collectPanelBuffMods(offTeam)
    const changedTeam = JSON.stringify(modsBefore) !== JSON.stringify(modsOffTeam)
    console.log(`  对照（team 增益 ${teamItem.effect.id}）：${changedTeam ? 'mods 变化' : 'mods 无变化'}`)
  }
}

console.log('\n=== 4. 跨槽位隔离（给 A 的行设例外 → B 的行伤害必须不变）===')
{
  const ownerIdOf = (slotIndex) => base.teamSlots[slotIndex]?.agentId
  const hitA = flowResult.hits.find((h) => h.ownerAgentId === ownerIdOf(mainA))
  const hitB = flowResult.hits.find((h) => h.ownerAgentId === ownerIdOf(otherSlot))
  if (!hitA || !hitB) {
    console.log('  fixture 里缺少 A 或 B 的命中，跳过')
  } else {
    hitA.buffOverride = null
    hitB.buffOverride = null
    const b0 = evaluateOptimalEventDetail(evalCtx, null, hitB, {})?.perHit ?? null
    const a0 = evaluateOptimalEventDetail(evalCtx, null, hitA, {})?.perHit ?? null
    // 给 A 的行设一条例外：关掉 A 自己的一批增益
    const aOwnIds = aItems
      .filter((it) => it.effect.applyTarget === 'self' && parseSourceKeySlotIndex(it.sourceKey) === mainA)
      .map((it) => it.effect.id)
      .slice(0, 5)
    hitA.buffOverride = { disabledEffectIds: aOwnIds }
    const a1 = evaluateOptimalEventDetail(evalCtx, null, hitA, {})?.perHit ?? null
    const b1 = evaluateOptimalEventDetail(evalCtx, null, hitB, {})?.perHit ?? null
    hitA.buffOverride = null
    console.log(`  A 的行：${a0 == null ? 'null' : a0.toFixed(0)} → ${a1 == null ? 'null' : a1.toFixed(0)}（设了例外，应当变化）`)
    console.log(`  B 的行：${b0 == null ? 'null' : b0.toFixed(0)} → ${b1 == null ? 'null' : b1.toFixed(0)}（必须相同）`)
    console.log(`  结论：${a0 !== a1 ? 'A 的行受影响 ✓' : 'A 的行没变（该批增益不贡献）'}；${b0 === b1 ? 'B 的行不受影响 ✓（隔离成立）' : 'B 的行被影响了 ✗'}`)
  }
}

