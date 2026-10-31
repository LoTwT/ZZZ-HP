/** 流程伤害记录：全局一份，手点才写入。不跟方案、不跟工作草稿。 */
import {
  normalizeSkillFlowDamageSnapshot,
  type SkillFlowDamageSnapshot,
} from '@/utils/skillFlowDamageRecordComparison'

export const SKILL_FLOW_DAMAGE_RECORD_KEY = 'zzz-hp-skill-flow-damage-records'

export interface SkillFlowDamageRecord {
  id: string
  savedAt: number
  current: number
  team: number
  agentName: string
  schemeName: string
  /** 用户自定义名称（可留空；留空时列表回落到方案名） */
  name?: string
  /** 记录当时三人全名，按下标对齐编队 */
  agentNames: string[]
  /** 记录当时的槽位配置摘要（影画/音擎/驱动盘，按槽位对齐） */
  slotMeta?: SkillFlowDamageRecordSlotMeta[]
  /** 新版记录的完整全队快照；旧记录保留总伤，不补造结构。 */
  snapshot?: SkillFlowDamageSnapshot
}

/** 记录时每槽位的装备摘要，用于柱状图悬停时像顶栏一样分项标记 */
export interface SkillFlowDamageRecordSlotMeta {
  /** 影画档位 */
  rank?: number
  /** 音擎名称 */
  wengine?: string
  /** 音擎精炼等级 */
  wengineRefine?: number
  /** 4 件套驱动盘名称 */
  disc4?: string
  /** 2 件套驱动盘名称 */
  disc2?: string
  /** 旧格式：4/2 未拆分时的驱动盘摘要（如「4件套 谵羽之哲」） */
  disc?: string
  /** 旧格式整串文本，原样保留为单个标签 */
  text?: string
}

export const SKILL_FLOW_DAMAGE_RECORD_NAME_MAX = 40

/** 记录名称：只保留单行文本，空白即视为未命名 */
export function normalizeSkillFlowDamageRecordName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim().slice(0, SKILL_FLOW_DAMAGE_RECORD_NAME_MAX)
  return text || undefined
}

/** 列表展示名：自定义名称优先，未命名时回落到方案名 */
export function skillFlowDamageRecordLabel(
  record: Pick<SkillFlowDamageRecord, 'name' | 'schemeName'>,
): string {
  return record.name || record.schemeName
}

function isRecord(value: unknown): value is SkillFlowDamageRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<SkillFlowDamageRecord>
  if (
    typeof item.id !== 'string' ||
    typeof item.savedAt !== 'number' ||
    typeof item.current !== 'number' ||
    typeof item.team !== 'number' ||
    typeof item.agentName !== 'string' ||
    typeof item.schemeName !== 'string'
  ) {
    return false
  }
  if (
    ![item.savedAt, item.current, item.team].every(
      (number) => Number.isFinite(number) && Number(number) >= 0,
    )
  )
    return false
  return true
}

function normalizeRecordSlotMetaItem(value: unknown): SkillFlowDamageRecordSlotMeta | null {
  if (typeof value === 'string') {
    const text = value.trim().slice(0, 160)
    return text ? { text } : null
  }
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SkillFlowDamageRecordSlotMeta>
  const item: SkillFlowDamageRecordSlotMeta = {}
  if (typeof raw.rank === 'number' && Number.isFinite(raw.rank)) item.rank = raw.rank
  if (typeof raw.wengine === 'string' && raw.wengine.trim()) {
    item.wengine = raw.wengine.trim().slice(0, 60)
  }
  if (typeof raw.wengineRefine === 'number' && Number.isFinite(raw.wengineRefine)) {
    item.wengineRefine = raw.wengineRefine
  }
  if (typeof raw.disc4 === 'string' && raw.disc4.trim()) item.disc4 = raw.disc4.trim().slice(0, 80)
  if (typeof raw.disc2 === 'string' && raw.disc2.trim()) item.disc2 = raw.disc2.trim().slice(0, 80)
  if (typeof raw.disc === 'string' && raw.disc.trim()) item.disc = raw.disc.trim().slice(0, 80)
  if (typeof raw.text === 'string' && raw.text.trim()) item.text = raw.text.trim().slice(0, 160)
  return Object.keys(item).length ? item : null
}

function normalizeRecordSlotMeta(value: unknown): SkillFlowDamageRecordSlotMeta[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value
    .map(normalizeRecordSlotMetaItem)
    .filter((item): item is SkillFlowDamageRecordSlotMeta => item != null)
  return list.length ? list : undefined
}

function normalizeRecord(value: unknown): SkillFlowDamageRecord | null {
  if (!isRecord(value)) return null
  const agentNames = Array.isArray(value.agentNames)
    ? value.agentNames.map((name) => String(name ?? '').trim() || '未选')
    : value.agentName
      ? [value.agentName]
      : []
  return {
    ...value,
    name: normalizeSkillFlowDamageRecordName(value.name),
    agentNames,
    slotMeta: normalizeRecordSlotMeta(value.slotMeta),
    snapshot: normalizeSkillFlowDamageSnapshot(value.snapshot, value.team),
  }
}

/** 外部文件（导出/导入）的类型标识，避免把别的 JSON 当记录读进来 */
export const SKILL_FLOW_DAMAGE_RECORD_EXPORT_KIND = 'zzz-hp-damage-records'

/** 规范化一份记录数组：丢弃坏条目，不做去重（去重由调用方决定） */
export function normalizeSkillFlowDamageRecords(value: unknown): SkillFlowDamageRecord[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeRecord).filter((item): item is SkillFlowDamageRecord => item != null)
}

export function loadSkillFlowDamageRecords(): SkillFlowDamageRecord[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const parsed = JSON.parse(localStorage.getItem(SKILL_FLOW_DAMAGE_RECORD_KEY) ?? '[]')
    return normalizeSkillFlowDamageRecords(parsed)
  } catch {
    return []
  }
}

/** 导出成可存档的 JSON 文本（附带类型与版本，方便导入时校验） */
export function exportSkillFlowDamageRecords(list: readonly SkillFlowDamageRecord[]): string {
  return JSON.stringify(
    {
      kind: SKILL_FLOW_DAMAGE_RECORD_EXPORT_KIND,
      version: 1,
      exportedAt: Date.now(),
      count: list.length,
      records: list,
    },
    null,
    2,
  )
}

export interface SkillFlowDamageRecordImportResult {
  records: SkillFlowDamageRecord[]
  /** 文件里被丢弃的坏条目数 */
  dropped: number
}

/**
 * 解析导入文件：只认本页导出的格式（也接受裸数组，方便手工整理）。
 * 坏条目逐条丢弃，不整体失败；`null` 表示完全无法识别。
 */
export function parseSkillFlowDamageRecordExport(text: string): SkillFlowDamageRecordImportResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { records?: unknown }).records)
      ? (parsed as { records: unknown[] }).records
      : null
  if (!raw) return null
  const records = normalizeSkillFlowDamageRecords(raw)
  return { records, dropped: raw.length - records.length }
}

/** 导入一律追加到现有记录后面：不去重、不设条数上限（存储空间不足由保存失败提示兜底） */
export function appendSkillFlowDamageRecords(
  existing: readonly SkillFlowDamageRecord[],
  incoming: readonly SkillFlowDamageRecord[],
): SkillFlowDamageRecord[] {
  return [...existing, ...incoming]
}

export function saveSkillFlowDamageRecords(list: readonly SkillFlowDamageRecord[]): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(SKILL_FLOW_DAMAGE_RECORD_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}
