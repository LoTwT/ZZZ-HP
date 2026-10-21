/** 流程数字、完整来源与展示公式的同源回归；不依赖服务或外部方案。 */
import assert from 'node:assert/strict'
import { computed, effectScope } from 'vue'
import { useDamageProcessEvents } from '../src/composables/useDamageProcessEvents.ts'
import { buildOptimalEvalContext, withAffixLibraryExtraGains } from '../src/utils/optimalAffixAlloc.ts'
import { evaluateSkillFlowHit, resolveSkillFlowCalculationDetail } from '../src/utils/skillFlowCalculation.ts'
import { resolveFlow } from '../src/utils/resolvedHit.ts'
import { buildAlignedDirectFormulaGroup } from '../src/utils/directDamageDisplay.ts'
import { buildAlignedAnomalyFormulaGroups } from '../src/utils/anomalyFormulaDisplay.ts'
import { pickEventDamage } from '../src/utils/damageEvent.ts'
import { createDefaultAffixDriveDiscMainStats } from '../src/types/calculatorPanel.ts'
import { invalidateBuffCatalogCache } from '../src/utils/panelBuffCalc.ts'
import { makePanel, dummyBangboo, testAgent, testSlot } from './_effectPipelineHarness.mjs'

let passed = 0
function check(name, action) {
  action()
  passed += 1
  console.log(`PASS ${name}`)
}

const agents = [testAgent('a'), testAgent('b', { element: '风', profession: '锋御' }), testAgent('remiel', { name: '蕾米埃尔', element: '流明' })]
const teamSlots = agents.map((agent) => testSlot(agent.id))
const panel = makePanel({
  atk: 2317, def: 1300, critRate: 37, critDmg: 123, dmgBonus: 40, mastery: 280,
  anomalyCritRate: 35, anomalyCritDmg: 80,
  disorderCritRate: 35, disorderCritDmg: 80,
  turbulenceCritRate: 35, turbulenceCritDmg: 80,
  anomalyReleaseCritRate: 35, anomalyReleaseCritDmg: 80,
  radianceCritRate: 35, radianceCritDmg: 80,
  disorderBaseMult: 450, disorderCompMult: 7.5, anomalyDuration: 10,
  sharpenCritDmgBonus: 60, sharpenDmgBonus: 22,
})
const activeSlotPanels = { a: panel, b: makePanel({ ...panel, atk: 3781, def: 1700 }), remiel: makePanel({ ...panel, atk: 3163 }) }
const types = ['direct', 'sharpen', 'anomaly', 'disorder', 'turbulence', 'anomalyRelease', 'radiance']
const skills = Object.fromEntries(types.map((damageType) => [damageType, {
  id: damageType, name: '同名招式', agentId: '', source: 'custom', damageType,
  skillTypes: damageType === 'direct' || damageType === 'sharpen' ? ['basic'] : [],
  baseMult: damageType === 'radiance' ? 360 : 250,
  settlementMult: damageType === 'direct' ? 35 : 0,
}]))
const prepared = types.map((type) => ({
  id: `prep-${type}`, skillId: type, skillSource: 'custom',
  anomalyPowerAgentId: 'a', triggerAgentId: type === 'radiance' ? 'remiel' : 'b',
}))
const flow = types.map((type) => ({
  id: `flow-${type}`, ownerAgentId: 'a', preparedId: `prep-${type}`,
  count: 3, staggerPhase: 'stagger', critMode: 'expected',
}))
const group = {
  id: 'group', name: '重复招式技能组', agentId: 'a', source: 'custom',
  members: [
    { skillId: 'direct', order: 0, count: 2, includeInFlow: true },
    { skillId: 'direct', order: 1, count: 4, includeInFlow: true },
  ],
}
const slots = [{
  prepared: [...prepared.filter((item) => item.skillId !== 'radiance'), { id: 'prep-group', skillGroupId: group.id, skillSource: 'custom' }],
  flow: [...flow.filter((item) => item.preparedId !== 'prep-radiance'), { id: 'flow-group', ownerAgentId: 'a', preparedId: 'prep-group', count: 2, staggerPhase: 'normal', critMode: 'noCrit' }],
}, { prepared: [], flow: [] }, {
  prepared: prepared.filter((item) => item.skillId === 'radiance'),
  flow: flow.filter((item) => item.preparedId === 'prep-radiance').map((item) => ({ ...item, ownerAgentId: 'remiel' })),
}]
const hits = resolveFlow({
  slots, teamSlots, findSkill: (id) => skills[id], findSkillGroup: () => group,
  resolveAgentProfession: (id) => agents.find((agent) => agent.id === id)?.profession,
}).hits
const gain = { id: 'allocated-dmg', name: '分配产生的局内增伤', stat: 'dmgBonus', value: 19, applySlot: 'team' }
function context(overrides = {}) {
  invalidateBuffCatalogCache()
  return buildOptimalEvalContext({
    isMb: false, teamSlots, agents, wengines: [], bangboo: dummyBangboo(), bangbooRefine: 1,
    driveDiscs: [], mainSlotIndex: 0, driveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
    enemyInput: { level: 60, defense: 953, resistanceType: 'normal', vulnerableMultiplier: 1, staggerMultiplier: 2, specialMultiplier: 1 },
    baseDamageSource: 'atk', activeSlotPanels, hits, extraGains: [], ...overrides,
  })
}
const numericFormat = (value) => String(value)

for (const source of ['config', 'allocation', 'sweep']) {
  const ctx = source === 'config' ? context() : withAffixLibraryExtraGains(context(), [gain])
  const external = source === 'config' ? null : makePanel({ ...panel, atk: source === 'allocation' ? 3001 : 3503 })
  for (const hit of hits) {
    check(`${source} ${hit.id}：数字与完整来源一致`, () => {
      const numeric = evaluateSkillFlowHit(ctx, external, hit)
      const full = resolveSkillFlowCalculationDetail(ctx, external, hit)
      assert.ok(numeric && full)
      assert.deepEqual(full.evaluation.result, numeric.result)
      assert.equal(full.evaluation.perHit, numeric.perHit)
      assert.equal(full.evaluation.total, numeric.perHit * hit.count)
      assert.equal(full.evaluation.eventId, hit.id)
      assert.deepEqual(full.enemyInput, ctx.enemyInput)
    })
  }
}

const ctx = context()
for (const hit of hits.filter((hit) => !hit.id.startsWith('flow-group#'))) {
  const detail = resolveSkillFlowCalculationDetail(ctx, null, hit)?.evaluation
  assert.ok(detail)
  for (const mode of ['expected', 'noCrit', 'fullCrit']) {
    check(`${hit.skill.damageType} ${mode}：公式乘区与最终伤害采用同一口径`, () => {
      const direct = hit.damageKind === 'direct'
      const formula = direct
        ? buildAlignedDirectFormulaGroup(detail.result, numericFormat, numericFormat, undefined, mode)
        : buildAlignedAnomalyFormulaGroups(detail.result, hit.anomalySubKind, '紊乱', numericFormat, numericFormat, undefined, mode).at(-1)
      assert.equal(Number(formula.result), pickEventDamage(detail.result, hit.skill.damageType, mode))
      const segments = formula.sumMultZones?.length
        ? formula.sumMultZones.map((zone) => [...formula.terms, zone])
        : [formula.terms]
      const reconstructed = segments.reduce((sum, terms) => sum + terms.reduce((product, term) => product * Number(term.value), 1), 0)
      assert.ok(Math.abs(reconstructed - Number(formula.result)) <= 1, `公式复算 ${reconstructed}，引擎结果 ${formula.result}`)
      if (hit.skill.damageType === 'radiance') {
        assert.equal(Number(formula.terms.find((term) => term.tipsKey === 'radianceMultZone').value), detail.result.radianceMultZone)
      }
    })
  }
}

check('组内同名招式保留独立事件、成员次数乘整组次数', () => {
  const members = hits.filter((hit) => hit.id.startsWith('flow-group#'))
  assert.equal(members.length, 2)
  assert.notEqual(members[0].id, members[1].id)
  assert.deepEqual(members.map((hit) => hit.count), [4, 8])
  const first = resolveSkillFlowCalculationDetail(context(), null, members[0]).evaluation
  const second = resolveSkillFlowCalculationDetail(context(), null, members[1]).evaluation
  assert.equal(second.total, first.total * 2)
})
check('主槽之外的锋御招式使用本人的面板及直伤路径', () => {
  const hit = { ...hits[0], id: 'other-owner', ownerAgentId: 'b' }
  const detail = resolveSkillFlowCalculationDetail(context(), null, hit).evaluation
  assert.equal(detail.external.def, activeSlotPanels.b.def)
  assert.equal(detail.result.useSharpenFormula, true)
})
check('分配的局内增益出现在公式数值和来源中', () => {
  const baseline = resolveSkillFlowCalculationDetail(context(), panel, hits[0]).evaluation
  const modified = resolveSkillFlowCalculationDetail(withAffixLibraryExtraGains(context(), [gain]), panel, hits[0]).evaluation
  assert.ok(modified.perHit > baseline.perHit)
  assert.ok(JSON.stringify(modified.breakdown.sources).includes(gain.id))
})
check('行级禁用额外增益时，数字与完整来源同步排除', () => {
  const row = { ...hits[0], buffOverride: { disabledBlockIds: ['extra-allocated-dmg'] } }
  const contextWithGain = withAffixLibraryExtraGains(context(), [gain])
  const disabled = resolveSkillFlowCalculationDetail(contextWithGain, panel, row).evaluation
  const baseline = evaluateSkillFlowHit(context(), panel, hits[0])
  assert.equal(disabled.perHit, baseline.perHit)
  assert.deepEqual(disabled.result, evaluateSkillFlowHit(contextWithGain, panel, row).result)
})
check('缺招式持有者面板：数字与详情都不出伤', () => {
  const ctx = context({ activeSlotPanels: { a: panel } })
  const hit = { ...hits[0], ownerAgentId: 'b' }
  assert.equal(evaluateSkillFlowHit(ctx, null, hit), null)
  assert.equal(resolveSkillFlowCalculationDetail(ctx, null, hit), null)
})
check('缺强度提供者面板或代理人：数字与详情都跳过', () => {
  const ctx = context({ activeSlotPanels: { a: panel } })
  for (const power of ['b', null]) {
    const hit = { ...hits[2], anomalyPowerAgentId: power }
    assert.equal(evaluateSkillFlowHit(ctx, null, hit), null)
    assert.equal(resolveSkillFlowCalculationDetail(ctx, null, hit), null)
  }
})
check('敌方变化后，详情不复用旧数字', () => {
  const ctx = context()
  const before = resolveSkillFlowCalculationDetail(ctx, null, hits[0]).evaluation
  ctx.enemyInput = { ...ctx.enemyInput, defense: 2400 }
  const after = resolveSkillFlowCalculationDetail(ctx, null, hits[0]).evaluation
  assert.ok(after.perHit < before.perHit)
  assert.deepEqual(after.result, evaluateSkillFlowHit(ctx, null, hits[0]).result)
})
check('底部对比区按需解析选中事件，且同名组成员能回指正确结果', () => {
  const scope = effectScope()
  let requests = 0
  try {
    scope.run(() => {
      const ctx = context()
      const events = useDamageProcessEvents({
        resolveDetail: (id) => {
          requests += 1
          return resolveSkillFlowCalculationDetail(ctx, null, hits.find((hit) => hit.id === id))?.evaluation ?? null
        },
        grandTotal: computed(() => 0),
        eventLines: computed(() => hits.map((hit) => {
          const evaluation = evaluateSkillFlowHit(ctx, null, hit)
          return { eventId: hit.id, displayName: hit.skill.name, total: evaluation.total, perHit: evaluation.perHit }
        })),
        selectedEventIds: computed(() => null), totalLabel: computed(() => '总伤'),
        hasEvents: computed(() => true), active: computed(() => true), enabled: computed(() => true),
        hits: computed(() => hits), agents: computed(() => agents), teamSlots: computed(() => teamSlots),
      })
      assert.equal(events.eventRows.value.length, hits.length)
      assert.equal(requests, 0)
      assert.equal(events.selectedDetail.value.eventId, hits[0].id)
      assert.equal(requests, 1)
      const member = hits.find((hit) => hit.id.startsWith('flow-group#1'))
      events.selectEvent(member.id)
      assert.equal(events.selectedDetail.value.eventId, member.id)
      assert.equal(events.selectedDetail.value.total, evaluateSkillFlowHit(ctx, null, member).total)
      assert.equal(requests, 2)
    })
  } finally {
    scope.stop()
  }
})
console.log(`\n${passed} passed, 0 failed`)
