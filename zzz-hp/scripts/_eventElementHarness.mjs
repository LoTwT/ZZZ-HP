import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { createExtraBuffGain } from '../src/utils/extraBuffCalc.ts'
import { collectAllBuffEffects } from '../src/utils/panelBuffCalc.ts'
import { buildOptimalEvalContext } from '../src/utils/optimalAffixAlloc.ts'
import { resolveFlow } from '../src/utils/resolvedHit.ts'
import { createDefaultAffixDriveDiscMainStats } from '../src/types/calculatorPanel.ts'
import { testAgent, testSlot, makePanel, makePanelCtx, mindscapeWithEffects, dummyBangboo } from './_effectPipelineHarness.mjs'

export function eventFixture({ mode = 'ordinary', damageType = 'anomalyRelease', effects, agents, sourceSlot = 0, flow, prepared, group, enemyInput, panels } = {}) {
  agents ??= [testAgent('owner'), testAgent('power')]
  panels ??= { owner: makePanel({ atk: 1000, anomalyReleaseMult: 50 }), power: makePanel({ atk: 2000 }) }
  if (mode === 'ordinary') {
    agents[sourceSlot].mindscapeBuffs = mindscapeWithEffects(effects)
    agents[sourceSlot].mindscapeBuffs[0].effectBlocks = effects.map(effect => ({ id: `block-${effect.id}`, name: effect.id, effects: [effect] }))
  }
  const extraGains = mode === 'ordinary' ? [] : effects.map(effect => createExtraBuffGain({
    id: `card-${effect.id}`, name: effect.id, sourceSlot, applySlot: mode === 'extra-team' ? 'team' : 0, effects: [effect],
  }))
  const teamSlots = agents.map(agent => testSlot(agent.id))
  const panelContext = makePanelCtx({ teamSlots, agents, mainSlotIndex: 0, extraGains, activeSlotPanels: panels,
    mainExternalPanel: panels.owner, skillTalentLevelsByAgent: { power: { basic: 12 } } })
  const items = collectAllBuffEffects(panelContext)
  const skill = { id: 'event-skill', name: 'event', agentId: 'owner', source: 'custom', damageType, skillTypes: ['basic'], baseMult: 0 }
  const resolvedFlow = resolveFlow({ teamSlots, slots: [{ prepared: prepared ?? [{ id: 'prepared', skillId: skill.id, skillSource: 'custom',
    anomalyPowerAgentId: 'power', triggerAgentId: 'owner' }],
    flow: flow ?? ['A', 'B'].map(id => ({ id, ownerAgentId: 'owner', preparedId: 'prepared', count: 1, staggerPhase: 'stagger', critMode: 'expected',
      ...(id === 'A' && effects.some(effect => effect.id === 'fixed') ? { buffOverrides: { disabledEffectIds: [items.find(item => item.effect.id.endsWith('fixed')).effect.id] } } : {}) })) }],
    findSkill: () => skill, findSkillGroup: () => group })
  const context = buildOptimalEvalContext({ isMb: false, teamSlots, agents, wengines: [], bangboo: dummyBangboo(), bangbooRefine: 1,
    driveDiscs: [], mainSlotIndex: 0, driveDiscMainStats: createDefaultAffixDriveDiscMainStats(), baseDamageSource: 'atk',
    enemyInput: { level: 60, defense: 953, resistanceType: 'normal', vulnerableMultiplier: 1, staggerMultiplier: 2, specialMultiplier: 1, ...enemyInput },
    activeSlotPanels: panels, hits: resolvedFlow.hits, extraGains, skillTalentLevelsByAgent: { power: { basic: 12 } } })
  return { context, panelContext, hits: resolvedFlow.hits, items, skill, agents, panels, extraGains, teamSlots, resolvedFlow }
}

export function r3Fixture(mode) {
  const effect = createEmptyBuffEffect({ id: 'release', kind: 'convert', stat: 'anomalyReleaseMult', enabledDefault: true,
    applyTarget: 'team', elementFilter: ['电'], convert: { from: 'skillLevelBasic', panelSource: 'external', ratioPercent: 10, initialBase: 0, cap: null } })
  return eventFixture({ mode, effects: [effect], sourceSlot: 1, agents: [testAgent('owner', { element: '冰' }), testAgent('power', { element: '电' })] })
}

export function r5Fixture(mode, damageType = 'anomalyRelease', options = {}) {
  return eventFixture({ mode, damageType, effects: [
    createEmptyBuffEffect({ id: 'fixed', stat: 'atk', value: 500, enabledDefault: true }),
    createEmptyBuffEffect({ id: 'convert', kind: 'convert', stat: damageType === 'direct' ? 'dmgBonus' : 'anomalyReleaseMult', enabledDefault: true,
      convert: { from: 'atk', panelSource: 'final', ratioPercent: 10, initialBase: 0, cap: null } }),
  ], ...options })
}
