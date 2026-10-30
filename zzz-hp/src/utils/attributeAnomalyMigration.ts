/**
 * 属性异常口径统一（2026-10-30）的旧数据转换。
 *
 * 背景：属性异常子类的英文字段、类型 id、词条目标后缀由 `anomaly*` 改为
 * `attributeAnomaly*`；「异常类」合集仍叫 `anomaly`（`DamageCalcKind`、
 * 事件模式 `modeType`）。旧个人存档 / 导入文件里的旧名必须在**字段白名单、
 * 类型校验、默认值填充、合并指纹**之前换成新名，之后才进原有逻辑。
 *
 * 契约（Spec §4.4.1 / §4.4.3 / §3.5）：
 * - 同一对象含新字段时保留新值（新值为 0 也保留）；只有旧字段时把旧值搬到新字段；
 *   移除旧字段；不相加、不用旧值覆盖新值。字段存在性按**自有属性**判断。
 * - 转换可重复执行：已转换内容再转一次结果不变。
 * - 只换字段名 / 语义类型值 / 目标字符串 / 工具生成行的 `属性=` 槽位；
 *   游戏原文、条目名、招式名、用户自由备注一律不动。
 */
import type { BuffDamageType } from '@/types/calculator'

/** 属性异常子类字段旧名 → 新名 */
export const ATTRIBUTE_ANOMALY_FIELD_RENAMES: Readonly<Record<string, string>> = {
  anomalyDmgBonus: 'attributeAnomalyDmgBonus',
  anomalyCritRate: 'attributeAnomalyCritRate',
  anomalyCritDmg: 'attributeAnomalyCritDmg',
  anomalyMult: 'attributeAnomalyMult',
  anomalyMultFactor: 'attributeAnomalyMultFactor',
}

/** 旧名集合（反向查表用） */
const OLD_FIELD_NAMES = new Set(Object.keys(ATTRIBUTE_ANOMALY_FIELD_RENAMES))

/**
 * 子类类型值出现的位置（父键名）。
 * `modeType`（事件模式大类）、`damageKind`（结算大类）不在此列 —— 它们的
 * `anomaly` 是「异常类合集」语义，继续保留。
 */
const SUBCLASS_TYPE_KEYS = new Set([
  'damageTypes',
  'scope',
  'damageType',
  'kind',
  'anomalySubKind',
  'types',
])

/** 旧子类类型值 → 新值 */
const OLD_TYPE_VALUE = 'anomaly'
const NEW_TYPE_VALUE = 'attributeAnomaly'

/** 旧 scope 里表示属性异常子类的值同样转换（含 `anomaly` 单值或数组元素） */
export function migrateAttributeAnomalyTypeValue(value: unknown): unknown {
  return value === OLD_TYPE_VALUE ? NEW_TYPE_VALUE : value
}

/** `panel:anomalyXxx` / `gain:anomalyXxx` 目标字符串换后缀 */
export function migrateAttributeAnomalyTargetString(value: string): string {
  const match = value.match(/^(panel|gain):(.+)$/)
  if (!match) return value
  const renamed = ATTRIBUTE_ANOMALY_FIELD_RENAMES[match[2]!]
  return renamed ? `${match[1]}:${renamed}` : value
}

/**
 * 工具生成备注行（`[关键字]` / `[关键字 N]`）的 `属性=` 槽位改名。
 *
 * 只替换**生成行**里 `属性=` 的完整旧值；`原文：…` 等其他行、数值、条件、
 * 序号与行顺序保持不变。重复调用不再变化（已为新名时不匹配）。
 */
const NOTE_SLOT_RENAMES: ReadonlyArray<[RegExp, string]> = [
  [/(属性=)异常增伤(?=\s|$)/g, '$1属性异常增伤'],
  [/(属性=)异常暴击率(?=\s|$)/g, '$1属性异常暴击率'],
  [/(属性=)异常暴击伤害(?=\s|$)/g, '$1属性异常暴击伤害'],
]

const GENERATED_LINE_RE = /^\s*\[关键字(\s+\d+)?\]/

export function migrateAttributeAnomalyNoteText(text: string): string {
  if (!text.includes('[关键字')) return text
  return text
    .split('\n')
    .map((line) => {
      if (!GENERATED_LINE_RE.test(line)) return line
      let next = line
      for (const [pattern, replacement] of NOTE_SLOT_RENAMES) {
        next = next.replace(pattern, replacement)
      }
      return next
    })
    .join('\n')
}

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key)
}

/** 面板 / 增益字段对象：把旧键搬到新键（新键优先生效，含新值为 0） */
export function migrateAttributeAnomalyFieldKeys<T extends Record<string, unknown>>(value: T): T {
  let touched = false
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (OLD_FIELD_NAMES.has(key)) {
      const newKey = ATTRIBUTE_ANOMALY_FIELD_RENAMES[key]!
      if (!hasOwn(value, newKey)) result[newKey] = item
      // 新键已存在：丢弃旧键（新值优先），不相加、不覆盖
      touched = true
      continue
    }
    result[key] = item
  }
  return (touched ? result : value) as T
}

/**
 * 通用深转换：对象键、`panel:`/`gain:` 目标串、类型值、工具生成行。
 *
 * 数组与对象都返回**新对象**（输入不被就地修改）；标量原样返回。
 * 已经是新格式的输入再次转换结果不变。
 */
export function migrateAttributeAnomalyNamingDeep<T>(value: T): T {
  return migrateNode(value, null) as T
}

function migrateNode(value: unknown, parentKey: string | null): unknown {
  if (typeof value === 'string') return migrateString(value, parentKey)
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const migrated = migrateNode(item, parentKey)
      if (migrated !== item) changed = true
      return migrated
    })
    return changed ? next : value
  }
  if (value && typeof value === 'object') {
    let changed = false
    const source = value as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(source)) {
      const renamedKey = OLD_FIELD_NAMES.has(key)
        ? ATTRIBUTE_ANOMALY_FIELD_RENAMES[key]!
        : key
      const migrated = migrateNode(item, key)
      if (renamedKey !== key) changed = true
      if (migrated !== item) changed = true
      if (renamedKey !== key && hasOwn(source, renamedKey)) {
        // 新键已存在：保留新键的值（旧键丢弃），仍算作发生转换
        continue
      }
      next[renamedKey] = migrated
    }
    return changed ? next : value
  }
  return value
}

function migrateString(value: string, parentKey: string | null): string {
  // 1) 字段名本身作为字符串值出现（`stat`、`field`、`legacyTarget` 等）
  const direct = ATTRIBUTE_ANOMALY_FIELD_RENAMES[value]
  if (direct) return direct

  // 2) 目标字符串（词条库 / 效果模板）
  if (value.startsWith('panel:') || value.startsWith('gain:')) {
    return migrateAttributeAnomalyTargetString(value)
  }

  // 3) 子类类型值：只在承载类型的键下转换
  if (value === OLD_TYPE_VALUE && parentKey && SUBCLASS_TYPE_KEYS.has(parentKey)) {
    return NEW_TYPE_VALUE
  }

  // 4) 工具生成备注行的属性槽位
  if (value.includes('[关键字')) return migrateAttributeAnomalyNoteText(value)

  return value
}

/** 便捷：子类类型数组（`conditions.damageTypes` / 旧 `scope`）转换 */
export function migrateAttributeAnomalyDamageTypes(value: unknown): BuffDamageType[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value]
  return list.map((item) => migrateAttributeAnomalyTypeValue(item)) as BuffDamageType[]
}
