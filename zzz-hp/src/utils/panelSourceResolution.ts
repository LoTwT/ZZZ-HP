import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { CharacterAttrKey } from '@/types/calculator'
import { createEmptyExternalPanel, type PanelStats } from '@/types/calculatorPanel'
import { convertSlotPartialToExternalPanel, panelToConvertAttrValues, type ConvertSlotPanels } from '@/utils/panelBuffCalc'

/**
 * 槽位级「局外面板 / 转模基数」解析的**唯一**实现（计算链路收敛 Spec §2.1 第 2 项）。
 *
 * 为什么要有它：面板页、词条分析页、引擎入口此前各写一份「激活面板 → 转模部分面板 → 空面板」
 * 与「等级 → 转模基数」的推导。三份写法一旦漂移，同一份配置在不同页面就会得到不同的有效输入，
 * 而两边数字都「看着像对的」。
 *
 * 边界（不放宽也不收紧任何既有规则）：
 * - 没有面板记录 → **空面板**（全 0）。不给占位毕业面板，也不拿编辑中的 live 面板顶替；
 *   没有面板就不该算出伤害（所有者口径 2026-09-12）。
 * - 转模部分面板 `convertSlotPanels[agentId]` 只在**没有激活面板**时兜底，且要按角色 id 取，
 *   不能拿当前角色的面板套到队友身上。
 * - 该函数**只做解析**：不读页面状态、不缓存、不改传入对象。
 */

export interface SlotExternalPanelInput {
  slotIndex: number
  teamSlots: readonly TeamSlot[]
  /**
   * 已解析的激活局外面板（每人一份，按角色 id；调用方先用 `resolveActivePanel` 解完来源）。
   * 引擎侧就是 `PanelCalcContext.activeSlotPanels` 的同一语义。
   */
  activeSlotPanels?: Record<string, PanelStats> | null
  /** 转模增益角色局外面板（仅转模来源属性，按角色 id） */
  convertSlotPanels?: ConvertSlotPanels | null
}

/** 某槽位的局外面板：激活面板 → 转模部分面板 → 空面板。 */
export function resolveSlotExternalPanel(input: SlotExternalPanelInput): PanelStats {
  const { slotIndex, teamSlots, activeSlotPanels, convertSlotPanels } = input
  const agentId = slotIndex >= 0 && slotIndex < teamSlots.length ? teamSlots[slotIndex]?.agentId : undefined
  if (!agentId) return createEmptyExternalPanel()
  const active = activeSlotPanels?.[agentId]
  if (active) return active
  const partial = convertSlotPanels?.[agentId]
  if (partial) return convertSlotPartialToExternalPanel(partial)
  return createEmptyExternalPanel()
}

export interface SlotAttrValuesInput {
  slotIndex: number
  /** 本次结算的主槽（`mainSlotIndex` 那份面板按敌方等级取基数，其余按角色等级） */
  mainSlotIndex: number
  teamSlots: readonly TeamSlot[]
  /** 已解析的该槽局面板（`resolveSlotExternalPanel` 的结果） */
  external: PanelStats
  convertSlotPanels?: ConvertSlotPanels | null
  /**
   * 该槽在**没有转模部分面板**时使用的等级。
   * 主槽通常是敌方等级、其余是角色等级 —— 由调用方决定，本函数不猜。
   */
  agentLevelBySlot: (slotIndex: number) => number | null | undefined
}

/** 某槽位的转模基数（属性取值表）：转模部分面板的 `level` 优先，其余回落到调用方给的等级。 */
export function resolveSlotAttrValues(input: SlotAttrValuesInput): Partial<Record<CharacterAttrKey, number>> {
  const { slotIndex, mainSlotIndex: _mainSlotIndex, teamSlots, external, convertSlotPanels, agentLevelBySlot } = input
  const agentId = teamSlots[slotIndex]?.agentId
  const partial = agentId ? convertSlotPanels?.[agentId] : undefined
  const level = partial?.level ?? agentLevelBySlot(slotIndex) ?? 60
  return panelToConvertAttrValues(external, { level, pierceMod: 0 })
}
