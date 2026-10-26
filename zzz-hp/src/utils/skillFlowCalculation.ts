import type { DamageEnemyInput } from '@/utils/enemyResistance'
import type { ResolvedHit } from '@/utils/resolvedHit'
import {
  evaluateOptimalEventDetail,
  type OptimalEvalContext,
  type OptimalEventEvalDetail,
} from '@/utils/optimalAffixAlloc'
import { readHitEvalCache, writeHitEvalCache } from '@/utils/hitEvalCache'

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
  /**
   * 同快照的 detail 轴缓存键（Spec §3.4 第 3 项）。
   * 提供时**只**接受同一快照的完整 detail 条目：命中直接复用，未命中才正式重放一次并写回；
   * 不提供时保持原来的纯求值行为（不读写缓存）。
   */
  cacheKey?: string,
): SkillFlowCalculationDetail | null {
  if (cacheKey) {
    const cached = readHitEvalCache(cacheKey)
    if (cached?.evaluation) return toDetail(cached.evaluation, context)
  }
  const evaluation = evaluateSkillFlowHit(context, external, hit, true)
  if (!evaluation) return null
  if (cacheKey) {
    writeHitEvalCache(cacheKey, {
      hitId: hit.id,
      perHit: evaluation.perHit,
      total: evaluation.total,
      result: evaluation.result,
      evaluation,
    })
  }
  return toDetail(evaluation, context)
}

function toDetail(
  evaluation: OptimalEventEvalDetail,
  context: OptimalEvalContext,
): SkillFlowCalculationDetail {
  return {
    evaluation,
    enemyInput: context.enemyInput,
    isMb: evaluation.kind === 'direct' && evaluation.result.baseDamageSource === 'pierce',
  }
}
