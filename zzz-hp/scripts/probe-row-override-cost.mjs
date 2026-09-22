/**
 * 招式级增益开关（行级例外）的求值开销实测 —— 只读离线复现，不改任何业务状态。
 *
 * 背景：带 `rowBuffOverride` 的上下文会绕开目录缓存
 * （`panelBuffCalc.ts:1953` / `2041`），每次求值重建整份增益清单
 * （遍历全队效果块 + 逐块解析效果）。本脚本量化「设了例外的命中行」对单次评估耗时的影响，
 * 给出「每个带例外的命中行」的代价，用于判断该开销是否值得优化。
 *
 * 用法：npx vite-node scripts/probe-row-override-cost.mjs [方案JSON]
 * 产出：控制台报告（无文件）
 */
import fs from 'node:fs'
import inspector from 'node:inspector'
import path from 'node:path'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import {
  buildOptimalEvalContext,
  clearAffixEvalCache,
  evaluateAffixCounts,
} from '../src/utils/optimalAffixAlloc.ts'
import { createEmptyAffixCounts } from '../src/types/calculatorPanel.ts'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'
import { ARTIFACTS_DIR, BUFFS_JSON, resolveSchemePath } from './_paths.mjs'

const buffs = JSON.parse(fs.readFileSync(BUFFS_JSON, 'utf8'))
const schemePack = JSON.parse(fs.readFileSync(resolveSchemePath(process.argv[2]), 'utf8'))
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
const hits = flowResult.hits

const mainSlotIndex = Number(scheme.activeSlot ?? 0)
const mainSlot = scheme.teamSlots[mainSlotIndex]
const agents = buffs.agents
const mainAgent = agents.find((a) => a.id === mainSlot.agentId)

const ctx = buildOptimalEvalContext({
  isMb: mainAgent?.profession === '命破',
  isFengYu: mainAgent?.profession === '锋御',
  teamSlots: scheme.teamSlots,
  agents,
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
  hits,
  resolveSubcategory: (id) => buffs.skillSubcategories.find((x) => x.id === id) ?? null,
  skillSubcategories: buffs.skillSubcategories,
  followUpSkillRules: buffs.followUpSkillRules,
})

/** 真实存在的效果块键（与端到端脚本同款），保证走的是真实过滤分支 */
const REAL_BLOCK_KEY = 'agent-0-0-blk-legacy'
/** 每次口径的评估次数（与 probe-affix-perf.mjs 同款稳态口径） */
const MEASURE_EVALS = 10
/** 预热次数（丢弃）：避免首轮吃 JIT / 冷缓存成本 */
const WARMUP_EVALS = 10
/** 交错重复轮数：每个口径重复测，取中位，抵消漂移 */
const ROUNDS = 3

/**
 * 给前 k 个命中行挂上行级例外。
 * 只挂前 k 个（而不是随机）是为了让 k 递增时口径可比。
 * @param {number} k
 */
function applyOverrides(k) {
  hits.forEach((hit, i) => {
    hit.buffOverride = i < k ? { disabledBlockIds: [REAL_BLOCK_KEY] } : null
  })
}

/** @param {number} k */
function measure(k) {
  applyOverrides(k)
  clearAffixEvalCache()
  const t = performance.now()
  for (let i = 0; i < MEASURE_EVALS; i += 1) {
    evaluateAffixCounts(ctx, { ...createEmptyAffixCounts(), atkPercent: 20 + i, critDmg: i })
  }
  return (performance.now() - t) / MEASURE_EVALS
}

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

console.log('=== 场景 ===')
console.log(`  方案: ${resolveSchemePath(process.argv[2])}`)
console.log(`  命中行数: ${hits.length}`)
console.log(`  主 C: ${ctx.mainAgentId}（${ctx.mainAgentName}）`)
console.log(`  每个口径评估 ${MEASURE_EVALS} 次 × ${ROUNDS} 轮交错，取中位（预热 ${WARMUP_EVALS} 次丢弃）`)

// 预热
for (let i = 0; i < WARMUP_EVALS; i += 1) {
  applyOverrides(0)
  evaluateAffixCounts(ctx, { ...createEmptyAffixCounts(), atkPercent: 5 + i })
}

const ks = [...new Set([0, 1, Math.min(3, hits.length), Math.min(8, hits.length), hits.length])]
/** @type {Map<number, number[]>} */
const samples = new Map(ks.map((k) => [k, []]))
for (let round = 0; round < ROUNDS; round += 1) {
  for (const k of ks) samples.get(k).push(measure(k))
}

const base = median(samples.get(0))
console.log('\n=== 带例外的命中行数 → 单次评估耗时（中位）===')
for (const k of ks) {
  const ms = median(samples.get(k))
  const delta = ms - base
  console.log(
    `  ${String(k).padStart(3)} 行带例外: ${ms.toFixed(2)} ms/次  ` +
      `（${(ms / base).toFixed(2)}× 基准，增量 ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} ms）` +
      `  样本 [${samples.get(k).map((v) => v.toFixed(1)).join(', ')}]`,
  )
}

const all = median(samples.get(hits.length))
if (hits.length > 0) {
  const perRow = (all - base) / hits.length
  console.log(`\n  每多 1 个带例外的命中行 ≈ ${perRow >= 0 ? '+' : ''}${perRow.toFixed(3)} ms/次`)
  console.log(
    `  按求解器每次求解 ~425 次评估推算: 每 1 个带例外的命中行 ≈ ` +
      `${((perRow * 425) / 1000).toFixed(3)} s/次求解；` +
      `${hits.length} 行全带例外 ≈ ${(((all - base) * 425) / 1000).toFixed(2)} s/次求解`,
  )
}

// ---------- 验证：例外真的传到了求值路径吗 ----------
applyOverrides(0)
clearAffixEvalCache()
const totalNoOverride = evaluateAffixCounts(ctx, { ...createEmptyAffixCounts(), atkPercent: 10 }).grandTotal
applyOverrides(hits.length)
clearAffixEvalCache()
const totalAllOverride = evaluateAffixCounts(ctx, { ...createEmptyAffixCounts(), atkPercent: 10 }).grandTotal
applyOverrides(0)
console.log('\n=== 验证（总伤应随例外变化，否则说明例外没传到求值路径）===')
console.log(`  0 行带例外  : ${totalNoOverride.toFixed(0)}`)
console.log(`  ${hits.length} 行带例外: ${totalAllOverride.toFixed(0)}`)
console.log(`  差值 ${(totalAllOverride - totalNoOverride).toFixed(0)}`)

// ---------- CPU 剖析：找出"全部行带例外"那 20 ms 花在哪 ----------
const session = new inspector.Session()
session.connect()
const post = (m, p) => new Promise((res, rej) => session.post(m, p, (e, x) => (e ? rej(e) : res(x))))

await post('Profiler.enable')
await post('Profiler.setSamplingInterval', { interval: 200 })
await post('Profiler.start')
applyOverrides(hits.length)
for (let i = 0; i < 10; i += 1) {
  evaluateAffixCounts(ctx, { ...createEmptyAffixCounts(), atkPercent: 40 + i, critDmg: i })
}
const { profile } = await post('Profiler.stop')
session.disconnect()

const profPath = path.join(ARTIFACTS_DIR, `row-override-${Date.now()}.cpuprofile`)
fs.writeFileSync(profPath, JSON.stringify(profile))
console.log(`\n=== CPU 剖析（${hits.length} 行全带例外）===`)
console.log(`  已写入: ${profPath}（采样 ${profile.samples.length}）`)
console.log('  用 node artifacts/analyze-cpuprofile.mjs <file> 查看热点')
