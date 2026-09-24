/**
 * 「逐位不变」快照对照 —— 增益体系改造（施工规格 §7.2）
 *
 * 用途：给「构建与筛选分离」改造钉一条可执行的回归线。
 *   改前：`npx vite-node scripts/test-buff-build-parity.mjs --write`  → 存基线
 *   改后：`npx vite-node scripts/test-buff-build-parity.mjs`          → 与基线逐位比对
 *
 * 快照内容（两个真实方案 + 一条 restrict 路径回归点）：
 *   - 每个方案的 **总伤**（`evaluateAffixCounts` 的 grandTotal）与**每行数字**（eventLines 的 total，按序）
 *   - **restrict 路径**（N1 回归点）：`restrictToSlotIndex` 非空时，邦布条目应被排除、场地条目应保留
 *     （现状依据：邦布收集条件含 `restrictToSlotIndex == null`，场地分支没有该 gate）
 *
 * 基线落点：`D:\WB_agent_out\ZZZ-HP\.dim\tmp\buff-build-snapshots\baseline.json`
 *   ⚠️ 该目录在**开发辅助目录**下（`DEV_ROOT`），不在 git 仓库里。
 *
 * 用法：
 *   npx vite-node scripts/test-buff-build-parity.mjs [--write]
 */
import fs from 'node:fs'
import path from 'node:path'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import {
  buildOptimalEvalContext,
  clearAffixEvalCache,
  evaluateAffixCounts,
} from '../src/utils/optimalAffixAlloc.ts'
import {
  collectAllBuffEffects,
  isEnvironmentBuffSourceKey,
} from '../src/utils/panelBuffCalc.ts'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { createEmptyAffixCounts } from '../src/types/calculatorPanel.ts'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'
import { BUFFS_JSON, DEV_ROOT, FRONTEND_ROOT, resolveSchemePath } from './_paths.mjs'

const WRITE = process.argv.includes('--write')
const SNAPSHOT_DIR = path.join(DEV_ROOT, '.dim', 'tmp', 'buff-build-snapshots')
const BASELINE = path.join(SNAPSHOT_DIR, 'baseline.json')

const FIXTURES = [
  { label: 'scheme-dan', file: resolveSchemePath(undefined), allSchemes: false },
  {
    label: 'ye-shiyuan-pen-rate',
    file: path.join(FRONTEND_ROOT, 'fixtures', 'pen-rate-alloc', 'ye-shiyuan-pen-rate.json'),
    allSchemes: false,
  },
  // 覆盖面靠这个大包（方案库导出，逐个方案快照）
  {
    label: 'schemes-2026-09-10',
    file: path.join(DEV_ROOT, 'artifacts', 'profiles', 'zzz-hp-schemes-2026-09-10.json'),
    allSchemes: true,
  },
]

const buffs = JSON.parse(fs.readFileSync(BUFFS_JSON, 'utf8'))

/** 固定口径的评估输入（与改造无关，必须稳定） */
const FIXED_COUNTS = { ...createEmptyAffixCounts(), atkPercent: 20 }

function buildContext(scheme, pack) {
  const skillById = new Map(
    [...(buffs.skills ?? []), ...(pack.customSkills ?? [])].map((s) => [s.id, s]),
  )
  const flowResult = resolveFlow({
    slots: scheme.slots,
    teamSlots: scheme.teamSlots.map((s) => ({ agentId: s.agentId, rank: s.rank })),
    findSkill: (id) => skillById.get(id) ?? null,
    skillSubcategories: buffs.skillSubcategories,
  })
  const mainSlotIndex = Number(scheme.activeSlot ?? 0)
  const mainAgent = buffs.agents.find((a) => a.id === scheme.teamSlots[mainSlotIndex]?.agentId)
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
    driveDiscMainStats: schemeAffixInputs(scheme, scheme.teamSlots[mainSlotIndex]?.agentId)
      .affixDriveDiscMainStats ?? {
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
  return { ctx, hits: flowResult.hits }
}

/** 一个方案的快照：总伤 + 每行数字（按 eventLines 顺序） */
function snapshotScheme(pack, scheme, packLabel, index) {
  const { ctx, hits } = buildContext(scheme, pack)
  clearAffixEvalCache()
  const { grandTotal, eventLines } = evaluateAffixCounts(ctx, FIXED_COUNTS)
  return {
    pack: packLabel,
    index,
    name: String(scheme.name ?? ''),
    hits: hits.length,
    grandTotal,
    lineCount: eventLines.length,
    lineTotals: eventLines.map((line) => line.total),
    panelContext: ctx.panelContext,
  }
}

/** restrict 路径回归点（N1）：邦布该被排除、场地该保留 */
function snapshotRestrictCase(panelContext) {
  const probeEffect = (id, value) =>
    createEmptyBuffEffect({ id, stat: 'dmgBonus', value, applyTarget: 'team', scope: 'general' })
  const bangboo = {
    id: 'probe-bangboo',
    name: '探针邦布',
    avatar_image: null,
    effects: [],
    effectBlocks: [
      { id: 'probe-bb-blk', name: '邦布技能', effects: [probeEffect('probe-bb-effect', 3)] },
    ],
    refinementEffects: [],
    refinementEffectBlocks: [],
    fixedMods: {},
    refinementMods: {},
  }
  const env = {
    kind: 'crisis',
    name: '探针场地',
    // ⚠️ 场地条目的来源标记是**数据自带字段**（`panelBuffCalc.ts` 的场地分支直接传 `env.sourceKey`）
    sourceKey: 'crisis-buff-probe-env',
    effectBlocks: [
      { id: 'probe-env-blk', name: '场地增益', effects: [probeEffect('probe-env-effect', 5)] },
    ],
  }
  const count = (items, picker) => items.filter(picker).length
  const free = collectAllBuffEffects({ ...panelContext, bangboo, environmentBuffs: [env] })
  const restricted = collectAllBuffEffects({
    ...panelContext,
    bangboo,
    environmentBuffs: [env],
    restrictToSlotIndex: 0,
  })
  const byBangboo = (item) => item.sourceKey.startsWith('bangboo')
  const byEnv = (item) => isEnvironmentBuffSourceKey(item.sourceKey)
  return {
    free: { bangboo: count(free, byBangboo), env: count(free, byEnv) },
    restricted: { bangboo: count(restricted, byBangboo), env: count(restricted, byEnv) },
  }
}

const snapshots = []
for (const fixture of FIXTURES) {
  if (!fs.existsSync(fixture.file)) {
    console.log(`  [skip] 夹具不存在（跳过）：${fixture.file}`)
    continue
  }
  const pack = JSON.parse(fs.readFileSync(fixture.file, 'utf8'))
  const schemes = Object.values(pack.schemes ?? {})
  const picked = fixture.allSchemes ? schemes : [schemes[0]]
  picked.forEach((scheme, index) => {
    if (!scheme) return
    snapshots.push(snapshotScheme(pack, scheme, fixture.label, index))
  })
}
const snapshot = {
  note: '增益体系改造 · 逐位不变基线（施工规格 §7.2）',
  counts: FIXED_COUNTS,
  fixtures: snapshots.map(({ panelContext, ...rest }) => rest),
  restrictCase: snapshots[0] ? snapshotRestrictCase(snapshots[0].panelContext) : null,
}

/** 找出第一处不同（用于报错定位） */
function firstDiff(a, b, trail = '$') {
  if (Object.is(a, b)) return null
  if (typeof a !== typeof b || a == null || b == null) return `${trail}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return `${trail}: 长度不同（${a?.length} ≠ ${b?.length}）`
    }
    for (let i = 0; i < a.length; i += 1) {
      const d = firstDiff(a[i], b[i], `${trail}[${i}]`)
      if (d) return d
    }
    return null
  }
  if (typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
      const d = firstDiff(a[key], b[key], `${trail}.${key}`)
      if (d) return d
    }
    return null
  }
  return `${trail}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`
}

console.log('=== 快照（逐位不变基线）===')
for (const f of snapshot.fixtures) {
  console.log(
    `  ${`${f.pack}#${f.index}`.padEnd(26)} hits=${String(f.hits).padStart(3)}  ` +
      `总伤=${f.grandTotal}  行数=${f.lineCount}  ${f.name}`,
  )
}
const rc = snapshot.restrictCase
console.log(
  `  restrict 路径：自由模式 邦布 ${rc.free.bangboo} / 场地 ${rc.free.env}；` +
    `restrict 模式 邦布 ${rc.restricted.bangboo}（期望 0）/ 场地 ${rc.restricted.env}（期望 ≥1）`,
)

if (WRITE) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
  fs.writeFileSync(BASELINE, JSON.stringify(snapshot, null, 2))
  console.log(`\n已写基线：${BASELINE}`)
  process.exit(0)
}

if (!fs.existsSync(BASELINE)) {
  console.error(`\n基线不存在：${BASELINE}\n先跑一次：npx vite-node scripts/test-buff-build-parity.mjs --write`)
  process.exit(1)
}
const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
const diff = firstDiff(baseline, snapshot)
if (diff) {
  console.error(`\n=== 结果：FAIL（与基线不逐位相同）===\n  第一处不同：${diff}`)
  process.exit(1)
}
console.log('\n=== 结果：PASS（与基线逐位相同）===')
