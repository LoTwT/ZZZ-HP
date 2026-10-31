/**
 * 词条评估「事件指纹跨候选复用」回归（本次优化 A 的守卫测试，对应 Spec §6 A 第 1–6 项）。
 *
 * 被验证的生产路径（全部是真实求值，不含 mock / 预设计数 / 计时）：
 * - `evaluateAffixCountsWithCacheInfo` / `evaluateAffixCounts` / `evaluateAffixCountsForSweep`
 *   → `resetAffixEvalCacheIfNeeded` → `affixEvalContextSignature`（上下文身份查询链）
 *   → `computeAffixEvalContextSignature`（完整签名构造）。
 * - 事件指纹由 `buildHitEvalFingerprintReused`（`hitEvalCache.ts`）**按真实内容**复用；
 *   它的「真实重建次数 / 复用次数」就是本测试观察「指纹是否被重复生成」的窗口。
 *   窗口内唯一会生成指纹的就是上面这条身份链（事件求值本身不调用指纹）。
 *
 * 断言口径（Spec §4.1）：结果只比较数值与来源业务字段，不比较对象引用。
 * 运行：npx vite-node scripts/test-affix-event-fingerprint-reuse.mjs
 */
import { eventFixture } from './_eventElementHarness.mjs'
import { testAgent, makePanel, fixedEffect } from './_effectPipelineHarness.mjs'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { isProxy } from 'vue'
import {
  affixEventIdentityDebugStats,
  clearAffixEvalCache,
  evaluateAffixCounts,
  evaluateAffixCountsForSweep,
  evaluateAffixCountsWithCacheInfo,
  resetAffixEventIdentityDebugStats,
} from '../src/utils/optimalAffixAlloc.ts'
import {
  buildHitEvalFingerprint,
  buildHitEvalFingerprintReused,
  clearHitEvalCache,
  hitFingerprintReuseDebugStats,
  resetHitFingerprintDebugStats,
} from '../src/utils/hitEvalCache.ts'
import { createEmptyAffixCounts } from '../src/types/calculatorPanel.ts'
import { AFFIX_VALUE_PER_COUNT } from '../src/utils/affixPanelCalc.ts'

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

function near(actual, expected, tolerance = 1e-6) {
  return typeof actual === 'number' && Math.abs(actual - expected) <= tolerance
}

/**
 * 结果快照：只取业务数值与来源字段（Spec §4.1 要求「不要求对象引用相同」）。
 * 逐事件行取行号内字段，避免把对象身份带进比较。
 */
function snapshot(result) {
  return JSON.stringify({
    grandTotal: result.grandTotal,
    piercePower: result.piercePower,
    finalPanel: result.finalPanel,
    external: result.external,
    result: result.result,
    eventLines: result.eventLines.map((line) => ({
      eventId: line.eventId,
      displayName: line.displayName,
      kind: line.kind,
      perHit: line.perHit,
      total: line.total,
      usesNonMainProducer: line.usesNonMainProducer,
      mainlyProducerDriven: line.mainlyProducerDriven,
    })),
  })
}

function sameResult(a, b) {
  return snapshot(a) === snapshot(b)
}

/** 单条事件的流程（计数可调） */
function singleFlow(count = 1) {
  return [
    {
      id: 'A',
      ownerAgentId: 'owner',
      preparedId: 'prepared',
      count,
      staggerPhase: 'stagger',
      critMode: 'expected',
    },
  ]
}

/** 两条独立事件的流程（两个准备条目 → 两条 hit） */
const twoHitPrepared = [
  { id: 'p1', skillId: 'event-skill', skillSource: 'custom', anomalyPowerAgentId: 'power', triggerAgentId: 'owner' },
  { id: 'p2', skillId: 'event-skill', skillSource: 'custom', anomalyPowerAgentId: 'power', triggerAgentId: 'owner' },
]
function twoHitFlow() {
  return [
    { id: 'A', ownerAgentId: 'owner', preparedId: 'p1', count: 1, staggerPhase: 'stagger', critMode: 'expected' },
    { id: 'B', ownerAgentId: 'owner', preparedId: 'p2', count: 1, staggerPhase: 'stagger', critMode: 'expected' },
  ]
}

/**
 * 构件：一份与内容一一对应的词条评估上下文。
 *
 * 所有配置轴都在**第一次评估之前**就位（`ctx` 在取证前不再被改配置），
 * 于是「同内容」= 用同一组 options 再建一次；「事件内容变化」由用例显式就地修改。
 */
const ENV_BUFF_SELECTION = {
  enabledIds: { 'crisis-buff-crisis-1::b1::e1': true },
  stacksByEffectId: {},
  convertInputs: {},
  manualTouchedIds: {},
}

function buildCtx(options = {}) {
  const fixture = eventFixture({
    mode: options.mode ?? 'ordinary',
    damageType: options.damageType ?? 'direct',
    effects: options.effects ?? [],
    agents: options.agents,
    sourceSlot: options.sourceSlot ?? 0,
    panels: options.panels,
    prepared: options.prepared,
    flow: options.flow ?? singleFlow(1),
  })
  const ctx = fixture.context
  if (options.skillLevels) ctx.panelContext.skillTalentLevelsByAgent = options.skillLevels
  if (options.convertSlotPanels) ctx.panelContext.convertSlotPanels = options.convertSlotPanels
  if (options.valuePerCount) ctx.valuePerCount = options.valuePerCount
  if (options.environmentBuffs) {
    ctx.panelContext.environmentBuffs = options.environmentBuffs
    ctx.panelContext.buffSelection = ENV_BUFF_SELECTION
  }
  if (options.hits === 'empty') ctx.hits = []
  if (options.hits === 'absent') ctx.hits = undefined
  if (options.setupHit) options.setupHit(ctx.hits?.[0], fixture)
  return { fixture, ctx, hit: ctx.hits?.[0] }
}

/** 事件效果实例 id（行级覆盖要按实例 id 禁用） */
function effectInstanceId(fixture, suffix) {
  const item = fixture.items.find((entry) => entry.effect.id.endsWith(suffix))
  if (!item) throw new Error(`夹具里找不到效果 ${suffix}`)
  return item.effect.id
}

/** 冷缓存下的正式求值：新建同内容上下文 + 清空全部缓存，保证不是复用上一次的候选结果 */
function evalFresh(options, affixCounts) {
  const { ctx } = buildCtx(options)
  clearAffixEvalCache()
  return evaluateAffixCounts(ctx, affixCounts)
}

/** 一条最小可用的环境 Buff：全队增伤（数值可调） */
function envBuff(dmgBonus) {
  return {
    kind: 'crisis',
    id: 'crisis-1',
    sourceKey: 'crisis-buff-crisis-1',
    name: '测试危局 Buff',
    effectBlocks: [
      {
        id: 'b1',
        name: '测试效果',
        effects: [
          {
            id: 'e1',
            scope: 'general',
            applyTarget: 'team',
            kind: 'fixed',
            stat: 'dmgBonus',
            value: dmgBonus,
            enabledDefault: true,
          },
        ],
      },
    ],
  }
}

const EMPTY = () => createEmptyAffixCounts()
const ATK_FLAT_1 = () => ({ ...createEmptyAffixCounts(), atkFlat: 1 })

/** 固定「小攻击 +500」的普通增益夹具（行级覆盖可禁用） */
const FIXED_ATK_OPTIONS = () => ({ effects: [fixedEffect('fixed', 'atk', 500)], flow: singleFlow(1) })

console.log('== A1 同上下文、不同候选：事件指纹跨候选复用 ==')
{
  const options = FIXED_ATK_OPTIONS()
  clearAffixEvalCache()
  clearHitEvalCache()
  resetAffixEventIdentityDebugStats()
  resetHitFingerprintDebugStats()

  const { ctx } = buildCtx(options)
  const hitCount = ctx.hits.length
  check('夹具为单条事件', hitCount === 1, String(hitCount))

  const zero = EMPTY()
  const first = evaluateAffixCountsWithCacheInfo(ctx, zero)
  const second = evaluateAffixCountsWithCacheInfo(ctx, ATK_FLAT_1())
  const third = evaluateAffixCountsWithCacheInfo(ctx, zero)

  const identity = affixEventIdentityDebugStats()
  const fingerprint = hitFingerprintReuseDebugStats()

  check('候选1 未命中候选结果缓存（真算）', first.cacheHit === false)
  check('候选2 未命中候选结果缓存（真算，不是靠结果缓存跳过）', second.cacheHit === false)
  check('三次评估 = 三次上下文身份查询', identity.batches === 3, JSON.stringify(identity))
  check(
    `整批事件指纹只生成一次（${hitCount} 条），后两个候选全部复用`,
    identity.builtFingerprints === hitCount && identity.reusedFingerprints === hitCount * 2,
    JSON.stringify(identity),
  )
  check(
    '指纹真实序列化次数 = 事件条数（后两个候选没有重新序列化）',
    fingerprint.serializations === hitCount,
    JSON.stringify(fingerprint),
  )
  check('身份链内没有走旁路的指纹生成', fingerprint.externalBuilds === 0, JSON.stringify(fingerprint))
  check('完整上下文签名只在首次构造一次', identity.signatureComputes === 1, JSON.stringify(identity))

  // 扫掠入口共用同一套身份链与复用状态：换候选时同样不重建整批指纹
  // （这里必须在后面的 `evalFresh` 之前跑：那一步会显式清空复用状态）
  resetAffixEventIdentityDebugStats()
  resetHitFingerprintDebugStats()
  evaluateAffixCountsForSweep(ctx, ATK_FLAT_1())
  const sweepIdentity = affixEventIdentityDebugStats()
  const sweepFingerprint = hitFingerprintReuseDebugStats()
  check(
    '扫掠入口换候选同样复用事件指纹（零重建）',
    sweepIdentity.builtFingerprints === 0 && sweepIdentity.reusedFingerprints === hitCount,
    JSON.stringify(sweepIdentity),
  )
  check(
    '扫掠入口没有重新序列化指纹',
    sweepFingerprint.serializations === 0 && sweepFingerprint.externalBuilds === 0,
    JSON.stringify(sweepFingerprint),
  )

  check('候选1 结果 = 同内容全新上下文正式求值', sameResult(first.value, evalFresh(options, zero)))
  check(
    '候选2 结果 = 同内容全新上下文正式求值',
    sameResult(second.value, evalFresh(options, ATK_FLAT_1())),
  )
  check('第三个候选（收回全零）= 第一个全零的结果', near(third.value.grandTotal, first.value.grandTotal))
  check(
    '候选2 与候选1 确实不同（复用没有把结果粘住）',
    !near(second.value.grandTotal, first.value.grandTotal),
    `${first.value.grandTotal} vs ${second.value.grandTotal}`,
  )
  clearHitEvalCache()
}

console.log('')
console.log('== A2 首次签名未命中：事件状态判断与完整签名共用同一批指纹 ==')
{
  const options = { effects: [], prepared: twoHitPrepared, flow: twoHitFlow() }
  clearAffixEvalCache()
  clearHitEvalCache()
  const { ctx } = buildCtx(options)
  const hitCount = ctx.hits.length
  check('夹具含 2 条事件（「一批」与「单条」可区分）', hitCount === 2, String(hitCount))

  // 从「未使用过的新上下文」开始：这是第一次（也是唯一一次）签名未命中
  resetAffixEventIdentityDebugStats()
  resetHitFingerprintDebugStats()
  evaluateAffixCounts(ctx, EMPTY())
  const identity = affixEventIdentityDebugStats()
  const fingerprint = hitFingerprintReuseDebugStats()

  check('一次评估只做一次上下文身份查询', identity.batches === 1, JSON.stringify(identity))
  check(
    '该次事件指纹恰好生成一批（2 条各一次，没有第二处再生成）',
    identity.builtFingerprints === hitCount,
    JSON.stringify(identity),
  )
  check(
    '指纹真实序列化次数 = 事件条数',
    fingerprint.serializations === hitCount,
    JSON.stringify(fingerprint),
  )
  check('整批指纹没有经过旁路再生成', fingerprint.externalBuilds === 0, JSON.stringify(fingerprint))
  check('完整签名构造一次', identity.signatureComputes === 1, JSON.stringify(identity))
  clearHitEvalCache()
}

console.log('')
console.log('== A3 原地改事件内容：hit.count 1 → 2 → 1 ==')
{
  const oneOptions = { effects: [fixedEffect('fixed', 'atk', 500)], flow: singleFlow(1) }
  const twoOptions = { effects: [fixedEffect('fixed', 'atk', 500)], flow: singleFlow(2) }
  clearAffixEvalCache()
  clearHitEvalCache()
  const { ctx, hit } = buildCtx(oneOptions)
  const zero = EMPTY()

  const damage1 = evaluateAffixCounts(ctx, zero).grandTotal
  const hitRef = hit
  const hitsRef = ctx.hits
  const fingerprint1 = buildHitEvalFingerprintReused(hit).fingerprint

  hit.count = 2
  const damage2 = evaluateAffixCounts(ctx, zero).grandTotal
  const fingerprint2 = buildHitEvalFingerprintReused(hit).fingerprint

  check('就地改 count 保持事件对象与数组引用不变', hit === hitRef && ctx.hits === hitsRef)
  check('就地改 count → 事件身份跟随内容变化', fingerprint1 !== fingerprint2)
  check('总伤 D → 2D', near(damage2, damage1 * 2), `${damage1} → ${damage2}`)
  check(
    '等于 count=2 的全新上下文正式求值',
    near(damage2, evalFresh(twoOptions, zero).grandTotal),
    `${damage2} vs ${evalFresh(twoOptions, zero).grandTotal}`,
  )

  hit.count = 1
  const damage1Again = evaluateAffixCounts(ctx, zero).grandTotal
  check('改回 1 → 回到 D', near(damage1Again, damage1), `${damage1} vs ${damage1Again}`)
  check('改回 1 → 事件身份回到原值', buildHitEvalFingerprintReused(hit).fingerprint === fingerprint1)
  clearHitEvalCache()
}

console.log('')
console.log('== A4 嵌套内容变化：buffOverride / multOverrides / elementOverride 逐轴 ==')
{
  const nestedAxes = [
    {
      name: 'buffOverride.disabledEffectIds',
      options: (disabled) => ({
        effects: [fixedEffect('fixed', 'atk', 500)],
        flow: singleFlow(1),
        setupHit: (hit, fixture) => {
          hit.buffOverride = { disabledEffectIds: disabled ? [effectInstanceId(fixture, 'fixed')] : [] }
        },
      }),
      mutate: (hit, fixture) => hit.buffOverride.disabledEffectIds.push(effectInstanceId(fixture, 'fixed')),
      restore: (hit) => hit.buffOverride.disabledEffectIds.pop(),
      expectDamageChange: true,
    },
    {
      name: 'multOverrides',
      options: (boosted) => ({
        effects: [fixedEffect('fixed', 'atk', 500)],
        flow: singleFlow(1),
        setupHit: (hit) => {
          hit.multOverrides = { directDmgMult: boosted ? 200 : 100 }
        },
      }),
      mutate: (hit) => {
        hit.multOverrides.directDmgMult = 200
      },
      restore: (hit) => {
        hit.multOverrides.directDmgMult = 100
      },
      expectDamageChange: true,
    },
    {
      name: 'elementOverride',
      options: (changed) => ({
        effects: [fixedEffect('fixed', 'atk', 500)],
        flow: singleFlow(1),
        setupHit: (hit) => {
          hit.elementOverride = changed ? '火' : null
        },
      }),
      mutate: (hit) => {
        hit.elementOverride = '火'
      },
      restore: (hit) => {
        hit.elementOverride = null
      },
      // 本夹具没有元素抗性差 => 数值可以相同；按 Spec 仍要求「身份跟随内容」且结果等于新内容求值
      expectDamageChange: false,
    },
  ]

  for (const axis of nestedAxes) {
    clearAffixEvalCache()
    clearHitEvalCache()
    const { ctx, hit, fixture } = buildCtx(axis.options(false))
    const zero = EMPTY()

    const before = evaluateAffixCounts(ctx, zero)
    const fingerprintBefore = buildHitEvalFingerprintReused(hit).fingerprint
    const hitRef = hit

    axis.mutate(hit, fixture)
    const fingerprintAfter = buildHitEvalFingerprintReused(hit).fingerprint
    const after = evaluateAffixCounts(ctx, zero)
    const fresh = evalFresh(axis.options(true), zero)

    check(`${axis.name}｜就地改嵌套内容保持事件引用`, hit === hitRef)
    check(
      `${axis.name}｜事件身份跟随嵌套内容`,
      fingerprintBefore !== fingerprintAfter,
      '指纹未变，内容变化没被识别',
    )
    check(`${axis.name}｜结果 = 同内容全新上下文正式求值`, sameResult(after, fresh))
    if (axis.expectDamageChange) {
      check(
        `${axis.name}｜数值确实随该轴变化（不是空转断言）`,
        !near(after.grandTotal, before.grandTotal),
        `${before.grandTotal} → ${after.grandTotal}`,
      )
    }

    axis.restore(hit)
    const restored = evaluateAffixCounts(ctx, zero)
    check(
      `${axis.name}｜恢复原内容 → 身份与结果都回到原值`,
      buildHitEvalFingerprintReused(hit).fingerprint === fingerprintBefore &&
        sameResult(restored, before),
    )
  }
  clearHitEvalCache()
}

console.log('')
console.log('== A4b 其他消费者：纯函数入口不因复用读到旧值 ==')
{
  const options = { effects: [fixedEffect('fixed', 'atk', 500)], flow: singleFlow(1) }
  clearAffixEvalCache()
  clearHitEvalCache()
  const { hit } = buildCtx(options)

  // 先预热复用层，证明它不会把纯函数入口（skillFlow 那两条链路的入口）带偏
  const reusedBefore = buildHitEvalFingerprintReused(hit).fingerprint
  const pureBefore = buildHitEvalFingerprint(hit)
  check('同一内容：纯函数入口与复用层给同一指纹', reusedBefore === pureBefore)

  hit.count = 3
  const pureAfter = buildHitEvalFingerprint(hit)
  const reusedAfter = buildHitEvalFingerprintReused(hit).fingerprint
  check('就地改内容后纯函数入口仍按真实内容生成', pureAfter !== pureBefore)
  check('就地改内容后复用层与纯函数入口仍然一致', reusedAfter === pureAfter)
  clearHitEvalCache()
}

console.log('')
console.log('== A5 显式清理：clearAffixEvalCache 后不得穿透旧事件身份 ==')
{
  const oneOptions = { effects: [fixedEffect('fixed', 'atk', 500)], flow: singleFlow(1) }
  const twoOptions = { effects: [fixedEffect('fixed', 'atk', 500)], flow: singleFlow(2) }
  clearAffixEvalCache()
  clearHitEvalCache()
  const { ctx, hit } = buildCtx(oneOptions)
  const zero = EMPTY()

  const damage1 = evaluateAffixCounts(ctx, zero).grandTotal
  hit.count = 2
  clearAffixEvalCache()
  const damage2 = evaluateAffixCounts(ctx, zero).grandTotal
  const fresh = evalFresh(twoOptions, zero)

  check('清理后同一上下文得到变更后的结果', near(damage2, fresh.grandTotal), `${damage2} vs ${fresh.grandTotal}`)
  check('清理后不是旧值', !near(damage2, damage1), `${damage1} vs ${damage2}`)

  // 结构断言：清理同时丢弃新增的事件指纹复用状态，下一轮必须按真实内容重新生成
  clearAffixEvalCache()
  resetHitFingerprintDebugStats()
  evaluateAffixCounts(ctx, zero)
  const afterFirst = hitFingerprintReuseDebugStats()
  clearAffixEvalCache()
  evaluateAffixCounts(ctx, zero)
  const afterSecond = hitFingerprintReuseDebugStats()
  check(
    'clearAffixEvalCache 丢弃事件指纹复用状态（两轮各重建整批）',
    afterFirst.serializations === ctx.hits.length &&
      afterSecond.serializations === afterFirst.serializations * 2,
    JSON.stringify({ afterFirst, afterSecond }),
  )
  clearHitEvalCache()
}

console.log('')
console.log('== A6 空事件与配置轴：不跨配置串值 ==')
{
  // 空事件 / 未提供事件：走既有「无事件」路径，不牵涉指纹
  for (const hits of ['empty', 'absent']) {
    const options = { effects: [fixedEffect('fixed', 'atk', 500)], flow: singleFlow(1), hits }
    clearAffixEvalCache()
    clearHitEvalCache()
    resetAffixEventIdentityDebugStats()
    resetHitFingerprintDebugStats()
    const { ctx } = buildCtx(options)
    const result = evaluateAffixCounts(ctx, EMPTY())
    const identity = affixEventIdentityDebugStats()
    const fingerprint = hitFingerprintReuseDebugStats()
    check(`hits=${hits}｜走无事件路径（没有事件行）`, result.eventLines.length === 0)
    check(`hits=${hits}｜没有生成任何事件指纹`, identity.builtFingerprints === 0 && fingerprint.serializations === 0)
    check(
      `hits=${hits}｜结果 = 同内容全新上下文正式求值`,
      sameResult(result, evalFresh(options, EMPTY())),
    )
  }

  const elementEffect = () =>
    createEmptyBuffEffect({
      id: 'ele-bonus',
      stat: 'dmgBonus',
      value: 25,
      kind: 'fixed',
      enabledDefault: true,
      applyTarget: 'team',
      elementFilter: ['电'],
    })
  const skillLevelEffect = () =>
    createEmptyBuffEffect({
      id: 'level-convert',
      kind: 'convert',
      stat: 'dmgBonus',
      enabledDefault: true,
      applyTarget: 'team',
      convert: { from: 'skillLevelBasic', panelSource: 'external', ratioPercent: 100, initialBase: 0, cap: null },
    })
  const levelConvertEffect = () =>
    createEmptyBuffEffect({
      id: 'lvl-conv',
      kind: 'convert',
      stat: 'dmgBonus',
      enabledDefault: true,
      applyTarget: 'team',
      convert: { from: 'level', panelSource: 'external', ratioPercent: 100, initialBase: 0, cap: null },
    })

  const configAxes = [
    {
      name: '元素',
      options: (element) => ({
        effects: [elementEffect()],
        agents: [testAgent('owner', { element }), testAgent('power', { element: '电' })],
        flow: singleFlow(1),
      }),
      values: ['电', '冰'],
    },
    {
      name: '技能等级',
      options: (basic) => ({
        effects: [skillLevelEffect()],
        sourceSlot: 1,
        skillLevels: { power: { basic } },
        flow: singleFlow(1),
      }),
      values: [8, 12],
    },
    {
      name: '主数据内容',
      options: (atk) => ({
        effects: [],
        agents: [testAgent('owner', { basePanel: { ...testAgent('owner').basePanel, atk } }), testAgent('power')],
        panels: { power: makePanel({ atk: 2000 }) },
        flow: singleFlow(1),
      }),
      values: [2000, 2400],
    },
    {
      name: '环境 Buff 数值',
      options: (value) => ({ effects: [], environmentBuffs: [envBuff(value)], flow: singleFlow(1) }),
      values: [30, 60],
    },
    {
      name: '行级覆盖',
      options: (disabled) => ({
        effects: [fixedEffect('fixed', 'atk', 500)],
        flow: singleFlow(1),
        setupHit: (hit, fixture) => {
          hit.buffOverride = { disabledEffectIds: disabled ? [effectInstanceId(fixture, 'fixed')] : [] }
        },
      }),
      values: [false, true],
    },
    {
      name: '转模面板',
      options: (level) => ({
        effects: [levelConvertEffect()],
        sourceSlot: 1,
        panels: { owner: makePanel({ atk: 1000 }), power: makePanel({ atk: 2000 }) },
        convertSlotPanels: { power: { level } },
        flow: singleFlow(1),
      }),
      values: [60, 80],
    },
    {
      name: '每档值',
      options: (atkFlat) => ({
        effects: [],
        valuePerCount: { ...AFFIX_VALUE_PER_COUNT, atkFlat },
        flow: singleFlow(1),
      }),
      values: [19, 30],
    },
  ]

  for (const axis of configAxes) {
    const optionsA = axis.options(axis.values[0])
    const optionsB = axis.options(axis.values[1])
    clearAffixEvalCache()
    clearHitEvalCache()
    const a = buildCtx(optionsA)
    const b = buildCtx(optionsB)
    const value = ATK_FLAT_1()

    const resultA = evaluateAffixCounts(a.ctx, value)
    const resultB = evaluateAffixCounts(b.ctx, value)
    const resultAAgain = evaluateAffixCounts(a.ctx, value)

    check(
      `${axis.name}｜两轴数值确实不同（断言不是空转对照）`,
      !sameResult(resultA, resultB),
      `${resultA.grandTotal} vs ${resultB.grandTotal}`,
    )
    check(
      `${axis.name}｜再次切回 A = A 的冷求值（不串 B 的值）`,
      sameResult(resultAAgain, evalFresh(optionsA, value)),
    )
    check(
      `${axis.name}｜B = B 的冷求值（不串 A 的值）`,
      sameResult(resultB, evalFresh(optionsB, value)),
    )
  }
  clearHitEvalCache()
}

console.log('')
console.log('== A7 复用层「非纯对象一律判不同」的保守分支不在真实数据上常态触发 ==')
{
  /**
   * 为什么必须单独盯这一条：复用层对无法按字段核对的容器（Map / 类实例…）一律判「不同」，
   * 于是每次都会重建指纹。若真实 `ResolvedHit` 里出现这种容器，4.2 第 1 项的跨候选复用
   * 就等于形同虚设 —— 数字仍然对，但「不重生成」不成立。所以这里直接检查真实上下文的
   * 命中对象（`buildOptimalEvalContext` 经 `snapshotCalculationInput` 深拷贝后的结果），
   * 并用连续两次询问观察是否真的走到复用分支。
   */
  const isPlainContainer = (value) => {
    if (value === null || typeof value !== 'object') return true
    if (Array.isArray(value)) return value.every(isPlainContainer)
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return false
    return Object.keys(value).every((key) => isPlainContainer(value[key]))
  }

  clearAffixEvalCache()
  clearHitEvalCache()
  const { ctx, hit } = buildCtx(FIXED_ATK_OPTIONS())

  check('上下文里的 hit 不是响应式代理', isProxy(hit) === false && isProxy(ctx.hits) === false)
  check('buffOverride 为纯对象/数组或空', hit.buffOverride == null || isPlainContainer(hit.buffOverride))
  check('multOverrides 为纯对象或空', hit.multOverrides == null || isPlainContainer(hit.multOverrides))
  check('panelMods 为纯对象或空', hit.panelMods == null || isPlainContainer(hit.panelMods))
  check('skillTypes 为字符串数组', Array.isArray(hit.skill.skillTypes) && isPlainContainer(hit.skill.skillTypes))

  // 再补一份「行级覆盖 + 倍率覆盖」都在位的最坏形状，确认仍然是纯容器
  const { hit: decoratedHit } = buildCtx({
    ...FIXED_ATK_OPTIONS(),
    setupHit: (target) => {
      target.buffOverride = { disabledEffectIds: ['x', 'y'] }
      target.multOverrides = { directDmgMult: 100, attributeAnomalyMult: 50, nested: { deep: [1, 2, 3] } }
    },
  })
  check('行级覆盖 + 嵌套倍率覆盖仍然是纯容器', isPlainContainer(decoratedHit.buffOverride) && isPlainContainer(decoratedHit.multOverrides))

  resetHitFingerprintDebugStats()
  const firstAsk = buildHitEvalFingerprintReused(decoratedHit)
  const secondAsk = buildHitEvalFingerprintReused(decoratedHit)
  const askStats = hitFingerprintReuseDebugStats()
  check(
    '连续两次询问同内容：第二次走复用（没有被动重建）',
    firstAsk.reused === false && secondAsk.reused === true && firstAsk.fingerprint === secondAsk.fingerprint,
    JSON.stringify({ firstAsk, secondAsk }),
  )
  check(
    '两次询问只序列化一次',
    askStats.serializations === 1 && askStats.reuses === 1,
    JSON.stringify(askStats),
  )

  // 整批真实路径上的同一观察：同一 ctx 连续两次身份查询，第二次零重建
  resetAffixEventIdentityDebugStats()
  resetHitFingerprintDebugStats()
  const counts = ATK_FLAT_1()
  evaluateAffixCounts(ctx, counts)
  evaluateAffixCounts(ctx, { ...counts, hpFlat: 1 })
  const identity = affixEventIdentityDebugStats()
  const fingerprint = hitFingerprintReuseDebugStats()
  check(
    '真实评估链第二次身份查询零重建（保守分支没被触发）',
    identity.batches === 2 &&
      identity.builtFingerprints === ctx.hits.length &&
      identity.reusedFingerprints === ctx.hits.length &&
      fingerprint.serializations === ctx.hits.length,
    JSON.stringify({ identity, fingerprint }),
  )
  clearHitEvalCache()
}

console.log('')
console.log(`结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
