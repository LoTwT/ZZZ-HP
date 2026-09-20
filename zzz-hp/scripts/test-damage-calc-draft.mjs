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

console.log('[3] slots 回退：只在「压根没有 slots 字段」的老草稿上生效')

const { schemeSlotsHaveContent } = await import('../src/utils/resolvedHit.ts')
check('空 slots 视为无内容（所以只能靠「字段在不在」区分）', schemeSlotsHaveContent([]) === false)
check('有准备内容的 slots 视为有内容', schemeSlotsHaveContent([{ prepared: [{ id: 'p' }], flow: [] }]) === true)
check('只有流程内容也算有内容', schemeSlotsHaveContent([{ prepared: [], flow: [{ id: 'f' }] }]) === true)
check(
  '源码：显式写下的空 slots 不再回退方案库',
  page.includes('if (entry.slots != null) return entry.slots'),
)
check(
  '源码：载入方案时先登记 id 再灌状态（回退读到的才是当前方案）',
  /function loadHistoryEntry\(entry: DamageCalcHistoryEntry\) \{[\s\S]{0,300}activeHistoryId\.value = entry\.id[\s\S]{0,160}applyWorkingState\(/.test(
    page,
  ),
)

console.log('[4] 绝不静默丢数据：写失败要报、被别的标签页抢先就不覆盖')

const draftKey = 'zzz-hp-damage-calc-draft'
memory.clear()
saveWorkingDraft(draftBase({ savedAt: 1 }))
// 模拟「另一个标签页」写了更新的草稿（绕过 util 直接写）
memory.set(
  draftKey,
  JSON.stringify(draftBase({ savedAt: 999, activeSlot: 7, panelState: snapshot([{ id: 'other' }], { bossName: '别的页' }) })),
)
const staleResult = saveWorkingDraft(draftBase({ savedAt: 2, activeSlot: 1 }))
const afterStale = JSON.parse(memory.get(draftKey))
check('别的标签页更新过 → 返回 stale', staleResult === 'stale', `result=${staleResult}`)
check('别的标签页更新过 → 不覆盖对方数据', afterStale.activeSlot === 7 && afterStale.savedAt === 999)
check('对方的面板快照也没被冲掉', afterStale.panelState?.enemyInput?.bossName === '别的页')

memory.clear()
saveWorkingDraft(draftBase({ savedAt: 10 })) // 先建立「已见 = 10」，且没有更新的旧草稿
const originalSetItem = globalThis.localStorage.setItem
globalThis.localStorage.setItem = () => {
  throw new Error('QuotaExceededError')
}
const failedResult = saveWorkingDraft(draftBase({ savedAt: 11 }))
globalThis.localStorage.setItem = originalSetItem
check('写入抛错 → 返回 failed（不装作已保存）', failedResult === 'failed', `result=${failedResult}`)

check(
  '源码：卸载前抓快照（beforeUnmount），onUnmounted 不再落盘',
  page.includes('onBeforeUnmount(() => {') &&
    /onUnmounted\(\(\) => \{\s*\n\s*window\.removeEventListener\('pagehide'/.test(page),
)
check(
  '源码：草稿写失败/被抢先都有可见提示',
  page.includes('draftSaveWarning') && page.includes('draft-save-warning'),
)
check(
  '源码：方案保存/覆盖后做写盘校验，失败不报「已保存」',
  (page.match(/if \(!findDamageCalcHistory\(/g) ?? []).length >= 2,
)

check(
  '源码：草稿落盘改成「改动即写」（不再 400ms 防抖）',
  /setTimeout\(\(\) => \{[\s\S]{0,90}persistWorkingDraftNow\(\)[\s\S]{0,30}\}, 0\)/.test(page) &&
    !page.includes('}, 400)'),
)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
