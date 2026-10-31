import assert from 'node:assert/strict'
import {
  damageAnalysisFixture,
  disposeStatsDomHarness,
  mountStatsPanel,
  testStorage,
} from './_skillFlowStatsDomHarness.mjs'
import { buildSkillFlowDamageAnalysis } from '../src/utils/skillFlowDamageAnalysis.ts'
import {
  captureSkillFlowDamageSnapshot,
  compareSkillFlowDamageRecords,
  normalizeSkillFlowDamageSnapshot,
} from '../src/utils/skillFlowDamageRecordComparison.ts'
import { skillFlowDamageSegmentHasChanges } from '../src/utils/skillFlowDamageRecordSegments.ts'
import { buildSkillFlowDamageAnalysisFromSnapshot } from '../src/utils/skillFlowDamageRecordAnalysis.ts'
import {
  skillFlowDamageCrossRows,
  skillFlowDamageSlices,
  skillFlowSkillContributions,
} from '../src/utils/skillFlowDamageAnalysis.ts'
import {
  exportSkillFlowDamageRecords,
  loadSkillFlowDamageRecords,
  appendSkillFlowDamageRecords,
  parseSkillFlowDamageRecordExport,
  normalizeSkillFlowDamageRecordName,
  saveSkillFlowDamageRecords,
  skillFlowDamageRecordLabel,
  SKILL_FLOW_DAMAGE_RECORD_KEY,
} from '../src/utils/skillFlowDamageRecords.ts'

let passed = 0
function check(name, action) {
  action()
  passed += 1
  console.log(`PASS ${name}`)
}
const fixture = damageAnalysisFixture()
const analysis = buildSkillFlowDamageAnalysis({ ...fixture, slotCount: 2 })
const changed = buildSkillFlowDamageAnalysis({
  ...fixture,
  slotCount: 2,
  hitDamages: { ...fixture.hitDamages, t2: 80 },
})
function record(id, source = analysis) {
  return {
    id,
    savedAt: id === 'before' ? 1000 : 2000,
    team: source.total,
    current: source.slots[1]?.total ?? 0,
    agentName: '角色乙',
    schemeName: id,
    agentNames: ['角色甲', '角色乙'],
    snapshot: captureSkillFlowDamageSnapshot(source, ['a', 'b']),
  }
}
const before = record('before')
const after = record('after', changed)
const cancelled = record(
  'cancelled',
  buildSkillFlowDamageAnalysis({
    ...fixture,
    slotCount: 2,
    hitDamages: { ...fixture.hitDamages, a1: 14, a2: 16 },
  }),
)
const countChanged = structuredClone(before)
countChanged.id = 'count-changed'
countChanged.schemeName = '次数调整'
countChanged.savedAt = 3000
countChanged.snapshot.lines.find(
  (line) => line.skillId === 'turb' && line.staggerPhase === 'stagger',
).count = 8
const legacy = {
  id: 'legacy',
  savedAt: 1,
  team: 150,
  current: 50,
  agentName: '旧角色',
  schemeName: '旧记录',
  agentNames: ['旧角色'],
}
const storage = testStorage()

try {
  check('快照只复制标量，之后修改当前伤害、招式名或角色数组不改变旧记录', () => {
    const ids = ['a', 'b']
    const snapshot = captureSkillFlowDamageSnapshot(analysis, ids)
    ids[0] = 'new'
    analysis.lines[0].total = 999
    const oldName = analysis.lines[0].hit.skill.name
    analysis.lines[0].hit.skill.name = '新名字'
    assert.equal(snapshot.agentIds[0], 'a')
    assert.equal(snapshot.lines[0].total, 10)
    assert.equal(snapshot.lines[0].skillName, oldName)
    analysis.lines[0].total = 10
    analysis.lines[0].hit.skill.name = oldName
  })
  check('全队、角色、类型与招式差值对得上，正负占比变化使用各自全队分母', () => {
    const result = compareSkillFlowDamageRecords(before, after)
    assert.equal(result.total.delta, 40)
    assert.equal(result.total.changeRatio, 0.2)
    for (const dimension of ['agent', 'type', 'skill'])
      assert.equal(
        result[dimension].reduce((sum, row) => sum + row.delta, 0),
        40,
      )
    assert.equal(result.agent.find((row) => row.id === 'a').delta, 40)
    assert.equal(result.type.find((row) => row.id === 'turbulence').delta, 40)
    const turbulence = result.skill.find((row) => row.name.includes('乱流'))
    assert.equal(turbulence.baseline, 70)
    assert.equal(turbulence.comparison, 110)
    assert.equal(turbulence.shareDelta, 110 / 240 - 70 / 200)
  })
  check('平均和总伤均不变时，仍保留相互抵消的两段单次涨跌', () => {
    const result = compareSkillFlowDamageRecords(before, cancelled)
    const row = result.skill.find((item) => item.id === JSON.stringify(['a', 'direct']))
    assert.equal(result.total.delta, 0)
    assert.equal(row.delta, 0)
    assert.equal(row.skill.averageDamage.delta, 0)
    assert.deepEqual(
      row.skill.segments.map((segment) => segment.damage.delta),
      [4, -2],
    )
    assert.ok(row.skill.segments.every(skillFlowDamageSegmentHasChanges))
  })
  check('流程重排仍按唯一解析段配对，不按序号制造伤害差异', () => {
    const reordered = structuredClone(before)
    reordered.snapshot.lines.reverse()
    reordered.snapshot.lines.forEach((line) => {
      line.context.flowEntryIndex += 3
    })
    const result = compareSkillFlowDamageRecords(before, reordered)
    const segments = result.skill.flatMap((row) => row.skill.segments)
    assert.equal(segments.length, 5)
    assert.ok(segments.every((segment) => segment.baseline && segment.comparison))
    assert.ok(segments.every((segment) => !skillFlowDamageSegmentHasChanges(segment)))
  })
  check('同一段状态和增益改变仍可对照，序号不参与条件变化判断', () => {
    const changedContext = structuredClone(before)
    changedContext.snapshot.lines[0].staggerPhase = 'stagger'
    changedContext.snapshot.lines[0].context.buffOverride.disabledEffectIds = ['effect']
    const segment = compareSkillFlowDamageRecords(before, changedContext).skill.find(
      (row) => row.id === JSON.stringify(['a', 'direct']),
    ).skill.segments[0]
    assert.equal(segment.damage.delta, 0)
    assert.equal(segment.conditionsChanged, true)
    assert.ok(skillFlowDamageSegmentHasChanges(segment))
  })
  check('上下文冻结增益覆盖，保存读回后仍与当前对象隔离', () => {
    const source = buildSkillFlowDamageAnalysis({ ...fixture, slotCount: 2 })
    source.lines[0].hit.buffOverride = {
      disabledBlockIds: ['block'],
      disabledEffectIds: ['effect'],
      stacksByEffectId: { stack: 2 },
      convertInputsByEffectId: { conversion: 3 },
    }
    try {
      const captured = captureSkillFlowDamageSnapshot(source, ['a', 'b'])
      source.lines[0].hit.buffOverride.disabledEffectIds.push('later')
      source.lines[0].hit.buffOverride.stacksByEffectId.stack = 5
      assert.deepEqual(captured.lines[0].context.buffOverride.disabledEffectIds, ['effect'])
      assert.equal(captured.lines[0].context.buffOverride.stacksByEffectId.stack, 2)
      saveSkillFlowDamageRecords([{ ...before, snapshot: captured }])
      const loaded = loadSkillFlowDamageRecords()[0].snapshot.lines[0].context
      assert.deepEqual(loaded, captured.lines[0].context)
      assert.equal(loaded.flowEntryId, 'a1')
      assert.equal(loaded.flowEntryIndex, 0)
    } finally {
      delete source.lines[0].hit.buffOverride
    }
  })
  check('旧快照和损坏上下文保留原始数值，不猜配逐段涨跌', () => {
    const old = structuredClone(before)
    old.snapshot.lines.forEach((line) => {
      delete line.context
    })
    const result = compareSkillFlowDamageRecords(old, after)
    const segments = result.skill.flatMap((row) => row.skill.segments)
    assert.equal(segments.length, 10)
    assert.ok(segments.every((segment) => !segment.baseline || !segment.comparison))
    assert.ok(segments.every((segment) => segment.damage.delta === null))
    assert.equal(
      result.skill.find((row) => row.name.includes('乱流')).skill.averageDamage.delta,
      110 / 7 - 10,
    )
    const corrupt = structuredClone(before.snapshot)
    corrupt.lines[0].context.flowEntryIndex = -1
    const loaded = normalizeSkillFlowDamageSnapshot(corrupt, before.team)
    assert.equal(loaded.lines[0].context, undefined)
    assert.equal(loaded.lines[0].total, 10)
    assert.ok(loaded.lines[1].context)
  })
  check('同名同状态但身份不同或重复时保留两侧，避免按数值硬配', () => {
    const unrelated = structuredClone(before)
    unrelated.snapshot.lines[0].context.hitId = 'different'
    const segments = compareSkillFlowDamageRecords(before, unrelated).skill.find(
      (row) => row.id === JSON.stringify(['a', 'direct']),
    ).skill.segments
    assert.equal(segments.length, 3)
    assert.equal(segments.filter((segment) => !segment.baseline || !segment.comparison).length, 2)
    const duplicates = structuredClone(before)
    duplicates.snapshot.lines.push(structuredClone(duplicates.snapshot.lines[0]))
    duplicates.team += 10
    const duplicateSegments = compareSkillFlowDamageRecords(duplicates, before).skill.find(
      (row) => row.id === JSON.stringify(['a', 'direct']),
    ).skill.segments
    assert.equal(
      duplicateSegments.filter((segment) => segment.baseline && segment.comparison).length,
      1,
    )
    assert.equal(
      duplicateSegments.filter((segment) => !segment.baseline || !segment.comparison).length,
      3,
    )
  })
  check('无效暴击模式与非有限增益覆盖只丢弃上下文，合法伤害仍可读', () => {
    for (const mutate of [
      (context) => {
        context.critMode = ['expected']
      },
      (context) => {
        context.buffOverride.stacksByEffectId.stack = Infinity
      },
      (context) => {
        context.buffOverride.disabledEffectIds = [5]
      },
    ]) {
      const snapshot = structuredClone(before.snapshot)
      mutate(snapshot.lines[0].context)
      const loaded = normalizeSkillFlowDamageSnapshot(snapshot, before.team)
      assert.ok(loaded)
      assert.equal(loaded.lines[0].context, undefined)
      assert.equal(loaded.lines[0].total, 10)
    }
  })
  check('技能组内相同招式的不同成员分别对齐，不按整组或招式名合并', () => {
    const grouped = structuredClone(before)
    grouped.snapshot.lines
      .filter((line) => line.slotIndex === 0 && line.skillId === 'direct')
      .forEach((line, index) => {
        line.context.flowEntryId = 'group'
        line.context.hitId = `group#${index}:direct`
        line.context.flowEntryIndex = 0
      })
    const reordered = structuredClone(grouped)
    reordered.snapshot.lines.reverse()
    const segments = compareSkillFlowDamageRecords(grouped, reordered).skill.find(
      (row) => row.id === JSON.stringify(['a', 'direct']),
    ).skill.segments
    assert.equal(segments.length, 2)
    assert.ok(segments.every((segment) => segment.baseline && segment.comparison))
    assert.ok(segments.every((segment) => !skillFlowDamageSegmentHasChanges(segment)))
  })
  check('单次伤害按累计次数加权，不对不同状态的单次简单平均', () => {
    const result = compareSkillFlowDamageRecords(before, after)
    const metrics = result.skill.find((row) => row.name.includes('乱流')).skill
    assert.deepEqual(metrics.count, { baseline: 7, comparison: 7, delta: 0, changeRatio: 0 })
    assert.equal(metrics.averageDamage.baseline, 10)
    assert.equal(metrics.averageDamage.comparison, 110 / 7)
    assert.ok(Math.abs(metrics.averageDamage.delta - 40 / 7) < 1e-12)
    assert.ok(Math.abs(metrics.averageDamage.changeRatio - 4 / 7) < 1e-12)
    assert.notEqual(metrics.averageDamage.comparison, (10 + 20) / 2)
    assert.deepEqual(result.skillSummary, {
      kinds: { baseline: 3, comparison: 3, delta: 0, changeRatio: 0 },
      uses: { baseline: 15, comparison: 15, delta: 0, changeRatio: 0 },
      added: 0,
      removed: 0,
    })
  })
  check('总伤相同而次数变化时仍标记变化，单次和次数分别比较', () => {
    const result = compareSkillFlowDamageRecords(before, countChanged)
    const row = result.skill.find((item) => item.name.includes('乱流'))
    assert.equal(result.total.delta, 0)
    assert.equal(row.delta, 0)
    assert.equal(row.state, 'changed')
    assert.deepEqual(row.skill.count, {
      baseline: 7,
      comparison: 11,
      delta: 4,
      changeRatio: 4 / 7,
    })
    assert.equal(row.skill.averageDamage.comparison, 70 / 11)
    assert.equal(result.skillSummary.uses.delta, 4)
  })
  check('拆段与小数次数只累计一次，同身份只计一种招式', () => {
    const fractional = structuredClone(before)
    fractional.team = 20
    fractional.snapshot.lines = [
      { ...before.snapshot.lines[0], count: 0.25, total: 5 },
      { ...before.snapshot.lines[0], staggerPhase: 'stagger', count: 0.75, total: 15 },
    ]
    const doubled = structuredClone(fractional)
    doubled.team = 40
    doubled.snapshot.lines.forEach((line) => {
      line.count *= 2
      line.total *= 2
    })
    const result = compareSkillFlowDamageRecords(fractional, doubled)
    assert.ok(normalizeSkillFlowDamageSnapshot(fractional.snapshot, fractional.team))
    assert.equal(result.skill.length, 1)
    assert.equal(result.skillSummary.kinds.baseline, 1)
    assert.equal(result.skillSummary.uses.baseline, 1)
    assert.equal(result.skillSummary.uses.comparison, 2)
    assert.equal(result.skill[0].skill.averageDamage.baseline, 20)
    assert.equal(result.skill[0].skill.averageDamage.delta, 0)
  })
  check('角色换槽按 id 对齐，不会被误判成伤害转移', () => {
    const swapped = structuredClone(before)
    swapped.agentNames.reverse()
    swapped.snapshot.agentIds.reverse()
    swapped.snapshot.lines.forEach((line) => {
      line.slotIndex = 1 - line.slotIndex
    })
    const result = compareSkillFlowDamageRecords(before, swapped)
    assert.equal(result.agent.length, 2)
    assert.ok(result.agent.every((row) => row.delta === 0))
    assert.ok(result.skill.every((row) => row.delta === 0 && row.state === 'same'))
    assert.equal(result.skillSummary.added, 0)
    assert.equal(result.skillSummary.removed, 0)
    assert.equal(result.skillSummary.uses.delta, 0)
  })
  check('招式改名仍匹配原 id，不按相同名称误合并', () => {
    const renamed = structuredClone(before)
    renamed.snapshot.lines
      .filter((line) => line.skillId === 'turb')
      .forEach((line) => {
        line.skillName = '改名后的乱流'
      })
    const result = compareSkillFlowDamageRecords(before, renamed)
    assert.equal(result.skill.length, 3)
    assert.ok(result.skill.every((row) => row.delta === 0))
    assert.ok(result.skill.some((row) => row.name.includes('改名后的乱流')))
    assert.equal(result.skillSummary.kinds.delta, 0)
    assert.equal(result.skillSummary.added, 0)
    assert.equal(result.skillSummary.removed, 0)
  })
  check('新增和移除招式正确显示，基准为 0 不生成无限增长率', () => {
    const added = structuredClone(before)
    added.team += 50
    added.snapshot.lines.push({ ...added.snapshot.lines[0], skillId: 'another', total: 50 })
    const row = compareSkillFlowDamageRecords(before, added).skill.find(
      (item) => item.state === 'added',
    )
    assert.equal(row.delta, 50)
    assert.equal(row.changeRatio, null)
    assert.deepEqual(row.skill.count, { baseline: 0, comparison: 1, delta: 1, changeRatio: null })
    assert.deepEqual(row.skill.averageDamage, {
      baseline: null,
      comparison: 50,
      delta: null,
      changeRatio: null,
    })
    assert.equal(
      compareSkillFlowDamageRecords(added, before).skill.find((item) => item.state === 'removed')
        .changeRatio,
      -1,
    )
    const reverse = compareSkillFlowDamageRecords(added, before)
    const removed = reverse.skill.find((item) => item.state === 'removed')
    assert.equal(removed.skill.averageDamage.baseline, 50)
    assert.equal(removed.skill.averageDamage.comparison, null)
    assert.equal(removed.skill.averageDamage.delta, null)
    assert.equal(reverse.skillSummary.kinds.delta, -1)
    assert.equal(reverse.skillSummary.removed, 1)
    assert.equal(reverse.skillSummary.uses.delta, -1)
  })
  check('种类总数相同也单独汇总新增与移除，不按同名合并', () => {
    const replaced = structuredClone(before)
    replaced.snapshot.lines
      .filter((line) => line.skillId === 'turb')
      .forEach((line) => {
        line.skillId = 'replacement'
      })
    const result = compareSkillFlowDamageRecords(before, replaced)
    assert.equal(result.skillSummary.kinds.delta, 0)
    assert.equal(result.skillSummary.added, 1)
    assert.equal(result.skillSummary.removed, 1)
    assert.equal(result.skillSummary.uses.delta, 0)
    assert.equal(result.skill.length, 4)
  })
  check('零次数与零伤害含义不同，不用 0 或无限值伪造单次伤害', () => {
    const zeroCount = structuredClone(before)
    zeroCount.team = 0
    zeroCount.snapshot.lines = [{ ...before.snapshot.lines[0], count: 0, total: 0 }]
    const positive = structuredClone(zeroCount)
    positive.team = 30
    positive.snapshot.lines[0].count = 2
    positive.snapshot.lines[0].total = 30
    const absentAverage = compareSkillFlowDamageRecords(zeroCount, positive).skill[0].skill
    assert.equal(absentAverage.averageDamage.baseline, null)
    assert.equal(absentAverage.averageDamage.comparison, 15)
    assert.equal(absentAverage.averageDamage.delta, null)
    const zeroCountSegment = compareSkillFlowDamageRecords(zeroCount, positive).skill[0].skill
      .segments[0]
    assert.equal(zeroCountSegment.damage.baseline, null)
    assert.equal(zeroCountSegment.damage.comparison, 15)
    assert.equal(zeroCountSegment.damage.delta, null)
    assert.equal(absentAverage.count.changeRatio, null)
    const zeroDamage = structuredClone(zeroCount)
    zeroDamage.snapshot.lines[0].count = 2
    const validAverage = compareSkillFlowDamageRecords(zeroDamage, positive).skill[0].skill
    assert.equal(validAverage.averageDamage.baseline, 0)
    assert.equal(validAverage.averageDamage.delta, 15)
    assert.equal(validAverage.averageDamage.changeRatio, null)
    assert.equal(
      compareSkillFlowDamageRecords(zeroCount, zeroCount).skill[0].skill.averageDamage.delta,
      null,
    )
  })
  check('空快照的种类与次数为 0，新增完整队伍时数量守恒', () => {
    const emptyRecord = {
      team: 0,
      agentNames: [],
      snapshot: { version: 1, agentIds: [], lines: [], uncomputedCount: 0 },
    }
    const emptyResult = compareSkillFlowDamageRecords(emptyRecord, emptyRecord)
    assert.equal(emptyResult.skillSummary.kinds.baseline, 0)
    assert.equal(emptyResult.skillSummary.uses.comparison, 0)
    const result = compareSkillFlowDamageRecords(emptyRecord, before)
    assert.equal(result.skillSummary.added, 3)
    assert.equal(result.skillSummary.kinds.delta, 3)
    assert.equal(result.skillSummary.uses.delta, 15)
  })
  check('旧记录只比较总伤，不从当前配置补造结构', () => {
    const result = compareSkillFlowDamageRecords(legacy, after)
    assert.equal(result.hasDetails, false)
    assert.equal(result.total.delta, 90)
    assert.deepEqual(result.skill, [])
    assert.deepEqual(result.agent, [])
    assert.equal(result.skillSummary, null)
  })
  check('空快照、损坏字段、未知版本与总伤不一致分别正确处理', () => {
    assert.ok(
      normalizeSkillFlowDamageSnapshot(
        { version: 1, agentIds: [], lines: [], uncomputedCount: 0 },
        0,
      ),
    )
    const mutations = [
      (s) => {
        s.version = 2
      },
      (s) => {
        s.lines[0].slotIndex = 9
      },
      (s) => {
        s.lines[0].total = -1
      },
      (s) => {
        s.lines[0].count = NaN
      },
      (s) => {
        s.lines[0].damageType = 'unknown'
      },
      (s) => {
        s.lines[0].staggerPhase = 'unknown'
      },
      (s) => {
        s.lines[0].total += 1
      },
      (s) => {
        s.uncomputedCount = -1
      },
    ]
    for (const mutate of mutations) {
      const snapshot = structuredClone(before.snapshot)
      mutate(snapshot)
      assert.equal(normalizeSkillFlowDamageSnapshot(snapshot, before.team), undefined)
    }
  })
  check('新旧记录混存、刷新后明细完整，坏快照保留总伤', () => {
    storage.setItem(
      SKILL_FLOW_DAMAGE_RECORD_KEY,
      JSON.stringify([legacy, before, { ...after, snapshot: { version: 2 } }]),
    )
    const loaded = loadSkillFlowDamageRecords()
    assert.equal(loaded.length, 3)
    assert.equal(loaded[0].snapshot, undefined)
    assert.equal(loaded[1].snapshot.lines.length, 5)
    assert.equal(loaded[2].team, 240)
    assert.equal(loaded[2].snapshot, undefined)
    assert.equal(saveSkillFlowDamageRecords([legacy, before, after]), true)
    assert.equal(loadSkillFlowDamageRecords()[2].snapshot.lines[3].total, 80)
  })
  check('条数不设上限，12 条原样存取；坏 JSON 有稳定空态', () => {
    saveSkillFlowDamageRecords(
      Array.from({ length: 12 }, (_, index) => ({ ...legacy, id: `record-${index}` })),
    )
    assert.equal(loadSkillFlowDamageRecords().length, 12)
    storage.setItem(SKILL_FLOW_DAMAGE_RECORD_KEY, 'bad json')
    assert.deepEqual(loadSkillFlowDamageRecords(), [])
  })
  check('记录名称：压缩空白、空名视为未命名、最长 40 字，展示名优先自定义名称', () => {
    assert.equal(normalizeSkillFlowDamageRecordName('  爆发前  '), '爆发前')
    assert.equal(normalizeSkillFlowDamageRecordName('第一行\n第二行'), '第一行 第二行')
    assert.equal(normalizeSkillFlowDamageRecordName('   '), undefined)
    assert.equal(normalizeSkillFlowDamageRecordName(123), undefined)
    assert.equal(normalizeSkillFlowDamageRecordName('.'.repeat(60)).length, 40)
    assert.equal(skillFlowDamageRecordLabel({ name: '爆发前', schemeName: '方案A' }), '爆发前')
    assert.equal(skillFlowDamageRecordLabel({ name: '', schemeName: '方案A' }), '方案A')
    assert.equal(skillFlowDamageRecordLabel({ schemeName: '方案A' }), '方案A')
  })
  check('载入时规范化脏名称，不会把空白名带进列表', () => {
    saveSkillFlowDamageRecords([
      { ...before, id: 'named', name: '  爆发前  ' },
      { ...before, id: 'blank', name: '   ' },
    ])
    const loaded = loadSkillFlowDamageRecords()
    assert.equal(loaded[0].name, '爆发前')
    assert.equal(loaded[1].name, undefined)
  })
  check('槽位配置按影画/音擎/驱动盘分项保存，兼容旧整串文本', () => {
    saveSkillFlowDamageRecords([
      {
        ...before,
        id: 'meta-structured',
        slotMeta: [{ rank: 2, wengine: '音擎A', wengineRefine: 5, disc: '4件套 X' }],
      },
      { ...before, id: 'meta-legacy', slotMeta: ['影画 0影 · 音擎 B'] },
      { ...before, id: 'meta-empty', slotMeta: [] },
    ])
    const loaded = loadSkillFlowDamageRecords()
    assert.deepEqual(loaded[0].slotMeta, [
      { rank: 2, wengine: '音擎A', wengineRefine: 5, disc: '4件套 X' },
    ])
    assert.deepEqual(loaded[1].slotMeta, [{ text: '影画 0影 · 音擎 B' }])
    assert.equal(loaded[2].slotMeta, undefined)
  })
  check('槽位配置分开存 4 件套与 2 件套驱动盘', () => {
    saveSkillFlowDamageRecords([
      {
        ...before,
        id: 'meta-disc',
        slotMeta: [{ rank: 1, disc4: '谵羽之哲', disc2: '折枝剑歌' }],
      },
    ])
    assert.deepEqual(loadSkillFlowDamageRecords()[0].slotMeta, [
      { rank: 1, disc4: '谵羽之哲', disc2: '折枝剑歌' },
    ])
  })
  check('记录快照能还原成同一套流程伤害分析，总和与记录总伤一致', () => {
    const rebuilt = buildSkillFlowDamageAnalysisFromSnapshot(before.snapshot)
    assert.equal(rebuilt.lines.length, before.snapshot.lines.length)
    assert.equal(rebuilt.slots.length, 2)
    assert.ok(Math.abs(rebuilt.total - before.team) < 1e-6, `${rebuilt.total} vs ${before.team}`)
    const firstLine = rebuilt.lines[0]
    assert.equal(firstLine.hit.skill.name, before.snapshot.lines[0].skillName)
    assert.equal(firstLine.hit.count, before.snapshot.lines[0].count)
    assert.equal(firstLine.perHit, before.snapshot.lines[0].total / before.snapshot.lines[0].count)
    // 逐段统计与实时一致：类型分片、交叉表、招式贡献都能算出非空结果
    assert.ok(skillFlowDamageSlices(rebuilt.lines, 'type').length > 0)
    assert.ok(skillFlowDamageCrossRows(rebuilt.lines).length > 0)
    assert.ok(skillFlowSkillContributions(rebuilt, null).length > 0)
    assert.equal(buildSkillFlowDamageAnalysisFromSnapshot(undefined).total, 0)
    assert.deepEqual(buildSkillFlowDamageAnalysisFromSnapshot(null).slots, [])
  })
  check('快照还原的异常段保留提供者与触发者，直伤段不带', () => {
    const rebuilt = buildSkillFlowDamageAnalysisFromSnapshot(before.snapshot)
    for (const line of rebuilt.lines) {
      const source = before.snapshot.lines.find(
        (item) => item.context?.hitId === line.hit.id,
      )
      assert.ok(source, line.hit.id)
      if (line.hit.damageKind === 'anomaly') {
        assert.equal(line.hit.anomalyPowerAgentId, source.context.anomalyPowerAgentId)
        assert.equal(line.hit.triggerAgentId, source.context.triggerAgentId)
      } else {
        assert.equal(line.hit.anomalyPowerAgentId, null)
      }
    }
  })

  check('导出成 JSON 再导入：记录、名称、槽位配置与快照都还原', () => {
    const named = { ...before, name: '爆发前', slotMeta: [{ rank: 2, disc4: '谵羽之哲' }] }
    const text = exportSkillFlowDamageRecords([named, after])
    const parsed = parseSkillFlowDamageRecordExport(text)
    assert.ok(parsed, '应能解析自己导出的文件')
    assert.equal(parsed.dropped, 0)
    assert.equal(parsed.records.length, 2)
    assert.equal(parsed.records[0].name, '爆发前')
    assert.deepEqual(parsed.records[0].slotMeta, [{ rank: 2, disc4: '谵羽之哲' }])
    assert.equal(parsed.records[0].snapshot.lines.length, named.snapshot.lines.length)
    assert.equal(parsed.records[1].team, after.team)
  })
  check('导入也接受裸数组，坏条目逐条丢弃而不是整体失败', () => {
    const raw = JSON.parse(exportSkillFlowDamageRecords([before]))
    const bare = parseSkillFlowDamageRecordExport(
      JSON.stringify([...raw.records, { id: '' }, { nonsense: true }]),
    )
    assert.equal(bare.records.length, 1)
    assert.equal(bare.dropped, 2)
  })
  check('不是本页格式的文件导入失败，不会清空现有记录', () => {
    assert.equal(parseSkillFlowDamageRecordExport('bad json'), null)
    assert.equal(parseSkillFlowDamageRecordExport('{"foo":1}'), null)
    assert.equal(parseSkillFlowDamageRecordExport('[1,2,3]').records.length, 0)
  })
  check('导入整份追加：不去重、不设条数上限', () => {
    const same = appendSkillFlowDamageRecords([before], [before, after])
    assert.equal(same.length, 3)
    assert.deepEqual(
      same.map((record) => record.id),
      ['before', 'before', 'after'],
    )
    const many = Array.from({ length: 30 }, (_, index) => ({ ...before, id: `many-${index}` }))
    assert.equal(appendSkillFlowDamageRecords(many, [{ ...before, id: 'extra' }]).length, 31)
  })

  saveSkillFlowDamageRecords([legacy, before, after])
  const mounted = await mountStatsPanel(fixture)
  try {
    check('组件默认最近两条记录，显示真实总伤变化', () => {
      assert.equal(mounted.one('[aria-label="基准伤害记录"]').value, 'before')
      assert.equal(mounted.one('[aria-label="对照伤害记录"]').value, 'after')
      assert.ok(mounted.one('.sf-record-total').textContent.includes('+40'))
      assert.ok(mounted.one('.sf-record-total').textContent.includes('+20.00%'))
      assert.ok(mounted.one('.sf-rec-chart-wrap').textContent.includes('仅总伤'))
      assert.equal(mounted.one('[aria-label="招式数量差异"]'), null)
    })
    check('记录列表第 0 行固定为当前流程，其后才是已保存记录', () => {
      const allRows = mounted.all('.sf-rec-row')
      assert.equal(allRows.length, 4)
      assert.ok(allRows[0].className.includes('is-current'), allRows[0].className)
      assert.equal(allRows[0].querySelector('.sf-rec-num').textContent.trim(), '0')
      assert.ok(allRows[0].textContent.includes('当前'))
      // 记录 0 没有改名/删除，也不可拖动
      assert.equal(allRows[0].querySelector('.mini-btn'), null)
      assert.equal(allRows[0].getAttribute('draggable'), 'false')
      assert.equal(mounted.all('.sf-rec-row[data-saved="true"]').length, 3)
    })
    check('记录改为横向柱状图，按角色分色，旧记录单色', () => {
      const rows = mounted.all('.sf-rec-row[data-saved="true"]')
      assert.equal(rows.length, 3)
      const afterRow = rows.find((row) => row.textContent.includes('after'))
      const beforeRow = rows.find((row) => row.textContent.includes('before'))
      const legacyRow = rows.find((row) => row.textContent.includes('旧记录'))
      assert.ok(afterRow && beforeRow && legacyRow)
      const afterSegs = afterRow.querySelectorAll('.sf-rec-seg')
      const beforeSegs = beforeRow.querySelectorAll('.sf-rec-seg')
      assert.equal(afterSegs.length, 2)
      assert.equal(beforeSegs.length, 2)
      assert.notEqual(afterSegs[0].style.background, afterSegs[1].style.background)
      assert.ok(afterRow.querySelector('.sf-rec-bar'))
      const legacySegs = legacyRow.querySelectorAll('.sf-rec-seg')
      assert.equal(legacySegs.length, 1)
      assert.ok(legacyRow.textContent.includes('仅总伤'))
      assert.ok(mounted.all('.sf-rec-legend-item').length >= 3)
      const width = (seg) => Number.parseFloat(seg.style.width)
      assert.ok(width(afterSegs[0]) > width(beforeSegs[0]))
    })
    const barFilterChips = () => mounted.all('[aria-label="柱状图角色筛选"] button')
    check('柱状图可按角色筛选，默认全队', () => {
      assert.deepEqual(
        barFilterChips().map((el) => el.textContent.trim()),
        ['全队', '角色甲', '角色乙'],
      )
      assert.equal(barFilterChips()[0].getAttribute('aria-pressed'), 'true')
      assert.equal(mounted.all('.sf-rec-seg.is-muted').length, 0)
    })
    barFilterChips()[1].click()
    await mounted.settle()
    const savedRow = (name) =>
      mounted
        .all('.sf-rec-row[data-saved="true"]')
        .find((row) => row.textContent.includes(name))
    check('只勾一个角色时，其余角色的分段与图例置灰、长度不变', () => {
      const muted = mounted.all('.sf-rec-seg.is-muted')
      assert.ok(muted.length > 0, '应有置灰分段')
      assert.ok(muted.every((el) => el.style.width !== ''), '置灰段仍带原宽度')
      assert.equal(mounted.all('.sf-rec-legend-item.is-muted').length, 1)
      assert.equal(barFilterChips()[1].getAttribute('aria-pressed'), 'true')
      assert.equal(barFilterChips()[0].getAttribute('aria-pressed'), 'false')
    })
    check('选了角色后，合计与较参考差值都只算该角色', () => {
      const row = savedRow('after')
      const total = row.querySelector('.sf-rec-total').textContent.replace(/\s/g, '')
      assert.ok(total.includes('140'), total)
      assert.ok(row.querySelector('.sf-rec-total-scope'), '应标出「所选」')
      assert.ok(row.querySelector('.sf-rec-delta').textContent.includes('+40.00%'))
    })
    barFilterChips()[1].click()
    barFilterChips()[2].click()
    await mounted.settle()
    check('换成另一名角色，差值只为该角色计算', () => {
      const row = savedRow('after')
      const total = row.querySelector('.sf-rec-total').textContent.replace(/\s/g, '')
      assert.ok(total.includes('100'), total)
      assert.equal(row.querySelector('.sf-rec-delta').textContent.trim(), '+0.00%')
    })
    barFilterChips()[0].click()
    await mounted.settle()
    check('点全队清除置灰', () => {
      assert.equal(mounted.all('.sf-rec-seg.is-muted').length, 0)
      assert.equal(mounted.all('.sf-rec-legend-item.is-muted').length, 0)
      assert.equal(barFilterChips()[0].getAttribute('aria-pressed'), 'true')
    })

    const afterRowForTip = mounted.all('.sf-rec-row[data-saved="true"]').find((row) => row.textContent.includes('after'))
    const afterSegForTip = afterRowForTip.querySelector('.sf-rec-seg')
    afterSegForTip.dispatchEvent(new Event('mouseenter'))
    await mounted.settle()
    const segmentTipText = document.querySelector('.stat-value-tip')?.textContent ?? ''
    afterSegForTip.dispatchEvent(new Event('mouseleave'))
    // 边缘移动会延迟隐藏（160ms 防频闪），等计时器走完再断言
    await new Promise((resolve) => setTimeout(resolve, 220))
    await mounted.settle()
    const segmentTipGone = document.querySelector('.stat-value-tip') === null
    const refSelect = mounted.one('[aria-label="伤害记录对比参考"]')
    refSelect.value = 'before'
    refSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await mounted.settle()
    check('分段悬停出角色明细，参考记录带标识且差值改按参考算', () => {
      assert.ok(segmentTipText.includes('角色甲'), segmentTipText)
      assert.equal(segmentTipGone, true)
      assert.equal(mounted.all('.sf-rec-row.is-ref').length, 1)
      const legacyRow = mounted.all('.sf-rec-row[data-saved="true"]').find((row) => row.textContent.includes('旧记录'))
      assert.ok(legacyRow.textContent.includes('-25.00%'), legacyRow.textContent)
    })
    await mounted.clickText('[aria-label="记录对比维度"] button', '伤害类型')
    check('切换到类型对比，乱流增量可见', () => {
      assert.ok(mounted.one('.sf-record-diff-table').textContent.includes('乱流'))
      assert.ok(mounted.one('.sf-record-diff-table').textContent.includes('+40'))
    })
    await mounted.clickText('[aria-label="记录对比维度"] button', '招式')
    check('招式默认单次视图，带角色身份且直接展示变化段', () => {
      assert.equal(
        mounted.one('[aria-label="招式对比内容"] [aria-pressed="true"]').textContent.trim(),
        '单次伤害',
      )
      assert.ok(mounted.one('.sf-record-single-heading').textContent.includes('角色甲 · 乱流'))
      assert.equal(mounted.all('.sf-record-segment-table tbody tr').length, 1)
      assert.ok(mounted.one('.sf-record-segment-table').textContent.includes('流程第 4 项'))
    })
    check('平均单次独立汇总，逐段使用基准、对照、差值和变化率五列', () => {
      const text = mounted.one('.sf-record-single-average').textContent.replace(/\s/g, '')
      assert.ok(text.includes('10→15.71'))
      assert.ok(text.includes('+5.71（+57.14%）'))
      assert.equal(mounted.all('.sf-record-segment-table thead th').length, 5)
      const row = mounted.one('.sf-record-segment-table tbody tr')
      assert.deepEqual(
        [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim()),
        ['10', '20', '+10', '+100.00%'],
      )
      assert.equal(mounted.one('.sf-record-diff-table'), null)
      assert.equal(mounted.one('[aria-label="招式数量差异"]'), null)
      // 2026-10-26：平均单次的口径说明收进问号浮层，正文不再常显；断言改为该说明仍在（挂在问号上）
      assert.ok(
        mounted.one('[aria-label="伤害记录结构对比"] [aria-label="平均单次说明"]'),
        '平均单次说明应以问号形式保留',
      )
    })
    await mounted.clickText('[aria-label="招式对比内容"] button', '使用次数')
    check('次数视图独立显示完整数量摘要，不混入单次与累计伤害', () => {
      const summary = mounted.one('[aria-label="招式数量差异"]').textContent.replace(/\s/g, '')
      assert.match(summary, /3→30种新增0种·移除0种/)
      assert.match(summary, /15→150次/)
      assert.equal(mounted.one('.sf-record-single-average'), null)
      assert.equal(mounted.one('.sf-record-segment-table'), null)
      assert.equal(mounted.one('.sf-record-diff-table'), null)
    })
    await mounted.clickText('[aria-label="招式对比内容"] button', '累计贡献')
    check('累计贡献视图保留总伤和占比，排除次数与单次列', () => {
      const table = mounted.one('.sf-record-diff-table')
      assert.ok(table.textContent.includes('110'))
      assert.ok(table.textContent.includes('占全队变化'))
      assert.equal(table.querySelectorAll('thead th').length, 6)
      assert.equal(mounted.one('.sf-record-single-average'), null)
      assert.equal(mounted.one('[aria-label="招式数量差异"]'), null)
    })
    const baselineSelect = mounted.one('[aria-label="基准伤害记录"]')
    baselineSelect.value = 'legacy'
    baselineSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await mounted.settle()
    check('选旧记录只显示总伤和缺少明细说明', () => {
      assert.ok(mounted.one('.sf-record-legacy').textContent.includes('仅保存总伤'))
      assert.equal(mounted.one('.sf-record-diff-table'), null)
      assert.ok(mounted.one('.sf-record-total').textContent.includes('+90'))
      assert.equal(mounted.one('[aria-label="招式数量差异"]'), null)
    })
    await mounted.clickLabel('筛选伤害类型：乱流')
    await mounted.clickText('.sf-stats-lift-actions button', '记录')
    check('筛选后记录仍保存完整全队，不保存筛选子集', () => {
      const saved = loadSkillFlowDamageRecords().at(-1)
      assert.equal(saved.team, 200)
      assert.equal(saved.current, 100)
      assert.equal(saved.agentName, '角色乙')
      assert.equal(
        saved.snapshot.lines.reduce((sum, line) => sum + line.total, 0),
        200,
      )
      assert.equal(saved.snapshot.lines.length, 5)
      assert.equal(mounted.one('[aria-label="对照伤害记录"]').value, saved.id)
    })
    const lastRow = mounted.all('.sf-rec-row').at(-1)
    lastRow.querySelector('[aria-label^="删除第"]').click()
    await mounted.settle()
    check('删除选中的记录后自动修正对比选择，旧记录仍保留', () => {
      assert.equal(mounted.one('[aria-label="对照伤害记录"]').value, 'after')
      assert.equal(loadSkillFlowDamageRecords().length, 3)
      assert.equal(loadSkillFlowDamageRecords()[0].id, 'legacy')
    })
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem() {
          throw new Error('quota')
        },
      },
    })
    try {
      await mounted.clickText('.sf-stats-lift-actions button', '记录')
      check('存储失败明确提示，不宣称刷新可恢复', () => {
        assert.ok(mounted.one('[role="alert"]').textContent.includes('未能保存'))
        assert.equal(storage.getItem(SKILL_FLOW_DAMAGE_RECORD_KEY) != null, true)
        assert.equal(saveSkillFlowDamageRecords([before]), false)
      })
    } finally {
      Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
  } finally {
    mounted.unmount()
  }

  saveSkillFlowDamageRecords([before, cancelled])
  const cancelling = await mountStatsPanel(fixture)
  try {
    await cancelling.clickText('[aria-label="记录对比维度"] button', '招式')
    check('均值不变的反向涨跌在默认单次视图全部直接可见', () => {
      assert.equal(cancelling.all('.sf-record-single-skill').length, 1)
      assert.equal(cancelling.all('.sf-record-segment-table tbody tr').length, 2)
      const mean = cancelling.one('.sf-record-single-average').textContent.replace(/\s/g, '')
      assert.ok(mean.includes('10→10'))
      const table = cancelling.one('.sf-record-segment-table')
      assert.ok(table.textContent.includes('+4'))
      assert.ok(table.textContent.includes('−2'))
      assert.equal(table.querySelectorAll('[aria-expanded="false"]').length, 0)
    })
    await cancelling.clickText('[aria-label="招式对比内容"] button', '使用次数')
    check('段内涨跌抵消且次数未变时，次数视图没有伪变化', () => {
      assert.equal(cancelling.one('.sf-record-diff-table'), null)
      assert.equal(cancelling.one('.sf-record-segment-table'), null)
    })
    await cancelling.clickText('[aria-label="招式对比内容"] button', '累计贡献')
    check('累计贡献不会将纯逐段变化混入相同总伤', () =>
      assert.equal(cancelling.one('.sf-record-diff-table'), null),
    )
  } finally {
    cancelling.unmount()
  }

  const oldDetails = structuredClone(before)
  oldDetails.snapshot.lines.forEach((line) => {
    delete line.context
  })
  saveSkillFlowDamageRecords([oldDetails, after])
  const oldSegments = await mountStatsPanel(fixture)
  try {
    await oldSegments.clickText('[aria-label="记录对比维度"] button', '招式')
    check('旧明细展示全部两侧单次值并明确未匹配，不按数组伪造涨跌', () => {
      assert.equal(oldSegments.all('.sf-record-segment-table tbody tr').length, 10)
      assert.ok(oldSegments.one('.sf-record-unmatched-hint').textContent.includes('10 段未匹配'))
      assert.equal(oldSegments.all('.sf-record-unmatched').length, 10)
      for (const row of oldSegments.all('.sf-record-segment-table tbody tr')) {
        const cells = [...row.querySelectorAll('td')]
        assert.equal(cells[2].textContent.trim(), '—')
        assert.equal(cells[3].textContent.trim(), '—')
      }
      assert.ok(
        oldSegments
          .all('.sf-record-single-average')
          .some((element) => element.textContent.replace(/\s/g, '').includes('10→15.71')),
      )
    })
  } finally {
    oldSegments.unmount()
  }

  const moreUses = record(
    'more-uses',
    buildSkillFlowDamageAnalysis({
      ...fixture,
      slotCount: 2,
      hits: fixture.hits.map((hit) =>
        hit.skill.id === 'turb' ? { ...hit, count: hit.count * 2 } : hit,
      ),
      hitDamages: { ...fixture.hitDamages, t1: 60, t2: 80 },
    }),
  )
  saveSkillFlowDamageRecords([before, moreUses])
  const countOnly = await mountStatsPanel(fixture)
  try {
    await countOnly.clickText('[aria-label="记录对比维度"] button', '招式')
    check('仅次数增加而单次不变时，单次视图明确没有变化', () => {
      assert.equal(countOnly.one('.sf-record-single-skill'), null)
      assert.ok(
        countOnly.one('[aria-label="伤害记录结构对比"]').textContent.includes('单次伤害没有变化'),
      )
    })
    await countOnly.clickText('[aria-label="招式对比内容"] button', '使用次数')
    check('仅次数增加的招式在次数视图保留准确前后值', () => {
      const cells = [...countOnly.one('.sf-record-diff-table tbody tr').querySelectorAll('td')]
      assert.deepEqual(
        cells.map((cell) => cell.textContent.trim()),
        ['7', '14', '+7', '+100.00%'],
      )
    })
    await countOnly.clickText('[aria-label="招式对比内容"] button', '累计贡献')
    check('数量增加带来的累计伤害在贡献视图正常显示', () =>
      assert.ok(countOnly.one('.sf-record-diff-table').textContent.includes('140')),
    )
  } finally {
    countOnly.unmount()
  }

  const changedWeights = record(
    'changed-weights',
    buildSkillFlowDamageAnalysis({
      ...fixture,
      slotCount: 2,
      hits: fixture.hits.map((hit) => (hit.id === 't1' ? { ...hit, count: 6 } : hit)),
      hitDamages: { ...fixture.hitDamages, t1: 60, t2: 80 },
    }),
  )
  saveSkillFlowDamageRecords([after, changedWeights])
  const weights = await mountStatsPanel(fixture)
  try {
    await weights.clickText('[aria-label="记录对比维度"] button', '招式')
    check('各段单次未变但次数权重改变时，仍展示平均变化并解释来源', () => {
      assert.equal(weights.all('.sf-record-single-skill').length, 1)
      assert.ok(weights.one('.sf-record-single-average').textContent.includes('−1.71'))
      assert.equal(weights.one('.sf-record-segment-table'), null)
      assert.ok(
        weights.one('.sf-record-single-skill').textContent.includes('平均值变化来自使用次数构成'),
      )
    })
  } finally {
    weights.unmount()
  }

  saveSkillFlowDamageRecords([before, countChanged])
  const counts = await mountStatsPanel(fixture)
  try {
    await counts.clickText('[aria-label="记录对比维度"] button', '招式')
    check('只看变化不会隐藏总伤相同但次数不同的招式', () => {
      assert.equal(counts.all('.sf-record-single-skill').length, 1)
      assert.ok(counts.one('.sf-record-single-heading').textContent.includes('角色甲 · 乱流'))
      assert.ok(counts.one('.sf-record-single-average').textContent.includes('−3.64'))
      assert.equal(counts.one('[aria-label="招式数量差异"]'), null)
    })
    await counts.clickText('[aria-label="招式对比内容"] button', '使用次数')
    const fullSummary = counts.one('[aria-label="招式数量差异"]').textContent
    check('次数表单独显示使用增减，仍使用完整快照摘要', () => {
      assert.equal(counts.all('.sf-record-diff-table tbody tr').length, 1)
      assert.ok(counts.one('.sf-record-diff-table tbody tr').textContent.includes('+4'))
      assert.equal(counts.all('.sf-record-diff-table thead th').length, 5)
      assert.match(fullSummary.replace(/\s/g, ''), /15→19\+4次/)
    })
    const checkbox = counts.one('.sf-record-toolbar input')
    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
    await counts.settle()
    check('取消只看变化不改变完整数量摘要', () => {
      assert.equal(counts.all('.sf-record-diff-table tbody tr').length, 3)
      assert.equal(counts.one('[aria-label="招式数量差异"]').textContent, fullSummary)
    })
    await counts.clickText('[aria-label="记录对比维度"] button', '伤害类型')
    check('非招式维度保留原伤害列，次数摘要随视图分离', () => {
      assert.equal(counts.one('[aria-label="招式数量差异"]'), null)
      assert.equal(counts.one('.sf-record-single-average'), null)
      assert.equal(counts.all('.sf-record-diff-table thead th').length, 6)
    })
  } finally {
    counts.unmount()
  }

  const fractionalBefore = structuredClone(before)
  fractionalBefore.id = 'fractional-before'
  fractionalBefore.snapshot.lines = [{ ...before.snapshot.lines[0], count: 0.25, total: 10 }]
  fractionalBefore.team = 10
  const fractionalAfter = structuredClone(fractionalBefore)
  fractionalAfter.id = 'fractional-after'
  fractionalAfter.snapshot.lines[0].count = 0.5
  saveSkillFlowDamageRecords([fractionalBefore, fractionalAfter])
  const fractional = await mountStatsPanel(fixture)
  try {
    await fractional.clickText('[aria-label="记录对比维度"] button', '招式')
    await fractional.clickText('[aria-label="招式对比内容"] button', '使用次数')
    check('界面保留小数次数和差值，不四舍五入为整数', () => {
      const cells = [...fractional.one('.sf-record-diff-table tbody tr').querySelectorAll('td')]
      assert.deepEqual(
        cells.map((cell) => cell.textContent.trim()),
        ['0.25', '0.5', '+0.25', '+100.00%'],
      )
      assert.match(
        fractional.one('[aria-label="招式数量差异"]').textContent.replace(/\s/g, ''),
        /0.25→0.5\+0.25次/,
      )
    })
  } finally {
    fractional.unmount()
  }

  const added = structuredClone(before)
  added.id = 'added'
  added.team += 50
  added.snapshot.lines.push({ ...before.snapshot.lines[0], skillId: 'added', total: 50 })
  saveSkillFlowDamageRecords([before, added])
  const addition = await mountStatsPanel(fixture)
  try {
    await addition.clickText('[aria-label="记录对比维度"] button', '招式')
    check('新增招式显示数量差异，缺失的单次以横线呈现并说明不可比较', () => {
      const row = addition.one('.sf-record-single-skill')
      const text = row.querySelector('.sf-record-single-average').textContent.replace(/\s/g, '')
      assert.ok(text.includes('—→50'))
      assert.ok(text.includes('单次变化无法比较'))
      assert.ok(!row.textContent.includes('Infinity'))
      assert.ok(row.textContent.includes('对照未匹配'))
    })
    await addition.clickText('[aria-label="招式对比内容"] button', '使用次数')
    check('新增招式的数量变动在次数视图明确显示', () => {
      assert.ok(addition.one('.sf-record-diff-table').textContent.includes('新增'))
      assert.match(
        addition.one('[aria-label="招式数量差异"]').textContent.replace(/\s/g, ''),
        /3→4\+1种新增1种·移除0种/,
      )
    })
  } finally {
    addition.unmount()
  }

  saveSkillFlowDamageRecords([before, after])
  const renaming = await mountStatsPanel(fixture)
  try {
    check('未命名时列表用方案名，每条都有改名入口', () => {
      assert.equal(renaming.all('.sf-rec-row[data-saved="true"]').length, 2)
      assert.equal(renaming.all('.sf-rec-row[data-saved="true"] .sf-rec-clip')[0].textContent, 'before')
      assert.equal(renaming.all('[aria-label^="重命名第"]').length, 2)
    })
    await renaming.clickLabel('重命名第1条伤害记录')
    const renameInput = renaming.one('.sf-rec-rename-input')
    check('点击改名进入编辑，输入框预填当前名称', () => {
      assert.ok(renameInput, '编辑框未出现')
      assert.equal(renameInput.value, 'before')
    })
    renameInput.value = '  爆发前  '
    renameInput.dispatchEvent(new Event('input', { bubbles: true }))
    renameInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await renaming.settle()
    check('回车提交后列表显示新名称，并写回浏览器存储', () => {
      assert.equal(renaming.all('.sf-rec-row[data-saved="true"] .sf-rec-clip')[0].textContent, '爆发前')
      assert.equal(renaming.one('.sf-rec-rename-input'), null)
      assert.equal(loadSkillFlowDamageRecords()[0].name, '爆发前')
    })
    await renaming.clickLabel('重命名第2条伤害记录')
    const cancelInput = renaming.one('.sf-rec-rename-input')
    cancelInput.value = '临时名字'
    cancelInput.dispatchEvent(new Event('input', { bubbles: true }))
    cancelInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await renaming.settle()
    check('Esc 取消改名，名称与存储都不变', () => {
      assert.equal(renaming.all('.sf-rec-row[data-saved="true"] .sf-rec-clip')[1].textContent, 'after')
      assert.equal(loadSkillFlowDamageRecords()[1].name, undefined)
    })
    await renaming.clickLabel('重命名第1条伤害记录')
    const clearInput = renaming.one('.sf-rec-rename-input')
    clearInput.value = '   '
    clearInput.dispatchEvent(new Event('input', { bubbles: true }))
    clearInput.dispatchEvent(new Event('blur'))
    await renaming.settle()
    check('清空名称并失焦后回落到方案名', () => {
      assert.equal(renaming.all('.sf-rec-row[data-saved="true"] .sf-rec-clip')[0].textContent, 'before')
      assert.equal(loadSkillFlowDamageRecords()[0].name, undefined)
    })
    await renaming.clickLabel('重命名第1条伤害记录')
    const syncInput = renaming.one('.sf-rec-rename-input')
    syncInput.value = '爆发前'
    syncInput.dispatchEvent(new Event('input', { bubbles: true }))
    syncInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await renaming.settle()
    check('自定义名称同步到对比下拉，并保留方案名以便溯源', () => {
      const options = renaming.all('[aria-label="基准伤害记录"] option')
      // 下拉第一项固定是「当前流程」，重命名后的记录紧随其后
      assert.ok(options[0].textContent.includes('当前流程'), options[0].textContent)
      const renamed = options.find((option) => option.textContent.includes('爆发前'))
      assert.ok(renamed, options.map((option) => option.textContent).join('|'))
      assert.ok(renamed.textContent.includes('（before）'), renamed.textContent)
    })
    await renaming.clickLabel('重命名第2条伤害记录')
    const pendingInput = renaming.one('.sf-rec-rename-input')
    pendingInput.value = '第二行草稿'
    pendingInput.dispatchEvent(new Event('input', { bubbles: true }))
    await renaming.clickLabel('重命名第1条伤害记录')
    check('切换改名行时先落库上一行输入，不静默丢失', () => {
      assert.equal(loadSkillFlowDamageRecords()[1].name, '第二行草稿')
      assert.equal(renaming.one('.sf-rec-rename-input').value, '爆发前')
    })
  } finally {
    renaming.unmount()
  }

  const withMeta = {
    ...before,
    id: 'meta-disc-record',
    schemeName: '双盘记录',
    slotMeta: [
      { rank: 3, wengine: '音擎甲', wengineRefine: 2, disc4: '谵羽之哲', disc2: '折枝剑歌' },
      {},
    ],
  }
  saveSkillFlowDamageRecords([withMeta, { ...withMeta, id: 'meta-disc-second', schemeName: '对照记录' }])
  const metaView = await mountStatsPanel(fixture)
  try {
    const metaRow = metaView.all('.sf-rec-row[data-saved="true"]')[0]
    const metaSeg = metaRow.querySelector('.sf-rec-seg')
    metaSeg.dispatchEvent(new Event('mouseenter'))
    await metaView.settle()
    const metaTip = document.querySelector('.stat-value-tip')
    const metaLabels = [...metaTip.querySelectorAll('.sf-rec-meta-tag')].map((el) =>
      el.textContent.trim(),
    )
    check('悬停浮层：影画跟在角色名后，装备按顶栏小卡分块', () => {
      // 影画不再是独立块，而是跟在金色角色名后
      assert.equal(metaTip.querySelector('.sf-rec-tip-name').textContent.trim(), '角色甲')
      assert.equal(metaTip.querySelector('.sf-rec-tip-rank').textContent.trim(), '3影')
      assert.deepEqual(metaLabels, ['音擎', '4件套', '2件套'])
      assert.ok(metaTip.textContent.includes('精2'), metaTip.textContent)
      assert.ok(metaTip.textContent.includes('谵羽之哲'))
      assert.ok(metaTip.textContent.includes('折枝剑歌'))
      // 装备行紧跟角色名：音擎独占一行，4 件套 + 2 件套同一行
      const equipRows = [...metaTip.querySelectorAll('.sf-rec-tip-equip-row')]
      assert.equal(equipRows.length, 2)
      assert.equal(equipRows[0].querySelectorAll('.sf-rec-meta-block').length, 1)
      assert.equal(equipRows[1].querySelectorAll('.sf-rec-meta-block').length, 2)
      const equip = metaTip.querySelector('.sf-rec-tip-equip')
      const items = metaTip.querySelector('.tip-items')
      assert.equal(
        Boolean(
          equip.compareDocumentPosition(items) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        true,
        '装备行应在伤害数字之前',
      )
    })
    metaSeg.dispatchEvent(new Event('mouseleave'))
    await new Promise((resolve) => setTimeout(resolve, 220))
    await metaView.settle()

    const flowPanel = () => metaView.one('#flow-damage')
    check('默认视图是流程伤害，展示当前流程（记录 0）', () => {
      const tabs = metaView.all('[aria-label="伤害记录视图"] [role="tab"]')
      assert.deepEqual(
        tabs.map((tab) => tab.textContent.trim()),
        ['流程伤害', '记录对比'],
      )
      assert.equal(tabs[0].getAttribute('aria-selected'), 'true')
      assert.ok(flowPanel().textContent.includes('当前流程'))
      assert.ok(metaView.one('[aria-label="基准伤害记录"]'), '记录对比也应已挂载')
    })

    const row1 = metaView.all('.sf-rec-row[data-saved="true"]')[0]
    row1.click()
    await metaView.settle()
    check('点列表里的一条记录，下方流程伤害切换为它的快照', () => {
      const panel = flowPanel()
      assert.ok(panel.textContent.includes('记录流程伤害'), panel.textContent.slice(0, 80))
      assert.ok(panel.textContent.includes('双盘记录'))
      // 冻结态没有「编辑中角色」指标，也不再出现记录列表
      assert.equal(panel.querySelector('.sf-stats-num.current'), null)
      assert.equal(panel.querySelector('.sf-rec-row'), null)
      const expectedTeam = Math.round(withMeta.team).toLocaleString('en-US')
      assert.ok(
        panel.querySelector('.sf-stats-num.team').textContent.includes(expectedTeam),
        panel.querySelector('.sf-stats-num.team').textContent,
      )
      assert.equal(panel.querySelectorAll('.sf-analysis-ranking').length, 1)
      assert.equal(row1.className.includes('is-selected'), true)
    })
    check('选中的记录成为结构对比的对照，基准仍是当前流程', () => {
      const baseline = metaView.one('[aria-label="基准伤害记录"]')
      const comparison = metaView.one('[aria-label="对照伤害记录"]')
      assert.ok(baseline && comparison)
      assert.ok(baseline.options[baseline.selectedIndex].textContent.includes('当前流程'))
      assert.ok(
        comparison.options[comparison.selectedIndex].textContent.includes('双盘记录'),
        comparison.options[comparison.selectedIndex].textContent,
      )
    })

    await metaView.clickText('[aria-label="伤害记录视图"] [role="tab"]', '记录对比')
    await metaView.settle()
    check('切到记录对比视图，流程伤害面板隐藏', () => {
      const tabs = metaView.all('[aria-label="伤害记录视图"] [role="tab"]')
      assert.equal(tabs[1].getAttribute('aria-selected'), 'true')
      assert.equal(
        flowPanel().closest('[style*="display: none"]') !== null,
        true,
        '流程伤害面板应隐藏',
      )
      assert.ok(metaView.one('.sf-record-total'))
    })

    await metaView.clickText('[aria-label="伤害记录视图"] [role="tab"]', '流程伤害')
    await metaView.settle()
    await metaView.clickText('#flow-damage .mini-btn', '回到当前')
    await metaView.settle()
    check('回到当前后重新显示实时流程', () => {
      const panel = flowPanel()
      assert.ok(panel.textContent.includes('当前流程'))
      assert.equal(panel.querySelector('.sf-rec-empty'), null)
      assert.ok(panel.querySelector('.sf-stats-num.current'), '实时态应有编辑中角色指标')
    })
  } finally {
    metaView.unmount()
  }

  // 拖动插入线：用假几何驱动 dragover，验证取缝、落线与换位
  const dragA = { ...withMeta, id: 'drag-a', schemeName: '拖动A' }
  const dragB = { ...withMeta, id: 'drag-b', schemeName: '拖动B' }
  const dragC = { ...withMeta, id: 'drag-c', schemeName: '拖动C' }
  saveSkillFlowDamageRecords([dragA, dragB, dragC])
  const dragView = await mountStatsPanel(fixture)
  try {
    const rowBoxes = () => {
      dragView.all('.sf-rec-row[data-saved="true"]').forEach((row, index) => {
        row.getBoundingClientRect = () => ({
          top: index * 60,
          bottom: index * 60 + 50,
          height: 50,
          left: 0,
          right: 600,
          width: 600,
          x: 0,
          y: index * 60,
          toJSON() {},
        })
      })
    }
    rowBoxes()
    const chart = dragView.one('.sf-rec-chart')
    const firstRow = dragView.all('.sf-rec-row[data-saved="true"]')[0]
    firstRow.dispatchEvent(new MouseEvent('dragstart', { bubbles: true }))
    await dragView.settle()
    // clientY=140 落在第 3 行上半（第 3 行中线 145）→ 缝位 2
    chart.dispatchEvent(new MouseEvent('dragover', { bubbles: true, clientY: 140 }))
    await dragView.settle()
    check('拖动经过时在该缝上画出插入线', () => {
      const active = dragView.all('.sf-rec-insert-slot.is-active')
      assert.equal(active.length, 1)
      assert.equal(
        [...chart.children].indexOf(active[0]),
        5,
        '插入线应落在第 3 条记录之前（记录 0 占第 1 个子节点）',
      )
    })
    // clientY=60 落在自己这条缝上（第 2 行上半）→ 不画线
    chart.dispatchEvent(new MouseEvent('dragover', { bubbles: true, clientY: 60 }))
    await dragView.settle()
    check('停在自己原来的缝上不画插入线', () =>
      assert.equal(dragView.all('.sf-rec-insert-slot.is-active').length, 0),
    )
    chart.dispatchEvent(new MouseEvent('drop', { bubbles: true, clientY: 140 }))
    await dragView.settle()
    check('按缝位换位：第 1 条插到第 3 条之前', () => {
      const names = dragView
        .all('.sf-rec-row[data-saved="true"] .sf-rec-clip')
        .map((el) => el.textContent.trim())
      assert.deepEqual(names, ['拖动B', '拖动A', '拖动C'])
      assert.equal(dragView.all('.sf-rec-insert-slot.is-active').length, 0)
    })
  } finally {
    dragView.unmount()
  }

  storage.clear()
  const empty = await mountStatsPanel(fixture)
  try {
    check('不足两条记录时有明确引导', () =>
      assert.ok(
        empty
          .one('[aria-label="伤害记录结构对比"]')
          .textContent.includes('需要两条可比较的伤害快照'),
      ),
    )
    await empty.clickText('.sf-stats-lift-actions button', '记录')
    await empty.clickText('.sf-stats-lift-actions button', '记录')
    check('两次相同记录的对比默认只看变化，并说明没有变化', () => {
      assert.ok(empty.one('[aria-label="伤害记录结构对比"]').textContent.includes('此维度没有变化'))
      assert.equal(empty.one('.sf-record-diff-table'), null)
    })
    const checkbox = empty.one('.sf-record-toolbar input')
    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
    await empty.settle()
    check('取消只看变化后可检查完整角色构成', () =>
      assert.equal(empty.all('.sf-record-diff-table tbody tr').length, 2),
    )
  } finally {
    empty.unmount()
  }
} finally {
  await disposeStatsDomHarness()
}

console.log(`\n${passed} 项伤害记录兼容、快照与结构对比回归通过（内存 DOM）`)
