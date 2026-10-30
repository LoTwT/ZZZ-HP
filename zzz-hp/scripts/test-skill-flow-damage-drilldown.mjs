import assert from 'node:assert/strict'
import {
  damageAnalysisFixture,
  disposeStatsDomHarness,
  mountStatsPanel,
} from './_skillFlowStatsDomHarness.mjs'
import {
  buildSkillFlowDamageAnalysis,
  filterSkillFlowDamageLines,
  skillFlowDamageCrossRows,
  skillFlowDamageSlices,
  skillFlowSkillContributions,
  skillFlowSliceAtPoint,
} from '../src/utils/skillFlowDamageAnalysis.ts'

let passed = 0
function check(name, action) {
  action()
  passed += 1
  console.log(`PASS ${name}`)
}
const fixture = damageAnalysisFixture()
const analysis = buildSkillFlowDamageAnalysis({ ...fixture, slotCount: 2 })
check('类型×失衡交叉表的行、列与总伤守恒', () => {
  const rows = skillFlowDamageCrossRows(analysis.lines)
  assert.deepEqual(
    rows.map((row) => [row.id, row.normal, row.stagger, row.total]),
    [
      ['normal', 110, 20, 130],
      ['turbulence', 30, 40, 70],
    ],
  )
  assert.equal(
    rows.reduce((sum, row) => sum + row.total, 0),
    200,
  )
  assert.equal(rows[1].staggerRatio, 40 / 70)
})
check('筛选为交集，部分招式仍以完整个人/全队总伤作分母', () => {
  const filter = { damageType: 'turbulence', staggerPhase: 'stagger' }
  assert.deepEqual(
    filterSkillFlowDamageLines(analysis.lines, filter).map((line) => line.hit.id),
    ['t2'],
  )
  const rows = skillFlowSkillContributions(analysis, null, filter)
  assert.equal(rows[0].total, 40)
  assert.equal(rows[0].personalRatio, 0.4)
  assert.equal(rows[0].teamRatio, 0.2)
  assert.equal(rows[0].count, 4)
  assert.equal(analysis.total, 200)
})
check('大类筛选、互斥条件与空结果', () => {
  assert.equal(
    skillFlowSkillContributions(analysis, null, { damageKind: 'direct' }).reduce(
      (sum, row) => sum + row.total,
      0,
    ),
    130,
  )
  assert.deepEqual(
    skillFlowSkillContributions(analysis, null, { damageKind: 'direct', damageType: 'turbulence' }),
    [],
  )
  assert.deepEqual(skillFlowDamageCrossRows([]), [])
})
check('饼图扇区命中从顶部顺时针，不依赖图例出现顺序', () => {
  const slices = skillFlowDamageSlices(analysis.lines, 'type')
  assert.equal(skillFlowSliceAtPoint(slices, 0, -10).id, 'normal')
  assert.equal(skillFlowSliceAtPoint(slices, 10, 0).id, 'normal')
  assert.equal(skillFlowSliceAtPoint(slices, -10, 0).id, 'turbulence')
  assert.equal(skillFlowSliceAtPoint(slices, 0, 0), null)
  assert.equal(skillFlowSliceAtPoint([], 10, 0), null)
})

let mounted
try {
  mounted = await mountStatsPanel(fixture)
  check('真实组件有交叉表，默认没有筛选', () => {
    assert.ok(mounted.one('[aria-label="伤害类型与失衡交叉分析"]'))
    assert.equal(mounted.one('[aria-label="当前招式筛选"]'), null)
  })
  // 大类分组 id 改名（anomaly → anomalyClass）后，点「大类」图例仍要能筛出异常类
  await mounted.clickText('[aria-label="伤害类型层级"] button', '大类')
  await mounted.clickLabel('筛选伤害类型：异常类')
  check('切到大类后点异常类图例，筛选用 anomaly 语义值而非分组 id', () => {
    const bar = mounted.one('[aria-label="当前招式筛选"]')
    assert.ok(bar, '应出现筛选条')
    assert.ok(bar.textContent.includes('异常类'), bar.textContent)
    assert.ok(mounted.one('.sf-analysis-table'), '应有筛选结果')
  })
  await mounted.clickLabel('筛选伤害类型：异常类')
  await mounted.clickText('[aria-label="伤害类型层级"] button', '细分')
  check('再次点大类图例取消筛选，切回细分无残留', () =>
    assert.equal(mounted.one('[aria-label="当前招式筛选"]'), null),
  )
  await mounted.clickLabel('筛选伤害类型：乱流')
  check('点击图例筛出乱流，并保留完整图表和分母', () => {
    assert.equal(mounted.all('.sf-analysis-table tbody > tr').length, 1)
    assert.ok(mounted.one('.sf-analysis-table').textContent.includes('70.00%'))
    assert.ok(mounted.one('.sf-analysis-table').textContent.includes('35.00%'))
    assert.ok(mounted.one('.sf-stats-pies').textContent.includes('200'))
    assert.equal(mounted.state.activeSlotIndex, 1)
  })
  check('选中的伤害类型对应柱体保持上浮，饼图也保持选中态', () => {
    const rows = mounted.all('.sf-analysis-bar-row')
    assert.equal(
      rows[0].querySelectorAll('.sf-analysis-bar > button[aria-pressed="true"]').length,
      1,
      '乱流只在角色甲这一行有一段',
    )
    assert.equal(
      rows[1].querySelectorAll('.sf-analysis-bar > button[aria-pressed="true"]').length,
      0,
      '角色乙没有乱流，不应上浮',
    )
    assert.equal(mounted.all('.sf-pie.is-selected').length, 1)
  })
  await mounted.clickLabel('筛选失衡状态：失衡期')
  check('状态与类型交集筛选', () => {
    assert.ok(mounted.one('.sf-analysis-table').textContent.includes('40.00%'))
    assert.ok(mounted.one('.sf-analysis-table').textContent.includes('20.00%'))
    assert.ok(mounted.one('[aria-label="当前招式筛选"]').textContent.includes('命中 1 段'))
  })
  await mounted.clickLabel('移除筛选：乱流')
  check('移除单项保留失衡条件', () => {
    assert.equal(mounted.all('.sf-analysis-table tbody > tr').length, 2)
    assert.ok(mounted.one('[aria-label="当前招式筛选"]').textContent.includes('失衡期'))
  })
  await mounted.clickText('.sf-analysis-filter-bar button', '清除全部筛选')
  await mounted.clickLabel('乱流 · 非失衡，筛选招式')
  check('交叉表单元格同时筛选类型和状态', () => {
    assert.ok(mounted.one('.sf-analysis-table').textContent.includes('30.00%'))
    assert.ok(mounted.one('.sf-analysis-table').textContent.includes('15.00%'))
  })
  await mounted.clickLabel('乱流 · 非失衡，筛选招式')
  check('再次点击同一交叉格取消筛选', () =>
    assert.equal(mounted.one('[aria-label="当前招式筛选"]'), null),
  )
  await mounted.clickLabel('筛选角色甲 · 乱流')
  check('角色条形片段切换分析范围，编辑者保持角色乙', () => {
    assert.ok(mounted.one('.sf-analysis-ranking h4').textContent.includes('角色甲'))
    assert.equal(mounted.state.activeSlotIndex, 1)
    assert.ok(mounted.one('.sf-stats-num.current').textContent.includes('100'))
  })
  await mounted.clickLabel('筛选失衡状态：失衡期')
  await mounted.clickText('.sf-analysis-scope button', '2 · 角色乙')
  check('筛选空结果有清除入口，不回落成全部招式', () => {
    assert.equal(mounted.one('.sf-analysis-table'), null)
    assert.ok(mounted.one('.sf-analysis-ranking').textContent.includes('没有符合当前筛选'))
    assert.ok(mounted.one('[aria-label="当前招式筛选"]'))
  })
  await mounted.setProps({ teamSlots: [{ agentId: 'new-a' }, { agentId: 'b' }] })
  check('编队换人时清除旧筛选', () =>
    assert.equal(mounted.one('[aria-label="当前招式筛选"]'), null),
  )
} finally {
  mounted?.unmount()
  await disposeStatsDomHarness()
}
console.log(`\n${passed} 项交叉分析与图表筛选回归通过（内存 DOM，不替代浏览器观感）`)
