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
    assert.equal(
      compareSkillFlowDamageRecords(added, before).skill.find((item) => item.state === 'removed')
        .changeRatio,
      -1,
    )
  })
  check('旧记录只比较总伤，不从当前配置补造结构', () => {
    const result = compareSkillFlowDamageRecords(legacy, after)
    assert.equal(result.hasDetails, false)
    assert.equal(result.total.delta, 90)
    assert.deepEqual(result.skill, [])
    assert.deepEqual(result.agent, [])
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
    const baselineSelect = mounted.one('[aria-label="基准伤害记录"]')
    baselineSelect.value = 'legacy'
    baselineSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await mounted.settle()
    check('选旧记录只显示总伤和缺少明细说明', () => {
      assert.ok(mounted.one('.sf-record-legacy').textContent.includes('仅保存总伤'))
      assert.equal(mounted.one('.sf-record-diff-table'), null)
      assert.ok(mounted.one('.sf-record-total').textContent.includes('+90'))
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
