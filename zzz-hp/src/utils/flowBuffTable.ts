/**
 * 流程增益表（2026-09-21 用户方案）的数据层。
 *
 * 把「流程招式 × 增益（效果块）」组织成表格需要的**行 / 列 / 单元格状态**，并提供一个写回函数。
 * 全部是纯逻辑（除写回外），便于单测；UI 只管画。
 *
 * 语义要点：
 * - 行级例外**只做减法**：与全局一致的不写；空 = `null`（全部继承）
 * - 技能组：组行 = `entry.buffOverrides`（整组），成员行 = `memberOverrides[].buffOverrides`（缺省继承整组）
 * - 单元格 `na` 的两种来源：① 该块全局未启用（行级无法单独打开）② 继承自组且组已关闭
 */
import type { SkillGroup } from '@/types/calculator'
import type { FlowBuffOverride, FlowEntry } from '@/types/damageCalcHistory'
import { isEffectEnabled } from '@/utils/buffEffect'
import { blockKeyOfCollected, type BuffSelectionState, type CollectedEffect } from '@/utils/panelBuffCalc'
import { BUFF_STAT_FIELDS, buffStatFieldLabel } from '@/utils/calculatorUi'

export interface FlowBuffTableRow {
  /** 唯一键：普通行 = 流程行 id；组成员 = `${行id}#${序号}:${skillId}` */
  key: string
  entryId: string
  label: string
  kind: 'skill' | 'group' | 'member'
  /** 同名招式第几次出现（仅同名时给） */
  badge?: string | null
  memberKey?: string | null
  skillId?: string | null
}

export interface FlowBuffTableBlock {
  key: string
  label: string
  title?: string | null
  /** 该块包含的效果摘要（悬停卡片里展示「增益的具体效果」） */
  details?: string[]
}

export type FlowBuffCellState = 'on' | 'off' | 'na'

function rawField(
  item: CollectedEffect,
  field: 'blockName' | 'sourceLabel' | 'blockNote',
): string {
  const value = (item as unknown as Record<string, unknown>)[field]
  return typeof value === 'string' ? value.trim() : ''
}

/** 效果摘要：`+20 电增伤` 这种（属性名走现有 label 表，取不到就退回 key） */
function effectSummary(item: CollectedEffect): string {
  const effect = item.effect
  const field = BUFF_STAT_FIELDS.find((entry) => entry.key === effect.stat)
  const label = field ? buffStatFieldLabel(field) : String(effect.stat ?? '')
  const value = typeof effect.value === 'number' && effect.value !== 0 ? `+${effect.value}` : ''
  return `${value} ${label}`.trim()
}

/** 列 = 效果块（一块一列，按收集顺序去重） */
export function buildFlowBuffTableBlocks(
  items: CollectedEffect[] | null | undefined,
): FlowBuffTableBlock[] {
  const map = new Map<string, FlowBuffTableBlock>()
  for (const item of items ?? []) {
    const key = blockKeyOfCollected(item)
    const existing = map.get(key)
    if (existing) {
      const line = effectSummary(item)
      if (line && existing.details && !existing.details.includes(line)) existing.details.push(line)
      continue
    }
    const blockName = rawField(item, 'blockName')
    const sourceLabel = rawField(item, 'sourceLabel')
    const label = blockName || sourceLabel || '未命名增益'
    const title = sourceLabel && sourceLabel !== label ? `${label}（来源：${sourceLabel}）` : label
    const detailLines: string[] = []
    const note = rawField(item, 'blockNote')
    if (note) detailLines.push(note)
    const line = effectSummary(item)
    if (line) detailLines.push(line)
    map.set(key, { key, label, title, details: detailLines })
  }
  return [...map.values()]
}

/** 行 = 流程招式（与流程列表同源同序）；技能组展开为「组行 + 成员行」 */
export function buildFlowBuffTableRows(input: {
  flow: FlowEntry[]
  preparedName: (entry: FlowEntry) => string
  groupOf: (entry: FlowEntry) => SkillGroup | null
  memberKeyOf: (member: SkillGroup['members'][number]) => string
  sortMembers: (members: SkillGroup['members']) => SkillGroup['members']
  skillName: (skillId: string) => string | undefined
}): FlowBuffTableRow[] {
  const rows: FlowBuffTableRow[] = []
  const total = new Map<string, number>()
  for (const entry of input.flow) {
    const name = input.preparedName(entry)
    total.set(name, (total.get(name) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  for (const entry of input.flow) {
    const name = input.preparedName(entry)
    const nth = (seen.get(name) ?? 0) + 1
    seen.set(name, nth)
    const badge = (total.get(name) ?? 0) > 1 ? `第 ${nth} 次` : null
    const group = input.groupOf(entry)
    if (group) {
      rows.push({
        key: entry.id,
        entryId: entry.id,
        label: group.name?.trim() || '技能组',
        kind: 'group',
        badge,
      })
      input.sortMembers(group.members).forEach((member, memberIndex) => {
        rows.push({
          key: `${entry.id}#${memberIndex}:${member.skillId}`,
          entryId: entry.id,
          label: input.skillName(member.skillId) ?? '招式已删除',
          kind: 'member',
          memberKey: input.memberKeyOf(member),
          skillId: member.skillId,
        })
      })
      continue
    }
    rows.push({ key: entry.id, entryId: entry.id, label: name, kind: 'skill', badge })
  }
  return rows
}

/** 某行的有效例外：成员缺省继承整行 */
export function effectiveRowOverride(
  entry: FlowEntry | null | undefined,
  memberKey: string | null | undefined,
): FlowBuffOverride | null {
  if (!entry) return null
  if (memberKey) {
    const found = (entry.memberOverrides ?? []).find((item) => item.memberKey === memberKey)
    return found?.buffOverrides ?? entry.buffOverrides ?? null
  }
  return entry.buffOverrides ?? null
}

/** 单元格状态表：`${rowKey}|${blockKey}` → on / off / na */
export function buildFlowBuffTableStates(input: {
  rows: FlowBuffTableRow[]
  blocks: FlowBuffTableBlock[]
  items: CollectedEffect[] | null | undefined
  flow: FlowEntry[]
  selection: BuffSelectionState | null | undefined
}): Record<string, FlowBuffCellState> {
  // 块的全局状态：块内只要有一条"全局已启用"的效果，这块就算全局开
  const blockGlobalOn = new Map<string, boolean>()
  for (const item of input.items ?? []) {
    const key = blockKeyOfCollected(item)
    if (blockGlobalOn.get(key) === true) continue
    if (isEffectEnabled(item.effect, input.selection ?? null)) blockGlobalOn.set(key, true)
    else if (!blockGlobalOn.has(key)) blockGlobalOn.set(key, false)
  }

  const entryById = new Map(input.flow.map((entry) => [entry.id, entry]))
  const out: Record<string, FlowBuffCellState> = {}
  for (const row of input.rows) {
    const entry = entryById.get(row.entryId) ?? null
    const rowOverride = effectiveRowOverride(entry, row.memberKey ?? null)
    // 成员行：整行（组）已关掉的块，成员这边显示为不可点（继承自组）
    const groupOverride =
      row.kind === 'member' ? effectiveRowOverride(entry, null) : null
    for (const block of input.blocks) {
      const cellKey = `${row.key}|${block.key}`
      if (blockGlobalOn.get(block.key) !== true) {
        out[cellKey] = 'na'
        continue
      }
      if (groupOverride?.disabledBlockIds?.includes(block.key)) {
        out[cellKey] = 'na'
        continue
      }
      out[cellKey] = rowOverride?.disabledBlockIds?.includes(block.key) ? 'off' : 'on'
    }
  }
  return out
}

/**
 * 写回一个单元格（就地改对象；由调用方换数组引用以触发上层重算）。
 * 只动 `disabledBlockIds`：开关是块级的，单条禁用由其它入口维护。
 */
export function setFlowBuffBlockDisabled(input: {
  entry: FlowEntry
  blockKey: string
  disabled: boolean
  memberKey?: string | null
  skillId?: string | null
}): void {
  const { entry, blockKey, disabled, memberKey, skillId } = input
  const current = effectiveRowOverride(entry, memberKey ?? null)
  const blocks = new Set(current?.disabledBlockIds ?? [])
  if (disabled) blocks.add(blockKey)
  else blocks.delete(blockKey)
  const effects = [...(current?.disabledEffectIds ?? [])]
  const merged: FlowBuffOverride = {
    disabledBlockIds: [...blocks],
    disabledEffectIds: effects,
  }
  const empty = !merged.disabledBlockIds?.length && !merged.disabledEffectIds?.length
  const value: FlowBuffOverride | null = empty ? null : merged

  if (memberKey) {
    const list = [...(entry.memberOverrides ?? [])]
    const index = list.findIndex((item) => item.memberKey === memberKey)
    const existing = index >= 0 ? list[index] : undefined
    if (existing) list[index] = { ...existing, buffOverrides: value }
    else list.push({ memberKey, skillId: skillId ?? '', buffOverrides: value })
    entry.memberOverrides = list
    return
  }
  entry.buffOverrides = value
}
