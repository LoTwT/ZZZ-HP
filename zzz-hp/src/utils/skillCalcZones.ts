import type { SkillDamageType } from '@/types/calculator'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import type { DamageCalcResult } from '@/utils/damageCalc'

export interface SkillCalcZoneRow {
  label: string
  value: string
}

function formatZoneValue(value: number, asDamage = false) {
  if (!Number.isFinite(value)) return '—'
  if (asDamage || Math.abs(value) >= 100) {
    return Math.round(value).toLocaleString('en-US')
  }
  return formatCalcDecimal(value)
}

function push(
  rows: SkillCalcZoneRow[],
  label: string,
  value: number,
  asDamage = false,
) {
  rows.push({ label, value: formatZoneValue(value, asDamage) })
}

function pushCommon(rows: SkillCalcZoneRow[], result: DamageCalcResult) {
  push(rows, '基础伤害', result.baseDamage, true)
  push(rows, '防御区', result.defenseMultiplier)
  push(rows, '抗性区', result.resistanceMultiplier)
  push(rows, '易伤区', result.vulnerableMultiplier)
  push(rows, '失衡易伤区', result.staggerMultiplier)
  push(rows, '通用乘区', result.generalMultiplier)
  push(rows, '特殊乘区', result.specialMultiplier)
}

/** 按伤害类型列出本条招式实际用到的乘区，风格对齐 zzz-dev 招式详情的 key / value。 */
export function buildSkillCalcZoneRows(
  result: DamageCalcResult,
  damageType: SkillDamageType,
): SkillCalcZoneRow[] {
  const rows: SkillCalcZoneRow[] = []
  pushCommon(rows, result)

  if (damageType === 'direct') {
    push(rows, '暴击区', result.critMultiplier)
    push(rows, '增伤', result.dmgMultiplier)
    if (result.baseDamageSource === 'pierce') {
      push(rows, '贯穿增伤区', result.pierceDmgMultiplier)
    }
    push(rows, '直伤倍率区', result.directDmgMultZone)
    if (result.settlementDmgMultZone > 0) {
      push(rows, '决算倍率区', result.settlementDmgMultZone)
    }
    push(rows, '期望伤害', result.directDamageExpected, true)
    return rows
  }

  push(rows, '精通区', result.masteryZone)
  push(rows, '等级区', result.levelZone)
  if (result.mutationZone > 1) push(rows, '异化系数', result.mutationZone)

  if (damageType === 'anomaly') {
    push(rows, '异常增伤区', result.anomalyDmgBonusZone)
    push(rows, '异常倍率区', result.anomalyMultZone)
    push(rows, '异常暴击区', result.anomalyCritZone)
    push(rows, '期望伤害', result.anomalyExpected, true)
    return rows
  }

  if (damageType === 'disorder') {
    push(rows, '紊乱基础倍率', result.disorderBaseMultRatio)
    push(rows, '异常持续时间', result.effectiveAnomalyDuration)
    push(rows, '紊乱补偿倍率', result.disorderCompMultRatio)
    push(rows, '紊乱倍率区', result.disorderZone)
    push(rows, '紊乱增伤区', result.disorderDmgBonusZone)
    push(rows, '期望伤害', result.disorderExpected, true)
    return rows
  }

  if (damageType === 'turbulence') {
    push(rows, '乱流基础倍率', result.turbulenceBaseMultRatio)
    push(rows, '异常持续时间', result.effectiveAnomalyDuration)
    push(rows, '乱流补偿倍率', result.turbulenceCompMultRatio)
    push(rows, '乱流倍率区', result.turbulenceZone)
    push(rows, '乱流综合增伤区', result.turbulenceCombinedDmgBonusZone)
    if (result.turbulenceUsesAnomalyCrit) {
      push(rows, '异常暴击区', result.anomalyCritZone)
    }
    push(rows, '期望伤害', result.turbulenceExpected, true)
    return rows
  }

  if (damageType === 'anomalyRelease') {
    push(rows, '异放综合增伤区', result.anomalyReleaseCombinedDmgBonusZone)
    push(rows, '异放倍率区', result.anomalyReleaseMultZone)
    push(rows, '异常综合暴击区', result.anomalyCombinedCritZone)
    push(rows, '期望伤害', result.anomalyReleaseExpected, true)
    return rows
  }

  if (damageType === 'radiance') {
    push(rows, '耀变综合增伤区', result.radianceCombinedDmgBonusZone)
    push(rows, '耀变倍率区', result.radianceMultZone)
    if (result.remielSelfRadianceActive) {
      push(rows, '特殊倍率乘区', result.specialMultZone)
    }
    push(rows, '期望伤害', result.radianceExpected, true)
  }

  return rows
}
