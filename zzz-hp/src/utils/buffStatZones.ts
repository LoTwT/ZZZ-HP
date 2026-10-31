/**
 * 管理侧「属性」下拉的乘区目录（2026-10-20）。
 *
 * 用户口径：
 * - 下拉只列**乘区级名称**，不再列 5 个异常子类字段；
 * - 类1 死限制（类型锁定、灰显）：贯穿增伤→命破、锐化伤害提升→锋御、异化系数→异常 5 项；
 * - 类2 部分限制：异常类增伤 / 暴击率 / 爆伤 → 只能选异常 5 项，直伤 3 项禁用；
 * - 类3 其余 55 项：全 8 项可选；
 * - **不改任何属性名**；「锐爆伤害加成」保留原名，作为类3 独立属性。
 *
 * 类2 是 1 行 ↔ N 条（每个第二级类型一个 stat）；类1/类3 是 1 行 ↔ 1 条。
 * 条件只写 `conditions.damageTypes`，从不改写字段。
 */
import type { BuffDamageType, BuffStatKey } from '@/types/calculator'
import {
  ANOMALY_DAMAGE_TYPES,
  BUFF_DAMAGE_TYPE_IDS,
  anomalyTypeOfStat as anomalyTypeOfStatBase,
  isAnomalyDamageType,
} from '@/utils/buffDamageTypes'
import { BUFF_STAT_FIELDS } from '@/utils/calculatorUi'

export type BuffStatZoneTier = 1 | 2 | 3

export interface BuffStatZone {
  id: string
  label: string
  tier: BuffStatZoneTier
  /** 类1/类3：单一字段 */
  stat?: BuffStatKey
  /** 类2：第二级类型 → 字段（5 个） */
  statsByType?: Partial<Record<BuffDamageType, BuffStatKey>>
  /** 类1：锁定的伤害类型（灰显不可改） */
  lockedTypes?: BuffDamageType[]
  /** 类2：允许的伤害类型；类1/3 缺省 = 全部 8 项 */
  allowedTypes?: BuffDamageType[]
}

const CLASS1_ZONES: BuffStatZone[] = [
  {
    id: 'zone:pierceDmgBonus',
    label: '贯穿增伤',
    tier: 1,
    stat: 'pierceDmgBonus',
    lockedTypes: ['pierce'],
  },
  {
    id: 'zone:sharpenDmgBonus',
    label: '锐化伤害提升',
    tier: 1,
    stat: 'sharpenDmgBonus',
    lockedTypes: ['sharpen'],
  },
  {
    id: 'zone:mutationCoeff',
    label: '异化系数',
    tier: 1,
    stat: 'mutationCoeff',
    lockedTypes: [...ANOMALY_DAMAGE_TYPES],
  },
]

const CLASS2_ZONES: BuffStatZone[] = [
  {
    id: 'zone:anomalyDmg',
    label: '异常类增伤',
    tier: 2,
    allowedTypes: [...ANOMALY_DAMAGE_TYPES],
    statsByType: {
      attributeAnomaly: 'attributeAnomalyDmgBonus',
      turbulence: 'turbulenceDmgBonus',
      disorder: 'disorderDmgBonus',
      radiance: 'radianceDmgBonus',
      anomalyRelease: 'anomalyReleaseDmgBonus',
    },
  },
  {
    id: 'zone:attributeAnomalyCritRate',
    label: '异常类暴击率',
    tier: 2,
    allowedTypes: [...ANOMALY_DAMAGE_TYPES],
    statsByType: {
      attributeAnomaly: 'attributeAnomalyCritRate',
      turbulence: 'turbulenceCritRate',
      disorder: 'disorderCritRate',
      radiance: 'radianceCritRate',
      anomalyRelease: 'anomalyReleaseCritRate',
    },
  },
  {
    id: 'zone:attributeAnomalyCritDmg',
    label: '异常类爆伤',
    tier: 2,
    allowedTypes: [...ANOMALY_DAMAGE_TYPES],
    statsByType: {
      attributeAnomaly: 'attributeAnomalyCritDmg',
      turbulence: 'turbulenceCritDmg',
      disorder: 'disorderCritDmg',
      radiance: 'radianceCritDmg',
      anomalyRelease: 'anomalyReleaseCritDmg',
    },
  },
]

const CLASS1_STATS = new Set(CLASS1_ZONES.map((zone) => zone.stat))
const CLASS2_STATS = new Set(
  CLASS2_ZONES.flatMap((zone) => Object.values(zone.statsByType ?? {})),
)

/** 类3：其余字段，保留现有 label（异常掌控的固定/百分比两个乘区在管理端加后缀区分） */
const CLASS3_ZONES: BuffStatZone[] = BUFF_STAT_FIELDS.filter(
  (field) => !CLASS1_STATS.has(field.key) && !CLASS2_STATS.has(field.key),
).map((field) => ({
  id: `zone:${field.key}`,
  label:
    field.key === 'anomalyControl'
      ? '异常掌控（数值）'
      : field.key === 'anomalyControlPercent'
        ? '异常掌控%'
        : field.label,
  tier: 3,
  stat: field.key,
}))

export const BUFF_STAT_ZONES: BuffStatZone[] = [
  ...CLASS1_ZONES,
  ...CLASS2_ZONES,
  ...CLASS3_ZONES,
]

const ZONE_BY_ID = new Map(BUFF_STAT_ZONES.map((zone) => [zone.id, zone]))

/** stat → { zone, type }（类2 的 5 个子类字段都能反查） */
const ZONE_BY_STAT = new Map<
  BuffStatKey,
  { zone: BuffStatZone; type?: BuffDamageType }
>()
for (const zone of BUFF_STAT_ZONES) {
  if (zone.stat) ZONE_BY_STAT.set(zone.stat, { zone })
  for (const [type, stat] of Object.entries(zone.statsByType ?? {})) {
    if (stat) ZONE_BY_STAT.set(stat, { zone, type: type as BuffDamageType })
  }
}

export function findBuffStatZoneById(id: string | null | undefined): BuffStatZone | null {
  if (!id) return null
  return ZONE_BY_ID.get(id) ?? null
}

export function buffStatZoneOf(stat: BuffStatKey | null | undefined): BuffStatZone | null {
  if (!stat) return null
  return ZONE_BY_STAT.get(stat)?.zone ?? null
}

/** 类2：stat 对应的第二级类型；类1/类3 返回 null */
export function anomalyTypeOfStat(stat: BuffStatKey | null | undefined): BuffDamageType | null {
  return anomalyTypeOfStatBase(stat)
}

export function isAnomalySubtypeStat(stat: BuffStatKey | null | undefined): boolean {
  return Boolean(stat && anomalyTypeOfStat(stat))
}

/** 类2 的 5 个 stat（按类型顺序）；类1/3 返回空数组 */
export function anomalyStatsOfZone(zone: BuffStatZone): BuffStatKey[] {
  if (!zone.statsByType) return []
  return ANOMALY_DAMAGE_TYPES.map((type) => zone.statsByType?.[type]).filter(
    (stat): stat is BuffStatKey => Boolean(stat),
  )
}

/** 该类允许选择的第二级类型 */
export function allowedDamageTypesOf(zone: BuffStatZone): BuffDamageType[] {
  if (zone.lockedTypes) return [...zone.lockedTypes]
  if (zone.allowedTypes) return [...zone.allowedTypes]
  return [...BUFF_DAMAGE_TYPE_IDS]
}

/** 类1 锁死；类2/3 可勾 */
export function isZoneTypeLocked(zone: BuffStatZone): boolean {
  return Boolean(zone.lockedTypes?.length)
}

/** 某类型在类2 里对应的字段；类1/3 返回 zone.stat */
export function statForZoneType(
  zone: BuffStatZone,
  type: BuffDamageType | null | undefined,
): BuffStatKey | undefined {
  if (zone.statsByType) {
    if (!type) return undefined
    return zone.statsByType[type]
  }
  return zone.stat
}

export interface ZoneStatRow {
  type?: BuffDamageType
  stat: BuffStatKey
}

/**
 * 一行 → 数据层 N 条。
 *
 * - 类2：按勾选类型各一条；空选择 = 全部 5 条。
 * - 类1/类3：永远一条（类型只进 conditions，不改字段）。
 */
export function statRowsForZone(
  zone: BuffStatZone,
  selectedTypes: readonly BuffDamageType[] | null | undefined,
): ZoneStatRow[] {
  if (!zone.statsByType) {
    return zone.stat ? [{ stat: zone.stat }] : []
  }
  const allowed = allowedDamageTypesOf(zone)
  const picked = (selectedTypes ?? []).filter((type) => allowed.includes(type))
  const types = picked.length ? picked : allowed
  const out: ZoneStatRow[] = []
  for (const type of types) {
    const stat = zone.statsByType?.[type]
    if (stat) out.push({ type, stat })
  }
  return out
}

/** 类2 按 stat 集合反推类型集（保持界面顺序） */
export function zoneTypesOfStats(
  zone: BuffStatZone,
  stats: readonly BuffStatKey[],
): BuffDamageType[] {
  if (!zone.statsByType) return []
  const statSet = new Set(stats)
  return ANOMALY_DAMAGE_TYPES.filter((type) => {
    const stat = zone.statsByType?.[type]
    return stat ? statSet.has(stat) : false
  })
}

/** 类2 是否覆盖全部 5 项 */
export function zoneHasAllAnomalyTypes(
  zone: BuffStatZone,
  stats: readonly BuffStatKey[],
): boolean {
  if (!zone.statsByType) return false
  const selected = zoneTypesOfStats(zone, stats)
  return selected.length === ANOMALY_DAMAGE_TYPES.length
}

/** 类2 的“族”标识（用于老数据启发式聚合 / 合并校验） */
export function zoneFamilyKey(zone: BuffStatZone): string {
  return zone.statsByType ? `family:${zone.id}` : `stat:${zone.stat ?? zone.id}`
}

/** 判断一个类型是否允许在该 zone 选（类1 锁定 / 类2 只许异常） */
export function zoneAllowsType(zone: BuffStatZone, type: BuffDamageType): boolean {
  return allowedDamageTypesOf(zone).includes(type)
}

/** 兼容旧调用：异常类 5 项判断 */
export { isAnomalyDamageType }
