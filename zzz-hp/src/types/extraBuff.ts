import type { BuffEffect } from '@/types/calculator'

/**
 * 额外 Buff 的唯一类型定义（Spec §3.1）。
 *
 * 一张卡片 = 界面上一行配置；底层可以是多条 `BuffEffect`（同一乘区多选伤害类型时），
 * 但用户看到的始终是"一条增益"。类型只在这里定义，禁止从 `.vue` 导出或导入。
 */
export type ExtraBuffSlotIndex = 0 | 1 | 2

/** 受益对象：全队，或固定槽位 0/1/2（界面显示为槽位 1/2/3） */
export type ExtraBuffApplySlot = ExtraBuffSlotIndex | 'team'

export interface ExtraBuffGain {
  /** 卡片身份，全页唯一；改名/换目标/切类型/保存恢复都不变 */
  id: string
  /** 卡片名，默认「自定义增益」 */
  name: string
  /** 受益对象：`team` = 全队，数字 = 固定槽位 */
  applySlot: ExtraBuffApplySlot
  /** 转模来源槽位：只用于读面板/技能等级，与受益对象分开保存 */
  sourceSlot: ExtraBuffSlotIndex
  /** 底层效果；非空，且必须能聚成恰好一行 */
  effects: BuffEffect[]
}
