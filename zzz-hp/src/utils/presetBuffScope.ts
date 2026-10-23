/**
 * 导入预设弹窗「高级设置」的增益范围（用户口径 2026-10-22）。
 *
 * 弹窗里能直接调 Buff，省掉「先导入、再开『选择 Buff』界面调一遍」这一步。
 * 但这里**只给本页物件作用在自己身上的增益**：
 *
 * - 角色页 → `自身`（影画 / 核心被动等，作用于本人）
 * - 武器页 → `自身音擎`（音擎的增益，作用于本人）
 * - 驱动盘页 → `自身驱动盘`
 * - 面板页 → 三者都给（面板页看的是整份配置）
 *
 * 明确**不给**：`全队（含自身）` / `全队音擎` / `队友` / `队友音擎` / `队友驱动盘` /
 * 邦布 / 场地类 —— 队友与全队增益是跨角色的共享状态，在导入弹窗里改它们容易顺手改到别人。
 *
 * 单独抽出来是为了能脱离组件测（见 `scripts/test-preset-buff-scope.mjs`）。
 */
import type { InjectionKey } from 'vue'
import type { CollectedEffect, MultiSlotBuffSelection } from '@/utils/panelBuffCalc'

export type PresetBuffScopeTab = 'agent' | 'wengine' | 'disc' | 'panel'

/**
 * 页面把「按槽位的 Buff 勾选」注入给导入弹窗：弹窗的「高级设置」直接改这份共享状态
 * （与局内 Buff 选择器同一份，勾选即时生效）。没有注入时（其它宿主）不显示该入口。
 */
export const MULTI_SLOT_BUFF_SELECTION_KEY: InjectionKey<MultiSlotBuffSelection> = Symbol(
  'multiSlotBuffSelection',
)

/** 本页「对自身生效」的增益分组（与 `CollectedEffect.group` 同一套文案） */
export const PRESET_BUFF_SCOPE_GROUPS: Record<PresetBuffScopeTab, readonly string[]> = {
  agent: ['自身'],
  wengine: ['自身音擎'],
  disc: ['自身驱动盘'],
  panel: ['自身', '自身音擎', '自身驱动盘'],
}

/** 该页签允许出现的分组；未知页签返回空数组（= 不提供高级设置） */
export function buffScopeGroupsForTab(tab: string): readonly string[] {
  return PRESET_BUFF_SCOPE_GROUPS[tab as PresetBuffScopeTab] ?? []
}

/** 按页签筛出可调的增益：只留本页对自身生效的那些 */
export function filterPresetBuffEffects(
  effects: readonly CollectedEffect[],
  tab: string,
): CollectedEffect[] {
  const allowed = new Set(buffScopeGroupsForTab(tab))
  if (!allowed.size) return []
  return effects.filter((item) => allowed.has(item.group))
}
