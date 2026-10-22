/** 全队/个人伤害构成：分母、正式流程边界、技能组合计与展开明细。 */
import assert from 'node:assert/strict'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import SkillFlowStatsPanel from '../src/components/calculator/SkillFlowStatsPanel.vue'
import {
  buildSkillFlowDamageAnalysis,
  skillFlowDamageSlices,
  skillFlowSkillContributions,
} from '../src/utils/skillFlowDamageAnalysis.ts'
import { resolveFlow } from '../src/utils/resolvedHit.ts'

let passed = 0
function check(name, action) {
  action()
  passed += 1
  console.log(`PASS ${name}`)
}

function hit(id, type, options = {}) {
  const direct = ['normal', 'pierce', 'sharpen'].includes(type)
  return {
    id,
    ownerAgentId: 'different-from-flow-owner',
    skill: {
      id: options.skillId ?? id,
      name: options.name ?? id,
      damageType: direct ? 'direct' : type,
    },
    damageKind: direct ? 'direct' : 'anomaly',
    directSubKind: direct ? type : 'normal',
    anomalySubKind: direct ? 'anomaly' : type,
    staggerPhase: 'normal',
    count: 1,
    anomalyPowerAgentId: 'producer',
    triggerAgentId: 'trigger',
    ...options,
  }
}

function flowSlot(...ids) {
  return { prepared: [], flow: ids.map((id) => ({ id })) }
}

const screenshotInput = {
  slotCount: 3,
  slots: [flowSlot('a'), flowSlot('b'), flowSlot('c-direct', 'c-release', 'c-turbulence')],
  hits: [
    hit('a', 'normal'),
    hit('b', 'radiance', { staggerPhase: 'stagger' }),
    hit('c-direct', 'normal'),
    hit('c-release', 'anomalyRelease'),
    hit('c-turbulence', 'turbulence', { count: 7 }),
  ],
  hitDamages: {
    a: 26054713,
    b: 86524275,
    'c-direct': 2796259,
    'c-release': 8063215,
    'c-turbulence': 35263297,
  },
}
const screenshot = buildSkillFlowDamageAnalysis(screenshotInput)

check('截图数字：全队与三人总伤保持原值', () => {
  assert.equal(screenshot.total, 158701759)
  assert.deepEqual(
    screenshot.slots.map((slot) => slot.total),
    [26054713, 86524275, 46122771],
  )
})

check('个人和全队分母独立：菲欧妮乱流 76.5% / 22.22%', () => {
  const row = skillFlowSkillContributions(screenshot, 2).find(
    (item) => item.skillId === 'c-turbulence',
  )
  assert.equal((row.personalRatio * 100).toFixed(1), '76.5')
  assert.equal((row.teamRatio * 100).toFixed(2), '22.22')
  assert.equal(row.count, 7)
  assert.equal(row.total, 35263297)
  assert.equal(row.lines[0].perHit, 35263297 / 7)
})

check('所有分析维度合计与全队一致，占比加起来为 1', () => {
  for (const dimension of ['type', 'category', 'stagger']) {
    const slices = skillFlowDamageSlices(screenshot.lines, dimension)
    assert.equal(
      slices.reduce((sum, slice) => sum + slice.total, 0),
      158701759,
    )
    assert.ok(Math.abs(slices.reduce((sum, slice) => sum + slice.ratio, 0) - 1) < 1e-12)
  }
  assert.equal(
    skillFlowSkillContributions(screenshot, null).reduce((sum, row) => sum + row.total, 0),
    158701759,
  )
})

check('个人视角只取本槽，但占全队仍用全队分母', () => {
  const rows = skillFlowSkillContributions(screenshot, 2)
  assert.equal(rows.length, 3)
  assert.ok(rows.every((row) => row.slotIndex === 2))
  assert.equal(
    rows.reduce((sum, row) => sum + row.total, 0),
    46122771,
  )
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.personalRatio, 0) - 1) < 1e-12)
  assert.ok(rows.reduce((sum, row) => sum + row.teamRatio, 0) < 0.3)
})

check('准备预览、孤立段、重复输入不进入正式流程总伤', () => {
  const result = buildSkillFlowDamageAnalysis({
    ...screenshotInput,
    hits: [
      ...screenshotInput.hits,
      screenshotInput.hits[0],
      hit('preview', 'normal'),
      hit('orphan#0:skill', 'normal'),
    ],
    hitDamages: {
      ...screenshotInput.hitDamages,
      preview: 1e12,
      'orphan#0:skill': 1e12,
      obsolete: 1e12,
    },
  })
  assert.equal(result.total, 158701759)
  assert.equal(result.lines.length, 5)
})

check('按流程所属槽位统计，不按异常强度提供者/触发者转移分账', () => {
  assert.equal(screenshot.slots[2].total, 46122771)
  assert.ok(screenshot.slots[2].lines.every((line) => line.slotIndex === 2))
  assert.equal(screenshot.slots[2].lines[1].hit.anomalyPowerAgentId, 'producer')
  assert.equal(screenshot.slots[2].lines[1].hit.triggerAgentId, 'trigger')
})

check('同槽同招式合并，同名不同 id/不同槽位不合并，明细保留状态与增益', () => {
  const override = { disabledEffectIds: ['buff-1'] }
  const input = {
    slotCount: 2,
    slots: [flowSlot('f1', 'f2', 'f3'), flowSlot('f4')],
    hits: [
      hit('f1', 'normal', { skillId: 'shared', name: '同名招式', count: 2 }),
      hit('f2', 'normal', {
        skillId: 'shared',
        name: '同名招式',
        count: 3,
        staggerPhase: 'stagger',
        buffOverride: override,
      }),
      hit('f3', 'normal', { skillId: 'different', name: '同名招式' }),
      hit('f4', 'normal', { skillId: 'shared', name: '同名招式' }),
    ],
    hitDamages: { f1: 20, f2: 60, f3: 5, f4: 10 },
  }
  const result = buildSkillFlowDamageAnalysis(input)
  const rows = skillFlowSkillContributions(result, null)
  assert.equal(rows.length, 3)
  assert.deepEqual(
    rows.map((row) => row.total),
    [80, 10, 5],
  )
  assert.equal(rows[0].count, 5)
  assert.equal(rows[0].personalRatio, 80 / 85)
  assert.equal(rows[0].teamRatio, 80 / 95)
  assert.deepEqual(
    rows[0].lines.map((line) => line.hit.staggerPhase),
    ['normal', 'stagger'],
  )
  assert.equal(rows[0].lines[1].flowEntryIndex, 1)
  assert.equal(rows[0].lines[1].perHit, 20)
  assert.equal(rows[0].lines[1].hit.buffOverride, override)
})

check('真实 resolveFlow 技能组：同招式多段合并，成员次数×整组次数仅计一次', () => {
  const skill = {
    id: 'skill',
    name: '组内招式',
    agentId: 'a',
    source: 'custom',
    damageType: 'direct',
    skillTypes: [],
    baseMult: 100,
  }
  const group = {
    id: 'group',
    agentId: 'a',
    name: '组合',
    members: [
      { skillId: skill.id, order: 0, count: 2 },
      { skillId: skill.id, order: 1, count: 4 },
    ],
  }
  const slots = [
    {
      prepared: [{ id: 'prep', skillGroupId: group.id }],
      flow: [
        { id: 'flow', ownerAgentId: 'a', preparedId: 'prep', count: 2, staggerPhase: 'normal' },
      ],
    },
  ]
  const hits = resolveFlow({
    slots,
    teamSlots: [{ agentId: 'a' }],
    findSkill: () => skill,
    findSkillGroup: () => group,
  }).hits
  assert.deepEqual(
    hits.map((item) => item.count),
    [4, 8],
  )
  const hitDamages = Object.fromEntries(hits.map((item) => [item.id, item.count * 10]))
  const result = buildSkillFlowDamageAnalysis({ slotCount: 1, slots, hits, hitDamages })
  const rows = skillFlowSkillContributions(result, null)
  assert.equal(result.total, 120)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].count, 12)
  assert.equal(rows[0].lines.length, 2)
  assert.ok(rows[0].lines.every((line) => line.perHit === 10))
})

check('提供者拆段 id 均属于同一流程行，伤害和次数各计一次', () => {
  const hits = [
    hit('split#0:skill@producer-a', 'turbulence', { skillId: 'skill', count: 1.5 }),
    hit('split#0:skill@producer-b', 'turbulence', { skillId: 'skill', count: 2.5 }),
  ]
  const result = buildSkillFlowDamageAnalysis({
    slotCount: 1,
    slots: [flowSlot('split')],
    hits,
    hitDamages: { [hits[0].id]: 15, [hits[1].id]: 50 },
  })
  const row = skillFlowSkillContributions(result, 0)[0]
  assert.equal(result.total, 65)
  assert.equal(row.count, 4)
  assert.deepEqual(
    row.lines.map((line) => line.perHit),
    [10, 20],
  )
})

check('复用既有八类口径：命破/锋御不再都落进普通直伤', () => {
  const types = [
    'normal',
    'pierce',
    'sharpen',
    'anomaly',
    'turbulence',
    'disorder',
    'radiance',
    'anomalyRelease',
  ]
  const result = buildSkillFlowDamageAnalysis({
    slotCount: 1,
    slots: [flowSlot(...types)],
    hits: types.map((type) => hit(type, type)),
    hitDamages: Object.fromEntries(types.map((type) => [type, 10])),
  })
  const slices = skillFlowDamageSlices(result.lines, 'type')
  assert.deepEqual(
    slices.map((slice) => slice.id),
    types,
  )
  assert.deepEqual(
    slices.slice(0, 3).map((slice) => slice.name),
    ['普通直伤', '命破', '锋御'],
  )
  assert.deepEqual(
    skillFlowDamageSlices(result.lines, 'category').map((slice) => slice.total),
    [30, 50],
  )
  const reversed = skillFlowDamageSlices([...result.lines].reverse(), 'type')
  assert.deepEqual(reversed, slices)
  for (const line of result.lines) {
    const single = skillFlowDamageSlices([line], 'type')[0]
    assert.equal(single.color, slices.find((slice) => slice.id === single.id).color)
  }
  assert.equal(new Set(slices.map((slice) => slice.color)).size, 8)
})

check('缺失/非法伤害单独计数，不生成 NaN、Infinity 或负占比', () => {
  const ids = ['missing', 'nan', 'infinite', 'negative', 'zero']
  const result = buildSkillFlowDamageAnalysis({
    slotCount: 1,
    slots: [flowSlot(...ids)],
    hits: ids.map((id) => hit(id, 'normal', { count: 0 })),
    hitDamages: { nan: NaN, infinite: Infinity, negative: -1, zero: 0 },
  })
  assert.equal(result.total, 0)
  assert.equal(result.slots[0].uncomputedCount, 4)
  assert.equal(result.lines.length, 1)
  assert.equal(result.lines[0].perHit, 0)
  for (const dimension of ['type', 'category', 'stagger'])
    assert.deepEqual(skillFlowDamageSlices(result.lines, dimension), [])
  const row = skillFlowSkillContributions(result, null)[0]
  assert.equal(row.personalRatio, 0)
  assert.equal(row.teamRatio, 0)
})

check('空槽/空流程/数据未就绪与无效个人范围都有稳定空态', () => {
  const result = buildSkillFlowDamageAnalysis({ slotCount: 3 })
  assert.equal(result.total, 0)
  assert.equal(result.slots.length, 3)
  assert.deepEqual(result.lines, [])
  assert.deepEqual(skillFlowSkillContributions(result, null), [])
  assert.deepEqual(skillFlowSkillContributions(screenshot, 99), [])
  assert.equal(buildSkillFlowDamageAnalysis({ ...screenshotInput, slotCount: 0 }).total, 0)
})

let detailRequests = 0
const componentProps = {
  teamSlots: ['a', 'b', 'c'].map((agentId) => ({ agentId })),
  agents: [
    { id: 'a', name: '维琳娜' },
    { id: 'b', name: '蕾米埃尔' },
    { id: 'c', name: '菲欧妮' },
  ],
  slots: screenshotInput.slots,
  hits: screenshotInput.hits,
  hitDamages: screenshotInput.hitDamages,
  activeSlotIndex: 2,
  resolveCalculationDetail: () => {
    detailRequests += 1
    return null
  },
}
const rendered = await renderToString(
  createSSRApp({ render: () => h(SkillFlowStatsPanel, componentProps) }),
)
check('真实组件默认渲染全队构成与招式排行，并显示个人/全队占比', () => {
  assert.ok(rendered.includes('全队 · 伤害类型'))
  assert.ok(rendered.includes('全队 · 失衡状态'))
  assert.ok(rendered.includes('全队 · 招式贡献排行'))
  assert.ok(rendered.includes('158,701,759'))
  assert.ok(rendered.includes('35,263,297'))
  assert.ok(rendered.includes('22.22%'))
  assert.ok(rendered.includes('占个人'))
  assert.ok(rendered.includes('占全队'))
})
const initialDetailRequests = detailRequests
const otherEditor = await renderToString(
  createSSRApp({ render: () => h(SkillFlowStatsPanel, { ...componentProps, activeSlotIndex: 0 }) }),
)
check('未展开时不会请求计算过程，默认全队不依赖编辑槽位', () => {
  assert.equal(initialDetailRequests, 0)
  assert.ok(otherEditor.includes('全队 · 伤害类型'))
  assert.ok(otherEditor.includes('158,701,759'))
  assert.equal(detailRequests, 0)
})
const emptyRendered = await renderToString(
  createSSRApp({
    render: () => h(SkillFlowStatsPanel, { teamSlots: [], agents: [], activeSlotIndex: 0 }),
  }),
)
check('真实组件空数据渲染明确空态，无非法百分比', () => {
  assert.ok(emptyRendered.includes('全队流程暂无可统计伤害'))
  assert.ok(emptyRendered.includes('全队流程暂无可统计招式'))
  assert.ok(!emptyRendered.includes('NaN'))
  assert.ok(!emptyRendered.includes('Infinity'))
})

console.log(`\n${passed} 项伤害构成回归通过`)
