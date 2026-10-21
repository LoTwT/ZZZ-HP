import type { DamageEnemyInput } from '@/utils/enemyResistance'
import type { ResolvedHit } from '@/utils/resolvedHit'
import {
  evaluateOptimalEventDetail,
  type OptimalEvalContext,
  type OptimalEventEvalDetail,
} from '@/utils/optimalAffixAlloc'

export interface SkillFlowCalculationDetail {
  evaluation: OptimalEventEvalDetail
  enemyInput: DamageEnemyInput
  isMb: boolean
}

/** 流程数字与完整来源共用同一入口；需要该条详情时才生成来源。 */
export function evaluateSkillFlowHit(
  context: OptimalEvalContext,
  external: OptimalEventEvalDetail['external'] | null,
  hit: ResolvedHit,
  includeDetails = false,
) {
  return evaluateOptimalEventDetail(context, external, hit, {
    includeDetails,
    requirePanel: true,
  })
}

export function resolveSkillFlowCalculationDetail(
  context: OptimalEvalContext,
  external: OptimalEventEvalDetail['external'] | null,
  hit: ResolvedHit,
): SkillFlowCalculationDetail | null {
  const evaluation = evaluateSkillFlowHit(context, external, hit, true)
  if (!evaluation) return null
  return {
    evaluation,
    enemyInput: context.enemyInput,
    isMb: evaluation.kind === 'direct' && evaluation.result.baseDamageSource === 'pierce',
  }
}
