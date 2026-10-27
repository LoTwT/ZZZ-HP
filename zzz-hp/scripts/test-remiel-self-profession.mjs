import assert from 'node:assert/strict'
import { eventFixture } from './_eventElementHarness.mjs'
import { testAgent } from './_effectPipelineHarness.mjs'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { buildEventPanelContext } from '../src/utils/optimalAffixAlloc.ts'
import { evaluateSkillFlowHit } from '../src/utils/skillFlowCalculation.ts'
import { collectRemielSelfRestrictedContributionsFromSources } from '../src/utils/remielSelfRadiancePanel.ts'

for (const [required, attack, damage] of [['支援', 2000, 9090], ['异常', 2100, 9544]]) {
  const effect = createEmptyBuffEffect({ id: 'profession-self', stat: 'atk', kind: 'convert', enabledDefault: true,
    applyTarget: 'self', applyProfession: required,
    convert: { from: 'mastery', panelSource: 'external', ratioPercent: 100, initialBase: 0, cap: null } })
  const fixture = eventFixture({ damageType: 'radiance', sourceSlot: 1, effects: [effect], agents: [
    testAgent('owner'), testAgent('power', { profession: '异常', element: '流明' }),
  ] })
  const hit = { ...fixture.hits[0], ownerAgentId: 'power', triggerAgentId: 'power', multOverrides: { radianceMult: 100 } }
  const numeric = evaluateSkillFlowHit(fixture.context, null, hit, false)
  const detail = evaluateSkillFlowHit(fixture.context, null, hit, true)
  assert.equal(numeric.result.remielSelfInCombatAtk, attack)
  assert.equal(numeric.total, damage)
  assert.equal(detail.result.remielSelfInCombatAtk, attack)
  assert.equal(detail.total, damage)
  const context = buildEventPanelContext(fixture.context, null, hit, 1)
  assert.equal(collectRemielSelfRestrictedContributionsFromSources(fixture.panels.power, context, 1).inCombatAtk, attack)
  console.log(`PASS self radiance required=${required}: attack=${attack}, damage=${damage}, numeric/detail/compatibility agree`)
}
