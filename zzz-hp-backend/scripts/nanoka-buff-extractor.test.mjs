/**
 * nanoka 增益抽取 v3 自测（`src/services/nanoka/nanokaBuffExtractor.js` +
 * `src/services/nanokaBuffService.js` + 路由接线）。
 *
 * 运行：`node --test scripts/nanoka-buff-extractor.test.mjs`
 *
 * **本文件不连库、不写库**：抽取/映射/合并全是纯函数；写库计划只喂假对象；
 * `applyBuffItems` / `extractBuffItems` 只测「参数不对时在碰库之前就抛中文错误」。
 *
 * 夹具：开发目录缓存的 nanoka 真实响应（不联网、不进仓库）：
 *   `D:/WB_agent_out/ZZZ-HP/artifacts/nanoka-probe/cache/char-<tag>-<id>.json`
 *   `D:/WB_agent_out/ZZZ-HP/artifacts/nanoka-probe/cache/weapon-<tag>-<id>.json`
 * 缓存不存在时，依赖夹具的用例跳过（可用 `NANOKA_CACHE` 指定目录）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTION_OPTIONS,
  CONVERT_FROM_OPTIONS,
  CONVERT_PANEL_SOURCE_OPTIONS,
  CONVERT_SLOT_HINTS,
  CONVERT_SLOT_IDS,
  CONVERT_SLOT_LABELS,
  GAME_LITERAL_REWRITES,
  MULTI_SLOT_IDS,
  NONE,
  SLOT_IDS,
  SLOT_OPTIONS,
  UNABLE,
  checkKeywordMappable,
  cleanNanokaText,
  detectSkillLimits,
  extractAgentBuffItems,
  extractKeywordEffects,
  extractNumbers,
  extractWengineBuffItems,
  formatKeywordLine,
  formatKeywordSlots,
  formatSourceBlock,
  isConvertClause,
  isEmptySlot,
  mapKeywordsToEffect,
  readConvertParts,
  readDurationInfo,
  readStackInfo,
  refineStatKeyword,
  resolveStatField,
  simplifyText,
  slotView,
  splitUnits,
  unableSlotsOf,
} from '../src/services/nanoka/nanokaBuffExtractor.js'
import {
  MERGE_FIELD_LIST,
  appendSourceText,
  applyAnchorPlanToRows,
  applyBuffItems,
  extractBuffItems,
  matchSkillDescTargets,
  planAnchorCreations,
  planBuffApply,
  resolveRowConflicts,
  resolveSlotTarget,
  sanitizeEffect,
  smartMergeParse,
  summarizeItems,
} from '../src/services/nanokaBuffService.js'
import nanokaBuffRoutes from '../src/routes/nanokaBuffRoutes.js'
import { requireAdmin } from '../src/middleware/requireAdmin.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const CACHE =
  process.env.NANOKA_CACHE ?? path.resolve(here, '../../../../ZZZ-HP/artifacts/nanoka-probe/cache')
const cacheNames = fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : []
const SKIP = cacheNames.length ? false : `未找到 nanoka 缓存夹具：${CACHE}`

/** 夹具文件名带 build tag（`char-3.3.12_19566749-1041.json`），tag 会变 → 按前缀 + id 找 */
function readFixture(prefix, id) {
  const name = cacheNames.find((f) => f.startsWith(`${prefix}-`) && f.endsWith(`-${id}.json`))
  assert.ok(name, `缺少夹具 ${prefix}-*-${id}.json（${CACHE}）`)
  return JSON.parse(fs.readFileSync(path.join(CACHE, name), 'utf8'))
}

/** 造一条关键字（9 槽位**不许缺格**） */
function keyword(overrides = {}) {
  const slots = {
    stat: '增伤',
    elements: [NONE],
    action: '提升',
    value: 10,
    unit: '%',
    target: NONE,
    conditions: [NONE],
    stacks: NONE,
    duration: NONE,
    object: NONE,
    ...overrides.slots,
  }
  return {
    id: overrides.id ?? 'k1',
    key: overrides.key ?? overrides.id ?? 'k1',
    origin: overrides.origin ?? 'nanoka:test:manual',
    slots,
    convert: overrides.convert ?? null,
    stackMax: overrides.stackMax ?? null,
    durationSeconds: overrides.durationSeconds ?? null,
    anchors: overrides.anchors ?? null,
    rawText: overrides.rawText ?? '',
  }
}

function firstEffect(text, options = {}) {
  const { effects, waste } = extractKeywordEffects({ text, origin: 'test', ...options })
  return { effect: effects[0], effects, waste }
}

// ================================================================== 1. 文本工具

test('文本工具：去标签 / 抽数值 / 切句 / 层数 / 时长', () => {
  assert.equal(cleanNanokaText('<color=#2BAD00>70%</color>\\n提升'), '70%\n提升')
  assert.equal(cleanNanokaText('{CAL:1041}造成伤害'), '造成伤害')
  assert.equal(cleanNanokaText('点按 <IconMap:Icon_Normal> 发动'), '点按 发动')

  assert.deepEqual(extractNumbers('提升70%，持续15秒'), [
    { value: 70, unit: '%', percent: true },
    { value: 15, unit: '点', percent: false },
  ])

  const units = splitUnits('第一句，子句。第二句；')
  assert.equal(units.length, 2)
  assert.deepEqual(units[0].clauses, ['第一句', '子句'])

  assert.deepEqual(readStackInfo('造成伤害提升3%，最多叠加12层'), {
    maxStacks: 12,
    perStack: false,
    mentioned: true,
  })
  assert.deepEqual(readStackInfo('每层提升2.5%，最多12层'), {
    maxStacks: 12,
    perStack: true,
    mentioned: true,
  })
  assert.deepEqual(readStackInfo('获得8层充能'), { maxStacks: null, perStack: false, mentioned: false })

  assert.deepEqual(readDurationInfo('持续20秒，重复触发刷新持续时间'), {
    seconds: 20,
    mentioned: true,
  })
  // 「该效果的持续时间提升2秒」：`持续时间` 是**属性**，不是时长槽位
  assert.equal(readDurationInfo('该效果的持续时间提升2秒').mentioned, false)
  assert.equal(readDurationInfo('持续时间提升2秒').seconds, null)
})

// ================================================================== 2. 9 槽位模型

test('9 槽位 + 元素不许缺格：每条关键字都能渲染出全部槽位（属性写工具语义）', () => {
  const { effect } = firstEffect('造成的伤害提升10%')
  assert.deepEqual(Object.keys(effect.slots), SLOT_IDS)
  for (const id of SLOT_IDS) assert.ok(id in effect.slots, `缺少槽位 ${id}`)
  assert.match(
    formatKeywordSlots(effect.slots),
    /^属性=增伤 元素=无 动作=提升 数值=10 单位=% 目标=无 条件=无 层数=无 时长=无 对象=无$/,
  )
})

test('元素**不拆条**：一条关键字带多个元素 → elementFilter 数组（复数白名单：条件 / 元素）', () => {
  assert.deepEqual(MULTI_SLOT_IDS, ['conditions', 'elements'])
  const { effects } = extractKeywordEffects({
    text: '造成的火属性伤害和冰属性伤害提升10%',
    origin: 'test',
  })
  assert.equal(effects.length, 1, '多元素不拆条')
  assert.equal(effects[0].slots.stat, '增伤', '多元素时属性退成通用语义')
  assert.deepEqual(effects[0].slots.elements, ['火', '冰'])
  const mapped = mapKeywordsToEffect({
    slots: effects[0].slots,
    id: 'e1',
    origin: 'test',
  })
  assert.equal(mapped.effect.stat, 'dmgBonus')
  assert.deepEqual(mapped.effect.elementFilter, ['火', '冰'])

  // 单元素也**统一走元素槽**（用户 2026-10-16：输出统一，不再用「属性=火属性伤害」）
  const single = firstEffect('造成的火属性伤害提升10%')
  assert.equal(single.effect.slots.stat, '增伤')
  assert.deepEqual(single.effect.slots.elements, ['火'])
  const singleMapped = mapKeywordsToEffect({ slots: single.effect.slots })
  assert.equal(singleMapped.effect.stat, 'dmgBonus')
  assert.deepEqual(singleMapped.effect.elementFilter, ['火'])

  // 「全属性伤害」= 不限元素 → 元素槽留空、elementFilter 保持 all
  const all = firstEffect('造成的全属性伤害提升10%')
  assert.equal(all.effect.slots.stat, '增伤')
  assert.deepEqual(all.effect.slots.elements, [NONE])
  assert.equal(mapKeywordsToEffect({ slots: all.effect.slots }).effect.elementFilter, 'all')

  // 旧字样仍能被识别（手动 / 老数据）：属性=火属性伤害 照样映射成元素过滤
  const legacy = mapKeywordsToEffect(keyword({ slots: { stat: '火属性伤害' } }))
  assert.equal(legacy.effect.stat, 'dmgBonus')
  assert.deepEqual(legacy.effect.elementFilter, ['火'])
})

test('`无` 与 `无法提取` 严格区分：没出现写「无」，出现但归不了类写「无法提取」', () => {
  // 动作 + 属性都认不出 → 可映射性预检在阶段1 就把它整条丢进废原文（不是「无法提取」）
  const wasteCase = firstEffect('队伍中任意角色对敌人造成属性异常伤害时')
  assert.equal(wasteCase.effects.length, 0)

  // 有动作、有属性（能映射），但数值读不出（「大量」）→ 数值标「无法提取」，该条**仍然进阶段二**等用户补
  const unableCase = firstEffect('造成的伤害提升大量')
  assert.equal(unableCase.effects.length, 1)
  assert.deepEqual(unableSlotsOf(unableCase.effect), ['value'])
  assert.equal(unableCase.effect.slots.action, '提升')
  const mapped = mapKeywordsToEffect(keyword({ slots: { value: UNABLE } }))
  assert.equal(mapped.ok, false)
  assert.equal(mapped.blocked, true)
  assert.match(mapped.reason, /无法提取/)

  // 没有数值 / 没有单位时写「无」，不是「无法提取」
  const noUnit = firstEffect('造成的伤害提升')
  assert.equal(noUnit.effect.slots.unit, NONE)
  assert.equal(noUnit.effect.slots.value, UNABLE)

  // 提到时限但读不出 → 时长「无法提取」
  const durationUnable = firstEffect('造成的伤害提升10%，持续一段时间')
  assert.equal(durationUnable.effect.slots.duration, UNABLE)
})

test('1 段原文 → N 条关键字（除「条件」外，任何槽位出现复数 = 2 条效果）', () => {
  const { effects } = extractKeywordEffects({
    text: '自身攻击力提升1000点，给全队造成的伤害提升30%。',
    origin: 'test',
  })
  assert.equal(effects.length, 2)
  assert.equal(effects[0].slots.stat, '攻击力（固定）')
  assert.equal(effects[0].slots.value, 1000)
  assert.equal(effects[0].slots.unit, '点')
  assert.equal(effects[0].slots.target, '自身')
  assert.equal(effects[1].slots.stat, '增伤')
  assert.equal(effects[1].slots.value, 30)
  assert.equal(effects[1].slots.unit, '%')
  assert.equal(effects[1].slots.target, '全队')
})

test('条件槽位是**唯一允许复数**的槽位', () => {
  const { effect } = firstEffect('若能量不足40点，攻击失衡敌人时，造成的伤害提升10%')
  assert.ok(Array.isArray(effect.slots.conditions))
  assert.ok(effect.slots.conditions.length >= 2)
  assert.ok(effect.slots.conditions.some((item) => /能量不足/.test(item)))
  assert.ok(effect.slots.conditions.some((item) => /失衡/.test(item)))
})

// ================================================================== 3. 槽位语义（v3 新口径）

test('动作表固定 4 个（回复已去掉）；回复类 / 非动作动词 → 废原文', () => {
  assert.deepEqual(ACTION_OPTIONS, ['提升', '降低', '无视', '转化'])
  const gained = firstEffect('获得10%暴击率')
  assert.equal(gained.effects.length, 0)
  assert.match(gained.waste[0].reason, /动词不在动作表/)
  const stateCase = firstEffect('进入[生竭]状态')
  assert.equal(stateCase.effects.length, 0)

  // 「立即回复 N 点能量」：没有工具字段（动作 / 属性都归不了）→ 阶段1 结束时整条进废原文，不进阶段2
  const energy = firstEffect('立即回复80点能量')
  assert.equal(energy.effects.length, 0)
  assert.ok(energy.waste.length >= 1)
  assert.match(energy.waste[0].reason, /不在动作表|没有对应字段|没命中属性词典/)
  // 有属性、但动作不在表（回能）→ 可映射性预检拦下
  const energyPrecheck = checkKeywordMappable({ slots: { stat: '能量', action: '回复', unit: '点' } })
  assert.equal(energyPrecheck.ok, false)
  assert.match(energyPrecheck.reason, /不在动作表/)
  // 「生命回复」同理
  const heal = firstEffect('回复自身10%生命值上限的生命值')
  assert.equal(heal.effects.length, 0)
  assert.ok(heal.waste.length >= 1)
})

test('可映射性预检：动作 + 属性 去阶段2 词表反查（阶段1 结束时决定去留）', () => {
  assert.equal(checkKeywordMappable({ slots: { stat: '能量自动回复', action: '提升', unit: '%' } }).ok, true)
  assert.equal(checkKeywordMappable({ slots: { stat: '能量', action: '提升', unit: '点' } }).ok, false)
  assert.equal(checkKeywordMappable({ slots: { stat: '技能等级', action: '提升', unit: NONE } }).ok, false)
  assert.equal(checkKeywordMappable({ slots: { stat: '冲击力', action: '提升', unit: '%' } }).ok, false)
  assert.equal(checkKeywordMappable({ slots: { stat: '增伤', action: '回复', unit: '%' } }).ok, false)
  assert.equal(checkKeywordMappable({ slots: { stat: '减防', action: '无视', unit: '%' } }).field, 'reduceDefense')
  assert.equal(resolveStatField({ stat: '抗性穿透', action: '无视' }), 'resPen')
  assert.equal(resolveStatField({ stat: '减防', action: '降低' }), 'reduceDefense')
})

test('预检**不丢** `无法提取`：动作 / 属性读不出的条目留在阶段2（标 blocked 待补）', () => {
  // 动作读不出（有属性、有数值）→ 留阶段2 等用户补动作（**不是**废原文）
  const actionPending = checkKeywordMappable({ slots: { stat: '暴击率', action: UNABLE, unit: '%' } })
  assert.equal(actionPending.ok, true)
  assert.equal(actionPending.pending, true)
  const actionRow = firstEffect('暴击率40%')
  assert.equal(actionRow.effects.length, 1, '动作=无法提取 不该被丢进废原文')
  assert.equal(actionRow.waste.length, 0)
  assert.equal(actionRow.effect.slots.action, UNABLE)
  const actionMapped = mapKeywordsToEffect(keyword({ slots: actionRow.effect.slots }))
  assert.equal(actionMapped.blocked, true, '阶段2 标 blocked / 待补')
  assert.match(actionMapped.reason, /无法提取/)

  // 属性读不出（有动作、有数值）→ 同样留阶段2
  const statPending = checkKeywordMappable({ slots: { stat: UNABLE, action: '提升', unit: '%' } })
  assert.equal(statPending.ok, true)
  assert.equal(statPending.pending, true)
  const statRow = firstEffect('提升40%')
  assert.equal(statRow.effects.length, 1, '属性=无法提取 不该被丢进废原文')
  assert.equal(statRow.effect.slots.stat, UNABLE)
  assert.equal(mapKeywordsToEffect(keyword({ slots: statRow.effect.slots })).blocked, true)

  // 对照：动作**认得**但属性查不到字段 → 才是废原文
  const unmappable = checkKeywordMappable({ slots: { stat: '技能等级', action: '提升', unit: NONE } })
  assert.equal(unmappable.ok, false)
  assert.match(unmappable.reason, /没有对应字段/)
})

test('能量是属性：能量自动回复 +X% 是正常增益；瞬时回能是废原文', () => {
  const rate = firstEffect('能量自动回复效率提升10%')
  assert.equal(rate.effect.slots.stat, '能量自动回复')
  assert.equal(rate.effect.slots.action, '提升')
  const rateMapped = mapKeywordsToEffect(keyword({ slots: rate.effect.slots }))
  assert.equal(rateMapped.effect.stat, 'energyRegen')
  assert.equal(rateMapped.effect.value, 10)

  const plain = firstEffect('能量回复效率提升5%')
  assert.equal(plain.effect.slots.stat, '能量自动回复')
  const plainMapped = mapKeywordsToEffect(keyword({ slots: plain.effect.slots }))
  assert.equal(plainMapped.effect.stat, 'energyRegen')
})

test('时长抓下来但不转化（只进 note）', () => {
  const { effect } = firstEffect('造成的伤害提升10%，持续15秒')
  assert.equal(effect.slots.duration, '15 秒')
  assert.equal(effect.durationSeconds, 15)
  const mapped = mapKeywordsToEffect(keyword({ slots: effect.slots, durationSeconds: 15 }))
  assert.equal(mapped.effect.kind, 'fixed')
  assert.ok(!('duration' in mapped.effect), '层C 里不该出现时长字段')
  assert.match(mapped.steps.join(' '), /时长=15 秒 → 不转化/)
  assert.match(mapped.effect.note, /15 秒/)
})

test('我方减伤不存在 → 废原文；「（敌人）受到的伤害提升」= **增伤**（不是易伤）', () => {
  const selfReduce = firstEffect('受到的伤害降低18%')
  assert.equal(selfReduce.effects.length, 0)
  assert.match(selfReduce.waste[0].reason, /我方减伤不存在/)

  // 游戏描述坑（用户 2026-10-16 纠正）：无条件「受到的伤害提升」是**增伤** → dmgBonus
  const raised = firstEffect('使敌人受到的伤害提升25%')
  assert.equal(raised.effects.length, 1)
  assert.equal(raised.effect.slots.stat, '增伤')
  const raisedMapped = mapKeywordsToEffect(keyword({ slots: raised.effect.slots }))
  assert.equal(raisedMapped.effect.stat, 'dmgBonus')
  assert.equal(raisedMapped.effect.value, 25)
  assert.notEqual(raisedMapped.effect.stat, 'vulnerable', '抽取器不主动产出 vulnerable')

  // 降低 → 负向（同一加算区里的减项）
  const lowered = firstEffect('使敌人受到的伤害降低20%')
  assert.equal(lowered.effect.slots.stat, '增伤')
  assert.equal(lowered.effect.slots.action, '降低')
  const loweredMapped = mapKeywordsToEffect(keyword({ slots: lowered.effect.slots }))
  assert.equal(loweredMapped.effect.stat, 'dmgBonus')
  assert.equal(loweredMapped.effect.value, -20)

  // `vulnerable` 只留给**手动**（下拉里还在）
  assert.equal(resolveStatField({ stat: '易伤', action: '提升' }), 'vulnerable')
})

test('易伤家族保留的落法：失衡 → staggerVulnerable；失衡/非失衡均 → globalStaggerVulnerable', () => {
  // 限定过的直伤 / 异常易伤仍是各自字段
  assert.equal(resolveStatField({ stat: '直伤易伤', action: '提升' }), 'directVulnerable')
  assert.equal(resolveStatField({ stat: '异常易伤', action: '降低' }), 'anomalyVulnerable')

  // 显式「失衡易伤」/「失衡易伤（全局）」
  assert.equal(resolveStatField({ stat: '失衡易伤', action: '提升' }), 'staggerVulnerable')
  assert.equal(resolveStatField({ stat: '失衡易伤（全局）', action: '提升' }), 'globalStaggerVulnerable')

  // 失衡在作用域里 + 「受到的伤害提升」→ 失衡易伤
  const imbalance = firstEffect('攻击处于失衡状态下的敌人时，受到的伤害提升30%')
  assert.equal(imbalance.effect.slots.stat, '失衡易伤')
  const imbalanceMapped = mapKeywordsToEffect({
    slots: imbalance.effect.slots,
    rawText: '攻击处于失衡状态下的敌人时，受到的伤害提升30%',
  })
  assert.equal(imbalanceMapped.effect.stat, 'staggerVulnerable')
  assert.equal(imbalanceMapped.effect.value, 30)

  // 「失衡期与非失衡期均生效」→ globalStaggerVulnerable（扳机式）
  const globalCase = firstEffect('失衡期与非失衡期均生效：受到的伤害提升35%')
  assert.equal(globalCase.effect.slots.stat, '失衡易伤（全局）')
  const globalMapped = mapKeywordsToEffect({
    slots: globalCase.effect.slots,
    rawText: '失衡期与非失衡期均生效：受到的伤害提升35%',
  })
  assert.equal(globalMapped.effect.stat, 'globalStaggerVulnerable')
})

test('游戏字面 → 工具语义：改写清单逐条对得上（结构性原则）', () => {
  const cases = [
    ['使敌人受到的伤害提升25%', '增伤'],
    ['使敌人受到的伤害降低20%', '增伤'],
    ['攻击处于失衡状态下的敌人时，受到的伤害提升30%', '失衡易伤'],
    ['无视目标20%防御力', '减防'],
    ['目标防御力降低40%', '减防'],
    ['无视敌人15%抗性', '抗性穿透'],
  ]
  for (const [text, expected] of cases) {
    const { effect } = firstEffect(text)
    assert.equal(effect.slots.stat, expected, `${text} → 属性应为 ${expected}`)
  }
  // 清单本身要覆盖用户点名的措辞
  const literals = GAME_LITERAL_REWRITES.map((item) => item.literal).join('；')
  assert.match(literals, /受到的伤害提升/)
  assert.match(literals, /失衡状态下/)
  assert.match(literals, /无视目标 X% 防御力/)
  assert.match(literals, /无视目标 X% 抗性/)
  // 攻击力按局内 / 局外 / 固定拆开
  assert.equal(refineStatKeyword('攻击力', { unit: '点' }), '攻击力（固定）')
  assert.equal(refineStatKeyword('攻击力', { unit: '%' }), '攻击力（局外）')
  assert.equal(refineStatKeyword('攻击力', { unit: '%', text: '局内' }), '攻击力（局内）')
})

test('「改既有机制的上限」没有字段 → 废原文', () => {
  const capped = firstEffect('[以太帷幕·决裁]提供的帷幕易伤加成上限提升至200%')
  assert.equal(capped.effects.length, 0)
  assert.match(capped.waste[0].reason, /改既有机制的上限/)
})

test('废原文带丢弃原因、可去重，且与「无法提取」不是一回事', () => {
  const { effects, waste } = extractKeywordEffects({
    text: '招式发动期间拥有无敌效果；招式发动期间拥有无敌效果；抗打断等级提升。',
    origin: 'test',
  })
  assert.equal(effects.length, 0)
  assert.equal(waste.length, 2, '同一句废原文只记一次')
  for (const item of waste) assert.ok(item.reason, '废原文必须带原因')
})

// ================================================================== 4. 转模（动作=转化）

test('转化（转模）走专用槽位；落库 kind=convert 且 value≡0', () => {
  assert.equal(isConvertClause('每1点攻击力转化为1.5点暴击率（上限60%）'), true)
  const parts = readConvertParts('每1点攻击力转化为1.5点暴击率（上限60%）')
  assert.equal(parts.convertFrom, 'atk')
  assert.equal(parts.convertRatio, 1.5)
  assert.equal(parts.convertCap, 60)

  const { effect } = firstEffect('每1点攻击力转化为1.5点暴击率（上限60%）')
  assert.equal(effect.slots.action, '转化')
  assert.equal(effect.slots.stat, '暴击率')
  assert.equal(effect.slots.value, NONE, '转模条的「数值 / 单位」不适用 → 写「无」')
  assert.equal(effect.convert.convertFrom, 'atk')

  const mapped = mapKeywordsToEffect({
    slots: effect.slots,
    convert: effect.convert,
    id: 'c1',
    origin: 'test',
  })
  assert.equal(mapped.ok, true)
  assert.equal(mapped.effect.kind, 'convert')
  assert.equal(mapped.effect.value, 0, '转模的 value 恒为 0（运行时折算）')
  assert.equal(mapped.effect.stat, 'critRate')
  assert.deepEqual(
    { ...mapped.effect.convert },
    { from: 'atk', panelSource: 'external', ratioPercent: 1.5, cap: 60, defaultBase: null, initialBase: 0 },
  )
  // 转模专用槽位都有下拉取值 / 文案（界面用）
  for (const id of CONVERT_SLOT_IDS) {
    assert.ok(id in SLOT_OPTIONS, `缺少转模槽位选项 ${id}`)
    assert.ok(CONVERT_SLOT_LABELS[id], `缺少转模槽位文案 ${id}`)
    assert.ok(CONVERT_SLOT_HINTS[id], `缺少转模槽位提示 ${id}`)
  }
  // 文案定稿（用户 2026-10-16）
  assert.equal(CONVERT_SLOT_LABELS.convertFrom, '读取属性')
  assert.equal(CONVERT_SLOT_LABELS.convertPanelSource, '取哪一层')
  assert.equal(CONVERT_SLOT_LABELS.convertRatio, '折算比例')
  assert.equal(CONVERT_SLOT_LABELS.convertCap, '上限')
  assert.match(CONVERT_SLOT_HINTS.convertFrom, /折算比例/)
  assert.ok(CONVERT_FROM_OPTIONS.includes('anomalyControl'))
  assert.deepEqual(CONVERT_PANEL_SOURCE_OPTIONS, ['external', 'final', 'manual'])
  // 读取属性下拉顺序：常用属性在前 → 角色等级 / 技能等级（特殊技）→ 其余技能类别垫底
  const levelIndex = CONVERT_FROM_OPTIONS.indexOf('level')
  const specialIndex = CONVERT_FROM_OPTIONS.indexOf('skillLevelSpecial')
  assert.ok(levelIndex > CONVERT_FROM_OPTIONS.indexOf('anomalyControl'))
  assert.ok(specialIndex > levelIndex)
  for (const tail of ['skillLevelBasic', 'skillLevelDodge', 'skillLevelAssist', 'skillLevelChainUltimate']) {
    assert.ok(CONVERT_FROM_OPTIONS.indexOf(tail) > specialIndex, `${tail} 应垫底`)
  }
})

test('「每点 X 使得 Y 提升 Z」也算转模（读取属性 / 目标属性分得开）', () => {
  const parts = readConvertParts('若初始异常掌控大于155点，每点超过的异常掌控会使得该效果的暴击率额外提升0.7%')
  assert.equal(parts.convertFrom, 'anomalyControl')
  assert.match(parts.targetText, /暴击率/)
  const { effect } = firstEffect('每点超过的异常掌控会使得该效果的暴击率额外提升0.7%')
  assert.equal(effect.slots.action, '转化')
  assert.equal(effect.slots.stat, '暴击率')
})

// ================================================================== 5. 招式限定 = 条件

const ANCHORS = [
  { id: 'a-basic', agentId: '1041', categoryId: 'basic', name: '普通攻击' },
  { id: 'a-dash', agentId: '1041', categoryId: 'dodge', name: '冲刺攻击' },
  { id: 'a-enh', agentId: '1041', categoryId: 'special', name: '强化特殊技' },
]

test('招式限定：锚点关联上 → 条件 + skillTargets；关联不上 → 这条不录', () => {
  assert.deepEqual(
    detectSkillLimits('[普通攻击]、[冲刺攻击]造成的伤害提升3%').map((item) => item.name),
    ['普通攻击', '冲刺攻击'],
  )
  // 泛称「招式」不算限定
  assert.deepEqual(detectSkillLimits('招式造成的伤害提升10%'), [])

  const text = '[普通攻击]、[冲刺攻击]造成的伤害提升3%'
  const { effect } = firstEffect(text, { anchors: ANCHORS, agentId: '1041' })
  assert.equal(effect.recorded, true)
  assert.ok(effect.slots.conditions.includes('限定招式：普通攻击 + 冲刺攻击'))
  const mapped = mapKeywordsToEffect({
    slots: effect.slots,
    anchors: effect.anchors,
    id: 'a1',
    origin: 'test',
  })
  assert.equal(mapped.ok, true)
  assert.deepEqual(mapped.effect.skillTargets, [
    { category: 'basic', subcategoryId: 'a-basic' },
    { category: 'dodge', subcategoryId: 'a-dash' },
  ])
  assert.match(mapped.steps.join(' '), /skillTargets/)

  // 技能库里没有这个小类 → 只回落「整大类」，也算关联上
  const categoryOnly = firstEffect('强化特殊技造成的伤害提升3%', { anchors: [], agentId: '1041' })
  assert.equal(categoryOnly.effect.recorded, true)
  assert.deepEqual(categoryOnly.effect.anchors.skillTargets, [
    { category: 'special', subcategoryId: null },
  ])

  // 技能库没加载（anchors=null）→ 不猜 → 这条不录（不新建挂载点、不动 schema）
  const noAnchors = extractKeywordEffects({ text, origin: 'test', anchors: null, agentId: '1041' })
  assert.equal(noAnchors.effects[0].recorded, false)
  assert.match(noAnchors.effects[0].dropReason, /锚点关联不上/)
  const blocked = mapKeywordsToEffect({
    slots: noAnchors.effects[0].slots,
    anchors: noAnchors.effects[0].anchors,
  })
  assert.equal(blocked.ok, false)
  assert.match(blocked.reason, /不录/)
})

test('招式文本的效果进角色增益块（槽位 0），并带技能「描述」落点', () => {
  const result = extractAgentBuffItems({
    detail: {
      name: '测试角色',
      passive: { level: { 1: { level: 1, name: [], desc: [] } } },
      talent: [],
      skill: {
        special: {
          description: [{ name: '强化特殊技：测试', desc: '强化特殊技造成的伤害提升12%。' }],
        },
      },
    },
    nanokaId: 'test',
    anchors: ANCHORS,
  })
  const item = result.items.find((entry) => entry.source === 'skill.special.0')
  assert.ok(item, '招式文本应当产出原文项')
  assert.equal(item.containerIndex, 0, '招式文本 → 角色增益块槽位 0')
  assert.deepEqual(item.landing.container, 'mindscapeBuffs')
  assert.equal(item.landing.index, 0)
  assert.deepEqual(item.skillDesc, {
    agentId: 'test',
    skillName: '强化特殊技：测试',
    category: 'special',
  })
  const effect = item.effects.find((entry) => entry.recorded)
  assert.ok(effect)
  assert.ok(effect.slots.conditions.includes('限定招式：强化特殊技'))
})

test('招式锚点：库里没有同名小类 → **按该技能名建立锚点**（建不出才不录）', () => {
  // 库里只有「普通攻击」，词表里的「冲刺攻击」没有同名小类 → 计划建锚点
  const anchorsOnlyBasic = [{ id: 'a-basic', agentId: '1041', categoryId: 'basic', name: '普通攻击' }]
  const { effects, waste } = extractKeywordEffects({
    text: '[普通攻击]、[冲刺攻击]造成的伤害提升3%',
    origin: 'test',
    anchors: anchorsOnlyBasic,
    agentId: '1041',
  })
  assert.equal(waste.length, 0)
  const effect = effects[0]
  assert.equal(effect.recorded, true, '建得出锚点 → 这条要录')
  assert.deepEqual(effect.anchors.pendingCreates, [
    { name: '冲刺攻击', categoryId: 'dodge', agentId: '1041' },
  ])

  const plan = planAnchorCreations({
    rows: [{ anchors: effect.anchors }],
    subcategories: anchorsOnlyBasic,
  })
  assert.equal(plan.creations.length, 1)
  assert.equal(plan.creations[0].exists, false)
  assert.equal(plan.creations[0].categoryId, 'dodge')
  assert.equal(plan.unresolved.length, 0)

  // 建好后回填：整大类目标 → 具体小类 id
  const patched = applyAnchorPlanToRows({
    rows: [{ anchors: effect.anchors, effect: { skillTargets: effect.anchors.skillTargets } }],
    creations: [{ ...plan.creations[0], id: 'new-dash-id' }],
  })
  assert.deepEqual(patched[0].effect.skillTargets, [
    { category: 'basic', subcategoryId: 'a-basic' },
    { category: 'dodge', subcategoryId: 'new-dash-id' },
  ])

  // 库里已有同名小类 → 不重复建
  const existsPlan = planAnchorCreations({
    rows: [{ anchors: effect.anchors }],
    subcategories: [...anchorsOnlyBasic, { id: 'a-dash', agentId: '1041', categoryId: 'dodge', name: '冲刺攻击' }],
  })
  assert.equal(existsPlan.creations[0].exists, true)
  assert.equal(existsPlan.creations[0].id, 'a-dash')

  // 招式名 / 大类读不出 → 锚点建不出来 → 记进 unresolved（这条不录）
  const broken = planAnchorCreations({
    rows: [{ anchors: { pendingCreates: [{ name: '', categoryId: '' }] } }],
    subcategories: [],
  })
  assert.equal(broken.unresolved.length, 1)
  assert.match(broken.unresolved[0].reason, /不录/)
})

// ================================================================== 6. 入库文本 / 显示规则

test('入库文本：原文 + `[关键字]` 行（多条带序号），v3 不再有"选不选进"的开关', () => {
  const single = formatSourceBlock({
    rawText: '造成的伤害提升10%',
    effects: [
      {
        slots: {
          stat: '增伤',
          action: '提升',
          value: 10,
          unit: '%',
          target: NONE,
          conditions: [NONE],
          stacks: NONE,
          duration: NONE,
          object: NONE,
        },
      },
    ],
  })
  assert.equal(single.split('\n')[0], '原文：造成的伤害提升10%')
  assert.match(single, /\n\[关键字\] 属性=增伤/)

  const many = formatSourceBlock({ rawText: '甲；乙', effects: [{ slots: {} }, { slots: {} }] })
  assert.match(many, /\[关键字 1\]/)
  assert.match(many, /\[关键字 2\]/)
  assert.equal(formatKeywordLine({}, 0, 1).startsWith('[关键字] '), true)
})

test('显示规则：只显示有值的槽位；`无` 默认隐藏；`无法提取` 单列出来（⚠X + 补）', () => {
  const view = slotView({
    stat: '增伤',
    action: '提升',
    value: 10,
    unit: '%',
    target: NONE,
    conditions: [NONE],
    stacks: NONE,
    duration: UNABLE,
    object: NONE,
  })
  assert.deepEqual(view.visible.map((item) => item.id), ['stat', 'action', 'value', 'unit'])
  assert.deepEqual(view.hidden.map((item) => item.id), [
    'elements',
    'target',
    'conditions',
    'stacks',
    'object',
  ])
  assert.deepEqual(view.unable.map((item) => item.id), ['duration'])
  assert.equal(isEmptySlot(NONE), true)
  assert.equal(isEmptySlot(UNABLE), false, '「无法提取」不是"无值"，不能当空槽藏起来')
  assert.equal(isEmptySlot(0), false)

  const expanded = slotView({ stat: '增伤' })
  assert.equal(expanded.visible.length + expanded.hidden.length + expanded.unable.length, SLOT_IDS.length)
})

// ================================================================== 7. 真实夹具（1041 / 1641 / 14164）

function itemsOf(result) {
  return new Map(result.items.map((item) => [item.slot, item]))
}

function recordableEffects(item) {
  return (item?.effects ?? []).filter((effect) => effect.recorded && effect.layerC)
}

test('1041「11号」：关键字 → 增益（招式限定 / 叠层 / 无视抗性 / 废原文）', { skip: SKIP }, () => {
  const detail = readFixture('char', '1041')
  const result = extractAgentBuffItems({ detail, nanokaId: '1041', anchors: [] })
  const items = itemsOf(result)

  // 核心被动：限定 [普通攻击] / [冲刺攻击] → 招式条件 + 锚点（只回落大类）
  const core = recordableEffects(items.get('core'))[0]
  assert.equal(core.slots.stat, '招式增伤')
  assert.equal(core.slots.value, 70)
  assert.ok(core.slots.conditions.includes('限定招式：普通攻击 + 冲刺攻击'))
  assert.equal(core.layerC.stat, 'skillDmgBonus')
  assert.deepEqual(core.layerC.skillTargets, [
    { category: 'basic', subcategoryId: null },
    { category: 'dodge', subcategoryId: null },
  ])

  // 影画 1：能量回复（动作不在表 + 词表无字段）→ 整条废原文
  assert.equal(items.get('talent-1').verdict, 'waste')
  assert.equal(recordableEffects(items.get('talent-1')).length, 0)
  assert.ok(items.get('talent-1').waste.length > 0)
  for (const entry of items.get('talent-1').waste) assert.ok(entry.reason, '废原文必须带原因')

  // 影画 2：叠层 → kind=stacked / 12 层，时长 15 秒只进 note
  const talent2 = recordableEffects(items.get('talent-2'))[0]
  assert.equal(talent2.layerC.kind, 'stacked')
  assert.equal(talent2.layerC.maxStacks, 12)
  assert.equal(talent2.layerC.valuePerStack, 3)
  assert.equal(talent2.slots.duration, '15 秒')
  assert.match(talent2.layerC.note, /15 秒/)

  // 影画 3 / 5：「技能等级+2」在阶段2 词表里没有对应字段 → 阶段1 结束时整条废原文
  for (const slot of ['talent-3', 'talent-5']) {
    assert.equal(items.get(slot).verdict, 'waste', `${slot} 应当是废原文`)
    assert.ok(items.get(slot).waste.some((item) => /没有对应字段/.test(item.reason)))
  }

  // 影画 6：无视目标 25% 抗性 → resPen
  const talent6 = recordableEffects(items.get('talent-6'))[0]
  assert.equal(talent6.slots.stat, '抗性穿透')
  assert.equal(talent6.slots.action, '无视')
  assert.equal(talent6.layerC.stat, 'resPen')
  assert.equal(talent6.layerC.value, 25)

  // 影画 4：抗打断 / 无敌 / 我方减伤 → 整条废原文（不入库）
  assert.equal(items.get('talent-4').verdict, 'waste')
  assert.equal(recordableEffects(items.get('talent-4')).length, 0)
  assert.ok(items.get('talent-4').waste.some((item) => /我方减伤不存在/.test(item.reason)))

  const counts = summarizeItems(result.items)
  assert.ok(counts.buffItems >= 4)
  assert.ok(counts.recordable >= 5)
  assert.ok(counts.wasteClauses > 0)
})

test('1641「菲欧妮」：转模条（异常掌控 → 暴击率）与无视防御', { skip: SKIP }, () => {
  const detail = readFixture('char', '1641')
  const result = extractAgentBuffItems({ detail, nanokaId: '1641', anchors: [] })
  const items = itemsOf(result)
  const coreEffects = recordableEffects(items.get('core'))

  const mastery = coreEffects.find((effect) => effect.layerC.stat === 'mastery')
  assert.equal(mastery.layerC.value, 85)
  assert.equal(mastery.slots.unit, '点')

  const convert = coreEffects.find((effect) => effect.layerC.kind === 'convert')
  assert.ok(convert, '「每点异常掌控使得暴击率提升」应当出转模条')
  assert.equal(convert.slots.action, '转化')
  assert.equal(convert.layerC.stat, 'critRate')
  assert.equal(convert.layerC.value, 0)
  assert.equal(convert.layerC.convert.from, 'anomalyControl')
  assert.equal(convert.layerC.convert.ratioPercent, 0.7)

  const talent6 = recordableEffects(items.get('talent-6'))
  const resPen = talent6.find((effect) => effect.layerC.stat === 'resPen')
  const reduceDefense = talent6.find((effect) => effect.layerC.stat === 'reduceDefense')
  assert.equal(resPen.layerC.value, 15)
  assert.equal(reduceDefense.slots.stat, '减防')
  assert.equal(reduceDefense.slots.action, '无视')
  assert.equal(reduceDefense.layerC.value, 40)
})

test('14164「涅槃初翎」：精炼 1–5 各自成档（精通 90→126 / 增伤 40→56）', { skip: SKIP }, () => {
  const detail = readFixture('weapon', '14164')
  const result = extractWengineBuffItems({ detail, nanokaId: '14164', anchors: [] })
  const items = itemsOf(result)
  const expected = [
    [1, 90, 40],
    [2, 99, 44],
    [3, 108, 48],
    [4, 117, 52],
    [5, 126, 56],
  ]
  for (const [level, masteryValue, dmgValue] of expected) {
    const item = items.get(`refinement-${level}`)
    assert.equal(item.landing.container, 'refinementBuffs')
    assert.equal(item.containerIndex, level - 1, `精炼 ${level} → refinementBuffs[${level - 1}]`)
    const effects = recordableEffects(item)
    const mastery = effects.find((effect) => effect.layerC.stat === 'mastery')
    const dmg = effects.find((effect) => effect.layerC.stat === 'dmgBonus')
    assert.equal(mastery.layerC.value, masteryValue)
    assert.equal(dmg.layerC.value, dmgValue)
    assert.equal(dmg.layerC.elementFilter[0], '火')
    assert.equal(item.skillDesc ?? null, null, '音擎文本没有「技能描述」落点')
  }
})

// ================================================================== 8. 写入计划（假对象，不碰库）

function fakeAgentLocal() {
  return {
    id: 'test-agent',
    name: '测试角色',
    profession: '强攻',
    element: '火',
    supportNeeds: [],
    note: '',
    avatar_image: null,
    basePanel: {},
    mindscapeNotes: ['', '', '', '', '', '', ''],
    mindscapeBuffs: [
      {
        effectBlocks: [
          { id: 'blk-weird', name: '奇怪的块名（手写展示文字）', note: '', effects: [], enabledDefault: true },
        ],
        effects: [],
      },
      ...Array.from({ length: 6 }, () => ({ effectBlocks: [], effects: [] })),
    ],
  }
}

function fakeWengineLocal() {
  return {
    id: 'test-wengine',
    name: '测试音擎',
    profession: '强攻',
    rarity: 'S',
    avatar_image: null,
    note: '',
    baseAtk: 0,
    baseDef: 0,
    advancedStats: {},
    fixedBuffs: { effectBlocks: [], effects: [] },
    refinementBuffs: Array.from({ length: 5 }, () => ({ effectBlocks: [], effects: [] })),
  }
}

function applyRow(overrides = {}) {
  const slots = {
    stat: '增伤',
    elements: [NONE],
    action: '提升',
    value: 30,
    unit: '%',
    target: NONE,
    conditions: [NONE],
    stacks: NONE,
    duration: NONE,
    object: NONE,
    ...overrides.slots,
  }
  return {
    key: overrides.key ?? 'k1',
    slot: overrides.slot ?? 'core',
    slotLabel: overrides.slotLabel ?? '核心被动',
    source: overrides.source ?? 'passive.core',
    containerIndex: overrides.containerIndex ?? 0,
    rawText: overrides.rawText ?? '造成的伤害提升30%',
    keywordSlots: slots,
    convert: null,
    effect: {
      stat: 'dmgBonus',
      kind: 'fixed',
      value: 30,
      applyTarget: 'self',
      applySituation: 'global',
      elementFilter: 'all',
      scope: 'general',
      maxStacks: 1,
      defaultStacks: 1,
      enabledDefault: true,
      note: '造成的伤害提升30%',
      ...overrides.effect,
    },
    skillDesc: overrides.skillDesc,
  }
}

test('planBuffApply：按**槽位下标**复用已有块（不看块名），没有块才新建', () => {
  const local = fakeAgentLocal()
  const plan = planBuffApply({
    kind: 'agent',
    local,
    rows: [
      applyRow(),
      applyRow({
        key: 'k2',
        slot: 'passive.extra',
        source: 'passive.extra',
        containerIndex: 0,
        effect: { stat: 'critRate', value: 15 },
        rawText: '暴击率提升15%',
      }),
      applyRow({
        key: 'k3',
        slot: 'talent-3',
        slotLabel: '影画 3',
        source: 'talent.3',
        containerIndex: 3,
        effect: { stat: 'atk', value: 100 },
        rawText: '攻击力提升100点',
      }),
    ],
  })

  const slot0 = plan.groups.find((group) => group.containerIndex === 0)
  assert.equal(slot0.blockName, '奇怪的块名（手写展示文字）', '复用该槽位已有的块，不管块名叫什么')
  assert.equal(slot0.blockIsNew, false)
  assert.equal(slot0.added, 2, '槽位 0 的两条都追加进同一块')
  assert.deepEqual(slot0.blocks[0].effects.map((effect) => effect.stat), ['dmgBonus', 'critRate'])

  const slot3 = plan.groups.find((group) => group.containerIndex === 3)
  assert.equal(slot3.blockIsNew, true)
  assert.equal(slot3.blockName, '3 影')
  assert.deepEqual(slot3.blocks[0].effects.map((effect) => effect.stat), ['atk'])

  assert.equal(plan.updated, 3)
  assert.equal(plan.skipped, 0)
  // 每条增益都标出「写入：<块位> · 新增/替换」
  for (const group of plan.groups) {
    for (const effect of group.effects) {
      assert.match(effect.writeLabel, /^写入：mindscapeBuffs\[\d\]/)
      assert.match(effect.writeLabel, /新增/)
    }
  }
  // 原文 + `[关键字]` 行进块 note（追加不覆盖）
  assert.match(slot0.blocks[0].note, /原文：造成的伤害提升30%/)
  assert.match(slot0.blocks[0].note, /\[关键字\]/)
})

test('planBuffApply：原文本地已有则不重复追加；重复效果按判重签名跳过', () => {
  const local = fakeAgentLocal()
  const row = applyRow()
  const block = formatSourceBlock({
    rawText: row.rawText,
    effects: [{ slots: row.keywordSlots, convert: row.convert }],
  })
  local.mindscapeBuffs[0].effectBlocks[0].note = block
  local.mindscapeBuffs[0].effectBlocks[0].effects = [
    {
      id: 'old',
      stat: 'dmgBonus',
      kind: 'fixed',
      applyTarget: 'self',
      applySituation: 'global',
      maxStacks: 1,
      value: 30,
      defaultStacks: 1,
      elementFilter: 'all',
    },
  ]
  const plan = planBuffApply({ kind: 'agent', local, rows: [row] })
  assert.equal(plan.updated, 0)
  assert.equal(plan.skipped, 1)
  assert.equal(plan.groups[0].blocks[0].effects.length, 1)
  assert.match(plan.groups[0].effects[0].writeLabel, /已存在（重复，跳过）/)
  assert.equal(plan.groups[0].note.duplicate, true)
  assert.equal(
    plan.groups[0].blocks[0].note.split('原文：造成的伤害提升30%').length - 1,
    1,
    '同一段原文不重复追加',
  )
})

test('planBuffApply：音擎写 refinementBuffs[j-1] / fixedBuffs；原文追加不覆盖', () => {
  const wengine = fakeWengineLocal()
  const plan = planBuffApply({
    kind: 'wengine',
    local: wengine,
    rows: [
      applyRow({
        key: 'r3',
        slot: 'refinement-3',
        slotLabel: '精炼 3',
        source: 'weapons.talents.3',
        containerIndex: 2,
        effect: { stat: 'mastery', value: 108 },
        rawText: '装备者的异常精通提升108点',
      }),
      applyRow({
        key: 'fx',
        slot: 'fixed',
        slotLabel: '基础效果',
        source: 'fixed',
        containerIndex: null,
        effect: { stat: 'atk', value: 20 },
        rawText: '攻击力提升20点',
      }),
    ],
  })
  const refinement = plan.groups.find((group) => group.container === 'refinementBuffs')
  assert.equal(refinement.containerIndex, 2)
  assert.equal(refinement.label, 'refinementBuffs[2]（精炼 3）')
  assert.equal(refinement.blockIsNew, true)
  assert.equal(refinement.blockName, '精炼 3')
  const fixed = plan.groups.find((group) => group.container === 'fixedBuffs')
  assert.equal(fixed.ok, true)
  assert.equal(fixed.added, 1)

  const first = appendSourceText('', '原文：甲')
  assert.equal(first.appended, true)
  const again = appendSourceText(first.note, '原文：甲')
  assert.equal(again.appended, false)
  assert.equal(again.duplicate, true)
})

test('planBuffApply：招式文本的「描述」只写既有招式行；没有这条招式 → 不改描述（不新建挂载点）', () => {
  const local = fakeAgentLocal()
  const skills = [{ id: 'sk-1', agentId: 'test-agent', name: '强化特殊技：测试', note: '' }]
  const plan = planBuffApply({
    kind: 'agent',
    local,
    skills,
    rows: [
      applyRow({
        key: 's1',
        slot: 'skill-special-0',
        slotLabel: '招式文本（特殊技）',
        source: 'skill.special.0',
        containerIndex: 0,
        effect: { stat: 'skillDmgBonus', value: 12 },
        slots: { stat: '招式增伤', action: '提升', value: 12, unit: '%', conditions: ['限定招式：强化特殊技'] },
        rawText: '强化特殊技造成的伤害提升12%',
        skillDesc: { agentId: 'test-agent', skillName: '强化特殊技：测试', category: 'special' },
      }),
      applyRow({
        key: 's2',
        slot: 'skill-basic-0',
        slotLabel: '招式文本（普通攻击）',
        source: 'skill.basic.0',
        containerIndex: 0,
        effect: { stat: 'dmgBonus', value: 5 },
        rawText: '普通攻击造成的伤害提升5%',
        skillDesc: { agentId: 'test-agent', skillName: '不存在的招式', category: 'basic' },
      }),
    ],
  })
  const appended = plan.skills.find((item) => item.skillId === 'sk-1')
  assert.equal(appended.appended, true)
  assert.match(appended.note, /原文：强化特殊技造成的伤害提升12%/)
  assert.match(appended.note, /\[关键字\] 属性=招式增伤/)
  const missing = plan.skills.find((item) => item.skillName === '不存在的招式')
  assert.equal(missing.appended, false)
  assert.match(missing.reason, /不新建挂载点/)

  // 招式行匹配口径：先精确名，再「名字·分段」
  assert.equal(
    matchSkillDescTargets([{ id: 'a', agentId: 'x', name: '普通攻击：火力镇压' }], {
      agentId: 'x',
      skillName: '普通攻击：火力镇压',
    }).length,
    1,
  )
  assert.equal(
    matchSkillDescTargets([{ id: 'a', agentId: 'x', name: '普通攻击：火力镇压·一段' }], {
      agentId: 'x',
      skillName: '普通攻击：火力镇压',
    }).length,
    1,
  )
  assert.equal(
    matchSkillDescTargets([{ id: 'a', agentId: 'y', name: '普通攻击：火力镇压' }], {
      agentId: 'x',
      skillName: '普通攻击：火力镇压',
    }).length,
    0,
  )
})

test('resolveSlotTarget：只按下标，越界就拒绝（不看块名）', () => {
  assert.equal(resolveSlotTarget({ kind: 'agent', source: 'talent.2', containerIndex: 2 }).index, 2)
  assert.equal(resolveSlotTarget({ kind: 'agent', source: 'talent.9', containerIndex: 9 }).ok, false)
  assert.equal(
    resolveSlotTarget({ kind: 'wengine', source: 'weapons.talents.5', containerIndex: 4 }).index,
    4,
  )
  assert.equal(
    resolveSlotTarget({ kind: 'wengine', source: 'weapons.talents.6', containerIndex: 5 }).ok,
    false,
  )
  assert.equal(
    resolveSlotTarget({ kind: 'wengine', source: 'fixed', containerIndex: null }).container,
    'fixedBuffs',
  )
})

// ================================================================== 9. 阶段二智能覆盖

function mergeRow(overrides = {}) {
  return {
    key: overrides.key ?? 'k1',
    effect: {
      stat: 'dmgBonus',
      kind: 'fixed',
      value: 10,
      applyTarget: 'self',
      note: '我的备注',
      ...overrides.effect,
    },
    dirty: overrides.dirty ?? {},
  }
}

test('smartMergeParse：只回填未手改字段；手填值 ≠ 新解析值 → 冲突（绝不静默覆盖）', () => {
  const rows = [
    mergeRow({ key: 'k1', effect: { stat: 'dmgBonus', value: 99 }, dirty: { value: true } }),
    mergeRow({ key: 'k2', effect: { stat: 'dmgBonus', value: 1 } }),
    mergeRow({ key: 'k4' }),
  ]
  const keywords = [
    keyword({ id: 'k1', slots: { value: 30 } }),
    keyword({ id: 'k2', slots: { value: 30 } }),
    keyword({ id: 'k3', slots: { stat: '暴击率', value: 15 } }),
  ]
  const result = smartMergeParse({ rows, keywords })

  const k1 = result.rows.find((row) => row.key === 'k1')
  assert.equal(k1.effect.value, 99, '手改过的字段解析不覆盖')
  assert.equal(k1.effect.stat, 'dmgBonus')
  assert.deepEqual(
    k1.conflicts.map((conflict) => [conflict.field, conflict.mine, conflict.theirs]),
    [['value', 99, 30]],
  )

  const k2 = result.rows.find((row) => row.key === 'k2')
  assert.equal(k2.effect.value, 30, '没手改过的字段被解析回填')
  assert.deepEqual(k2.conflicts, [])

  const k3 = result.rows.find((row) => row.key === 'k3')
  assert.equal(k3.added, true, '关键字新增效果 → 追加新行')
  assert.equal(k3.effect.stat, 'critRate')

  const k4 = result.rows.find((row) => row.key === 'k4')
  assert.equal(k4.stale, true, '关键字里已无此条 → 旧增益行保留并标注')
  assert.equal(k4.staleLabel, '关键字里已无此条')

  assert.equal(result.added, 1)
  assert.equal(result.stale, 1)
  assert.equal(result.conflicts.length, 1)
  // 关键字 ↔ 增益一对一：行数 = 旧行 + 新增行
  assert.equal(result.rows.length, 4)

  // 冲突裁决：保留我的 / 用新解析
  const keepMine = resolveRowConflicts({ row: k1, choices: { value: 'mine' } })
  assert.equal(keepMine.effect.value, 99)
  assert.equal(keepMine.conflicts.length, 1)
  const useTheirs = resolveRowConflicts({ row: k1, choices: { value: 'theirs' } })
  assert.equal(useTheirs.effect.value, 30)
  assert.equal(useTheirs.conflicts.length, 0)
})

test('smartMergeParse：关键字标了「无法提取」→ 保留旧行并给阻断原因（不覆盖）', () => {
  const rows = [mergeRow({ key: 'k1', effect: { value: 10 } })]
  const keywords = [keyword({ id: 'k1', slots: { value: UNABLE } })]
  const result = smartMergeParse({ rows, keywords })
  assert.equal(result.blocked, 1)
  assert.equal(result.rows[0].blocked, true)
  assert.match(result.rows[0].blockReason, /无法提取/)
  assert.equal(result.rows[0].effect.value, 10, '阻断时旧值原样保留')
})

test('smartMergeParse：转模条回填 kind=convert（value 归零）', () => {
  const rows = [mergeRow({ key: 'c1', effect: { stat: 'critRate', value: 5 } })]
  const keywords = [
    keyword({
      id: 'c1',
      slots: { stat: '暴击率', action: '转化', value: NONE, unit: NONE },
      convert: {
        convertFrom: 'anomalyControl',
        convertPanelSource: 'external',
        convertRatio: 0.7,
        convertBase: null,
        convertCap: null,
      },
    }),
  ]
  const result = smartMergeParse({ rows, keywords })
  const row = result.rows.find((item) => item.key === 'c1')
  assert.equal(row.effect.kind, 'convert')
  assert.equal(row.effect.value, 0)
  assert.equal(row.effect.convert.from, 'anomalyControl')
  assert.equal(row.effect.convert.ratioPercent, 0.7)
  assert.ok(MERGE_FIELD_LIST.some((field) => field.id === 'convert'))
})

// ================================================================== 10. 效果整理 / 参数校验 / 接线

test('sanitizeEffect：只留 schema 字段；转模 value 恒 0；非法值抛中文错误', () => {
  const effect = sanitizeEffect({
    stat: 'dmgBonus',
    kind: 'fixed',
    value: 30,
    applyTarget: 'team',
    statLabel: '增伤',
    writeLabel: '写入：xxx',
    displayOnly: true,
  })
  assert.equal(effect.applyTarget, 'team')
  assert.ok(!('statLabel' in effect))
  assert.ok(!('writeLabel' in effect))
  assert.ok(!('displayOnly' in effect))

  const convert = sanitizeEffect({
    stat: 'critRate',
    kind: 'convert',
    value: 99,
    convert: { from: 'anomalyControl', panelSource: 'external', ratioPercent: 0.7 },
  })
  assert.equal(convert.value, 0)
  assert.equal(convert.convert.from, 'anomalyControl')

  assert.throws(() => sanitizeEffect({ stat: 'not-a-stat' }), /不是合法增益字段/)
  assert.throws(
    () => sanitizeEffect({ stat: 'critRate', kind: 'convert', convert: { from: 'nope' } }),
    /读取属性|来源属性/,
  )
})

test('extractBuffItems / applyBuffItems：参数不对时在碰库之前就抛中文错误', async () => {
  await assert.rejects(() => extractBuffItems({ kind: 'nope', detail: {} }), /未知的增益来源类型/)
  await assert.rejects(() => extractBuffItems({ kind: 'agent', detail: null }), /缺少 nanoka 详情 JSON/)
  await assert.rejects(() => applyBuffItems({ kind: 'agent', id: '', rows: [] }), /缺少本地角色 id/)
  await assert.rejects(() => applyBuffItems({ kind: 'wengine', id: '  ' }), /缺少本地音擎 id/)
})

test('增益接口接线：/extract /simplify /parse /apply 的首个中间件都是 requireAdmin', () => {
  const routes = [
    ['post', '/extract'],
    ['post', '/simplify'],
    ['post', '/parse'],
    ['post', '/apply'],
  ]
  for (const [method, path] of routes) {
    const layer = nanokaBuffRoutes.stack.find(
      (entry) => entry.route && entry.route.path === path && Boolean(entry.route.methods[method]),
    )
    assert.ok(layer, `缺少路由 ${method.toUpperCase()} ${path}`)
    const handlers = layer.route.stack.map((item) => item.handle)
    assert.equal(handlers[0], requireAdmin, `${method.toUpperCase()} ${path} 首个中间件应为 requireAdmin`)
    assert.ok(handlers.length >= 2, `${method.toUpperCase()} ${path} 缺少控制器`)
  }
})

test('化简的公开入口与 buildItem 同源（只重跑阶段1）', () => {
  const simplified = simplifyText({ text: '造成的伤害提升10%', origin: 'test' })
  assert.equal(simplified.effects.length, 1)
  assert.equal(simplified.effects[0].layerC.stat, 'dmgBonus')
  assert.deepEqual(simplified.waste, [])
})

