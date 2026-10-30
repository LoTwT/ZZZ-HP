import assert from 'node:assert/strict'
import fs from 'node:fs'
import { nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { eventFixture, eventRuntimeInput } from './_eventElementHarness.mjs'
import { testAgent } from './_effectPipelineHarness.mjs'
import { mountVueSetup } from './_vueSetupHarness.mjs'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { collectAllBuffEffects, invalidateBuffCatalogCache, blockKeyOfCollected } from '../src/utils/panelBuffCalc.ts'
import { buildEventValueTips } from '../src/utils/eventDamageSourceTips.ts'
import { createBuffCalculationRuntime, evaluateSkillFlowHit } from '../src/utils/skillFlowCalculation.ts'
import { resolveEventBuffPreviewInputs, projectEventEffectRecords } from '../src/utils/optimalAffixAlloc.ts'
import { clearHitEvalCache, hitEvalCacheDebugStats, internHitEvalContext } from '../src/utils/hitEvalCache.ts'

let passed = 0
let failed = 0
async function check(name, run) {
  try { await run(); passed += 1; console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`) }
}
const fixed = (id, stat, value, extra = {}) => createEmptyBuffEffect({ id, stat, value, enabledDefault: true, applyTarget: 'team', ...extra })
const convert = (id, extra = {}) => createEmptyBuffEffect({ id, stat: 'dmgBonus', kind: 'convert', enabledDefault: true, applyTarget: 'team', convert: { from: 'atk', panelSource: 'external', ratioPercent: 10, initialBase: 0, cap: null }, ...extra })
const idIn = (fixture, suffix, slot = 0) => collectAllBuffEffects({ ...fixture.context.panelContext, mainSlotIndex: slot }).find(item => item.effect.id.endsWith(suffix)).effect.id
async function sfcImports(url) {
  const imports = {}
  const source = fs.readFileSync(url, 'utf8').split('</script>')[0]
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    const key = match[1]
    if (key === 'vue' || key.endsWith('.vue') || key in imports) continue
    imports[key] = key.startsWith('@/') ? await import(new URL(`../src/${key.slice(2)}.ts`, import.meta.url).href) : await import(key)
  }
  return imports
}

for (const mode of ['ordinary', 'extra-team']) {
  for (const stat of ['mastery', 'attributeAnomalyDmgBonus']) await check(`${mode}: direct does not adopt ${stat}`, () => {
    const f = eventFixture({ mode, damageType: 'direct', effects: [fixed('unused', stat, 25)] })
    const d = evaluateSkillFlowHit(f.context, null, f.hits[0], true)
    assert.equal(projectEventEffectRecords(d.effectRecords)[idIn(f, 'unused')].state, 'inactive')
  })
  for (const critMode of ['noCrit', 'fullCrit', 'expected']) await check(`${mode}: only selected ${critMode} inputs are adopted`, () => {
    const f = eventFixture({ mode, damageType: 'direct', effects: [fixed('crit-rate', 'critRate', 25), fixed('crit-damage', 'critDmg', 50)] })
    const d = evaluateSkillFlowHit(f.context, null, { ...f.hits[0], critMode }, true)
    const fields = new Set(d.damageInputUsages.map(u => u.field))
    assert.equal(fields.has('critRate'), critMode === 'expected')
    assert.equal(fields.has('critDmg'), critMode !== 'noCrit')
  })
  await check(`${mode}: overwritten release multiplier is a candidate but not a recipient`, () => {
    const f = eventFixture({ mode, damageType: 'anomalyRelease', effects: [fixed('release-original', 'anomalyReleaseMult', 50)] })
    const d = evaluateSkillFlowHit(f.context, null, { ...f.hits[0], multOverrides: { anomalyReleaseMult: 100 } }, true)
    assert.equal(projectEventEffectRecords(d.effectRecords)[idIn(f, 'release-original')].state, 'inactive')
  })
  await check(`${mode}: unused energy regen is not a direct-event recipient`, () => {
    const f = eventFixture({ mode, damageType: 'direct', effects: [fixed('unused-energy', 'energyRegen', 25)] })
    const id = idIn(f, 'unused-energy')
    const d = evaluateSkillFlowHit(f.context, null, f.hits[0], true)
    const off = evaluateSkillFlowHit(f.context, null, { ...f.hits[0], buffOverride: { disabledEffectIds: [id] } })
    assert.equal(d.total, off.total)
    assert.equal(projectEventEffectRecords(d.effectRecords)[id].state, 'inactive')
  })
  await check(`${mode}: source-only attack remains an indirect conversion dependency`, () => {
    const f = eventFixture({ mode, damageType: 'direct', sourceSlot: 1, effects: [fixed('source-atk', 'atk', 500, { applyTarget: 'self' }), convert('derived', { convert: { from: 'atk', panelSource: 'final', ratioPercent: 10, initialBase: 0, cap: null } })] })
    if (mode === 'extra-team') f.context.panelContext.extraGains[0].applySlot = 1
    invalidateBuffCatalogCache()
    const id = idIn(f, 'source-atk', 1)
    const hit = { ...f.hits[0], multOverrides: { directDmgMult: 100 } }
    const d = evaluateSkillFlowHit(f.context, null, hit, true)
    const off = evaluateSkillFlowHit(f.context, null, { ...hit, buffOverride: { disabledEffectIds: [id] } })
    assert.equal(d.total, 3261)
    assert.equal(off.total, 2795)
    const p = resolveEventBuffPreviewInputs(f.context, null, hit, 1, d)
    assert.equal(p.effectAmounts[id], 500)
    assert.ok(p.effectSummaries[id].recipients.some(r => r.usedViews.includes('convertSourcePanel')))
  })
  await check(`${mode}: candidate panel supplies both the effective base and input model`, () => {
    const f = eventFixture({ mode, damageType: 'direct', effects: [convert('candidate')] })
    const candidate = { ...f.panels.owner, atk: 3000 }
    const p = resolveEventBuffPreviewInputs(f.context, candidate, f.hits[0], 0)
    const id = idIn(f, 'candidate')
    assert.equal(p.effectAmounts[id], 300)
    assert.equal(p.configurationParameters[id].convertBase.value, 3000)
    assert.equal(p.configurationParameters[id].amount, 300)
  })
  for (const [stat, from] of [['hp', 'pierce'], ['atk', 'pierce'], ['pierce', 'pierce'], ['anomalyControlPercent', 'anomalyControl'], ['energyRegenFlat', 'energyRegen']]) await check(`${mode}: ${stat} feeds a ${from} conversion base`, () => {
    const f = eventFixture({ mode, damageType: 'direct', sourceSlot: 1, effects: [
      fixed('source-base', stat, 500, { applyTarget: 'self' }),
      convert('derived-pierce', { convert: { from, panelSource: 'final', ratioPercent: 10, initialBase: 0, cap: null } }),
    ] })
    if (mode === 'extra-team') f.context.panelContext.extraGains[0].applySlot = 1
    invalidateBuffCatalogCache()
    const id = idIn(f, 'source-base', 1)
    const hit = { ...f.hits[0], multOverrides: { directDmgMult: 100 } }
    const d = evaluateSkillFlowHit(f.context, null, hit, true)
    const off = evaluateSkillFlowHit(f.context, null, { ...hit, buffOverride: { disabledEffectIds: [id] } })
    assert.ok(d.total > off.total)
    const p = resolveEventBuffPreviewInputs(f.context, null, hit, 1, d)
    assert.equal(p.effectAmounts[id], 500)
    assert.ok(p.effectSummaries[id].recipients.some(r => r.usedViews.includes('convertSourcePanel')))
  })
  await check(`${mode}: explicit zero overrides and clearing restore the permitted inherited base`, () => {
    const f = eventFixture({ mode, damageType: 'direct', effects: [convert('zero-base')] })
    const id = idIn(f, 'zero-base')
    f.context.panelContext.buffSelection = { enabledIds: {}, stacksByEffectId: {}, convertInputs: { [id]: 2000 } }
    const hit = { ...f.hits[0], buffOverride: { convertInputsByEffectId: { [id]: 0 } } }
    const zero = resolveEventBuffPreviewInputs(f.context, null, hit, 0)
    assert.equal(zero.configurationParameters[id].convertBase.value, 0)
    assert.equal(zero.effectAmounts[id], 0)
    const inherited = resolveEventBuffPreviewInputs(f.context, null, { ...hit, buffOverride: null }, 0)
    assert.equal(inherited.configurationParameters[id].convertBase.value, mode === 'ordinary' ? 2000 : 1000)
    assert.equal(inherited.effectAmounts[id], mode === 'ordinary' ? 200 : 100)
  })
  await check(`${mode}: conversion identity and both raw stages survive numeric warmup`, () => {
    const f = eventFixture({ mode, damageType: 'direct', sourceSlot: 1, effects: [convert('identity')] })
    evaluateSkillFlowHit(f.context, null, f.hits[0], false)
    const d = evaluateSkillFlowHit(f.context, null, f.hits[0], true)
    const id = idIn(f, 'identity')
    const records = d.effectRecords.filter(r => r.effectId === id && r.beneficiarySlot === 0)
    assert.equal(records.length, 1)
    assert.ok(records[0].sourceKey)
    assert.ok(records[0].blockId)
    assert.equal(records[0].providerSlot, mode === 'ordinary' ? 1 : null)
    assert.equal(records[0].sourceSlot, 1)
    const stages = d.panelStageTraces.flatMap(t => t.contributions).filter(r => r.effectId === id && r.beneficiarySlot === 0)
    assert.ok(stages.some(r => r.status === 'convert-skipped' && r.stage === 'preConvert'))
    assert.ok(stages.some(r => r.status === 'applied' && r.stage === 'convert'))
  })
}

await check('self radiance uses shared profession gating instead of the legacy numeric loop', () => {
  const effect = convert('gated-self', { stat: 'atk', applyTarget: 'self', applyProfession: '支援', convert: { from: 'mastery', panelSource: 'external', ratioPercent: 100, initialBase: 0, cap: null } })
  const f = eventFixture({ damageType: 'radiance', sourceSlot: 1, effects: [effect], agents: [testAgent('owner'), testAgent('power', { profession: '异常', element: '流明' })] })
  const hit = { ...f.hits[0], ownerAgentId: 'power', triggerAgentId: 'power', multOverrides: { radianceMult: 100 } }
  const d = evaluateSkillFlowHit(f.context, null, hit, true)
  assert.equal(d.result.remielSelfInCombatAtk, 2000)
  assert.equal(d.total, 9090)
  const s = projectEventEffectRecords(d.effectRecords)[idIn(f, 'gated-self', 1)]
  assert.equal(s.state, 'inactive')
})

await check('self radiance adopts only eligible attack conversion, not an own fixed attack bonus', () => {
  const f = eventFixture({ damageType: 'radiance', sourceSlot: 0, effects: [
    fixed('self-fixed', 'atk', 500, { applyTarget: 'self' }),
    convert('self-converted', { stat: 'atk', applyTarget: 'self', convert: { from: 'mastery', panelSource: 'external', ratioPercent: 100, initialBase: 0, cap: null } }),
  ], agents: [testAgent('owner', { profession: '异常', element: '流明' }), testAgent('power')] })
  const hit = { ...f.hits[0], anomalyPowerAgentId: 'owner', triggerAgentId: 'owner', multOverrides: { radianceMult: 100 } }
  const numeric = evaluateSkillFlowHit(f.context, null, hit, false)
  const d = evaluateSkillFlowHit(f.context, null, hit, true)
  assert.equal(d.total, numeric.total)
  assert.equal(d.result.remielSelfInCombatAtk, 1100)
  const summaries = projectEventEffectRecords(d.effectRecords)
  assert.equal(summaries[idIn(f, 'self-fixed')].state, 'inactive')
  const converted = summaries[idIn(f, 'self-converted')]
  assert.equal(converted.amount, 100)
  assert.equal(converted.recipients.length, 1)
  assert.ok(converted.candidates.some(c => c.usedInputs.some(u => u.usedView === 'radianceSelfPanel' && u.field === 'inCombatAtk')))
})

await check('extra conversion with a missing source preserves the shared zero-source rule', () => {
  const f = eventFixture({ mode: 'extra-team', damageType: 'direct', effects: [convert('missing-source')] })
  f.context.panelContext.extraGains[0].sourceSlot = 2
  invalidateBuffCatalogCache()
  const id = idIn(f, 'missing-source')
  const p = resolveEventBuffPreviewInputs(f.context, null, f.hits[0], 0)
  assert.equal(p.configurationParameters[id].convertBase.value, 0)
  assert.equal(p.effectAmounts[id], 0)
})

for (const rowOverride of [false, true]) await check(`ordinary/extra conversion records are equivalent, row override=${rowOverride}`, () => {
  const build = mode => {
    const f = eventFixture({ mode, damageType: 'direct', sourceSlot: 1, effects: [
      fixed('same-atk', 'atk', 50),
      fixed('same-stacks', 'critDmg', 0, { kind: 'stacked', valuePerStack: 25, defaultStacks: 2, maxStacks: 3 }),
      convert('same-convert', { convert: { from: 'atk', panelSource: 'final', ratioPercent: 10, initialBase: 0, cap: null } }),
    ] })
    const hit = { ...f.hits[0] }
    if (rowOverride) hit.buffOverride = { stacksByEffectId: { [idIn(f, 'same-stacks')]: 3 }, convertInputsByEffectId: { [idIn(f, 'same-convert')]: 3000 } }
    const detail = evaluateSkillFlowHit(f.context, null, hit, true)
    const records = detail.effectRecords.map(r => ({
      stat: r.stat, status: r.status, amount: r.amount, stacks: r.stacks,
      base: r.convertBase && { from: r.convertBase.from, value: r.convertBase.value, source: r.convertBase.source, stage: r.convertBase.stage },
      matchElement: r.matchElement, sourceSlot: r.sourceSlot, beneficiarySlot: r.beneficiarySlot,
      policy: r.policy, stage: r.stage,
      uses: r.usedInputs.map(u => [u.field, u.resultKey, u.usedView, u.usedZones]).sort(),
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    for (const r of detail.effectRecords) {
      assert.equal(r.providerSlot, mode === 'ordinary' ? 1 : null)
      assert.ok(r.sourceKey && r.blockId && r.providerName)
    }
    return { total: detail.total, records }
  }
  assert.deepEqual(build('ordinary'), build('extra-team'))
})

await check('real PanelCalcSection preview and detail share a complete snapshot in both orders', async () => {
  const panelUrl = new URL('../src/components/calculator/PanelCalcSection.vue', import.meta.url)
  const imports = await sfcImports(panelUrl)
  const f = eventFixture({ damageType: 'direct', effects: [convert('component')] })
  const slotPanels = Object.fromEntries(Object.entries(f.panels).map(([id, panel]) => [id, { active: 'imported', importedPanel: panel }]))
  const mounted = mountVueSetup(panelUrl, { imports, plugins: [createPinia()], props: { flowCalculationRuntime: createBuffCalculationRuntime(eventRuntimeInput(f)), enemyInput: f.context.enemyInput, agents: f.agents, teamSlots: f.teamSlots, wengines: [], driveDiscs: [], slotPanels, convertSlotPanels: {}, slotBuffSelections: null, skillTalentLevelsByAgent: {}, editedSlotIndex: 0, staggerPhase: 'stagger', damageKind: 'direct', calcMode: 'panel', hits: f.hits, environmentBuffs: [], bangboos: [], selectedBangbooId: 'none', bangbooRefine: 1 } })
  try {
    await nextTick()
    clearHitEvalCache()
    const id = f.hits[0].id
    mounted.vm.getEventBuffPreviewInputs(0, f.hits[0], null)
    const before = hitEvalCacheDebugStats().hits
    const a = mounted.vm.resolveFlowCalculationDetail(id)
    const b = mounted.vm.resolveFlowCalculationDetail(id)
    assert.ok(a)
    assert.equal(a.evaluation, b.evaluation)
    assert.equal(hitEvalCacheDebugStats().hits, before + 2)
    clearHitEvalCache()
    mounted.props.hits = [{ ...f.hits[0], id: 'reverse-order' }]
    await nextTick()
    const c = mounted.vm.resolveFlowCalculationDetail('reverse-order')
    mounted.vm.getEventBuffPreviewInputs(0, mounted.props.hits[0], null)
    assert.equal(hitEvalCacheDebugStats().hits, 1)
    assert.ok(c.evaluation.effectRecords.length)
    const effectId = idIn(f, 'component')
    const configured = mounted.vm.getConfigurationParametersForSlot(0, { disabledEffectIds: [effectId], convertInputsByEffectId: { [effectId]: 3000 } })
    assert.equal(configured[effectId].convertBase.value, 3000)
    assert.equal(configured[effectId].amount, 300)
    mounted.props.skillFlowMainExternalOverride = { ...f.panels.owner, atk: 3000 }
    mounted.props.flowCalculationRuntime = createBuffCalculationRuntime(eventRuntimeInput(f,{mainExternal:mounted.props.skillFlowMainExternalOverride}))
    await nextTick()
    const changed = mounted.vm.resolveFlowCalculationDetail('reverse-order')
    assert.notEqual(changed.evaluation, c.evaluation)
    assert.equal(changed.evaluation.external.atk, 3000)
    // Exercise projection eviction and full-result eviction through the real component entry.
    const hits = Array.from({ length: hitEvalCacheDebugStats().limit + 5 }, (_, i) => ({ ...f.hits[0], id: `capacity-${i}` }))
    mounted.props.hits = hits
    await nextTick()
    clearHitEvalCache()
    const firstProjection = mounted.vm.getEventBuffPreviewInputs(0, hits[0], null)
    const firstDetail = mounted.vm.resolveFlowCalculationDetail(hits[0].id)
    for (let i = 1; i <= 140; i += 1) mounted.vm.getEventBuffPreviewInputs(0, hits[i], null)
    const reprojected = mounted.vm.getEventBuffPreviewInputs(0, hits[0], null)
    assert.notEqual(reprojected, firstProjection)
    assert.equal(mounted.vm.resolveFlowCalculationDetail(hits[0].id).evaluation, firstDetail.evaluation)
    for (let i = 141; i < hits.length; i += 1) mounted.vm.getEventBuffPreviewInputs(0, hits[i], null)
    const replayed = mounted.vm.resolveFlowCalculationDetail(hits[0].id)
    assert.notEqual(replayed.evaluation, firstDetail.evaluation)
    assert.equal(replayed.evaluation.total, firstDetail.evaluation.total)
    assert.equal(mounted.vm.resolveFlowCalculationDetail(hits[0].id).evaluation, replayed.evaluation)
    for (let i = 0; i < 55; i += 1) internHitEvalContext(`takeover-token-${i}`)
    mounted.props.flowCalculationRuntime = createBuffCalculationRuntime(eventRuntimeInput(f,{mainExternal:mounted.props.skillFlowMainExternalOverride}))
    await nextTick()
    const afterTokenEviction = mounted.vm.resolveFlowCalculationDetail(hits[0].id)
    assert.notEqual(afterTokenEviction.evaluation, replayed.evaluation)
    assert.equal(afterTokenEviction.evaluation.total, replayed.evaluation.total)
  } finally { mounted.unmount(); clearHitEvalCache() }
})

for (const mode of ['ordinary', 'extra-team']) await check(`${mode}: real detail tips follow trigger resistance and owner combat sources`, async () => {
  const f = eventFixture({ mode, damageType: 'attributeAnomaly', effects: [fixed('foreign-respen', 'resPen', 25, { applyProfession: '支援' }), fixed('foreign-vulnerable', 'vulnerable', 25, { applyProfession: '支援' })], agents: [testAgent('owner'), testAgent('power', { profession: '支援' })] })
  const d = evaluateSkillFlowHit(f.context, null, f.hits[0], true)
  assert.equal(d.result.resistanceMultiplier, 1)
  const url = new URL('../src/components/calculator/DamageResultDetail.vue', import.meta.url)
  const mounted = mountVueSetup(url, { imports: await sfcImports(url), expose: ['valueTips'], props: {
    sourceTips: buildEventValueTips({evaluation:d,enemyInput:f.context.enemyInput,isMb:false}),
    calcParts: d.result, damageInputUsages: d.damageInputUsages, finalPanel: d.finalPanel, externalPanel: d.external,
    sources: d.breakdown.sources, pierceMod: d.breakdown.totalMods.pierce, piercePower: d.piercePower,
    enemyInput: f.context.enemyInput, isMb: false, show: 'anomaly', anomalySubKind: d.anomalySubKind,
    producerFinalPanel: d.producerFinalPanel, producerExternalPanel: d.producerExternalPanel, producerSources: d.producerBreakdown.sources,
    bonusFinalPanel: d.bonusFinalPanel, bonusExternalPanel: d.bonusExternalPanel, bonusSources: d.bonusBreakdown.sources,
    defenseTriggerFinalPanel: d.defenseTriggerFinalPanel, defenseTriggerExternalPanel: d.defenseTriggerExternalPanel, defenseTriggerSources: d.defenseTriggerBreakdown.sources,
  } })
  try {
    const tips = mounted.vm.valueTips
    assert.ok(!JSON.stringify(tips.resistanceMultiplier).includes('25'), JSON.stringify(tips.resistanceMultiplier))
    assert.ok(!JSON.stringify(tips.vulnerableMultiplier).includes('25'), JSON.stringify(tips.vulnerableMultiplier))
  } finally { mounted.unmount() }
})

for (const mode of ['ordinary', 'extra-team']) await check(`${mode}: self-radiance resistance tip reads the complete resPen view`, async () => {
  const f = eventFixture({ mode, damageType: 'radiance', sourceSlot: 1, effects: [fixed('teammate-respen', 'resPen', 25)],
    agents: [testAgent('owner', { profession: '异常', element: '流明' }), testAgent('power')] })
  const hit = { ...f.hits[0], anomalyPowerAgentId: 'owner', triggerAgentId: 'owner', multOverrides: { radianceMult: 100 } }
  const d = evaluateSkillFlowHit(f.context, null, hit, true)
  assert.equal(d.result.remielSelfResistanceMultiplier, 1.25)
  const url = new URL('../src/components/calculator/DamageResultDetail.vue', import.meta.url)
  const mounted = mountVueSetup(url, { imports: await sfcImports(url), expose: ['valueTips'], props: {
    sourceTips: buildEventValueTips({evaluation:d,enemyInput:f.context.enemyInput,isMb:false}),
    calcParts: d.result, damageInputUsages: d.damageInputUsages, finalPanel: d.finalPanel, externalPanel: d.external,
    sources: d.breakdown.sources, pierceMod: d.breakdown.totalMods.pierce, piercePower: d.piercePower,
    enemyInput: f.context.enemyInput, isMb: false, show: 'anomaly', anomalySubKind: d.anomalySubKind,
    producerFinalPanel: d.producerFinalPanel, producerExternalPanel: d.producerExternalPanel, producerSources: d.producerBreakdown.sources,
    bonusFinalPanel: d.bonusFinalPanel, bonusExternalPanel: d.bonusExternalPanel, bonusSources: d.bonusBreakdown.sources,
    remielSelfFinalPanel: d.remielSelfFinalPanel, remielSelfExternalPanel: d.remielSelfExternalPanel, remielSelfSources: d.remielSelfSources,
  } })
  try { assert.ok(JSON.stringify(mounted.vm.valueTips.remielSelfResistanceMultiplier).includes('25')) }
  finally { mounted.unmount() }
})

for (const mode of ['ordinary', 'extra-slot', 'extra-team']) {
  const build = () => eventFixture({ mode, damageType: 'direct', effects: [
    fixed('config-source', 'atk', 500),
    convert('config-derived', { convert: { from: 'atk', panelSource: 'final', ratioPercent: 10, initialBase: 0, cap: null } }),
  ] })
  await check(`${mode}: disabling a source preserves actual configuration inputs, including block overrides`, () => {
    const f = build()
    const items = collectAllBuffEffects(f.context.panelContext)
    const source = items.find(i => i.effect.id.endsWith('config-source'))
    const derived = items.find(i => i.effect.id.endsWith('config-derived'))
    for (const override of [null, { disabledEffectIds: [source.effect.id] }, { disabledBlockIds: [blockKeyOfCollected(source)] }, { disabledEffectIds: [derived.effect.id] }]) {
      const hit = { ...f.hits[0], multOverrides: { directDmgMult: 100 }, buffOverride: override }
      const d = evaluateSkillFlowHit(f.context, null, hit, true)
      const p = resolveEventBuffPreviewInputs(f.context, null, hit, 0, d)
      const sourceOff = override && !override.disabledEffectIds?.includes(derived.effect.id)
      assert.equal(p.configurationParameters[derived.effect.id].convertBase.value, sourceOff ? 1000 : 1500)
      assert.equal(p.configurationParameters[derived.effect.id].amount, sourceOff ? 100 : 150)
      assert.ok(p.configurationParameters[source.effect.id])
      assert.equal(p.effectAmounts[derived.effect.id], override?.disabledEffectIds?.includes(derived.effect.id) ? 0 : sourceOff ? 100 : 150)
    }
  })
  await check(`${mode}: real global configuration and row modal share the effective source snapshot`, async () => {
    const f = build()
    const items = collectAllBuffEffects(f.context.panelContext)
    const source = items.find(i => i.effect.id.endsWith('config-source'))
    const derived = items.find(i => i.effect.id.endsWith('config-derived'))
    const panelUrl = new URL('../src/components/calculator/PanelCalcSection.vue', import.meta.url)
    const slotPanels = Object.fromEntries(Object.entries(f.panels).map(([id, panel]) => [id, { active: 'imported', importedPanel: panel }]))
    const panel = mountVueSetup(panelUrl, { imports: await sfcImports(panelUrl), plugins: [createPinia()], props: {
      flowCalculationRuntime: createBuffCalculationRuntime(eventRuntimeInput(f)),
      enemyInput: f.context.enemyInput, agents: f.agents, teamSlots: f.teamSlots, wengines: [], driveDiscs: [], slotPanels, convertSlotPanels: {}, slotBuffSelections: null,
      skillTalentLevelsByAgent: {}, editedSlotIndex: 0, staggerPhase: 'stagger', damageKind: 'direct', calcMode: 'panel', hits: f.hits,
      extraGains: f.extraGains, environmentBuffs: [], bangboos: [], selectedBangbooId: 'none', bangbooRefine: 1,
    } })
    let modal
    try {
      assert.equal(panel.vm.getConfigurationParametersForSlot(0)[derived.effect.id].convertBase.value, 1500)
      const override = { disabledEffectIds: [source.effect.id] }
      assert.equal(panel.vm.getConfigurationParametersForSlot(0, override)[derived.effect.id].convertBase.value, 1000)
      const modalUrl = new URL('../src/components/calculator/SkillBuffOverrideModal.vue', import.meta.url)
      modal = mountVueSetup(modalUrl, { imports: await sfcImports(modalUrl), expose: ['convertBaseModel', 'convertResult', 'restoreGlobal'], props: {
        open: true, override, effects: items, slotIndex: 0,
        convertResolveInputs(slot, rowOverride) {
          return panel.vm.getEventBuffPreviewInputs(slot, f.hits[0], rowOverride)
        },
      } })
      assert.equal(modal.vm.convertBaseModel(derived), 1000)
      assert.equal(modal.vm.convertResult(derived), 100)
      modal.vm.restoreGlobal()
      await nextTick()
      assert.equal(modal.vm.convertBaseModel(derived), 1500)
      assert.equal(modal.vm.convertResult(derived), 150)
    } finally { modal?.unmount(); panel.unmount(); clearHitEvalCache() }
  })
}

for (const mode of ['ordinary', 'extra-team']) await check(`${mode}: real optimal sweep section shares numeric/detail inputs, attached gains and candidate invalidation`, async () => {
  const f = eventFixture({ mode, damageType: 'direct', effects: [fixed('optimal-shared', 'dmgBonus', 25)] })
  const attached = eventFixture({ mode: 'extra-team', damageType: 'direct', effects: [fixed('optimal-attached', 'dmgBonus', 10)] }).extraGains
  invalidateBuffCatalogCache()
  const url = new URL('../src/components/calculator/OptimalAffixAllocSection.vue', import.meta.url)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  await router.push('/?mode=sweep')
  const mounted = mountVueSetup(url, { imports: await sfcImports(url), plugins: [createPinia(), router], expose: ['recomputeSkillFlowHitMaps', 'skillFlowHitMapState'], props: {
    enemyInput: f.context.enemyInput, baseDamageSource: 'atk', active: true, damageKind: 'direct', agents: f.agents, teamSlots: f.teamSlots,
    wengines: [], driveDiscs: [], bangboos: [], selectedBangbooId: 'none', bangbooRefine: 1,
    activeSlotPanels: f.panels, editedSlotIndex: 0, hits: f.hits, extraGains: f.extraGains, slotBuffSelections: null,
    flowCalculationRuntime: createBuffCalculationRuntime(eventRuntimeInput(f,{mainExternal:{ ...f.panels.owner, atk:3000 },sourceExtraGains:attached})),
    skillFlowMainExternalOverride: { ...f.panels.owner, atk: 3000 }, skillFlowSourceExtraGains: attached,
  } })
  try {
    await nextTick()
    clearHitEvalCache()
    mounted.vm.recomputeSkillFlowHitMaps()
    const id = f.hits[0].id
    const first = mounted.vm.resolveFlowCalculationDetail(id)
    assert.equal(first.evaluation.external.atk, 3000)
    assert.equal(first.evaluation.finalPanel.dmgBonus, 35)
    assert.equal(mounted.vm.skillFlowHitMapState.map[id], first.evaluation.total)
    assert.deepEqual(mounted.vm.skillFlowHitMapState.results[id], first.evaluation.result)
    assert.equal(mounted.vm.resolveFlowCalculationDetail(id).evaluation, first.evaluation)
    mounted.props.skillFlowMainExternalOverride = { ...f.panels.owner, atk: 4000 }
    mounted.props.skillFlowSourceExtraGains = []
    mounted.props.flowCalculationRuntime = createBuffCalculationRuntime(eventRuntimeInput(f,{mainExternal:mounted.props.skillFlowMainExternalOverride}))
    await nextTick()
    mounted.vm.recomputeSkillFlowHitMaps()
    const changed = mounted.vm.resolveFlowCalculationDetail(id)
    assert.notEqual(changed.evaluation, first.evaluation)
    assert.equal(changed.evaluation.external.atk, 4000)
    assert.equal(changed.evaluation.finalPanel.dmgBonus, 25)
    assert.equal(mounted.vm.skillFlowHitMapState.map[id], changed.evaluation.total)
    assert.deepEqual(mounted.vm.skillFlowHitMapState.results[id], changed.evaluation.result)
  } finally { mounted.unmount(); clearHitEvalCache() }
})

const pairedEventResults = new Map()
for (const mode of ['ordinary', 'extra-team']) for (const damageType of ['direct', 'sharpen', 'attributeAnomaly', 'anomalyRelease', 'disorder', 'turbulence', 'radiance']) {
  await check(`${mode}: actual ${damageType} event matrix preserves numeric/detail/parity and adoption`, () => {
    for (const stat of ['atk','def','hp','penRate','pen','resPen','mastery','dmgBonus','critRate','critDmg','attributeAnomalyDmgBonus','attributeAnomalyMult','attributeAnomalyCritRate','attributeAnomalyCritDmg','anomalyReleaseMult','anomalyReleaseMultFactor','disorderBaseMult','disorderCompMult','anomalyDuration','turbulenceBaseMult','turbulenceCompMult','radianceMult','mutationCoeff','directDmgMult','pierce','pierceDmgBonus','settlementDmgMult','sharpenDmgBonus','sharpenCritDmgBonus']) {
      const f = eventFixture({ mode, damageType, effects: [fixed('matrix', stat, 50)], agents: [
        testAgent('owner', { element: damageType === 'radiance' ? '流明' : damageType === 'turbulence' ? '风' : '电' }), testAgent('power'),
      ] })
      const id = idIn(f, 'matrix')
      const hit = { ...f.hits[0], multOverrides: { directDmgMult: 100, attributeAnomalyMult: 100, anomalyReleaseMult: 100, radianceMult: 100 } }
      const d = evaluateSkillFlowHit(f.context, null, hit, true)
      const n = evaluateSkillFlowHit(f.context, null, hit, false)
      const off = evaluateSkillFlowHit(f.context, null, { ...hit, buffOverride: { disabledEffectIds: [id] } }, true)
      assert.ok(d && n && off, `${damageType}/${stat} must be a calculable event`)
      assert.deepEqual(d.finalPanel, n.finalPanel, stat)
      assert.deepEqual(d.breakdown.totalMods, n.breakdown.totalMods, stat)
      assert.equal(d.total, n.total, stat)
      if (d.total !== off.total) assert.notEqual(projectEventEffectRecords(d.effectRecords)[id].state, 'inactive', stat)
      const key = `${damageType}/${stat}`
      if (mode === 'ordinary') pairedEventResults.set(key, d.result)
      else assert.deepEqual(d.result, pairedEventResults.get(key), `ordinary/extra ${key}`)
    }
  })
}

console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
