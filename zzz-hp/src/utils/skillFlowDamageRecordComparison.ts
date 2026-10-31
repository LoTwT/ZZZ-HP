import {
  BUFF_DAMAGE_TYPE_OPTIONS,
  type BuffDamageType,
  type StaggerPhase,
} from '@/types/calculator'
import type { SkillFlowDamageAnalysis } from '@/utils/skillFlowDamageAnalysis'
import { migrateAttributeAnomalyTypeValue } from '@/utils/attributeAnomalyMigration'
import {
  captureSkillFlowDamageSnapshotContext,
  compareSkillFlowDamageSegments,
  normalizeSkillFlowDamageSnapshotContext,
  type SkillFlowDamageSnapshotContext,
  type SkillFlowDamageSegmentComparison,
} from '@/utils/skillFlowDamageRecordSegments'

export interface SkillFlowDamageSnapshotLine {
  slotIndex: number
  skillId: string
  skillName: string
  damageType: BuffDamageType
  staggerPhase: StaggerPhase
  count: number
  total: number
  context?: SkillFlowDamageSnapshotContext
}

/** 只保存数值与稳定身份；比例在比较时按各自全队总伤计算。 */
export interface SkillFlowDamageSnapshot {
  version: 1
  agentIds: string[]
  lines: SkillFlowDamageSnapshotLine[]
  uncomputedCount: number
}

export interface SkillFlowDamageMetricComparison {
  baseline: number
  comparison: number
  delta: number
  /** 基准为 0 且对照非 0 时为 null，不伪造无穷大百分比。 */
  changeRatio: number | null
}

export interface SkillFlowAverageDamageComparison {
  baseline: number | null
  comparison: number | null
  delta: number | null
  changeRatio: number | null
}

export interface SkillFlowSkillComparisonMetrics {
  count: SkillFlowDamageMetricComparison
  averageDamage: SkillFlowAverageDamageComparison
  segments: SkillFlowDamageSegmentComparison[]
}

export interface SkillFlowDamageComparisonRow extends SkillFlowDamageMetricComparison {
  id: string
  name: string
  shareDelta: number
  state: 'added' | 'removed' | 'changed' | 'same'
  skill?: SkillFlowSkillComparisonMetrics
}

type ComparisonRecord = {
  team: number
  agentNames: string[]
  snapshot?: SkillFlowDamageSnapshot
}

type SnapshotGroup = {
  name: string
  total: number
  count: number
  lines: SkillFlowDamageSnapshotLine[]
}

function compareMetric(baseline: number, comparison: number): SkillFlowDamageMetricComparison {
  const delta = comparison - baseline
  return {
    baseline,
    comparison,
    delta,
    changeRatio: baseline > 0 ? delta / baseline : comparison === 0 ? 0 : null,
  }
}

function compareAverageDamage(
  baseline: SnapshotGroup | undefined,
  comparison: SnapshotGroup | undefined,
): SkillFlowAverageDamageComparison {
  const before = baseline && baseline.count > 0 ? baseline.total / baseline.count : null
  const after = comparison && comparison.count > 0 ? comparison.total / comparison.count : null
  const metric = before != null && after != null ? compareMetric(before, after) : null
  return {
    baseline: before,
    comparison: after,
    delta: metric?.delta ?? null,
    changeRatio: metric?.changeRatio ?? null,
  }
}

export function captureSkillFlowDamageSnapshot(
  analysis: SkillFlowDamageAnalysis,
  agentIds: readonly string[],
): SkillFlowDamageSnapshot {
  return {
    version: 1,
    agentIds: [...agentIds],
    lines: analysis.lines.map((line) => ({
      slotIndex: line.slotIndex,
      skillId: line.hit.skill.id,
      skillName: line.hit.skill.name,
      damageType: line.damageType,
      staggerPhase: line.hit.staggerPhase,
      count: line.hit.count,
      total: line.total,
      context: captureSkillFlowDamageSnapshotContext(line),
    })),
    uncomputedCount: analysis.slots.reduce((sum, slot) => sum + slot.uncomputedCount, 0),
  }
}

/** 坏明细只降级为「仅总伤」，不丢弃合法的旧记录或凭当前配置补数据。 */
export function normalizeSkillFlowDamageSnapshot(
  value: unknown,
  teamTotal: number,
): SkillFlowDamageSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<SkillFlowDamageSnapshot>
  if (
    raw.version !== 1 ||
    !Array.isArray(raw.agentIds) ||
    !raw.agentIds.every((id) => typeof id === 'string') ||
    !Array.isArray(raw.lines)
  )
    return undefined
  if (!Number.isInteger(raw.uncomputedCount) || !(Number(raw.uncomputedCount) >= 0))
    return undefined
  const types = new Set<string>(BUFF_DAMAGE_TYPE_OPTIONS.map((item) => item.id))
  const lines: SkillFlowDamageSnapshotLine[] = []
  for (const item of raw.lines) {
    if (!item || typeof item !== 'object') return undefined
    // 旧子类 id（nomaly）在类型白名单校验前转换；不改已保存的数值
    const lineDamageType = migrateAttributeAnomalyTypeValue(item.damageType) as string
    if (
      !Number.isInteger(item.slotIndex) ||
      item.slotIndex < 0 ||
      item.slotIndex >= raw.agentIds.length ||
      typeof item.skillId !== 'string' ||
      !item.skillId ||
      typeof item.skillName !== 'string' ||
      !types.has(lineDamageType) ||
      !['normal', 'stagger'].includes(item.staggerPhase) ||
      !Number.isFinite(item.count) ||
      item.count < 0 ||
      !Number.isFinite(item.total) ||
      item.total < 0
    )
      return undefined
    lines.push({
      slotIndex: item.slotIndex,
      skillId: item.skillId,
      skillName: item.skillName,
      damageType: lineDamageType as SkillFlowDamageSnapshotLine['damageType'],
      staggerPhase: item.staggerPhase,
      count: item.count,
      total: item.total,
      context: normalizeSkillFlowDamageSnapshotContext(item.context),
    })
  }
  const sum = lines.reduce((total, line) => total + line.total, 0)
  if (!Number.isFinite(sum) || Math.abs(sum - teamTotal) > Math.max(1, Math.abs(teamTotal)) * 1e-9)
    return undefined
  return {
    version: 1,
    agentIds: [...raw.agentIds],
    lines,
    uncomputedCount: Number(raw.uncomputedCount),
  }
}

export function skillFlowDamageComparisonRow(
  id: string,
  name: string,
  baseline: number,
  comparison: number,
  baselineTotal: number,
  comparisonTotal: number,
  existedBefore = true,
  existsNow = true,
): SkillFlowDamageComparisonRow {
  const delta = comparison - baseline
  return {
    id,
    name,
    ...compareMetric(baseline, comparison),
    shareDelta:
      (comparisonTotal > 0 ? comparison / comparisonTotal : 0) -
      (baselineTotal > 0 ? baseline / baselineTotal : 0),
    state: !existedBefore ? 'added' : !existsNow ? 'removed' : delta !== 0 ? 'changed' : 'same',
  }
}

function aggregateSnapshot(record: ComparisonRecord, dimension: 'agent' | 'type' | 'skill') {
  const groups = new Map<string, SnapshotGroup>()
  const snapshot = record.snapshot
  if (!snapshot) return groups
  if (dimension === 'agent') {
    snapshot.agentIds.forEach((id, index) => {
      if (id)
        groups.set(id, { name: record.agentNames[index] || id, total: 0, count: 0, lines: [] })
    })
  }
  for (const line of snapshot.lines) {
    const agentId = snapshot.agentIds[line.slotIndex] ?? ''
    const agentName = record.agentNames[line.slotIndex] || agentId || '未选'
    const id =
      dimension === 'agent'
        ? agentId
        : dimension === 'type'
          ? line.damageType
          : JSON.stringify([agentId, line.skillId])
    const name =
      dimension === 'agent'
        ? agentName
        : dimension === 'type'
          ? (BUFF_DAMAGE_TYPE_OPTIONS.find((item) => item.id === line.damageType)?.label ??
            line.damageType)
          : `${agentName} · ${line.skillName}`
    const group = groups.get(id) ?? { name, total: 0, count: 0, lines: [] }
    group.name = name
    group.total += line.total
    group.count += line.count
    group.lines.push(line)
    groups.set(id, group)
  }
  return groups
}

export function compareSkillFlowDamageRecords(
  baseline: ComparisonRecord,
  comparison: ComparisonRecord,
) {
  const hasDetails = Boolean(baseline.snapshot && comparison.snapshot)
  const dimensions = {
    agent: [] as SkillFlowDamageComparisonRow[],
    type: [] as SkillFlowDamageComparisonRow[],
    skill: [] as SkillFlowDamageComparisonRow[],
  }
  if (hasDetails) {
    for (const dimension of ['agent', 'type', 'skill'] as const) {
      const before = aggregateSnapshot(baseline, dimension)
      const after = aggregateSnapshot(comparison, dimension)
      dimensions[dimension] = [...new Set([...before.keys(), ...after.keys()])]
        .map((id) => {
          const a = before.get(id)
          const b = after.get(id)
          const row = skillFlowDamageComparisonRow(
            id,
            b?.name ?? a?.name ?? id,
            a?.total ?? 0,
            b?.total ?? 0,
            baseline.team,
            comparison.team,
            Boolean(a),
            Boolean(b),
          )
          if (dimension === 'skill') {
            row.skill = {
              count: compareMetric(a?.count ?? 0, b?.count ?? 0),
              averageDamage: compareAverageDamage(a, b),
              segments: compareSkillFlowDamageSegments(a?.lines ?? [], b?.lines ?? []),
            }
            if (row.state === 'same' && row.skill.count.delta !== 0) row.state = 'changed'
          }
          return row
        })
        .sort(
          (a, b) =>
            Math.abs(b.delta) - Math.abs(a.delta) ||
            b.comparison - a.comparison ||
            a.name.localeCompare(b.name, 'zh-CN'),
        )
    }
  }
  return {
    hasDetails,
    skillSummary: hasDetails
      ? {
          kinds: compareMetric(
            dimensions.skill.filter((row) => row.state !== 'added').length,
            dimensions.skill.filter((row) => row.state !== 'removed').length,
          ),
          uses: compareMetric(
            dimensions.skill.reduce((sum, row) => sum + (row.skill?.count.baseline ?? 0), 0),
            dimensions.skill.reduce((sum, row) => sum + (row.skill?.count.comparison ?? 0), 0),
          ),
          added: dimensions.skill.filter((row) => row.state === 'added').length,
          removed: dimensions.skill.filter((row) => row.state === 'removed').length,
        }
      : null,
    total: skillFlowDamageComparisonRow(
      'team',
      '全队',
      baseline.team,
      comparison.team,
      baseline.team,
      comparison.team,
    ),
    ...dimensions,
  }
}
