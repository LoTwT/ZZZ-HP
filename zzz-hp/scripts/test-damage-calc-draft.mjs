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

const {
  loadWorkingDraft,
  saveWorkingDraft,
  localStorageUsageBytes,
  saveDamageCalcHistory,
  schemeStoreWriteFailed,
  clearWorkingDraft,
} = await import('../src/utils/damageCalcHistory.ts')

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

console.log('[4] 绝不静默丢数据：写失败要报、被别的标签页抢先就不覆盖、可疑缩水留上一版')

const draftKey = 'zzz-hp-damage-calc-draft'
const metaKey = 'zzz-hp-damage-calc-draft-meta'
const prevKey = 'zzz-hp-damage-calc-draft-prev'

// 4.1 别的标签页写过更新的草稿 → stale，且不覆盖
memory.clear()
check('首次写入返回 ok', saveWorkingDraft(draftBase({ savedAt: 1 })) === 'ok')
memory.set(metaKey, JSON.stringify({ savedAt: 999, writerId: 'other-tab' }))
const staleResult = saveWorkingDraft(draftBase({ savedAt: 2, activeSlot: 5 }))
check('别的标签页更新过 → 返回 stale', staleResult === 'stale', `result=${staleResult}`)
check(
  '别的标签页更新过 → 不覆盖对方数据',
  JSON.parse(memory.get(draftKey))?.savedAt === 1,
  `stored savedAt=${JSON.parse(memory.get(draftKey))?.savedAt}`,
)

// 4.2 写入抛错 → failed（不装作已保存）
memory.clear()
check('清空后首次写入 ok', saveWorkingDraft(draftBase({ savedAt: 10 })) === 'ok')
const originalSetItem = globalThis.localStorage.setItem
globalThis.localStorage.setItem = () => {
  throw new Error('QuotaExceededError')
}
const failedResult = saveWorkingDraft(draftBase({ savedAt: 11 }))
globalThis.localStorage.setItem = originalSetItem
check('写入抛错 → 返回 failed（不装作已保存）', failedResult === 'failed', `result=${failedResult}`)

// 4.3 可疑缩水（队伍 / 流程被清空）→ 先把旧草稿留一份
memory.clear()
saveWorkingDraft(
  draftBase({
    savedAt: 20,
    teamSlots: [{ agentId: 'a' }],
    slots: [{ prepared: [{ id: 'p1' }], flow: [] }],
  }),
)
const shrinkResult = saveWorkingDraft(
  draftBase({ savedAt: 21, teamSlots: [{ agentId: '' }], slots: [] }),
)
check('可疑缩水仍写入（不阻断用户操作）', shrinkResult === 'ok', `result=${shrinkResult}`)
const prev = memory.get(prevKey) ? JSON.parse(memory.get(prevKey)) : null
check(
  '可疑缩水 → 旧草稿留在 draft-prev',
  prev?.savedAt === 20 && prev?.teamSlots?.[0]?.agentId === 'a',
  `prev savedAt=${prev?.savedAt}`,
)

// 4.4 正常保存不留备份（不增大占用）
memory.clear()
saveWorkingDraft(draftBase({ savedAt: 30, activeSlot: 1 }))
saveWorkingDraft(draftBase({ savedAt: 31, activeSlot: 2 }))
check('正常保存不写 draft-prev（避免存储翻倍）', !memory.has(prevKey))

// 4.5 存储用量可测（先量，后面会清空）
check('localStorageUsageBytes() 能报出用量', localStorageUsageBytes() > 0)

// 4.6 残留 meta（没有草稿）不能把保存永久挡住 —— 这是我自己复核时发现的 bug
memory.clear()
memory.set(metaKey, JSON.stringify({ savedAt: 9999, writerId: 'ghost-tab' }))
const ghostResult = saveWorkingDraft(draftBase({ savedAt: 40 }))
check(
  '只有 meta、没有草稿 → 仍能保存（不被幽灵 meta 挡住）',
  ghostResult === 'ok',
  `result=${ghostResult}`,
)
// clearWorkingDraft 要连 meta 一起清
clearWorkingDraft()
check('clearWorkingDraft() 同时清掉 meta', !memory.has(metaKey) && !memory.has(draftKey))

// 4.6 方案库写失败要能被调用方发现
const originalSchemeSetItem = globalThis.localStorage.setItem
globalThis.localStorage.setItem = () => {
  throw new Error('QuotaExceededError')
}
saveDamageCalcHistory({
  id: '/t',
  name: 't',
  savedAt: Date.now(),
  teamSlots: [],
  activeSlot: 0,
  selectedBangbooId: 'none',
  bangbooRefine: 1,
  panelCalcMode: 'optimal',
  panelState: {},
  folder: '',
  order: 0,
})
globalThis.localStorage.setItem = originalSchemeSetItem
check('方案库写失败 → schemeStoreWriteFailed() 为真', schemeStoreWriteFailed() === true)

console.log('[5] 源码守卫：卸载前抓快照 / 失败提示 / 用量统计口径')

check(
  '源码：卸载前抓快照（beforeUnmount），onUnmounted 只做清理',
  page.includes('onBeforeUnmount(() => {') &&
    /onUnmounted\(\(\) => \{\s*\n\s*window\.removeEventListener\('pagehide'/.test(page),
)
check(
  '源码：草稿写失败/被抢先都有可见提示',
  page.includes('draftSaveWarning') && page.includes('draft-save-warning'),
)
check(
  '源码：方案保存/覆盖后检查写盘结果，失败不报「已保存」',
  (page.match(/if \(schemeStoreWriteFailed\(\)\)/g) ?? []).length >= 2,
)
check(
  '源码：用量统计算的是整个源的占用（不只方案库那个 key）',
  readFileSync(
    new URL('../src/components/calculator/DamageCalcHistorySection.vue', import.meta.url),
    'utf8',
  ).includes('localStorageUsageBytes()'),
)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
