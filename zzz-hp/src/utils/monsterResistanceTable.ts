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
 * - 最大异常积蓄列：**用户提供的真实游戏数据**——最大异常积蓄 = 基础异常条长度 × 异常条系数，
 *   基础值按敌人类别（普通 / 精英 / 首领）与属性分列；展示口径为初始条长（0 次已异常）。
 *   系数优先取 `boss_info.anomaly_bar_coefficient` 覆盖值，缺失时用内置默认表
 *   `ANOMALY_BAR_COEFFICIENT_BY_NAME`（按 Boss 名），两者都没有才按 1 兜底。
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

/** 敌人类别（决定基础异常条所在列）；缺省按「首领」 */
export type MonsterAnomalyBarCategory = 'normal' | 'elite' | 'boss'

/** 基础异常条表的属性分组列：物理、火/电/冰/以太（数据完全一致，共用一列）、风 */
type MonsterAnomalyBarColumn = 'physical' | 'fireGroup' | 'wind'

/**
 * 基础异常条长度表（用户提供：boss 图鉴数据）。
 * 行维度：已异常次数 0..8 与 9+，共十档；列维度：敌人类别 × 属性分组。
 */
const BASE_ANOMALY_PROGRESS_TABLE: Record<
  MonsterAnomalyBarCategory,
  Record<MonsterAnomalyBarColumn, readonly number[]>
> = {
  normal: {
    physical: [720, 734, 748, 762, 777, 792, 807, 823, 839, 855],
    fireGroup: [600, 612, 624, 636, 648, 660, 673, 686, 699, 712],
    wind: [300, 500, 624, 636, 648, 660, 673, 686, 699, 712],
  },
  elite: {
    physical: [2700, 2754, 2809, 2865, 2922, 2980, 3039, 3099, 3160, 3223],
    fireGroup: [2250, 2295, 2340, 2386, 2433, 2481, 2530, 2580, 2631, 2683],
    wind: [1150, 2000, 2340, 2386, 2433, 2481, 2530, 2580, 2631, 2683],
  },
  boss: {
    physical: [3600, 3672, 3745, 3819, 3895, 3972, 4051, 4132, 4214, 4298],
    fireGroup: [3000, 3060, 3121, 3183, 3246, 3310, 3376, 3443, 3511, 3581],
    wind: [1500, 2700, 3121, 3183, 3246, 3310, 3376, 3443, 3511, 3581],
  },
}

function resolveAnomalyBarColumn(element: EnemyResistanceElement): MonsterAnomalyBarColumn {
  if (element === '物理') return 'physical'
  if (element === '风') return 'wind'
  return 'fireGroup'
}

/**
 * 取基础异常条长度：已异常次数 0..8 逐档，9 及以上取最后一档（越界按边界档收敛）。
 * 展示口径恒传 0（初始条长），其余档位供后续扩展（如已异常次数步进器）使用。
 */
export function getMonsterBaseAnomalyProgress(
  category: MonsterAnomalyBarCategory,
  element: EnemyResistanceElement,
  occurrence: number,
): number {
  const column = BASE_ANOMALY_PROGRESS_TABLE[category][resolveAnomalyBarColumn(element)]
  const index = Math.min(Math.max(Math.floor(occurrence), 0), column.length - 1)
  return column[index]!
}

/** 异常积蓄 / 失衡的截断上下限：即 ±20% 两个档位，非新常量 */
const ANOMALY_STAGGER_LOWER_BOUND_PERCENT = RESISTANCE_VALUE_MAP.weak * 100
const ANOMALY_STAGGER_UPPER_BOUND_PERCENT = RESISTANCE_VALUE_MAP.res20 * 100

/**
 * 异常条系数内置默认表（Boss 名 → 系数，用户提供的真实游戏数据，共 18 条）。
 *
 * 单一事实来源与覆盖关系：
 * - 本常量表是**内置默认值**：不接数据库、不跑任何脚本即可开箱生效；
 * - `boss_info.anomaly_bar_coefficient` 是**覆盖值**（后台可编辑），优先于本表；
 * - `zzz-hp-backend/insert_boss_anomaly_coefficients.sql` 只在**需要覆盖默认**时执行，
 *   本表已覆盖的条目不必跑它。
 * ⚠ 本表与上述 SQL 必须同步维护：任一处改了名称或系数，另一处要一起改，
 *   否则「库里填了值」与「库里没值」两条路径会给出不同结果。
 *
 * 键名写法沿用 `crisisHpCoeff.CRISIS_BASE_HP_BY_NAME` 的口径（能省引号则省）；
 * 本表键是字面写法，带括号的条目只能按括号写法直取，请统一走
 * `resolveAnomalyBarCoefficient`（内部先归一化，两种写法都能命中，见 normalizeBossName）。
 */
export const ANOMALY_BAR_COEFFICIENT_BY_NAME: Readonly<Record<string, number>> = {
  死路屠夫: 1.0,
  未知复合侵蚀体: 1.0,
  '「霸主侵蚀体·庞培」': 1.1,
  '牲鬼·布林格': 1.1,
  '恶名·冥宁芙': 1.1,
  '自律强袭单位·「提丰·破坏者型」': 1.1,
  '恶名·死路屠夫': 1.1,
  '恶名·庞培': 1.1,
  秽息司祭: 1.2,
  '秽息妖鬼·名可名': 1.2,
  '「亵渎者」': 1.32,
  '魇缚者·叶释渊': 1.32,
  彷徨猎手: 1.38,
  '太初梦魇·「始主」': 1.5,
  '叛律孤歌·薇斯珀': 1.25,
  异变能量体: 1.25,
  猎血清道夫: 1.0625,
  基塔布鲁: 1.3,
}

/** 需要从 Boss 名中剔除的书名号 / 引号与空白（含全角空格，`\s` 已覆盖） */
const BOSS_NAME_DECORATION_PATTERN = /[\s「」『』“”‘’"']/g

/** Boss 名归一化：去掉书名号/引号与空白，容忍「霸主侵蚀体·庞培」与 霸主侵蚀体·庞培 的差异 */
function normalizeBossName(name: string | null | undefined): string {
  if (typeof name !== 'string') return ''
  return name.replace(BOSS_NAME_DECORATION_PATTERN, '')
}

/** 归一化名 → 系数：构建时归一化，使带括号与不带括号的两种写法共用一条默认值 */
const ANOMALY_BAR_COEFFICIENT_BY_NORMALIZED_NAME: ReadonlyMap<string, number> = new Map(
  Object.entries(ANOMALY_BAR_COEFFICIENT_BY_NAME).map(([name, coefficient]) => [
    normalizeBossName(name),
    coefficient,
  ]),
)

/**
 * 异常条系数：显式值（boss_info 覆盖）> 内置默认表 > 1。
 * 显式值须为有限正数；0 / 负数 / NaN / Infinity 一律视为「未提供」，
 * 避免脏数据把最大异常积蓄算成 0 或负数。
 */
export function resolveAnomalyBarCoefficient(
  bossName: string | null | undefined,
  explicitValue?: number | null,
): number {
  if (typeof explicitValue === 'number' && Number.isFinite(explicitValue) && explicitValue > 0) {
    return explicitValue
  }
  return ANOMALY_BAR_COEFFICIENT_BY_NORMALIZED_NAME.get(normalizeBossName(bossName)) ?? 1
}

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
  /** 敌人类别（决定基础异常条所在列）；缺省按「首领」 */
  monster_category?: MonsterAnomalyBarCategory | null
  /** Boss 名：缺省时只用显式系数（或内置默认表查不到则按 1） */
  boss_name?: string | null
  /**
   * 异常条系数覆盖值（来自 boss_info.anomaly_bar_coefficient）；
   * 缺省 / 非有限正数时回退内置默认表 `ANOMALY_BAR_COEFFICIENT_BY_NAME`（按 boss_name 查），
   * 表中也没有才按 1 处理。
   */
  anomaly_bar_coefficient?: number | null
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
  /** 最大异常积蓄 = 基础异常条（初始条长）× 异常条系数，四舍五入取整；千分位由展示层格式化 */
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
  const category = input.monster_category ?? 'boss'
  const coefficient = resolveAnomalyBarCoefficient(input.boss_name, input.anomaly_bar_coefficient)

  return MONSTER_RESISTANCE_TABLE_ELEMENTS.map((element) => {
    const type = resolveResistanceType(element, weakElements, resistElements, highResistElements)
    const damagePercent = Math.round(RESISTANCE_VALUE_MAP[type] * 100)
    return {
      element,
      icon: elementIconPath(element),
      damagePercent,
      anomalyPercent: clampPercent(damagePercent),
      staggerPercent: clampPercent(damagePercent),
      maxAnomalyProgress: Math.round(getMonsterBaseAnomalyProgress(category, element, 0) * coefficient),
    }
  })
}
