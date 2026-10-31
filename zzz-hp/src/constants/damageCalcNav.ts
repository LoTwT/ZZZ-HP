export const DAMAGE_CALC_SECTIONS = [
  { id: 'damage-calc-history', label: '方案库' },
  { id: 'damage-team', label: '队伍编组' },
  { id: 'damage-bangboo', label: '邦布' },
  { id: 'damage-combat-buff', label: '局内 Buff' },
  { id: 'damage-enemy', label: '敌方与环境' },
  { id: 'damage-panel', label: '词条配比分析' },
  { id: 'skill-flow', label: '招式流程' },
  { id: 'flow-records', label: '伤害统计' },
] as const

/**
 * 「面板导入 / 词条导入」两个模式切换按钮**已永久删除**（2026-09-12，所有者口径）：
 * 它们不是导入功能（真正的导入在页面顶部「导入」按钮），只是会改掉算进伤害面板的
 * 第二状态干扰架构（曾因「局内攻击在 3883 / 6136 之间跳」冻结，后直接删除）。
 * 面板读取统一走 `resolveActivePanel`（唯一入口），与模式无关。
 * 「词条配比分析」2026-09-13 起**常驻**：侧栏该项只作锚点滚动（#damage-panel）。
 *
 * 底部「事件详情」区已于 2026-10-26 删除：总伤/单次/次数、角色占比、逐条乘区明细
 * 均由招式流程（含其计算过程下钻）覆盖；无法计入伤害的行改为流程行红色标记 +
 * 悬停弹层写明原因，因此不再需要单独的事件列表与跳过清单。
 */

export type DamageCalcSectionId = (typeof DAMAGE_CALC_SECTIONS)[number]['id']

export type DamageCalcNavItem = (typeof DAMAGE_CALC_SECTIONS)[number]
