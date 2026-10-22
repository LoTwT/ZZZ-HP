import {
  BUFF_DAMAGE_TYPE_GROUPS,
  BUFF_DAMAGE_TYPE_OPTIONS,
  type BuffDamageType,
  type StaggerPhase,
} from '@/types/calculator'
import type { SchemeSlot } from '@/types/damageCalcHistory'
import type { ResolvedHit } from '@/utils/resolvedHit'
import { hitBelongsToFlowEntry } from '@/utils/skillGroup'

/** 颜色按类型固定，个人/全队、饼图/堆叠图共用，不按出现顺序分配。 */
const DAMAGE_TYPE_COLORS: Record<BuffDamageType, string> = {
  normal: '#c9a55c',
  pierce: '#70a9b5',
  sharpen: '#c277a1',
  anomaly: '#4caf8a',
  turbulence: '#e08a3c',
  disorder: '#9b7ed9',
  radiance: '#d46a6a',
  anomalyRelease: '#5b8def',
}

export interface SkillFlowDamageSlice {
  id: string
  name: string
  total: number
  ratio: number
  color: string
}

export interface SkillFlowDamageLine {
  hit: ResolvedHit
  slotIndex: number
  flowEntryId: string
  flowEntryIndex: number
  total: number
  perHit: number
  damageType: BuffDamageType
}

export interface SkillFlowDamageSlot {
  slotIndex: number
  total: number
  lines: SkillFlowDamageLine[]
  uncomputedCount: number
}

export interface SkillFlowDamageAnalysis {
  total: number
  slots: SkillFlowDamageSlot[]
  lines: SkillFlowDamageLine[]
}

export interface SkillFlowSkillContribution {
  id: string
  slotIndex: number
  skillId: string
  name: string
  count: number
  total: number
  personalRatio: number
  teamRatio: number
  lines: SkillFlowDamageLine[]
}

export interface SkillFlowDamageFilter {
  damageType?: BuffDamageType | null
  damageKind?: 'direct' | 'anomaly' | null
  staggerPhase?: StaggerPhase | null
}

export interface SkillFlowDamageCrossRow {
  id: BuffDamageType
  name: string
  color: string
  normal: number
  stagger: number
  total: number
  staggerRatio: number
}

export function filterSkillFlowDamageLines(
  lines: readonly SkillFlowDamageLine[],
  filter: SkillFlowDamageFilter = {},
): SkillFlowDamageLine[] {
  return lines.filter(
    (line) =>
      (!filter.damageType || line.damageType === filter.damageType) &&
      (!filter.damageKind || line.hit.damageKind === filter.damageKind) &&
      (!filter.staggerPhase || line.hit.staggerPhase === filter.staggerPhase),
  )
}

export function skillFlowDamageCrossRows(
  lines: readonly SkillFlowDamageLine[],
): SkillFlowDamageCrossRow[] {
  return skillFlowDamageSlices(lines, 'type').map((slice) => {
    const typeLines = lines.filter((line) => line.damageType === slice.id)
    const stagger = typeLines.reduce(
      (sum, line) => sum + (line.hit.staggerPhase === 'stagger' ? line.total : 0),
      0,
    )
    return {
      id: slice.id as BuffDamageType,
      name: slice.name,
      color: slice.color,
      normal: slice.total - stagger,
      stagger,
      total: slice.total,
      staggerRatio: slice.total > 0 ? stagger / slice.total : 0,
    }
  })
}

/** conic-gradient 从正上方顺时针开始；坐标为相对圆心的像素。 */
export function skillFlowSliceAtPoint(
  slices: readonly SkillFlowDamageSlice[],
  x: number,
  y: number,
): SkillFlowDamageSlice | null {
  if (!slices.length || (x === 0 && y === 0)) return null
  const turn = ((Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)
  let cursor = 0
  for (const slice of slices) {
    cursor += slice.ratio
    if (turn < cursor) return slice
  }
  return slices[slices.length - 1] ?? null
}

/**
 * 只读取正式流程中的已结算段。hitDamages 已包含段次数，不能再乘 count；
 * 同一映射里还有准备区预览值，不能直接累加 Object.values(hitDamages)。
 * 归属按流程所在槽位，不按异常强度提供者或触发者重新分账。
 */
export function buildSkillFlowDamageAnalysis(input: {
  slotCount: number
  slots?: SchemeSlot[]
  hits?: ResolvedHit[]
  hitDamages?: Record<string, number>
}): SkillFlowDamageAnalysis {
  const slots: SkillFlowDamageSlot[] = Array.from({ length: input.slotCount }, (_, slotIndex) => ({
    slotIndex,
    total: 0,
    lines: [],
    uncomputedCount: 0,
  }))
  const entries = slots.flatMap((slot) =>
    (input.slots?.[slot.slotIndex]?.flow ?? []).map((entry, flowEntryIndex) => ({
      slot,
      entryId: entry.id,
      flowEntryIndex,
    })),
  )
  const seen = new Set<string>()
  for (const hit of input.hits ?? []) {
    if (seen.has(hit.id)) continue
    seen.add(hit.id)
    const entry = entries.find((item) => hitBelongsToFlowEntry(hit.id, item.entryId))
    if (!entry) continue
    const total = input.hitDamages?.[hit.id]
    if (total == null || !Number.isFinite(total) || total < 0) {
      entry.slot.uncomputedCount += 1
      continue
    }
    const damageType = hit.damageKind === 'direct' ? hit.directSubKind : hit.anomalySubKind
    entry.slot.lines.push({
      hit,
      slotIndex: entry.slot.slotIndex,
      flowEntryId: entry.entryId,
      flowEntryIndex: entry.flowEntryIndex,
      total,
      perHit: hit.count > 0 ? total / hit.count : 0,
      damageType,
    })
    entry.slot.total += total
  }
  return {
    total: slots.reduce((sum, slot) => sum + slot.total, 0),
    slots,
    lines: slots.flatMap((slot) => slot.lines),
  }
}

export function skillFlowDamageSlices(
  lines: readonly SkillFlowDamageLine[],
  dimension: 'type' | 'category' | 'stagger',
): SkillFlowDamageSlice[] {
  const options =
    dimension === 'type'
      ? BUFF_DAMAGE_TYPE_OPTIONS.map((item) => ({
          id: item.id,
          name: item.label,
          color: DAMAGE_TYPE_COLORS[item.id],
        }))
      : dimension === 'category'
        ? BUFF_DAMAGE_TYPE_GROUPS.map((group, index) => ({
            id: group.id,
            name: group.label,
            color: index === 0 ? DAMAGE_TYPE_COLORS.normal : DAMAGE_TYPE_COLORS.anomalyRelease,
          }))
        : [
            { id: 'normal', name: '非失衡', color: '#c9a55c' },
            { id: 'stagger', name: '失衡期', color: '#5b8def' },
          ]
  const totals = new Map<string, number>()
  let total = 0
  for (const line of lines) {
    const key =
      dimension === 'type'
        ? line.damageType
        : dimension === 'stagger'
          ? line.hit.staggerPhase
          : line.hit.damageKind
    totals.set(key, (totals.get(key) ?? 0) + line.total)
    total += line.total
  }
  return options
    .map((option) => {
      const value = totals.get(option.id) ?? 0
      return { ...option, total: value, ratio: total > 0 ? value / total : 0 }
    })
    .filter((slice) => slice.total > 0)
}

/** 同槽位同招式 id 合并；不同状态、技能组成员与提供者拆段仍留在 lines 里。 */
export function skillFlowSkillContributions(
  analysis: SkillFlowDamageAnalysis,
  slotIndex: number | null,
  filter: SkillFlowDamageFilter = {},
): SkillFlowSkillContribution[] {
  const groups = new Map<string, SkillFlowSkillContribution>()
  for (const line of filterSkillFlowDamageLines(analysis.lines, filter)) {
    if (slotIndex != null && line.slotIndex !== slotIndex) continue
    const id = JSON.stringify([line.slotIndex, line.hit.skill.id])
    let group = groups.get(id)
    if (!group) {
      group = {
        id,
        slotIndex: line.slotIndex,
        skillId: line.hit.skill.id,
        name: line.hit.skill.name,
        count: 0,
        total: 0,
        personalRatio: 0,
        teamRatio: 0,
        lines: [],
      }
      groups.set(id, group)
    }
    group.lines.push(line)
    group.count += line.hit.count
    group.total += line.total
  }
  for (const group of groups.values()) {
    const personalTotal = analysis.slots[group.slotIndex]?.total ?? 0
    group.personalRatio = personalTotal > 0 ? group.total / personalTotal : 0
    group.teamRatio = analysis.total > 0 ? group.total / analysis.total : 0
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.total - a.total || a.slotIndex - b.slotIndex || a.name.localeCompare(b.name, 'zh-CN'),
  )
}
