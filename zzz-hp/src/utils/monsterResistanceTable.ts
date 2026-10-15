import {
  RESISTANCE_VALUE_MAP,
  type EnemyResistanceElement,
  type EnemyResistanceType,
} from '@/utils/enemyResistance'
import { elementIconPath, splitTraitElements } from '@/utils/elementIcons'

/**
 * 怪物详情弹窗的「弱点与抗性」表（六属性 × 伤害 / 异常积蓄 / 失衡 / 最大异常积蓄），
 * 展示口径对齐 nanoka 怪物页（用户提供截图）。
 *
 * 知识来源与可信度：
 * - 伤害列：本项目既有模型 `RESISTANCE_VALUE_MAP`（弱点 -20%、无弱点无抗性 0%、抗性 20%、高抗性 40%），
 *   此处不写任何百分比字面量，全部由该表 × 100 推导。
 * - 异常积蓄 / 失衡列：**推断**——截图中 40% 抗性属性的这两列显示为 20%，
 *   故按「伤害值截断到 ±20% 档（`RESISTANCE_VALUE_MAP.weak` / `.res20`）」实现，待验证。
 * - 最大异常积蓄列：**编码自截图**（70 级怪物样本）的各属性常量，是否随等级变化未经验证。
 */

/**
 * 表内属性顺序：冰 / 火 / 电 / 以太 / 物理 / 风（与截图一致）。
 * 与 `TRAIT_ELEMENTS` 同序但去掉流明，单独声明以保证表格恒为六行。
 */
export const MONSTER_RESISTANCE_TABLE_ELEMENTS: readonly EnemyResistanceElement[] = [
  '冰',
  '火',
  '电',
  '以太',
  '物理',
  '风',
]

/**
 * 各属性「最大异常积蓄」常量。
 * 来源：用户提供的 nanoka 怪物页截图（70 级怪物），物理 4752 / 风 1980，其余属性 3960；
 * 是否随等级缩放尚未验证，故入参 `level` 暂不参与计算。
 */
const MAX_ANOMALY_PROGRESS_BY_ELEMENT: Partial<Record<EnemyResistanceElement, number>> = {
  物理: 4752,
  风: 1980,
}

const DEFAULT_MAX_ANOMALY_PROGRESS = 3960

/** 异常积蓄 / 失衡的截断上下限：即 ±20% 两个档位，非新常量 */
const ANOMALY_STAGGER_LOWER_BOUND_PERCENT = RESISTANCE_VALUE_MAP.weak * 100
const ANOMALY_STAGGER_UPPER_BOUND_PERCENT = RESISTANCE_VALUE_MAP.res20 * 100

export interface MonsterResistanceTableInput {
  /** 弱点文本，如「冰、物理」；支持数组 */
  weakness?: string | string[] | null
  /** 抗性文本，如「电」；支持数组 */
  resistance?: string | string[] | null
  /** 高抗性（40%）属性，为 resistance 的子集 */
  resistance_high?: string | string[] | null
  /**
   * 怪物等级。最大异常积蓄是否随等级变化未经验证（见模块注释），
   * 当前不参与计算，仅作调用方显式声明用。
   */
  level?: number | null
}

export interface MonsterResistanceRow {
  /** 属性名（冰 / 火 / 电 / 以太 / 物理 / 风） */
  element: EnemyResistanceElement
  /** 属性图标地址（/attribute_image/*.webp）；未收录图标时为 null */
  icon: string | null
  /** 伤害补充百分比：弱点 -20、无弱点无抗性 0、抗性 20、高抗性 40 */
  damagePercent: number
  /** 异常积蓄百分比（伤害值截断到 ±20%） */
  anomalyPercent: number
  /** 失衡百分比（同异常积蓄截断规则） */
  staggerPercent: number
  /** 最大异常积蓄（整数，千分位由展示层格式化） */
  maxAnomalyProgress: number
}

function resolveResistanceType(
  element: EnemyResistanceElement,
  weakElements: ReadonlySet<string>,
  resistElements: ReadonlySet<string>,
  highResistElements: ReadonlySet<string>,
): EnemyResistanceType {
  // 抗性覆盖同属性弱点，与计算器口径（enemyBossTextParse.parseBossTraitToElementResistance）一致
  if (resistElements.has(element)) {
    return highResistElements.has(element) ? 'res40' : 'res20'
  }
  if (weakElements.has(element)) return 'weak'
  return 'normal'
}

function clampPercent(percent: number): number {
  return Math.min(
    ANOMALY_STAGGER_UPPER_BOUND_PERCENT,
    Math.max(ANOMALY_STAGGER_LOWER_BOUND_PERCENT, percent),
  )
}

/** 按「弱点与抗性」表口径生成六行数据（顺序固定为 冰 / 火 / 电 / 以太 / 物理 / 风） */
export function buildMonsterResistanceRows(
  input: MonsterResistanceTableInput,
): MonsterResistanceRow[] {
  const weakElements = new Set(splitTraitElements(input.weakness))
  const resistElements = new Set(splitTraitElements(input.resistance))
  const highResistElements = new Set(splitTraitElements(input.resistance_high))

  return MONSTER_RESISTANCE_TABLE_ELEMENTS.map((element) => {
    const type = resolveResistanceType(element, weakElements, resistElements, highResistElements)
    const damagePercent = Math.round(RESISTANCE_VALUE_MAP[type] * 100)
    return {
      element,
      icon: elementIconPath(element),
      damagePercent,
      anomalyPercent: clampPercent(damagePercent),
      staggerPercent: clampPercent(damagePercent),
      maxAnomalyProgress: MAX_ANOMALY_PROGRESS_BY_ELEMENT[element] ?? DEFAULT_MAX_ANOMALY_PROGRESS,
    }
  })
}
