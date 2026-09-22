/**
 * 行级例外对「额外 Buff」的过滤 —— 语义验证（真实 fixture，不需要 dev server）。
 *
 * 背景（2026-09-22 用户反馈）：额外 Buff 在流程增益表里看不到，行级例外也管不到它。
 * 根因是额外 Buff **单独收集**（`collectExtraGainEffects`），不经过
 * `collectAllBuffEffects` 里那个唯一的行级过滤点 —— 所以过滤要在这里单独补一次。
 *
 * 断言：
 * 1. 额外 Buff 的块键 = `extra-<id>`（显示与过滤必须是同一个，否则表里关不掉）
 * 2. 行级「块禁用」关掉额外 Buff → 该行 mods 少掉它
 * 3. 行级「单条禁用」同样生效
 * 4. 没设例外的上下文不受影响（无污染）
 *
 * 用法：npx vite-node scripts/test-row-override-extra-gain.mjs [方案JSON]
 */
import fs from 'node:fs'
import path from 'node:path'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import { buildOptimalEvalContext } from '../src/utils/optimalAffixAlloc.ts'
import {
  blockKeyOfCollected,
  collectExtraGainEffects,
  collectPanelBuffMods,
  extraGainBlockKey,
  invalidateBuffCatalogCache,
} from '../src/utils/panelBuffCalc.ts'
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

const evalCtx = buildOptimalEvalContext({
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

const EXTRA_ID = 'test-extra-in-combat-atk'
const EXTRA_GAIN = {
  id: EXTRA_ID,
  name: '测试额外 Buff',
  stat: 'inCombatAtkPercent',
  value: 30,
  applySlot: 'team',
}
const EXTRA_KEY = extraGainBlockKey(EXTRA_ID)

invalidateBuffCatalogCache()
const base = { ...evalCtx.panelContext, extraGains: [EXTRA_GAIN] }

console.log('=== 场景 ===')
console.log(`  方案：${scheme.name ?? '(无名)'}`)
console.log(`  额外 Buff：${EXTRA_GAIN.name}（${EXTRA_GAIN.stat} +${EXTRA_GAIN.value}）`)

console.log('\n=== 1. 块键（显示与过滤必须同一个）===')
const collected = collectExtraGainEffects(base)
check('额外 Buff 被收集到', collected.length === 1, `实际 ${collected.length} 条`)
const key = collected[0] ? blockKeyOfCollected(collected[0]) : null
console.log(`  块键：${key}`)
check('块键 = extra-<id>', key === EXTRA_KEY, `期望 ${EXTRA_KEY}，实际 ${key}`)

console.log('\n=== 2. 行级「块禁用」→ 额外 Buff 不参与 ===')
const modsBase = collectPanelBuffMods(base).inCombatAtkPercent
const blockOffCtx = { ...base, rowBuffOverride: { disabledBlockIds: [EXTRA_KEY] } }
const modsBlockOff = collectPanelBuffMods(blockOffCtx).inCombatAtkPercent
console.log(`  未禁用 ${modsBase} / 块禁用后 ${modsBlockOff}（差 ${modsBase - modsBlockOff}）`)
check('块禁用后局内攻击力% 少了 30', Math.abs(modsBase - modsBlockOff - 30) < 1e-6, `差 ${modsBase - modsBlockOff}`)
check('块禁用后收集列表里没有它', collectExtraGainEffects(blockOffCtx).length === 0)

console.log('\n=== 3. 行级「单条禁用」同样生效 ===')
const effectOffCtx = { ...base, rowBuffOverride: { disabledEffectIds: [EXTRA_ID] } }
const modsEffectOff = collectPanelBuffMods(effectOffCtx).inCombatAtkPercent
console.log(`  单条禁用后 ${modsEffectOff}（差 ${modsBase - modsEffectOff}）`)
check('单条禁用后同样少 30', Math.abs(modsBase - modsEffectOff - 30) < 1e-6, `差 ${modsBase - modsEffectOff}`)

console.log('\n=== 4. 无例外上下文不受影响 ===')
const modsAgain = collectPanelBuffMods(base).inCombatAtkPercent
check('回到未禁用口径逐位相同', modsAgain === modsBase, `${modsBase} vs ${modsAgain}`)

console.log('')
console.log(`=== 结果：passed = ${passed}, failed = ${failed} ===`)
if (failed > 0) process.exit(1)
