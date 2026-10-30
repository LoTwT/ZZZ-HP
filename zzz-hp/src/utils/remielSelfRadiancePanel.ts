import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import {
  computeFinalPanel,
  type ComputeFinalPanelOptions,
  type PanelBuffBreakdown,
  type PanelCalcContext,
} from '@/utils/panelBuffCalc'
import {
  computeMutationZone,
  resolveLuminousEquivalentElement,
  type RemielSelfRadianceCalcInput,
} from '@/utils/remielUtils'

/**
 * 蕾米本人耀变：仅本槽、不含邦布（用于攻击/精通/穿透/耀变抗穿等仍取本槽面板的部分；
 * 抗性穿透 resPen 例外，改取完整面板以吃到队友 team resPen，见 resolveRemielSelfRadianceCalcInput）。
 * 生产入口走 `panelViewPolicy.ts` 的 `remiel-self-radiance`；本文件仍是规则实现。
 */
export function computeRemielSelfInCombatPanel(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  remielSlotIndex: number,
  options?: ComputeFinalPanelOptions,
): PanelBuffBreakdown {
  return computeFinalPanel(
    externalPanel,
    {
      ...ctx,
      mainSlotIndex: remielSlotIndex,
      restrictToSlotIndex: remielSlotIndex,
      excludeBangboo: true,
    },
    options,
  )
}

function formatSignedContribution(value: number) {
  if (value > 0) return `+${value}`
  return String(value)
}

/**
 * 本人耀变专用（`collectRemielSelfRestrictedContributions` 的产物）：
 * - 局内攻击 = 局外攻击 + 蕾米埃尔自身（影画/角色）攻击力转模
 * - 局内精通 = 局外精通 + 驱动盘4件套全局精通 + 音擎全局精通
 * 不含局内攻击%、队友/邦布，也不吃角色其它固定攻击/精通。
 */
export interface RemielSelfRestrictedContributions {
  inCombatAtk: number
  inCombatMastery: number
  atkItems: string[]
  masteryItems: string[]
}

function finishRestrictedContributions(
  externalPanel: PanelStats,
  atkConvert: number,
  masteryBonus: number,
  atkItems: string[],
  masteryItems: string[],
): RemielSelfRestrictedContributions {
  return {
    inCombatAtk: Math.max(0, externalPanel.atk + atkConvert),
    inCombatMastery: Math.max(0, externalPanel.mastery + masteryBonus),
    atkItems,
    masteryItems,
  }
}

/** 旧路径：手写遍历来源前缀。阶段 4 收尾双跑对照用。 */
export function collectRemielSelfRestrictedContributionsFromSources(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  remielSlotIndex: number,
): RemielSelfRestrictedContributions {
  return collectRemielSelfRestrictedContributions(externalPanel, ctx, remielSlotIndex)
}

export function collectRemielSelfRestrictedContributions(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  remielSlotIndex: number,
  options?: ComputeFinalPanelOptions,
): RemielSelfRestrictedContributions {
  const restrictedCtx: PanelCalcContext = {
    ...ctx,
    mainSlotIndex: remielSlotIndex,
    restrictToSlotIndex: remielSlotIndex,
    excludeBangboo: true,
    effectSourcePolicy: 'remiel-self-base',
  }
  const parentTrace = options?.trace ?? ctx.trace
  const trace = parentTrace?.resolveView?.(externalPanel, restrictedCtx, 'radianceSelfPanel', 'remiel-self-radiance') ?? parentTrace
  const breakdown = computeFinalPanel(externalPanel, restrictedCtx, trace ? { trace } : undefined)
  trace?.bindInput?.('remielSelfRadianceCalc', 'inCombatAtk', trace.viewKey)
  trace?.bindInput?.('remielSelfRadianceCalc', 'inCombatMastery', trace.viewKey)
  const atkItems: string[] = []
  const masteryItems: string[] = []
  for (const source of breakdown.sources) {
    if (source.mods.atk) atkItems.push(source.label + ' 攻击力转模 ' + formatSignedContribution(source.mods.atk))
    if (source.mods.mastery) {
      const kindLabel = source.key.startsWith('drive-disc-') ? '四件套全局精通' : '音擎全局精通'
      masteryItems.push(source.label + ' ' + kindLabel + ' ' + formatSignedContribution(source.mods.mastery))
    }
  }
  return finishRestrictedContributions(externalPanel, breakdown.totalMods.atk, breakdown.totalMods.mastery, atkItems, masteryItems)
}

export function computeRemielSelfRestrictedAtkAndMastery(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  remielSlotIndex: number,
): { inCombatAtk: number; inCombatMastery: number } {
  const collected = collectRemielSelfRestrictedContributions(
    externalPanel,
    ctx,
    remielSlotIndex,
  )
  return {
    inCombatAtk: collected.inCombatAtk,
    inCombatMastery: collected.inCombatMastery,
  }
}

export function extractRemielSelfInCombatStats(
  breakdown: PanelBuffBreakdown,
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  remielSlotIndex: number,
  /** 异化系数取最终局内面板（含队友等）；未传则回落到本槽受限面板 */
  finalPanelForMutation?: PanelStats,
): {
  inCombatAtk: number
  inCombatMastery: number
  mutationZone: number
  penRate: number
  pen: number
  resPen: number
  radianceResPen: number
  radianceDmgBonus: number
  attributeAnomalyDmgBonus: number
} {
  const panel = breakdown.finalPanel
  const restricted = computeRemielSelfRestrictedAtkAndMastery(
    externalPanel,
    ctx,
    remielSlotIndex,
  )
  return {
    inCombatAtk: restricted.inCombatAtk,
    inCombatMastery: restricted.inCombatMastery,
    mutationZone: computeMutationZone(finalPanelForMutation ?? panel),
    penRate: panel.penRate,
    pen: panel.pen,
    resPen: panel.resPen,
    radianceResPen: panel.radianceResPen,
    radianceDmgBonus: panel.radianceDmgBonus,
    attributeAnomalyDmgBonus: panel.attributeAnomalyDmgBonus,
  }
}

export function resolveRemielSelfRadianceCalcInput(options: {
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  externalPanel: PanelStats
  panelCtx: PanelCalcContext
  remielSlotIndex: number
  agentLevel: number
  isMb: boolean
  trace?: ComputeFinalPanelOptions['trace']
}): RemielSelfRadianceCalcInput {
  const restrictedCtx: PanelCalcContext = {
    ...options.panelCtx,
    mainSlotIndex: options.remielSlotIndex,
    restrictToSlotIndex: options.remielSlotIndex,
    excludeBangboo: true,
  }
  const trace = options.trace ?? options.panelCtx.trace
  const restrictedTrace = trace?.resolveView?.(options.externalPanel, restrictedCtx, 'radianceSelfPanel', 'remiel-self-radiance')
  const breakdown = computeRemielSelfInCombatPanel(
    options.externalPanel,
    options.panelCtx,
    options.remielSlotIndex,
    restrictedTrace ? { trace: restrictedTrace } : undefined,
  )
  for (const field of ['penRate', 'pen', 'radianceResPen'] as const) {
    restrictedTrace?.bindInput?.('remielSelfRadianceCalc', field, restrictedTrace.viewKey)
  }
  // 异化系数：蕾米最终局内面板（含队友/邦布等），与页级 luminous 异化同源口径。
  // scope=mutation 仅在 anomaly 上下文生效，缺省或直伤上下文时强制 anomaly。
  const baseSkillCtx = options.panelCtx.skillContext
  const mutationSkillContext = {
    damageKind: 'anomaly' as const,
    categoryId: baseSkillCtx?.categoryId ?? 'basic',
    subcategoryId: baseSkillCtx?.subcategoryId ?? null,
    coords: baseSkillCtx?.coords ?? [],
    element: baseSkillCtx?.element,
    staggerPhase: baseSkillCtx?.staggerPhase,
    isFollowUp: baseSkillCtx?.isFollowUp ?? false,
    anomalySubKind: baseSkillCtx?.anomalySubKind ?? 'radiance',
  }
  const mutationContext: PanelCalcContext = {
    ...options.panelCtx,
    mainSlotIndex: options.remielSlotIndex,
    skillContext: mutationSkillContext,
  }
  const mutationTrace = trace?.resolveView?.(options.externalPanel, mutationContext, 'mutationPanel', 'default')
  const finalMutationPanel = computeFinalPanel(options.externalPanel, mutationContext,
    mutationTrace ? { trace: mutationTrace } : undefined).finalPanel
  mutationTrace?.bindInput?.('remielSelfRadianceCalc', 'mutationZone', mutationTrace.viewKey)
  const stats = extractRemielSelfInCombatStats(
    breakdown,
    options.externalPanel,
    { ...restrictedCtx, trace },
    options.remielSlotIndex,
    finalMutationPanel,
  )
  /**
   * 抗性穿透取蕾米**完整局内面板**（含队友影画/音擎/驱动盘 team 效果与邦布），
   * 与招式流程链路一致：队友（如柚叶影画1「甜蜜惊吓」team resPen +10）必须计入，
   * 否则蕾米自身耀变的抗性区吃不到队友抗性穿透（用户口径 2026-09-16）。
   * 其余字段（攻击/精通/穿透/耀变抗穿等）仍取本槽受限面板（上方 stats）。
   */
  const fullContext: PanelCalcContext = {
    ...options.panelCtx,
    mainSlotIndex: options.remielSlotIndex,
  }
  const fullTrace = trace?.resolveView?.(options.externalPanel, fullContext, 'powerProviderPanel', 'default')
  const fullPanelResPen = computeFinalPanel(options.externalPanel, fullContext,
    fullTrace ? { trace: fullTrace } : undefined).finalPanel.resPen
  fullTrace?.bindInput?.('remielSelfRadianceCalc', 'resPen', fullTrace.viewKey)
  return {
    agentLevel: options.agentLevel,
    inCombatAtk: stats.inCombatAtk,
    inCombatMastery: stats.inCombatMastery,
    mutationZone: stats.mutationZone,
    penRate: stats.penRate,
    pen: stats.pen,
    resPen: fullPanelResPen,
    radianceResPen: stats.radianceResPen,
    radianceDmgBonus: stats.radianceDmgBonus,
    attributeAnomalyDmgBonus: stats.attributeAnomalyDmgBonus,
    resistanceElement: resolveLuminousEquivalentElement(
      options.teamSlots,
      options.agents,
      options.remielSlotIndex,
    ) ?? null,
    isMb: options.isMb,
  }
}
