/**
 * 把伤害记录快照还原成流程伤害分析结果，让「记录」与「当前流程」共用同一套统计与渲染。
 *
 * 快照只存标量与身份（次数 / 合计 / 类型 / 失衡 / 归属），不存 `ResolvedHit` 与乘区明细；
 * 这里造出的 `hit` 只在流程伤害视图读到的字段上有意义（id、skill、count、staggerPhase、
 * damageKind、提供者/触发者、buff 例外），**不能**拿去重算伤害或取计算过程。
 */
import type { AnomalyDamageSubKind, DamageCalcKind } from '@/types/calculator'
import type {
  SkillFlowDamageAnalysis,
  SkillFlowDamageLine,
  SkillFlowDamageSlot,
} from '@/utils/skillFlowDamageAnalysis'
import type {
  SkillFlowDamageSnapshot,
  SkillFlowDamageSnapshotLine,
} from '@/utils/skillFlowDamageRecordComparison'
import type { ResolvedHit } from '@/utils/resolvedHit'

const DIRECT_DAMAGE_TYPES = new Set(['normal', 'pierce', 'sharpen'])

function damageKindOf(line: SkillFlowDamageSnapshotLine): DamageCalcKind {
  return DIRECT_DAMAGE_TYPES.has(line.damageType) ? 'direct' : 'anomaly'
}

function viewHit(line: SkillFlowDamageSnapshotLine, index: number): ResolvedHit {
  const damageKind = damageKindOf(line)
  const context = line.context
  return {
    id: context?.hitId ?? `${line.skillId}:${index}`,
    skill: { id: line.skillId, name: line.skillName },
    count: line.count,
    staggerPhase: line.staggerPhase,
    damageKind,
    directSubKind: damageKind === 'direct' ? line.damageType : 'normal',
    anomalySubKind: damageKind === 'anomaly' ? (line.damageType as AnomalyDamageSubKind) : 'anomaly',
    anomalyPowerAgentId: context?.anomalyPowerAgentId ?? null,
    triggerAgentId: context?.triggerAgentId ?? null,
    critMode: context?.critMode ?? 'expected',
    buffOverride: context?.buffOverride ?? null,
  } as unknown as ResolvedHit
}

export function buildSkillFlowDamageAnalysisFromSnapshot(
  snapshot: SkillFlowDamageSnapshot | null | undefined,
): SkillFlowDamageAnalysis {
  if (!snapshot) return { total: 0, slots: [], lines: [] }
  const slots: SkillFlowDamageSlot[] = snapshot.agentIds.map((_, slotIndex) => ({
    slotIndex,
    total: 0,
    lines: [],
    // 记录里的未结算段是整队合计，分不到具体槽位；由调用方按「全队」范围单独显示
    uncomputedCount: 0,
  }))
  const lines: SkillFlowDamageLine[] = []
  snapshot.lines.forEach((line, index) => {
    const slot = slots[line.slotIndex]
    if (!slot) return
    const view: SkillFlowDamageLine = {
      hit: viewHit(line, index),
      slotIndex: line.slotIndex,
      flowEntryId: line.context?.flowEntryId ?? '',
      flowEntryIndex: line.context?.flowEntryIndex ?? 0,
      total: line.total,
      perHit: line.count > 0 ? line.total / line.count : 0,
      damageType: line.damageType,
    }
    slot.lines.push(view)
    slot.total += view.total
    lines.push(view)
  })
  return { total: slots.reduce((sum, slot) => sum + slot.total, 0), slots, lines }
}
