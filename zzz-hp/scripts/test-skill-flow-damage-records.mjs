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
import {
  loadSkillFlowDamageRecords,
  saveSkillFlowDamageRecords,
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
  check('仍最多保存 10 条，坏 JSON 有稳定空态', () => {
    saveSkillFlowDamageRecords(
      Array.from({ length: 12 }, (_, index) => ({ ...legacy, id: `record-${index}` })),
    )
    assert.equal(loadSkillFlowDamageRecords().length, 10)
    storage.setItem(SKILL_FLOW_DAMAGE_RECORD_KEY, 'bad json')
    assert.deepEqual(loadSkillFlowDamageRecords(), [])
  })

  saveSkillFlowDamageRecords([legacy, before, after])
  const mounted = await mountStatsPanel(fixture)
  try {
    check('组件默认最近两条记录，显示真实总伤变化', () => {
      assert.equal(mounted.one('[aria-label="基准伤害记录"]').value, 'before')
      assert.equal(mounted.one('[aria-label="对照伤害记录"]').value, 'after')
      assert.ok(mounted.one('.sf-record-total').textContent.includes('+40'))
      assert.ok(mounted.one('.sf-record-total').textContent.includes('+20.00%'))
      assert.ok(mounted.one('.sf-rec-table').textContent.includes('仅总伤'))
      const summary = mounted.one('[aria-label="招式数量差异"]')
      assert.ok(summary.textContent.includes('招式种类'))
      assert.ok(summary.textContent.includes('累计使用次数'))
      assert.match(summary.textContent.replace(/\s/g, ''), /3→30种新增0种·移除0种/)
      assert.match(summary.textContent.replace(/\s/g, ''), /15→150次/)
    })
    await mounted.clickText('[aria-label="记录对比维度"] button', '伤害类型')
    check('切换到类型对比，乱流增量可见', () => {
      assert.ok(mounted.one('.sf-record-diff-table').textContent.includes('乱流'))
      assert.ok(mounted.one('.sf-record-diff-table').textContent.includes('+40'))
    })
    await mounted.clickText('[aria-label="记录对比维度"] button', '招式')
    check('招式对比带角色身份，合并同一招式的多段', () => {
      const rows = mounted.all('.sf-record-diff-table tbody tr')
      const row = rows.find((item) => item.textContent.includes('角色甲 · 乱流'))
      assert.ok(row)
      assert.ok(row.textContent.includes('110'))
    })
    check('招式表同时显示单次与次数对照，两份记录的均值和数量可见', () => {
      const table = mounted.one('.sf-record-diff-table')
      assert.ok(table.textContent.includes('平均单次伤害'))
      assert.ok(table.textContent.includes('使用次数'))
      const row = mounted
        .all('.sf-record-diff-table tbody tr')
        .find((item) => item.textContent.includes('角色甲 · 乱流'))
      const singleHit = row
        .querySelector('.sf-record-average-damage')
        .textContent.replace(/\s/g, '')
      assert.ok(singleHit.includes('10→15.71'))
      assert.ok(singleHit.includes('+5.71（+57.14%）'))
      assert.match(
        row.querySelector('.sf-record-usage-count').textContent.replace(/\s/g, ''),
        /7→70（0.00%）/,
      )
      assert.ok(mounted.one('[aria-label="伤害记录结构对比"]').textContent.includes('按次数加权'))
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
    const lastRow = mounted.all('.sf-rec-table tbody tr').at(-1)
    lastRow.querySelector('button').click()
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

  saveSkillFlowDamageRecords([before, countChanged])
  const counts = await mountStatsPanel(fixture)
  try {
    const fullSummary = counts.one('[aria-label="招式数量差异"]').textContent
    await counts.clickText('[aria-label="记录对比维度"] button', '招式')
    check('只看变化不会隐藏总伤相同但次数不同的招式', () => {
      const rows = counts.all('.sf-record-diff-table tbody tr')
      assert.equal(rows.length, 1)
      assert.ok(rows[0].textContent.includes('角色甲 · 乱流'))
      assert.ok(rows[0].querySelector('.sf-record-usage-count').textContent.includes('+4'))
      assert.ok(rows[0].querySelector('.sf-record-average-damage').textContent.includes('−3.64'))
      assert.equal(counts.one('[aria-label="招式数量差异"]').textContent, fullSummary)
      assert.match(fullSummary.replace(/\s/g, ''), /15→19\+4次/)
    })
    const checkbox = counts.one('.sf-record-toolbar input')
    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
    await counts.settle()
    check('取消只看变化与切换维度均不改变完整数量摘要', () => {
      assert.equal(counts.all('.sf-record-diff-table tbody tr').length, 3)
      assert.equal(counts.one('[aria-label="招式数量差异"]').textContent, fullSummary)
    })
    await counts.clickText('[aria-label="记录对比维度"] button', '伤害类型')
    check('非招式维度保留原伤害列，数量摘要仍可见', () => {
      assert.equal(counts.one('[aria-label="招式数量差异"]').textContent, fullSummary)
      assert.equal(counts.one('.sf-record-average-damage'), null)
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
    check('界面保留小数次数和差值，不四舍五入为整数', () => {
      const text = fractional.one('.sf-record-usage-count').textContent.replace(/\s/g, '')
      assert.ok(text.includes('0.25→0.5'))
      assert.ok(text.includes('+0.25（+100.00%）'))
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
      const row = addition.one('.sf-record-diff-table tbody tr')
      assert.ok(row.textContent.includes('新增'))
      const text = row.querySelector('.sf-record-average-damage').textContent.replace(/\s/g, '')
      assert.ok(text.includes('—→50'))
      assert.ok(text.includes('单次变化无法比较'))
      assert.ok(!row.textContent.includes('Infinity'))
      assert.match(
        addition.one('[aria-label="招式数量差异"]').textContent.replace(/\s/g, ''),
        /3→4\+1种新增1种·移除0种/,
      )
    })
  } finally {
    addition.unmount()
  }

  storage.clear()
  const empty = await mountStatsPanel(fixture)
  try {
    check('不足两条记录时有明确引导', () =>
      assert.ok(empty.one('[aria-label="伤害记录结构对比"]').textContent.includes('记录两次')),
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
