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
  isRemielSelfRadiancePowerProvider,
  type RemielSelfRadianceCalcInput,
} from '@/utils/remielUtils'
import {
  collectRemielSelfRestrictedContributions,
  computeRemielSelfInCombatPanel,
  resolveRemielSelfRadianceCalcInput,
  type RemielSelfRestrictedContributions,
} from '@/utils/remielSelfRadiancePanel'

export type PanelViewPolicyId = 'default' | 'remiel-self-radiance'

export interface RemielSelfRadianceViewOptions {
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  externalPanel: PanelStats
  panelCtx: PanelCalcContext
  remielSlotIndex: number
  agentLevel: number
  isMb: boolean
  /** 追踪（Spec §2.4 第 1 项） */
  trace?: ComputeFinalPanelOptions['trace']
}

/**
 * 面板视图政策：同一份局外快照可以按不同规则看「局内」。
 * `default` = 通用 `computeFinalPanel`。
 * `remiel-self-radiance` = 本人耀变受限来源（规则仍在 remielSelfRadiancePanel.ts）。
 */
export interface PanelViewPolicy {
  id: PanelViewPolicyId
  computeInCombatPanel: (
    externalPanel: PanelStats,
    ctx: PanelCalcContext,
    slotIndex: number,
    /** 追踪选项（Spec §2.4 第 1 项）：与默认政策同一条求值路径，只多一个观察点 */
    options?: ComputeFinalPanelOptions,
  ) => PanelBuffBreakdown
  collectRestrictedContributions?: (
    externalPanel: PanelStats,
    ctx: PanelCalcContext,
    slotIndex: number,
    options?: ComputeFinalPanelOptions,
  ) => RemielSelfRestrictedContributions
  resolveRadianceCalcInput?: (options: RemielSelfRadianceViewOptions) => RemielSelfRadianceCalcInput
}

export const DEFAULT_PANEL_VIEW_POLICY: PanelViewPolicy = {
  id: 'default',
  computeInCombatPanel(externalPanel, ctx, slotIndex, options) {
    return computeFinalPanel(externalPanel, { ...ctx, mainSlotIndex: slotIndex }, options)
  },
}

export const REMIEL_SELF_RADIANCE_VIEW_POLICY: PanelViewPolicy = {
  id: 'remiel-self-radiance',
  computeInCombatPanel: computeRemielSelfInCombatPanel,
  collectRestrictedContributions: collectRemielSelfRestrictedContributions,
  resolveRadianceCalcInput: resolveRemielSelfRadianceCalcInput,
}

export function resolvePanelViewPolicy(id: PanelViewPolicyId): PanelViewPolicy {
  return id === 'remiel-self-radiance'
    ? REMIEL_SELF_RADIANCE_VIEW_POLICY
    : DEFAULT_PANEL_VIEW_POLICY
}

export function resolvePanelViewPolicyForRadiance(
  anomalyPowerAgentId: string | null | undefined,
  remielId: string | null | undefined,
): PanelViewPolicy {
  return isRemielSelfRadiancePowerProvider(anomalyPowerAgentId, remielId)
    ? REMIEL_SELF_RADIANCE_VIEW_POLICY
    : DEFAULT_PANEL_VIEW_POLICY
}

export type { RemielSelfRestrictedContributions }
