// Run: npx vite-node scripts/test-buff-catalog-empty-convert.mjs
//
// 契约（calc-solve-perf task-spec §4.3 / §6「B」）：
//   1) 目录缓存命中、且该条目里**一个转模运算包都没有**时，不得再跑「空转模收集 + 全字段空合并」；
//   2) 返回值仍是完整的 BuffStatModifiers，逐字段与未优化的正式求值一致；
//   3) 「没有转模包」≠「有转模包但这次算出来是 0」—— 有转模包必须照常实时求值；
//   4) 既有 skipConvert / 追踪 / 未命中 / 失效 / LRU 触点语义不变；
//   5) 返回对象共享是审计结论：生产侧没有任何写入方（见下面 §消费者审计）。
//
// 本脚本只用断言与业务数值对照，不写耗时断言；「命中阶段没有空转模收集再空合并」用
// panelBuffCalc.ts 的真实执行路径计数（buffCatalogCacheDebugCounters）观察，不用 mock/预设计数。
//
// ── 消费者审计（Spec §4.3.5，B 独立负责）──────────────────────────────────
// 检索命令（在 zzz-hp/ 下执行，命中范围互相印证）：
//   rg -n "collectPanelBuffMods" src            → 8 处：1 定义 + 3 调用点 + 4 注释/追踪同族函数
//   rg -n "totalMods" src                       → 19 处，全部为读（读取 .pierce/.atk/.mastery/字段下标）
//   rg -n "(mods|totalMods)(\[[^]]*\])?\.[A-Za-z]+\s*(=|\+=|-=)[^=]" src
//                                               → 仅 calculatorUi.ts normalizeTwoPieceMods 写入
//                                                 normalizeBuffStatModifiers() 的**新对象**，与本返回值无关
//   rg -n "Object\.assign" src                  → 30 处，无一处作用于 BuffStatModifiers / breakdown
//   rg -n "finalBreakdown" src                  → 10 处，全部读或原样上传
//
// 生产侧直接消费者（全部只读，因此命中短路可以直接交出共享对象，不复制）：
//   ① panelBuffCalc.ts buildPanelSourceValuesForSlot：读 interimMods.pierce + applyBuffModsToPanel()
//   ② panelBuffCalc.ts computePanelStages（interimMods，skipConvert=true）：同上
//   ③ panelBuffCalc.ts computePanelStages（totalMods，includeDetails=false）：
//      读 applyBuffModsToPanel() / extractCombatMods()（逐字段搬到新 CombatBuffMods）/
//      挂到 finalBreakdown.totalMods 后由下游只读：
//        FlowCalculationDetail.vue:43（pierce）、DamageCalcPage.vue:2390（字段值）、
//        PanelCalcSection.vue:349（computed → 模板）、eventDamageSourceTips.ts:168（pierce）、
//        optimalAffixAlloc.ts ×6（pierce）、remielSelfRadiancePanel.ts:108（atk/mastery）
//   链路里唯一的写入是 applyFengYuSharpenCritMods() 写 combatMods.sharpenCritDmgBonus，
//   而 combatMods 是 extractCombatMods() 新建的对象，不是 totalMods。
//   既有共享语义：skipConvert=true 命中路径今天就返回 entry.nonConvertMods（同一份目录对象），
//   本次只是把同一语义延伸到「非 skipConvert 且条目无转模包」的命中路径。
// ─────────────────────────────────────────────────────────────────────────
import assert from 'node:assert/strict'
import { BUFF_STAT_FIELDS, createEmptyBuffStatModifiers } from '../src/utils/calculatorUi.ts'
import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import * as panelBuffCalc from '../src/utils/panelBuffCalc.ts'

const { collectPanelBuffMods, computeFinalPanel, invalidateBuffCatalogCache } = panelBuffCalc

/** 真实执行路径计数：用来证明命中短路真的没再跑空转模收集（不是模拟值） */
function debugCounters() {
  const counters = panelBuffCalc.buffCatalogCacheDebugCounters
  assert.ok(
    counters,
    'panelBuffCalc 应导出真实路径计数 buffCatalogCacheDebugCounters（结构观察点）',
  )
  return counters
}

function resetCounters() {
  assert.equal(
    typeof panelBuffCalc.resetBuffCatalogCacheDebugCounters,
    'function',
    'panelBuffCalc 应导出 resetBuffCatalogCacheDebugCounters',
  )
  panelBuffCalc.resetBuffCatalogCacheDebugCounters()
}

function makeBangboo(atkFlat) {
  return {
    id: 'test-bangboo',
    name: '测试邦布',
    avatar_image: null,
    effectBlocks: [
      {
        id: 'blk-1',
        name: '固定',
        note: '',
        effects: [
          {
            id: 'eff-atk',
            kind: 'fixed',
            stat: 'atk',
            value: atkFlat,
            scope: 'general',
            applyTarget: 'team',
            enabledDefault: true,
          },
        ],
      },
    ],
    effects: [],
    refinementEffects: [[], [], [], [], []],
    refinementEffectBlocks: [[], [], [], [], []],
  }
}

/** 只有一条「全队攻击转模」的邦布：来源槽位 0 局内攻击 × 10%，无其他增益/覆盖/过滤 */
function makeConvertBangboo() {
  return {
    id: 'test-bangboo-convert',
    name: '测试转模邦布',
    avatar_image: null,
    effectBlocks: [
      {
        id: 'blk-cv',
        name: '全队攻击转模',
        note: '',
        effects: [
          {
            id: 'eff-convert-atk',
            kind: 'convert',
            stat: 'atk',
            value: 0,
            scope: 'general',
            applyTarget: 'team',
            enabledDefault: true,
            convert: {
              from: 'atk',
              panelSource: 'final',
              ratioPercent: 10,
              initialBase: 0,
              cap: null,
            },
          },
        ],
      },
    ],
    effects: [],
    refinementEffects: [[], [], [], [], []],
    refinementEffectBlocks: [[], [], [], [], []],
  }
}

function makeCtx(bangboo, overrides = {}) {
  return {
    teamSlots: [{ agentId: '', rank: 0, wengineId: '', wengineRefine: 1 }],
    agents: [],
    wengines: [],
    bangboo,
    bangbooRefine: 1,
    mainSlotIndex: 0,
    driveDiscs: [],
    skipConvert: false,
    ...overrides,
  }
}

function modsSnapshot(mods) {
  const snapshot = {}
  for (const field of BUFF_STAT_FIELDS) snapshot[field.key] = mods[field.key]
  return snapshot
}

/** 逐字段比对（字段范围按 BuffStatModifiers / BUFF_STAT_FIELDS 全量，不按固定字段数省略） */
function assertSameMods(actual, expected, label) {
  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(createEmptyBuffStatModifiers()).sort(),
    `${label}：返回对象字段集合应覆盖完整 BuffStatModifiers`,
  )
  for (const field of BUFF_STAT_FIELDS) {
    assert.equal(actual[field.key], expected[field.key], `${label}：${field.key} 应一致`)
  }
}

console.log('[1] 无转模目录命中：短路生效、数值逐字段一致')
{
  invalidateBuffCatalogCache()
  resetCounters()
  const counters = debugCounters()
  const ctx = makeCtx(makeBangboo(100))

  const miss = collectPanelBuffMods(ctx)
  assert.equal(miss.atk, 100, '未命中时应计入邦布攻击 +100')
  assert.equal(counters.catalogMisses, 1, '首次求值必须是真实冷算')
  assert.equal(counters.convertCollectCalls, 0, '没有转模包时，未命中也不该调用转模收集')
  assert.equal(counters.emptyConvertShortCircuits, 0, '未命中不是短路')

  const firstHit = collectPanelBuffMods(ctx)
  const secondHit = collectPanelBuffMods(ctx)
  for (const [index, hit] of [firstHit, secondHit].entries()) {
    assert.equal(hit.atk, 100, `第 ${index + 2} 次（命中）应仍为攻击 +100`)
    assertSameMods(hit, miss, `第 ${index + 2} 次命中 vs 正式冷算`)
  }
  assert.equal(counters.catalogMisses, 1, '重复求值不得再次冷算')
  assert.equal(counters.emptyConvertShortCircuits, 2, '两次命中都应走「条目无转模包」短路')
  assert.equal(counters.convertCollectCalls, 0, '命中阶段不得再执行空转模收集')
  // 结构证据：短路后不做全字段空合并 → 两次命中拿到同一个对象（合并一定新建对象）
  assert.equal(firstHit, secondHit, '命中阶段不应为「空合并」新建对象')
  assert.notEqual(firstHit, miss, '未命中仍走正式合并，返回自己的对象')
}

console.log('[2] 失效后更新：100 → 50 → 0 不沿用旧值')
{
  invalidateBuffCatalogCache()
  resetCounters()
  const counters = debugCounters()
  const bangboo = makeBangboo(100)
  const ctx = makeCtx(bangboo)

  assert.equal(collectPanelBuffMods(ctx).atk, 100, '首次应为 +100')

  // 既有契约：就地改而不失效 → 仍读到旧值（见 test-buff-catalog-cache.mjs）
  bangboo.effectBlocks[0].effects[0].value = 50
  assert.equal(collectPanelBuffMods(ctx).atk, 100, '未失效时就地改：按既有契约返回旧值 +100')

  invalidateBuffCatalogCache()
  resetCounters()
  const miss50 = collectPanelBuffMods(ctx)
  assert.equal(miss50.atk, 50, '失效后冷算应为 +50')
  assert.equal(counters.catalogMisses, 1, '失效后必须是一次真实冷算')
  const hit50 = collectPanelBuffMods(ctx)
  assert.equal(hit50.atk, 50, '后续命中应仍为 +50')
  assertSameMods(hit50, miss50, '失效后命中 vs 冷算')
  assert.equal(counters.convertCollectCalls, 0, '无转模包时命中仍不收集转模')

  bangboo.effectBlocks[0].effects[0].value = 0
  invalidateBuffCatalogCache()
  resetCounters()
  const miss0 = collectPanelBuffMods(ctx)
  assert.equal(miss0.atk, 0, '再次失效后应为 0，不沿用 100/50')
  assert.equal(counters.catalogMisses, 1, '再次失效后仍是真实冷算')
  assert.equal(collectPanelBuffMods(ctx).atk, 0, '命中应仍为 0')
}

console.log('[3] 存在转模包而旧结果为 0：必须实时求值，不得当成「无转模」')
{
  invalidateBuffCatalogCache()
  resetCounters()
  const counters = debugCounters()
  const bangboo = makeConvertBangboo()
  // 来源容器必须是 Map（转模按来源槽位取值），且后面用同一个 Map 的 set 更新
  const panelSourceValuesBySlot = new Map([[0, { final: { atk: 0 } }]])
  const ctx = makeCtx(bangboo, { panelSourceValuesBySlot })

  const first = collectPanelBuffMods(ctx)
  assert.equal(first.atk, 0, '来源攻击为 0 时转模增量为 0')
  assert.equal(counters.catalogMisses, 1, '首次为真实冷算')
  assert.equal(counters.emptyConvertShortCircuits, 0, '存在转模包时不得走「无转模」短路')

  panelSourceValuesBySlot.set(0, { final: { atk: 1000 } })
  const second = collectPanelBuffMods(ctx)
  assert.equal(second.atk, 100, '同一目录命中下来源 0 → 1000，转模增量应为 100')
  assert.equal(counters.catalogMisses, 1, '第二次应是目录命中，不是重算目录')
  assert.equal(counters.emptyConvertShortCircuits, 0, '有转模包时命中也不得短路')
  assert.equal(counters.convertCollectCalls, 1, '存在转模包时命中必须重新求值转模')

  const third = collectPanelBuffMods(ctx)
  assert.equal(third.atk, 100, '重复命中仍为 100')
  assert.equal(counters.convertCollectCalls, 2, '有转模包时每次命中都要实时求值')

  // skipConvert=true：转模增量必须为 0（既有语义不变）
  const skipCtx = makeCtx(bangboo, { panelSourceValuesBySlot, skipConvert: true })
  assert.equal(collectPanelBuffMods(skipCtx).atk, 0, 'skipConvert=true 时转模增量为 0')
}

console.log('[4] 消费者写入安全：共享对象经真实消费者后不被改写')
{
  invalidateBuffCatalogCache()
  resetCounters()
  const counters = debugCounters()
  const ctx = makeCtx(makeBangboo(100))
  const panel = createDefaultExternalPanel()

  collectPanelBuffMods(ctx) // 冷算
  const shared = collectPanelBuffMods(ctx) // 命中：共享 entry.nonConvertMods
  const before = modsSnapshot(shared)

  // includeDetails=false 的真实消费者：totalMods 就是 collectPanelBuffMods 的返回值
  const first = computeFinalPanel(panel, ctx, { includeDetails: false })
  assert.equal(first.totalMods, shared, 'includeDetails=false 的 totalMods 应与目录返回值同源')
  assert.deepEqual(modsSnapshot(first.totalMods), before, '消费者读到的 totalMods 与目录返回值逐字段一致')

  const second = computeFinalPanel(panel, ctx, { includeDetails: false })
  assert.equal(second.totalMods.atk, 100, '第二次求值攻击仍为 +100（若被写入会累加）')
  assert.deepEqual(modsSnapshot(shared), before, '消费者跑完后共享对象不得被改写')
  assert.deepEqual(
    modsSnapshot(second.totalMods),
    modsSnapshot(first.totalMods),
    '两次求值的 totalMods 必须完全一致（无残留/累加污染）',
  )
  assert.equal(second.finalPanel.atk, first.finalPanel.atk, '两次 finalPanel 必须一致')

  // 另一个目录（不同键）的求值既不污染本目录对象，也不把本目录条目挤掉
  const otherCtx = makeCtx(makeBangboo(30))
  const otherMods = collectPanelBuffMods(otherCtx)
  assert.equal(otherMods.atk, 30, '另一目录应得到自己的 +30')
  assert.deepEqual(modsSnapshot(shared), before, '另一目录求值不得污染本目录共享对象')
  const afterOtherMisses = counters.catalogMisses
  const backAgain = collectPanelBuffMods(ctx)
  assert.equal(counters.catalogMisses, afterOtherMisses, '回到原目录仍应命中（LRU 触点语义不变）')
  assert.equal(backAgain.atk, 100, '回到原目录应仍为 +100')
}

console.log('[5] 其他路径：未命中 / 命中 / skipConvert / 正式追踪，字段与记录都不丢')
{
  invalidateBuffCatalogCache()
  resetCounters()
  const counters = debugCounters()
  const ctx = makeCtx(makeBangboo(100))

  const miss = collectPanelBuffMods(ctx) // 目录未命中
  const hit = collectPanelBuffMods(ctx) // 目录命中（无转模短路）
  const skip = collectPanelBuffMods({ ...ctx, skipConvert: true }) // skipConvert=true 命中

  assert.equal(miss.atk, 100, '未命中攻击 +100')
  assert.equal(hit.atk, 100, '命中攻击 +100')
  assert.equal(skip.atk, 100, 'skipConvert=true 攻击 +100')
  assertSameMods(hit, miss, '命中 vs 未命中')
  assertSameMods(skip, miss, 'skipConvert=true vs 未命中')

  const contributions = []
  const traceCtx = {
    ...ctx,
    trace: {
      viewKey: 'catalog-empty-convert-fixture',
      policy: 'default',
      onContribution: (item) => contributions.push(item),
    },
  }
  const traced = collectPanelBuffMods(traceCtx)
  assert.equal(counters.tracedCalls, 1, '带 trace 必须走正式追踪分支')
  assert.equal(traced.atk, 100, '追踪路径数值应与数值路径一致')
  assertSameMods(traced, miss, '追踪路径 vs 未命中数值')

  // 收集器会把效果 id 规范成 `<sourceKey>::<blockId>::<effectId>`（bangboo-fixed::blk-1::eff-atk）
  const records = contributions.filter((item) => item.effectId.endsWith('eff-atk'))
  assert.ok(records.length > 0, '追踪记录必须包含固定攻击效果（不得因短路丢记录）')
  assert.ok(
    records.every((item) => item.viewKey === 'catalog-empty-convert-fixture' && item.policy === 'default'),
    '追踪记录必须来自本次正式求值',
  )
  assert.ok(
    records.some((item) => item.status === 'applied' && item.amount === 100),
    '追踪记录应报告实际生效值 +100（不得因短路丢字段）',
  )
  assert.equal(counters.emptyConvertShortCircuits, 1, '只有一次命中走了无转模短路')
  assert.equal(counters.convertCollectCalls, 0, '本组没有转模包，转模收集一次都不该发生')
}

console.log('test-buff-catalog-empty-convert: ok')
