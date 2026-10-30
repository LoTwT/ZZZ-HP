import assert from 'node:assert/strict'
import { evaluateSkillFlowHit, resolveSkillFlowCalculationDetail } from '../src/utils/skillFlowCalculation.ts'
import { resolveAnomalyReleaseSkillConvertMods } from '../src/utils/panelBuffCalc.ts'
import { r3Fixture, r5Fixture } from './_eventElementHarness.mjs'
import { eventFixture } from './_eventElementHarness.mjs'
import { createEmptyBuffEffect, effectMatchesElement } from '../src/utils/buffEffect.ts'
import { resolveEventElement, resolveFlow, resolveSkillPreviews, buildGenericPanelSkillContext, normalizeFlowEventElements } from '../src/utils/resolvedHit.ts'
import { resolveEventBuffPreviewInputs, buildEventPanelContext, withAffixLibraryExtraGains } from '../src/utils/optimalAffixAlloc.ts'
import { resolveSkillFlowPanelSource } from '../src/utils/skillFlowPanelSource.ts'
import { computeFinalPanel, blockKeyOfCollected } from '../src/utils/panelBuffCalc.ts'
import { makePanel, testAgent } from './_effectPipelineHarness.mjs'
import { evaluateAffixCounts, clearAffixEvalCache } from '../src/utils/optimalAffixAlloc.ts'
import { AFFIX_VALUE_PER_COUNT } from '../src/utils/affixPanelCalc.ts'
import { createEmptyAffixCounts } from '../src/types/calculatorPanel.ts'
import { buildHitEvalFingerprint, hitEvalCacheKey, readHitEvalCache, writeHitEvalCache, clearHitEvalCache, hitEvalCacheDebugStats } from '../src/utils/hitEvalCache.ts'
import { bindVueFunctions } from './_vueSetupHarness.mjs'
import { skillGroupMemberKey } from '../src/utils/skillGroup.ts'
import { isFlowBuffOverrideEmpty } from '../src/utils/flowBuffTable.ts'
import { normalizeEventElement } from '../src/utils/resolvedHit.ts'
import { evaluateAffixCountsWithCacheInfo } from '../src/utils/optimalAffixAlloc.ts'

let passed = 0
let failed = 0
function check(label, actual, expected) {
  try { assert.deepEqual(actual, expected); passed++; console.log(`PASS ${label}: ${JSON.stringify(actual)}`) }
  catch { failed++; console.error(`FAIL ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`) }
}

// Each calculation starts from resolveFlow's hit and its own real panel machinery.
// UI output is never injected into the event calculation.
for (const mode of ['ordinary', 'extra-slot', 'extra-team']) {
  const fixture = r3Fixture(mode)
  check(`R3 ${mode} public contribution`, resolveAnomalyReleaseSkillConvertMods(fixture.panelContext, '电').anomalyReleaseMult, 1.2)
  const hit = fixture.hits[0]
  check(`R3 ${mode} real event total`, evaluateSkillFlowHit(fixture.context, null, hit, true)?.defenseTriggerFinalPanel?.anomalyReleaseMult, 51.2)
  check(`R3 ${mode} independent detail`, resolveSkillFlowCalculationDetail(fixture.context, null, hit)?.evaluation?.defenseTriggerFinalPanel?.anomalyReleaseMult, 51.2)
}
for (const mode of ['ordinary', 'extra-slot']) for (const damageType of ['direct', 'anomalyRelease']) {
  const fixture = r5Fixture(mode, damageType)
  for (const hit of fixture.hits) {
    const expected = (hit.id === 'A' ? 100 : 150) + (damageType === 'direct' ? 0 : 50)
    const value = evaluation => damageType === 'direct' ? evaluation?.finalPanel?.dmgBonus : evaluation?.defenseTriggerFinalPanel?.anomalyReleaseMult
    check(`R5 ${mode} ${damageType} ${hit.id} real event`, value(evaluateSkillFlowHit(fixture.context, null, hit, true)), expected)
    check(`R5 ${mode} ${damageType} ${hit.id} independent detail`, value(resolveSkillFlowCalculationDetail(fixture.context, null, hit)?.evaluation), expected)
  }
}
for (const damageType of ['direct', 'sharpen', 'attributeAnomaly', 'anomalyRelease', 'disorder', 'turbulence', 'radiance']) {
  const hit = { skill: { damageType, element: '物理' }, ownerAgentId: 'owner', anomalyPowerAgentId: 'power', elementOverride: null }
  const agents = [testAgent('owner', { element: '冰' }), testAgent('power', { element: '电' })]
  const expected = ['direct', 'sharpen'].includes(damageType) ? '冰' : '电'
  check(`E1 ${damageType} auto ignores Skill.element`, resolveEventElement(hit, agents), expected)
  check(`E2 ${damageType} manual wins`, resolveEventElement({ ...hit, elementOverride: '火' }, agents), '火')
  check(`E1 ${damageType} missing role has no fallback`, resolveEventElement(hit, []), undefined)
}
for (const mode of ['ordinary', 'extra-slot', 'extra-team']) {
  const f = r3Fixture(mode)
  const hit = f.hits[0]
  for (const [manual, contribution, total] of [['冰', 0, 50], ['电', 1.2, 51.2], [null, 1.2, 51.2]]) {
    hit.elementOverride = manual
    const detail = evaluateSkillFlowHit(f.context, null, hit, true)
    const preview = resolveEventBuffPreviewInputs(f.context, null, hit, 0)
    const eid = f.items.find(item => item.effect.id.endsWith('release')).effect.id
    check(`E4 ${mode} ${manual} preview`, preview.effectAmounts[eid], contribution)
    check(`E4 ${mode} ${manual} total`, detail?.defenseTriggerFinalPanel?.anomalyReleaseMult, total)
    check(`E4 ${mode} ${manual} numeric/detail`, evaluateSkillFlowHit(f.context, null, hit)?.result, detail?.result)
  }
  for (const source of ['allocation', 'sweep']) {
    clearAffixEvalCache()
    const counts = createEmptyAffixCounts()
    counts.atkFlat = source === 'allocation' ? 2 : 4
    const candidate = evaluateAffixCounts(f.context, counts).external
    const selected = resolveSkillFlowPanelSource({ mode: source, currentSignature: source, options: {
      [source]: { mode: source, signature: source, mainExternal: candidate, extraGains: [], baseDamageSource: 'atk' },
    } })
    for (const elementOverride of [null, '冰']) {
      const event = { ...hit, elementOverride }
      const numeric = evaluateSkillFlowHit(f.context, selected.mainExternal, event)
      const detail = resolveSkillFlowCalculationDetail(f.context, selected.mainExternal, event).evaluation
      check(`E9 R3 ${mode}/${source}/${elementOverride} release`, numeric.defenseTriggerFinalPanel.anomalyReleaseMult, elementOverride ? 50 : 51.2)
      check(`E9 R3 ${mode}/${source}/${elementOverride} detail`, detail.result, numeric.result)
    }
  }
}
// A and B are expanded independently. Group/member settings never store the resolved default.
{
  const f = r5Fixture('ordinary', 'direct')
  const members = [{ skillId: f.skill.id, order: 0, count: 1 }, { skillId: f.skill.id, order: 1, count: 1 }]
  const entry = { id: 'group', preparedId: 'group-prep', count: 1, staggerPhase: 'normal', critMode: 'expected', elementOverride: '火',
    memberOverrides: [{ memberKey: `1:${f.skill.id}`, skillId: f.skill.id, elementOverride: '冰' }] }
  const options = { teamSlots: f.teamSlots, slots: [{ prepared: [{ id: 'group-prep', skillGroupId: 'g' }], flow: [entry] }],
    findSkill: () => f.skill, findSkillGroup: () => ({ id: 'g', members }) }
  check('E3 group/member own values', resolveFlow(options).hits.map(hit => hit.elementOverride), ['火', '冰'])
  delete entry.memberOverrides[0].elementOverride
  check('E3 clear member inherits group', resolveFlow(options).hits.map(hit => hit.elementOverride), ['火', '火'])
  delete entry.elementOverride
  check('E3 clear group returns auto', resolveFlow(options).hits.map(hit => hit.elementOverride), [null, null])
  check('E3 prepared preview is auto', resolveSkillPreviews(options).map(hit => hit.elementOverride), [null, null])
  for (const invalid of [null, '', ' ', 'invalid']) {
    const normalized = normalizeFlowEventElements({ ...entry, elementOverride: invalid, memberOverrides: [{ skillId: 'x', elementOverride: invalid }] })
    check(`E7 invalid ${JSON.stringify(invalid)} removes own field`, Object.hasOwn(normalized, 'elementOverride'), false)
    check(`E7 invalid ${JSON.stringify(invalid)} keeps event/member`, [normalized.id, Object.hasOwn(normalized.memberOverrides[0], 'elementOverride')], ['group', false])
  }
}
for (const mode of ['ordinary', 'extra-slot']) for (const damageType of ['direct', 'anomalyRelease']) {
  const f = r5Fixture(mode, damageType)
  const fixed = f.items.find(item => item.effect.id.endsWith('fixed'))
  const convert = f.items.find(item => item.effect.id.endsWith('convert'))
  const a = f.hits[0], b = f.hits[1]
  for (const override of [{ disabledEffectIds: [fixed.effect.id] }, { disabledBlockIds: [blockKeyOfCollected(fixed)] }]) {
    const hit = { ...a, buffOverride: override }
    const preview = resolveEventBuffPreviewInputs(f.context, null, hit, 0)
    check(`E5 ${mode} ${damageType} ${Object.keys(override)[0]} contribution`, preview.effectAmounts[convert.effect.id], 100)
    check(`E5 ${mode} ${damageType} disabled contribution`, preview.effectAmounts[fixed.effect.id], 0)
    const full = resolveSkillFlowCalculationDetail(f.context, null, hit)?.evaluation
    check(`E5 ${mode} ${damageType} real total`, damageType === 'direct' ? full?.finalPanel.dmgBonus : full?.defenseTriggerFinalPanel.anomalyReleaseMult, damageType === 'direct' ? 100 : 150)
    check(`E5 ${mode} ${damageType} sources reflect row`, full?.breakdown.sources.reduce((sum, source) => sum + (source.mods[convert.effect.stat] ?? 0), 0), 100)
  }
  const global = computeFinalPanel(f.panels.owner, { ...f.panelContext, skillContext: buildGenericPanelSkillContext({ element: '电' }) })
  check(`E5 ${mode} ${damageType} global remains150`, global.totalMods[convert.effect.stat], 150)
  check(`E5 ${mode} ${damageType} B remains150`, resolveEventBuffPreviewInputs(f.context, null, b, 0).effectAmounts[convert.effect.id], 150)
  // Real source selection plus the production affix panel generator, no preview-supplied row map.
  for (const [source, atk, expectedA, expectedB] of [['config', 1000, 100, 150], ['allocation', 2000, 200, 250], ['sweep', 3000, 300, 350]]) {
    const counts = createEmptyAffixCounts()
    counts.atkFlat = source === 'allocation' ? 1000 / 19 : 2000 / 19
    // Test candidate generator is configured with a precise per-roll amount, to avoid game rounding obscuring the source.
    clearAffixEvalCache()
    const candidate = evaluateAffixCounts(f.context, counts, undefined, { ...AFFIX_VALUE_PER_COUNT, atkFlat: 19 }).external
    // The generator returns the active panel plus affix rolls; assertions ensure the actual chosen source value.
    if (source !== 'config') check(`E9 ${source} generated atk`, candidate.atk, atk)
    const resolved = resolveSkillFlowPanelSource({ mode: source, currentSignature: 'fixture', options: source === 'config' ? {} : {
      [source]: { mode: source, signature: 'fixture', mainExternal: candidate, extraGains: [], baseDamageSource: 'atk' },
    } })
    const context = withAffixLibraryExtraGains(f.context, resolved.extraGains ?? [])
    for (const [hit, expected] of [[a, expectedA], [b, expectedB]]) {
      const preview = resolveEventBuffPreviewInputs(context, resolved.mainExternal, hit, 0)
      const numeric = evaluateSkillFlowHit(context, resolved.mainExternal, hit)
      const detailed = resolveSkillFlowCalculationDetail(context, resolved.mainExternal, hit)?.evaluation
      check(`E9 ${mode} ${damageType} ${source} ${hit.id} source`, buildEventPanelContext(context, resolved.mainExternal, hit, 0).panelSourceValues.external.atk, atk)
      check(`E9 ${mode} ${damageType} ${source} ${hit.id} preview`, preview.effectAmounts[convert.effect.id], expected)
      check(`E9 ${mode} ${damageType} ${source} ${hit.id} total`, damageType === 'direct' ? detailed?.finalPanel.dmgBonus : detailed?.defenseTriggerFinalPanel.anomalyReleaseMult, expected + (damageType === 'direct' ? 0 : 50))
      check(`E9 ${mode} ${damageType} ${source} ${hit.id} numeric/detail`, numeric?.result, detailed?.result)
    }
  }
}
// Element filters use event element for both targets; a foreign source/beneficiary element cannot replace it.
for (const mode of ['ordinary', 'extra-slot', 'extra-team']) for (const applyTarget of ['self', 'team']) {
  const f = eventFixture({ mode, damageType: 'direct', effects: [createEmptyBuffEffect({ id: 'fire', stat: 'atk', value: 5050, enabledDefault: true, elementFilter: ['火'], applyTarget })],
    agents: [testAgent('owner', { element: '冰' }), testAgent('power', { element: '电' })] })
  f.skill.element = '物理'
  check(`E2 ${mode}/${applyTarget} default ice ignores fire buff`, evaluateSkillFlowHit(f.context, null, f.hits[0])?.finalPanel.atk, 1000)
  f.hits[0].elementOverride = '火'
  check(`E2 ${mode}/${applyTarget} fire matches`, evaluateSkillFlowHit(f.context, null, f.hits[0])?.finalPanel.atk, 6050)
  check(`E2 ${mode}/${applyTarget} B unaffected`, evaluateSkillFlowHit(f.context, null, f.hits[1])?.finalPanel.atk, 1000)
  for (const source of ['allocation', 'sweep']) {
    clearAffixEvalCache()
    const counts = createEmptyAffixCounts()
    counts.atkFlat = source === 'allocation' ? 1 : 2
    const candidate = evaluateAffixCounts(f.context, counts).external
    const selected = resolveSkillFlowPanelSource({ mode: source, currentSignature: source, options: {
      [source]: { mode: source, signature: source, mainExternal: candidate, extraGains: [], baseDamageSource: 'atk' },
    } })
    check(`E9 E2 ${mode}/${applyTarget}/${source} event element`, evaluateSkillFlowHit(f.context, selected.mainExternal, f.hits[0]).finalPanel.atk, candidate.atk + 5050)
    check(`E9 E2 ${mode}/${applyTarget}/${source} detail element`, resolveSkillFlowCalculationDetail(f.context, selected.mainExternal, f.hits[0]).evaluation.eventElement, '火')
  }
}
for (const damageType of ['direct', 'anomalyRelease']) {
  const f = eventFixture({ damageType, effects: [], enemyInput: { elementResistance: { 火: 'normal', 冰: 'res40' } },
    panels: { owner: makePanel({ atk: 1000, directDmgMult: 100, critRate: 0, anomalyReleaseMult: 50 }), power: makePanel({ atk: 2000, critRate: 0 }) } })
  const hit = f.hits[0]
  hit.elementOverride = '火'
  const fire = evaluateSkillFlowHit(f.context, null, hit, true)
  hit.elementOverride = '冰'
  const ice = resolveSkillFlowCalculationDetail(f.context, null, hit)?.evaluation
  check(`E6 ${damageType} fire resistance`, fire?.result.resistanceMultiplier, 1)
  check(`E6 ${damageType} ice resistance`, ice?.result.resistanceMultiplier, 0.6)
  check(`E6 ${damageType} real damage ratio`, Math.abs(ice.perHit - fire.perHit * 0.6) <= 1, true)
  check(`E6 ${damageType} detail element`, ice.eventElement, '冰')
}
{
  const f = r3Fixture('ordinary'), hit = f.hits[0]
  clearHitEvalCache()
  for (const elementOverride of [null, '火', '冰', null]) {
    hit.elementOverride = elementOverride
    const key = hitEvalCacheKey(buildHitEvalFingerprint(hit), 'elements', f.panels.owner, false)
    const cold = evaluateSkillFlowHit(f.context, null, hit)
    if (!readHitEvalCache(key)) writeHitEvalCache(key, { hitId: hit.id, ...cold })
    const hot = readHitEvalCache(key)
    check(`E8 ${elementOverride} real cache/result`, hot.result, cold.result)
    check(`E8 ${elementOverride} real cache/element`, hot.eventElement, resolveEventElement(hit, f.agents))
  }
  check('E8 real cache was hit', hitEvalCacheDebugStats().hits >= 4, true)
}
check('E6 luminous keeps existing filter semantics', effectMatchesElement(createEmptyBuffEffect({ elementFilter: ['火'] }), '流明'), false)
{
  const f = eventFixture({ damageType: 'radiance', effects: [],
    agents: [testAgent('owner', { element: '流明', name: '蕾米埃尔' }), testAgent('power', { element: '冰' })],
    prepared: [{ id: 'prepared', skillId: 'event-skill', skillSource: 'custom', anomalyPowerAgentId: 'owner', triggerAgentId: 'owner' }],
    enemyInput: { elementResistance: { 火: 'normal', 冰: 'res40' } },
    panels: { owner: makePanel({ atk: 1000, mastery: 100, radianceMult: 360, mutationCoeff: 100 }), power: makePanel({ atk: 2000 }) },
  })
  const hit = f.hits[0]
  hit.elementOverride = '火'
  const fire = evaluateSkillFlowHit(f.context, null, hit, true)
  hit.elementOverride = '冰'
  const ice = resolveSkillFlowCalculationDetail(f.context, null, hit)?.evaluation
  check('E6 self radiance fire resistance follows manual E', fire?.result.remielSelfResistanceMultiplier, 1)
  check('E6 self radiance ice resistance follows manual E', ice?.result.remielSelfResistanceMultiplier, 0.6)
  check('E6 self radiance details report used resistance element', fire?.result.remielSelfResistanceElement, '火')
  check('E6 self radiance actual damage ratio', fire.perHit > 0 && Math.abs(ice.perHit - fire.perHit * 0.6) <= 1, true)
}
{
  const effect = createEmptyBuffEffect({ id: 'self-atk', kind: 'convert', stat: 'atk', enabledDefault: true,
    convert: { from: 'atk', panelSource: 'manual', defaultBase: 1000, ratioPercent: 10, initialBase: 0, cap: null } })
  const f = eventFixture({ damageType: 'radiance', effects: [effect],
    agents: [testAgent('owner', { element: '流明', name: '蕾米埃尔' }), testAgent('power', { element: '冰' })],
    prepared: [{ id: 'prepared', skillId: 'event-skill', anomalyPowerAgentId: 'owner', triggerAgentId: 'owner' }],
    panels: { owner: makePanel({ atk: 1000, mastery: 100, radianceMult: 360, mutationCoeff: 100 }), power: makePanel({ atk: 2000 }) },
  })
  const eid = f.items.find(item => item.effect.id.endsWith('self-atk')).effect.id
  const hit = { ...f.hits[0], elementOverride: '火', buffOverride: { convertInputsByEffectId: { [eid]: 3000 } } }
  const actual = evaluateSkillFlowHit(f.context, null, hit, true)
  check('E5 self radiance real row convert input', actual.result.remielSelfInCombatAtk, 1300)
  check('E5 self radiance row detail explains same contribution', actual.remielSelfAtkSourceItems.some(text => text.includes('+300')), true)
}
// Real SFC model writers preserve other overrides; clearing only removes the current element field.
{
  const entry = { id: 'ui-group', preparedId: 'p', count: 1, memberOverrides: [{ memberKey: '0:event-skill', skillId: 'event-skill', buffOverrides: { convertInputsByEffectId: { example: 0 } } }] }
  const member = { order: 0, skillId: 'event-skill', count: 1 }
  const ui = bindVueFunctions(new URL('../src/components/calculator/SkillFlowSection.vue', import.meta.url),
    ['setFlowElement', 'setMemberElement', 'setMemberOverride'], {
      getActiveSlot: () => ({ flow: [entry] }), normalizeEventElement, skillGroupMemberKey, isFlowBuffOverrideEmpty,
    })
  ui.setFlowElement(entry.id, '火')
  ui.setMemberElement(entry.id, member, '冰')
  check('E3 real UI stores only own settings', [entry.elementOverride, entry.memberOverrides[0].elementOverride], ['火', '冰'])
  ui.setMemberOverride(entry.id, member, { count: 2 })
  check('E3 real UI count edit preserves element/buff', [entry.memberOverrides[0].elementOverride, entry.memberOverrides[0].buffOverrides.convertInputsByEffectId.example], ['冰', 0])
  ui.setMemberElement(entry.id, member, '')
  check('E3 real UI clear member does not store inherited fire', Object.hasOwn(entry.memberOverrides[0], 'elementOverride'), false)
  check('E3 real UI clear member preserves group/other fields', [entry.elementOverride, entry.memberOverrides[0].count], ['火', 2])
  ui.setFlowElement(entry.id, '')
  check('E3 real UI clear group removes field', Object.hasOwn(entry, 'elementOverride'), false)
}
for (const mode of ['ordinary', 'extra-slot']) for (const disabledBy of ['parent-effect', 'parent-block', 'member-effect', 'member-block']) {
  const f = r5Fixture(mode)
  const fixed = f.items.find(item => item.effect.id.endsWith('fixed'))
  const own = disabledBy.endsWith('effect') ? { disabledEffectIds: [fixed.effect.id] } : { disabledBlockIds: [blockKeyOfCollected(fixed)] }
  const entry = { id: 'group', preparedId: 'gp', count: 1, staggerPhase: 'stagger',
    ...(disabledBy.startsWith('parent') ? { buffOverrides: own } : {}),
    memberOverrides: disabledBy.startsWith('member') ? [{ memberKey: `0:${f.skill.id}`, skillId: f.skill.id, buffOverrides: own }] : null }
  const hits = resolveFlow({ teamSlots: f.teamSlots, slots: [{ prepared: [{ id: 'gp', skillGroupId: 'group', anomalyPowerAgentId: 'power', triggerAgentId: 'owner' }], flow: [entry] }],
    findSkill: () => f.skill, findSkillGroup: () => ({ members: [{ skillId: f.skill.id, order: 0, count: 1 }, { skillId: f.skill.id, order: 1, count: 1 }] }) }).hits
  for (const [index, hit] of hits.entries()) {
    const expected = disabledBy.startsWith('parent') || index === 0 ? 150 : 200
    check(`E5 ${mode} ${disabledBy} member${index} calculation`, evaluateSkillFlowHit(f.context, null, hit)?.defenseTriggerFinalPanel.anomalyReleaseMult, expected)
    check(`E5 ${mode} ${disabledBy} member${index} detail`, resolveSkillFlowCalculationDetail(f.context, null, hit)?.evaluation.defenseTriggerFinalPanel.anomalyReleaseMult, expected)
    const eid = f.items.find(item => item.effect.id.endsWith('convert')).effect.id
    check(`E5 ${mode} ${disabledBy} member${index} preview`, resolveEventBuffPreviewInputs(f.context, null, hit, 0).effectAmounts[eid], expected - 50)
  }
}
// Existing automatic defaults and duration branch use final E; filled panel/skill values stay intact.
{
  const { resolveInherentSkillMultPercent, unsetSkillMult, skillMultNeedsAnomalyPowerProvider } = await import('../src/utils/skillSubcategoryMult.ts')
  const { resolveEffectiveBaseMult } = await import('../src/utils/skillTalentLevels.ts')
  const { ref } = await import('vue')
  for (const [damageType, element, expected] of [['attributeAnomaly', '火', '50'], ['attributeAnomaly', '电', '125'], ['turbulence', '火', '900'], ['turbulence', '冰', '1300']]) {
    const f = eventFixture({ damageType, effects: [], agents: [testAgent('owner', { element: '风' }), testAgent('power')], panels: { owner: makePanel(), power: makePanel() } })
    f.hits[0].elementOverride = element
    const ui = bindVueFunctions(new URL('../src/components/calculator/SkillFlowSection.vue', import.meta.url), ['skillMultText', 'libraryEffectiveBaseMult'], {
      props: { hits: f.hits, agents: f.agents, teamSlots: f.teamSlots }, currentAgentId: ref('owner'), skillSubcategories: ref([]),
      resolveEventElement, resolveInherentSkillMultPercent, unsetSkillMult, skillMultNeedsAnomalyPowerProvider, resolveEffectiveBaseMult,
    })
    check(`E6 existing UI automatic default ${damageType}/${element}`, ui.skillMultText(f.skill, f.hits[0].id), expected)
  }
}
{
  const f = eventFixture({ damageType: 'disorder', effects: [], panels: { owner: makePanel({ anomalyDuration: 10, disorderBaseMult: 450, disorderCompMult: 7.5 }), power: makePanel({ anomalyDuration: 10, disorderBaseMult: 450, disorderCompMult: 7.5 }) } })
  const hit = f.hits[0]
  hit.elementOverride = '冰'
  const ice = evaluateSkillFlowHit(f.context, null, hit, true)
  hit.elementOverride = '火'
  const fire = evaluateSkillFlowHit(f.context, null, hit, true)
  check('E6 filled duration unchanged by E', fire.producerFinalPanel.anomalyDuration, 10)
  check('E6 fire duration branch doubles effective duration', [ice.result.effectiveAnomalyDuration, fire.result.effectiveAnomalyDuration], [10, 20])
}
{
  const f = eventFixture({ damageType: 'direct', effects: [], agents: [testAgent('owner', { element: '冰' }), testAgent('power', { element: '火' })], enemyInput: { elementResistance: { 火: 'normal', 冰: 'res40' } } })
  f.hits[0].elementOverride = '流明'
  const full = evaluateSkillFlowHit(f.context, null, f.hits[0], true)
  check('E6 luminous manual uses automatic owner as mapping anchor', [full.eventElement, full.result.resistanceMultiplier], ['流明', 1])
  // No manual element can make a missing actual panel/role eligible.
  delete f.context.panelContext.activeSlotPanels.owner
  check('E2 manual does not bypass missing panel', evaluateSkillFlowHit(f.context, null, f.hits[0]), null)
}
{
  const f = r3Fixture('ordinary'), hit = f.hits[0], counts = createEmptyAffixCounts()
  clearAffixEvalCache()
  for (const manual of [null, '火', '冰', null]) {
    hit.elementOverride = manual
    // 捕获的上下文不与调用方容器互为别名，明确替换真实评估输入。
    f.context.hits = f.hits
    const cold = evaluateAffixCountsWithCacheInfo(f.context, counts)
    const hot = evaluateAffixCountsWithCacheInfo(f.context, counts)
    check(`E8 ${manual} affix cache really hit`, hot.cacheHit, true)
    check(`E8 ${manual} affix cache same actual event`, hot.value.eventLines[0].perHit, evaluateSkillFlowHit(f.context, hot.value.external, hit).perHit)
    check(`E8 ${manual} affix hot/cold`, hot.value.result, cold.value.result)
  }
  f.agents.find(agent => agent.id === 'power').element = '冰'
  f.context.panelContext.agents.find(agent => agent.id === 'power').element = '冰'
  check('E8 auto source role element changes shared parser', resolveEventElement(hit, f.agents), '冰')
  const changed = evaluateAffixCountsWithCacheInfo(f.context, counts)
  check('E8 auto role element invalidates actual affix cache', changed.cacheHit, false)
}
for (const mode of ['ordinary', 'extra-team']) {
  const effect = createEmptyBuffEffect({ id: 'event-mutation', stat: 'mutationCoeff', value: 100, applyTarget: 'team', elementFilter: ['电'], enabledDefault: true })
  const f = eventFixture({ mode, damageType: 'radiance', effects: [effect],
    agents: [testAgent('owner', { element: '流明', name: '蕾米埃尔' }), testAgent('power', { element: '电' })],
    prepared: [{ id: 'prepared', skillId: 'event-skill', anomalyPowerAgentId: 'power', triggerAgentId: 'owner' }],
    panels: { owner: makePanel({ atk: 1000, radianceMult: 360 }), power: makePanel({ atk: 2000, mastery: 100 }) },
  })
  const hit = f.hits[0], eid = f.items.find(item => item.effect.id.endsWith('event-mutation')).effect.id
  const actual = evaluateSkillFlowHit(f.context, null, hit, true)
  check(`E4 luminous team ${mode} event element match`, actual.result.mutationZone, 2)
  check(`E5 luminous team ${mode} detail source matches event`, actual.mutationFinalPanel.mutationCoeff, 100)
  const disabled = { ...hit, buffOverride: { disabledEffectIds: [eid] } }
  check(`E5 luminous team ${mode} row disable`, evaluateSkillFlowHit(f.context, null, disabled, true).result.mutationZone, 1)
  check(`E5 luminous team ${mode} preview disable`, resolveEventBuffPreviewInputs(f.context, null, disabled, 0).effectAmounts[eid], 0)
}
console.log(`event-element: ${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
