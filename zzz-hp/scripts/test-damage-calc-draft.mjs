/**
 * 伤害计算页状态存储：工作草稿的三态落盘 + 恢复兜底（源码守卫）
 *
 * 背景（见 dev-docs/damage-calc-state-storage.md）：
 * 「敌方与环境」（enemyInput）与「额外 Buff」（extraGains）**只存在于 panelState**，
 * 而草稿落盘曾会在「取不到子组件快照」时写 `null` → 恢复端静默跳过 → 两块被默认值永久覆盖，
 * 只有从方案库手动重载才能救回。
 *
 * 运行：npx vite-node scripts/test-damage-calc-draft.mjs
 */
import { readFileSync } from 'node:fs'

// localStorage 打桩（模块只在函数内读写，导入前装上最稳）
const memory = new Map()
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => void memory.set(key, String(value)),
  removeItem: (key) => void memory.delete(key),
  clear: () => memory.clear(),
  key: (index) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size
  },
}

const { loadWorkingDraft, saveWorkingDraft } = await import('../src/utils/damageCalcHistory.ts')

let passed = 0
let failed = 0
function check(name, ok, detail) {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const draftBase = (over = {}) => ({
  savedAt: 1,
  loadedSchemeId: '/方案A',
  teamSlots: [{ agentId: 'a' }],
  activeSlot: 0,
  selectedBangbooId: 'none',
  bangbooRefine: 1,
  panelCalcMode: 'optimal',
  ...over,
})
const snapshot = (extraGains, enemyInput) => ({
  baseDamageSource: 'atk',
  externalPanel: {},
  extraMods: {},
  extraGains,
  enemyInput,
})

console.log('[1] 落盘三态（saveWorkingDraft）')

// 1) 无旧草稿 + 不带 panelState：照存，不崩
memory.clear()
saveWorkingDraft(draftBase())
check('无旧草稿 + 不带快照 → 不崩、panelState 为空', loadWorkingDraft()?.panelState == null)

// 2) 有旧草稿（带快照）+ 新草稿不带 → 沿用旧快照（本次修的核心）
memory.clear()
saveWorkingDraft(draftBase({ panelState: snapshot([{ id: 'g1' }], { bossName: 'B' }) }))
saveWorkingDraft(draftBase({ activeSlot: 2 })) // 模拟「卸载 / 页面隐藏瞬间取不到快照」的那次落盘
const kept = loadWorkingDraft()
check(
  '新草稿不带快照 → 沿用旧快照（敌方与环境保住）',
  kept?.panelState?.enemyInput?.bossName === 'B',
  `bossName=${kept?.panelState?.enemyInput?.bossName}`,
)
check('新草稿不带快照 → 额外 Buff 也保住', kept?.panelState?.extraGains?.[0]?.id === 'g1')
check('同一次落盘的其它字段照常更新', kept?.activeSlot === 2, `activeSlot=${kept?.activeSlot}`)

// 3) 新草稿**带**快照（哪怕内容是空数组）→ 正常覆盖（用户故意清空也算数）
memory.clear()
saveWorkingDraft(draftBase({ panelState: snapshot([{ id: 'g1' }], { bossName: 'B' }) }))
saveWorkingDraft(draftBase({ panelState: snapshot([], { bossName: 'C' }) }))
const overwritten = loadWorkingDraft()
check(
  '新草稿带快照 → 覆盖（空数组也是有效值）',
  overwritten?.panelState?.extraGains?.length === 0 &&
    overwritten?.panelState?.enemyInput?.bossName === 'C',
)

console.log('[2] 源码守卫：不再写 null / 恢复有兜底 / 环境筛选不被清')

const page = readFileSync(
  new URL('../src/components/calculator/DamageCalcPage.vue', import.meta.url),
  'utf8',
)
check(
  '草稿捕获不再把 panelState 写成 null',
  page.includes('...(withTalent ? { panelState: withTalent } : {})'),
)
check('草稿捕获不再无条件写 panelState: withTalent', !page.includes('panelState: withTalent,'))
check(
  '恢复时草稿缺快照 → 回退当前高亮方案',
  page.includes('const fallbackPanelState = draft.panelState') &&
    page.includes('panelState: draft.panelState ?? fallbackPanelState'),
)
check(
  '环境筛选：目录为空时不清 id（且有恢复守卫）',
  page.includes('watch(defenseFrontierOptions') &&
    page.includes('if (!options.length) return') &&
    /watch\(defenseFrontierOptions[\s\S]{0,120}if \(restoringWorkingState\) return/.test(page),
)
check(
  '环境筛选字段进草稿 watch 列表',
  /multiSlotBuffSelection,\s*\n\s*\/\/ 环境筛选[\s\S]{0,200}envBuffNodeId,/.test(page),
)
check(
  'Boss 同步不再忽略用户当前值（回落当前值而非默认 1.5）',
  readFileSync(new URL('../src/utils/enemyInputFromBoss.ts', import.meta.url), 'utf8').includes(
    'base.staggerMultiplier,',
  ),
)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
