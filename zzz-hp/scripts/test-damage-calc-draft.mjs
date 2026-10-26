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
  takeSchemeStoreWriteFailed,
  clearWorkingDraft,
  listAllDamageCalcHistory,
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

console.log('[4] 绝不静默丢数据：写失败要报、别的标签页写过也照样保存、不留多余 key')

const draftKey = 'zzz-hp-damage-calc-draft'

// 4.1 别的标签页写过更新的草稿 → 提示（stale），但**必须照样写**，且下一次不能再 stale
//     （独立复核实测过：拒绝写会让本标签页从此永久停止保存 = 更大的坑）
memory.clear()
check('首次写入返回 ok', saveWorkingDraft(draftBase({ savedAt: 1 })) === 'ok')
memory.set(draftKey, JSON.stringify(draftBase({ savedAt: 999, activeSlot: 7 })))
const staleResult = saveWorkingDraft(draftBase({ savedAt: 1000, activeSlot: 5 }))
check('别的标签页更新过 → 返回 stale（提示用户）', staleResult === 'stale', `result=${staleResult}`)
check(
  '别的标签页更新过 → 仍然写入（本页数据不丢）',
  JSON.parse(memory.get(draftKey))?.savedAt === 1000 &&
    JSON.parse(memory.get(draftKey))?.activeSlot === 5,
  `stored savedAt=${JSON.parse(memory.get(draftKey))?.savedAt}`,
)
check(
  'stale 之后的下一次保存回到 ok（不会被永久挡住）',
  saveWorkingDraft(draftBase({ savedAt: 1001 })) === 'ok',
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

// 4.3 只写一个 key：不再有 meta / draft-prev 这类多余副本（不增大占用）
memory.clear()
saveWorkingDraft(draftBase({ savedAt: 30, activeSlot: 1 }))
saveWorkingDraft(draftBase({ savedAt: 31, activeSlot: 2, teamSlots: [{ agentId: '' }] }))
check(
  '落盘只写草稿一个 key（没有 meta / prev 副本）',
  [...memory.keys()].join(',') === draftKey,
  `keys=${[...memory.keys()].join(',')}`,
)

// 4.4 存储用量：报字节（UTF-16 每码元 2 字节）
memory.clear()
memory.set('zzz-hp-x', 'abcd') // 8 + 4 个码元 = 12 码元 → 24 字节
check(
  'localStorageUsageBytes() 按字节报（码元 ×2）',
  localStorageUsageBytes() === 24,
  `bytes=${localStorageUsageBytes()}`,
)

// 4.5 clearWorkingDraft 之后能正常再写（没有残留状态挡路）
memory.clear()
saveWorkingDraft(draftBase({ savedAt: 40 }))
clearWorkingDraft()
check('clearWorkingDraft() 清掉草稿', !memory.has(draftKey))
check('clear 之后仍能正常写入', saveWorkingDraft(draftBase({ savedAt: 41 })) === 'ok')

// 4.6 方案库写失败：标记可被消费一次（不误报、不漏报）
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
check('方案库写失败 → takeSchemeStoreWriteFailed() 为真', takeSchemeStoreWriteFailed() === true)
check('标记取一次即复位（不会误报下一次）', takeSchemeStoreWriteFailed() === false)
// 早退（空名）不能被当成写盘失败
saveDamageCalcHistory({
  id: '/',
  name: '',
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
check('空名早退不报「写盘失败」', takeSchemeStoreWriteFailed() === false)

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
  '源码：方案保存/覆盖/方案库改动后都检查写盘结果',
  (page.match(/takeSchemeStoreWriteFailed\(\)/g) ?? []).length >= 3,
)
check(
  '源码：用量统计算的是整个源的占用（不只方案库那个 key）',
  readFileSync(
    new URL('../src/components/calculator/DamageCalcHistorySection.vue', import.meta.url),
    'utf8',
  ).includes('localStorageUsageBytes()'),
)
check(
  '源码：用量全量扫描带缓存（搜索每敲一个字都重算会很浪费）',
  readFileSync(new URL('../src/utils/damageCalcHistory.ts', import.meta.url), 'utf8').includes(
    'usageCache',
  ),
)

console.log('[6] 读盘不再回写（省 IO，且不会用陈旧视图覆盖别的标签页）')

const storeKey = 'zzz-hp-damage-calc-history'
const entryBase = (name, extra = {}) => ({
  id: `/${name}`,
  name,
  savedAt: 1,
  teamSlots: [],
  activeSlot: 0,
  selectedBangbooId: 'none',
  bangbooRefine: 1,
  panelCalcMode: 'optimal',
  panelState: { externalPanel: {}, extraMods: {}, extraGains: [], enemyInput: {} },
  folder: '',
  order: 0,
  ...extra,
})

// 6.1 读盘不产生写入
memory.clear()
memory.set(
  storeKey,
  JSON.stringify({ version: 4, dirs: {}, schemes: { '/A': entryBase('A') } }),
)
let writeCount = 0
const countingSetItem = globalThis.localStorage.setItem
globalThis.localStorage.setItem = (k, v) => {
  writeCount += 1
  return countingSetItem.call(globalThis.localStorage, k, v)
}
const listed = listAllDamageCalcHistory()
globalThis.localStorage.setItem = countingSetItem
check('listAllDamageCalcHistory() 读到方案', listed.length === 1 && listed[0]?.name === 'A')
check('读盘不写盘（原实现每次读都全量回写）', writeCount === 0, `writes=${writeCount}`)

// 6.2 旧数组结构（一次性迁移）仍然要写盘 —— 那是真正的形状变化
memory.clear()
memory.set(
  storeKey,
  JSON.stringify([
    {
      id: '/B',
      name: 'B',
      savedAt: 1,
      teamSlots: [],
      activeSlot: 0,
      selectedBangbooId: 'none',
      bangbooRefine: 1,
      panelCalcMode: 'optimal',
      panelState: {},
      folder: '',
      order: 0,
    },
  ]),
)
const migrated = listAllDamageCalcHistory()
check('旧数组结构仍能迁移读出来', migrated.length === 1, `len=${migrated.length}`)
check(
  '旧数组迁移仍写盘（一次性形状变化）',
  !!memory.get(storeKey) && !memory.get(storeKey).trimStart().startsWith('['),
)

console.log('[6] 额外 Buff 草稿往返：结构完整、空数组不回退旧扁平值')

{
  const { createExtraBuffGain, normalizeExtraGains, serializeExtraGains } = await import(
    '../src/utils/extraBuffCalc.ts'
  )
  const { createEmptyBuffEffect } = await import('../src/utils/buffEffect.ts')

  const fixedCard = createExtraBuffGain({
    id: 'draft-fixed',
    name: '固定攻击',
    applySlot: 'team',
    effects: [createEmptyBuffEffect({ id: 'draft-fixed-eff', stat: 'atk', value: 120 })],
  })
  const stackedCard = createExtraBuffGain({
    id: 'draft-stacked',
    name: '叠层',
    applySlot: 1,
    effects: [
      createEmptyBuffEffect({
        id: 'draft-stacked-eff',
        kind: 'stacked',
        stat: 'dmgBonus',
        valuePerStack: 10,
        maxStacks: 5,
        defaultStacks: 1.33,
      }),
    ],
  })
  const convertCard = createExtraBuffGain({
    id: 'draft-convert',
    name: '转模',
    applySlot: 'team',
    sourceSlot: 1,
    effects: [
      createEmptyBuffEffect({
        id: 'draft-convert-eff',
        kind: 'convert',
        stat: 'dmgBonus',
        convert: {
          from: 'atk',
          panelSource: 'external',
          ratioPercent: 10,
          initialBase: 0,
          cap: null,
          defaultBase: null,
        },
        conditions: { damageTypes: ['normal', 'anomalyRelease'] },
      }),
    ],
  })

  memory.clear()
  const saved = [fixedCard, stackedCard, convertCard]
  saveWorkingDraft(draftBase({ panelState: snapshot(serializeExtraGains(saved), { bossName: 'D' }) }))
  const restoredRaw = loadWorkingDraft()?.panelState?.extraGains ?? []
  const restored = normalizeExtraGains(restoredRaw)
  check('草稿往返保留 3 张卡片', restored.gains.length === 3, `实际 ${restored.gains.length}`)
  check('正常卡片不被丢弃', restored.discardedCount === 0, `实际 ${restored.discardedCount}`)
  // 结构比较用稳定序列化（键排序）：Spec §7.1 要求递归比较，不比字符串顺序
  const stable = (value) =>
    Array.isArray(value)
      ? `[${value.map(stable).join(',')}]`
      : value && typeof value === 'object'
        ? `{${Object.keys(value)
            .sort()
            .map((key) => `${key}:${stable(value[key])}`)
            .join(',')}}`
        : JSON.stringify(value ?? null)
  check(
    '结构与保存前一致（稳定序列化后相等）',
    stable(serializeExtraGains(restored.gains)) === stable(serializeExtraGains(saved)),
  )
  check(
    '多选伤害类型不丢',
    JSON.stringify(restored.gains[2]?.effects[0]?.conditions) ===
      JSON.stringify({ damageTypes: ['normal', 'anomalyRelease'] }),
  )
  check('叠层小数层数保留', restored.gains[1]?.effects[0]?.defaultStacks === 1.33)

  // 空数组 = 没有额外 Buff：不能回退到旧的扁平 extraMods
  memory.clear()
  saveWorkingDraft(
    draftBase({ panelState: { ...snapshot([], { bossName: 'E' }), extraMods: { atk: 999 } } }),
  )
  const emptyGains = loadWorkingDraft()?.panelState?.extraGains
  check('extraGains=[] 原样保存为空（不回落 extraMods）', Array.isArray(emptyGains) && emptyGains.length === 0)
  check('读取归一化后仍为 0 条', normalizeExtraGains(emptyGains).gains.length === 0)

  // 旧格式 / 无效卡片：整卡丢弃并计数
  memory.clear()
  saveWorkingDraft(
    draftBase({
      panelState: snapshot(
        [
          serializeExtraGains([fixedCard])[0],
          { id: 'legacy-1', name: '旧条目', stat: 'atk', value: 5 },
          { id: '', name: '无 id', effects: [] },
        ],
        { bossName: 'F' },
      ),
    }),
  )
  const mixed = normalizeExtraGains(loadWorkingDraft()?.panelState?.extraGains ?? [])
  check('旧格式/无效卡片整卡丢弃并计数 2', mixed.gains.length === 1 && mixed.discardedCount === 2,
    JSON.stringify({ n: mixed.gains.length, d: mixed.discardedCount }))
}

console.log('\n[七类修复 R7] 真实 loadSnapshot 的加载/重放/关闭生命周期')
{
  const { bindVueFunctions } = await import('./_vueSetupHarness.mjs')
  const { ref } = await import('vue')
  const { normalizeExtraGains, serializeExtraGains, createExtraBuffGain } = await import('../src/utils/extraBuffCalc.ts')
  const { createEmptyBuffEffect } = await import('../src/utils/buffEffect.ts')
  const state = { extraGains: ref([]), extraGainsDiscardedCount: ref(0),
    externalPanel: {}, enemyInput: ref({}), baseDamageSource: ref('atk'),
    loadAffixFromCurrentSlot: () => {}, createDefaultExternalPanel: () => ({}),
    normalizeDamageEnemyInput: () => ({ level: 60 }), normalizeExtraGains, serializeExtraGains }
  const { loadSnapshot, dismissExtraGainsNotice } = bindVueFunctions(
    new URL('../src/components/calculator/PanelCalcSection.vue', import.meta.url),
    ['loadSnapshot', 'dismissExtraGainsNotice'], state)
  const invalid = { extraGains: [{ id: 'legacy', stat: 'atk', value: 50 }] }
  loadSnapshot(invalid)
  check('R7 无效加载提示 1', state.extraGainsDiscardedCount.value === 1)
  loadSnapshot({ extraGains: [] }, { isRestoreReplay: true })
  check('R7 同次规范化重放不抹首次提示', state.extraGainsDiscardedCount.value === 1)
  loadSnapshot({ extraGains: [], externalPanel: { atk: 2000 } })
  check('R7 明确加载合法空方案清除旧提示', state.extraGainsDiscardedCount.value === 0)
  check('R7 其他快照字段仍正常恢复', state.externalPanel.atk === 2000)
  const valid = createExtraBuffGain({ id: 'valid-load', name: '合法卡片', applySlot: 0, sourceSlot: 0, effects: [createEmptyBuffEffect({ id: 'valid-load-e', stat: 'atk', value: 20 })] })
  loadSnapshot({ extraGains: [valid, ...invalid.extraGains] })
  check('R7 混合快照保留合法卡片并提示 1', state.extraGains.value.length === 1 && state.extraGainsDiscardedCount.value === 1)
  loadSnapshot({ extraGains: [valid] })
  check('R7 明确加载内容相同的合法非空方案也清除提示', state.extraGains.value.length === 1 && state.extraGainsDiscardedCount.value === 0)
  loadSnapshot(invalid)
  dismissExtraGainsNotice()
  loadSnapshot(invalid, { isRestoreReplay: true })
  check('R7 关闭后同次重放不重新提示', state.extraGainsDiscardedCount.value === 0)
  loadSnapshot(invalid)
  check('R7 再次明确加载相同无效源重新提示', state.extraGainsDiscardedCount.value === 1)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
