import type { DamageEventCritMode } from '@/types/calculator'
import type { SkillFlowDamageLine } from '@/utils/skillFlowDamageAnalysis'
import type {
  SkillFlowAverageDamageComparison,
  SkillFlowDamageSnapshotLine,
} from '@/utils/skillFlowDamageRecordComparison'

export interface SkillFlowDamageSnapshotContext {
  hitId: string
  flowEntryId: string
  flowEntryIndex: number
  critMode: DamageEventCritMode
  anomalyPowerAgentId: string | null
  triggerAgentId: string | null
  buffOverride: {
    disabledBlockIds: string[]
    disabledEffectIds: string[]
    stacksByEffectId: Record<string, number>
    convertInputsByEffectId: Record<string, number>
  }
}

export interface SkillFlowDamageSegmentSide {
  line: SkillFlowDamageSnapshotLine
  index: number
  perHit: number | null
}

export interface SkillFlowDamageSegmentComparison {
  id: string
  baseline: SkillFlowDamageSegmentSide | null
  comparison: SkillFlowDamageSegmentSide | null
  damage: SkillFlowAverageDamageComparison
  conditionsChanged: boolean
}

function stringIds(value: unknown): string[] | undefined {
  if (value == null) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined
  return [...new Set(value as string[])].sort()
}

function numericEntries(value: unknown): Record<string, number> | undefined {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value)
  if (!entries.every(([, number]) => typeof number === 'number' && Number.isFinite(number)))
    return undefined
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
}

/** 上下文损坏只取消逐段配对，已经验证的次数、总伤与旧快照仍可使用。 */
export function normalizeSkillFlowDamageSnapshotContext(
  value: unknown,
): SkillFlowDamageSnapshotContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<SkillFlowDamageSnapshotContext>
  if (
    typeof raw.hitId !== 'string' ||
    !raw.hitId ||
    typeof raw.flowEntryId !== 'string' ||
    !raw.flowEntryId ||
    !Number.isInteger(raw.flowEntryIndex) ||
    !(Number(raw.flowEntryIndex) >= 0) ||
    typeof raw.critMode !== 'string' ||
    !['expected', 'noCrit', 'fullCrit'].includes(raw.critMode) ||
    !(raw.anomalyPowerAgentId === null || typeof raw.anomalyPowerAgentId === 'string') ||
    !(raw.triggerAgentId === null || typeof raw.triggerAgentId === 'string') ||
    (raw.buffOverride != null &&
      (typeof raw.buffOverride !== 'object' || Array.isArray(raw.buffOverride)))
  )
    return undefined
  const buff = raw.buffOverride
  const disabledBlockIds = stringIds(buff?.disabledBlockIds)
  const disabledEffectIds = stringIds(buff?.disabledEffectIds)
  const stacksByEffectId = numericEntries(buff?.stacksByEffectId)
  const convertInputsByEffectId = numericEntries(buff?.convertInputsByEffectId)
  if (!disabledBlockIds || !disabledEffectIds || !stacksByEffectId || !convertInputsByEffectId)
    return undefined
  return {
    hitId: raw.hitId,
    flowEntryId: raw.flowEntryId,
    flowEntryIndex: Number(raw.flowEntryIndex),
    critMode: raw.critMode,
    anomalyPowerAgentId: raw.anomalyPowerAgentId,
    triggerAgentId: raw.triggerAgentId,
    buffOverride: {
      disabledBlockIds,
      disabledEffectIds,
      stacksByEffectId,
      convertInputsByEffectId,
    },
  }
}

export function captureSkillFlowDamageSnapshotContext(line: SkillFlowDamageLine) {
  return normalizeSkillFlowDamageSnapshotContext({
    hitId: line.hit.id,
    flowEntryId: line.flowEntryId,
    flowEntryIndex: line.flowEntryIndex,
    critMode: line.hit.critMode ?? 'expected',
    anomalyPowerAgentId: line.hit.damageKind === 'anomaly' ? line.hit.anomalyPowerAgentId : null,
    triggerAgentId: line.hit.damageKind === 'anomaly' ? line.hit.triggerAgentId : null,
    buffOverride: line.hit.buffOverride,
  })
}

function segmentIdentity(line: SkillFlowDamageSnapshotLine) {
  return line.context ? JSON.stringify([line.context.flowEntryId, line.context.hitId]) : null
}

function segmentSide(line: SkillFlowDamageSnapshotLine, index: number): SkillFlowDamageSegmentSide {
  const perHit = line.count > 0 ? line.total / line.count : null
  return { line, index, perHit: perHit != null && Number.isFinite(perHit) ? perHit : null }
}

function conditions(line: SkillFlowDamageSnapshotLine) {
  const context = line.context
  return JSON.stringify([
    line.damageType,
    line.staggerPhase,
    context?.critMode,
    context?.anomalyPowerAgentId,
    context?.triggerAgentId,
    context?.buffOverride,
  ])
}

function comparisonRow(
  id: string,
  baseline: SkillFlowDamageSegmentSide | null,
  comparison: SkillFlowDamageSegmentSide | null,
): SkillFlowDamageSegmentComparison {
  const before = baseline?.perHit ?? null
  const after = comparison?.perHit ?? null
  const delta = before != null && after != null ? after - before : null
  return {
    id,
    baseline,
    comparison,
    damage: {
      baseline: before,
      comparison: after,
      delta,
      changeRatio:
        delta != null && before != null && after != null
          ? before > 0
            ? delta / before
            : after === 0
              ? 0
              : null
          : null,
    },
    conditionsChanged: Boolean(
      baseline && comparison && conditions(baseline.line) !== conditions(comparison.line),
    ),
  }
}

/** 调用方先限定角色与招式；只配对双方均唯一的解析段身份，不按位置或数值猜配。 */
export function compareSkillFlowDamageSegments(
  baseline: readonly SkillFlowDamageSnapshotLine[],
  comparison: readonly SkillFlowDamageSnapshotLine[],
): SkillFlowDamageSegmentComparison[] {
  const beforeCounts = new Map<string, number>()
  const afterIndices = new Map<string, number[]>()
  baseline.forEach((line) => {
    const key = segmentIdentity(line)
    if (key) beforeCounts.set(key, (beforeCounts.get(key) ?? 0) + 1)
  })
  comparison.forEach((line, index) => {
    const key = segmentIdentity(line)
    if (key) afterIndices.set(key, [...(afterIndices.get(key) ?? []), index])
  })
  const matched = new Set<number>()
  const rows = baseline.map((line, index) => {
    const key = segmentIdentity(line)
    const candidates = key ? afterIndices.get(key) : undefined
    if (key && beforeCounts.get(key) === 1 && candidates?.length === 1) {
      const comparisonIndex = candidates[0]!
      matched.add(comparisonIndex)
      return comparisonRow(
        key,
        segmentSide(line, index),
        segmentSide(comparison[comparisonIndex]!, comparisonIndex),
      )
    }
    return comparisonRow(`baseline:${index}`, segmentSide(line, index), null)
  })
  comparison.forEach((line, index) => {
    if (!matched.has(index))
      rows.push(comparisonRow(`comparison:${index}`, null, segmentSide(line, index)))
  })
  return rows
}

export function skillFlowDamageSegmentHasChanges(segment: SkillFlowDamageSegmentComparison) {
  return (
    !segment.baseline ||
    !segment.comparison ||
    segment.damage.baseline !== segment.damage.comparison ||
    segment.conditionsChanged
  )
}
