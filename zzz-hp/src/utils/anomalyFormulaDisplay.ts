import type { AnomalyDamageSubKind } from '@/types/calculator'
import type { DamageCalcResult } from '@/utils/damageCalc'

export interface AnomalyFormulaAgentLabels {
  /**
   * 异常基础乘区所属角色展示名（建议带身份前缀，如「异常强度提供者 · 爱丽丝」）
   */
  baseAgent?: string
  /**
   * 增伤/倍率/暴击等 bonus 乘区所属角色展示名
   * 全部异常子类（含紊乱/乱流）→ 异常类触发者；异常结算中不出现招式持有者
   */
  bonusAgent?: string
  /** 异化系数区所属角色展示名（如「异化系数 · 蕾米埃尔」） */
  mutationAgent?: string
}

/** 公式标题上的身份前缀，避免只显示角色名时误解来源 */
export function formatAnomalyFormulaAgentLabel(
  role: 'anomalyPower' | 'owner' | 'trigger' | 'mutation',
  agentName: string | null | undefined,
): string | undefined {
  const name = agentName?.trim()
  if (!name) return undefined
  if (role === 'anomalyPower') return `异常强度提供者 · ${name}`
  if (role === 'owner') return `招式持有者 · ${name}`
  if (role === 'trigger') return `异常类触发者 · ${name}`
  return `异化系数 · ${name}`
}

export interface AlignedFormulaTerm {
  label: string
  value: string
  tipsKey: string
}

export type AlignedAnomalyFormulaKey =
  | 'anomalyBaseExpected'
  | 'anomalyExpected'
  | 'anomalyReleaseExpected'
  | 'radianceExpected'
  | 'radianceMutation'
  | 'disorderExpected'
  | 'turbulenceExpected'

export interface AlignedAnomalyFormulaGroup {
  key: AlignedAnomalyFormulaKey
  title: string
  hint?: string
  /** 乘区所属角色名，展示在标题开头 */
  agentLabel?: string
  terms: AlignedFormulaTerm[]
  result: string
  dualResults?: { label: string; value: string }[]
}

/**
 * 结果区展示三档：**期望 / 不暴击 / 暴击**（用户 2026-10-18 口径）。
 *
 * 期望是主口径，后两个是"如果这次没暴击 / 必定暴击"的边界值。
 * 之前这里只有后两档，且乘区里写死 `1 / 满暴击区`，导致看起来"不显示期望"。
 */
function expectedTriple(
  expected: number,
  noCrit: number,
  fullCrit: number,
  formatNumber: (v: number) => string,
): { label: string; value: string }[] {
  return [
    { label: '期望', value: formatNumber(expected) },
    { label: '不暴击', value: formatNumber(noCrit) },
    { label: '暴击', value: formatNumber(fullCrit) },
  ]
}

export function buildAlignedAnomalyFormulaGroups(
  p: DamageCalcResult,
  sub: AnomalyDamageSubKind,
  disorderLabel: string,
  formatFormulaNumber: (v: number, precision?: number) => string,
  formatNumber: (v: number) => string,
  labels?: AnomalyFormulaAgentLabels,
): AlignedAnomalyFormulaGroup[] {
  const remielSelf = p.remielSelfRadianceActive
  const baseWithMutation = resolveAnomalyBaseWithMutation(p)
  const baseTerms: AlignedFormulaTerm[] = remielSelf
    ? [
        {
          label: '局内攻击力',
          value: formatFormulaNumber(p.remielSelfInCombatAtk ?? 0, 4),
          tipsKey: 'remielSelfInCombatAtk',
        },
        {
          label: '局内精通区',
          value: formatFormulaNumber(p.remielSelfInCombatMasteryZone ?? 0),
          tipsKey: 'remielSelfInCombatMasteryZone',
        },
        {
          label: '特殊等级区',
          value: formatFormulaNumber(p.remielSelfSpecialLevelZone ?? 1),
          tipsKey: 'remielSelfSpecialLevelZone',
        },
        {
          label: '异化系数区',
          value: formatFormulaNumber(p.remielSelfMutationZone ?? p.mutationZone),
          tipsKey: 'mutationZone',
        },
        {
          label: '等级区',
          value: formatFormulaNumber(p.remielSelfStandardLevelZone ?? 1),
          tipsKey: 'remielSelfStandardLevelZone',
        },
      ]
    : [
        { label: '通用乘区', value: formatFormulaNumber(p.generalMultiplier, 2), tipsKey: 'generalMultiplier' },
        {
          label: '非直伤易伤区',
          value: formatFormulaNumber(p.anomalyVulnerableMultiplier),
          tipsKey: 'anomalyVulnerableMultiplier',
        },
        { label: '精通区', value: formatFormulaNumber(p.masteryZone), tipsKey: 'masteryZone' },
        { label: '等级区', value: formatFormulaNumber(p.levelZone), tipsKey: 'levelZone' },
        { label: '特殊乘区', value: formatFormulaNumber(p.specialMultiplier), tipsKey: 'specialMultiplier' },
      ]
  if (!remielSelf && p.mutationZone > 1) {
    baseTerms.push({
      label: '异化系数区',
      value: formatFormulaNumber(p.mutationZone),
      tipsKey: 'mutationZone',
    })
  }
  const base: AlignedAnomalyFormulaGroup = {
    key: 'anomalyBaseExpected',
    title: remielSelf ? '蕾米埃尔异常基础' : '异常基础期望',
    agentLabel: labels?.baseAgent,
    terms: baseTerms,
    result: formatNumber(baseWithMutation),
  }
  const anomaly: AlignedAnomalyFormulaGroup = {
    key: 'anomalyExpected',
    title: '异常伤害',
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      { label: '异常增伤区', value: formatFormulaNumber(p.anomalyDmgBonusZone), tipsKey: 'anomalyDmgBonusZone' },
      { label: '异常倍率区', value: formatFormulaNumber(p.anomalyMultZone), tipsKey: 'anomalyMultZone' },
      {
        label: '异常暴击区',
        value: formatFormulaNumber(p.anomalyCritZone),
        tipsKey: 'anomalyCritZone',
      },
    ],
    result: formatNumber(p.anomalyExpected),
    dualResults: expectedTriple(p.anomalyExpected, p.anomalyExpectedNoCrit, p.anomalyExpectedFullCrit, formatNumber),
  }
  const disorder: AlignedAnomalyFormulaGroup = {
    key: 'disorderExpected',
    title: `${disorderLabel}期望`,
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      { label: '紊乱倍率区', value: formatFormulaNumber(p.disorderZone), tipsKey: 'disorderZone' },
      { label: '紊乱增伤区', value: formatFormulaNumber(p.disorderDmgBonusZone), tipsKey: 'disorderDmgBonusZone' },
      // 紊乱只吃自己的暴击字段（紊乱暴击率/爆伤），与乱流同构
      {
        label: '紊乱暴击区',
        value: formatFormulaNumber(p.disorderCritZone),
        tipsKey: 'disorderCritZone',
      },
    ],
    result: formatNumber(p.disorderExpected),
    dualResults: expectedTriple(p.disorderExpected, p.disorderExpectedNoCrit, p.disorderExpectedFullCrit, formatNumber),
  }
  const turbulence: AlignedAnomalyFormulaGroup = {
    key: 'turbulenceExpected',
    title: '乱流伤害',
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      { label: '乱流倍率区', value: formatFormulaNumber(p.turbulenceZone), tipsKey: 'turbulenceZone' },
      {
        label: '乱流增伤区+异常增伤区',
        value: formatFormulaNumber(p.turbulenceCombinedDmgBonusZone),
        tipsKey: 'turbulenceCombinedDmgBonusZone',
      },
      {
        // 乱流只吃自己的暴击字段（用户 2026-10-16）；此前这里错用异常暴击区
        label: '乱流暴击区',
        value: formatFormulaNumber(p.turbulenceCritZone),
        tipsKey: 'turbulenceCritZone',
      },
    ],
    result: formatNumber(p.turbulenceExpected),
    dualResults: expectedTriple(p.turbulenceExpected, p.turbulenceExpectedNoCrit, p.turbulenceExpectedFullCrit, formatNumber),
  }
  const release: AlignedAnomalyFormulaGroup = {
    key: 'anomalyReleaseExpected',
    title: '异放伤害',
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      {
        label: '异放综合增伤区',
        value: formatFormulaNumber(p.anomalyReleaseCombinedDmgBonusZone),
        tipsKey: 'anomalyReleaseCombinedDmgBonusZone',
      },
      {
        label: '异放倍率区',
        value: formatFormulaNumber(p.anomalyReleaseMultZone),
        tipsKey: 'anomalyReleaseMultZone',
      },
      // 「异常综合暴击区」已删除（用户 2026-10-16：暴击按子类拆开，异放只吃自己的暴击字段）
      {
        label: '异放暴击区',
        value: formatFormulaNumber(p.anomalyReleaseCritZone),
        tipsKey: 'anomalyReleaseCritZone',
      },
    ],
    result: formatNumber(p.anomalyReleaseExpected),
    dualResults: expectedTriple(
      p.anomalyReleaseExpected,
      p.anomalyReleaseExpectedNoCrit,
      p.anomalyReleaseExpectedFullCrit,
      formatNumber,
    ),
  }
  const radianceChain: AlignedAnomalyFormulaGroup = {
    key: 'radianceExpected',
    title: '耀变伤害',
    agentLabel: labels?.bonusAgent,
    terms: remielSelf
      ? [
          {
            label: '蕾米埃尔异常基础',
            value: formatNumber(baseWithMutation),
            tipsKey: 'anomalyBaseExpected',
          },
          {
            label: '防御区',
            value: formatFormulaNumber(p.remielSelfDefenseMultiplier ?? 1),
            tipsKey: 'remielSelfDefenseMultiplier',
          },
          {
            label: '抗性区',
            value: formatFormulaNumber(p.remielSelfResistanceMultiplier ?? 1),
            tipsKey: 'remielSelfResistanceMultiplier',
          },
          {
            label: '易伤区',
            value: formatFormulaNumber(p.anomalyVulnerableMultiplier),
            tipsKey: 'anomalyVulnerableMultiplier',
          },
          {
            label: '失衡易伤区',
            value: formatFormulaNumber(p.staggerMultiplier),
            tipsKey: 'staggerMultiplier',
          },
          {
            label: '耀变综合增伤区',
            value: formatFormulaNumber(p.radianceCombinedDmgBonusZone),
            tipsKey: 'radianceCombinedDmgBonusZone',
          },
          {
            label: '耀变倍率区',
            value: formatFormulaNumber(p.radianceMultZone),
            tipsKey: 'radianceMultZone',
          },
          {
            label: '特殊倍率乘区',
            value: formatFormulaNumber(p.specialMultZone),
            tipsKey: 'specialMultZone',
          },
          {
            label: '特殊乘区',
            value: formatFormulaNumber(p.specialMultiplier),
            tipsKey: 'specialMultiplier',
          },
          {
            // 耀变的触发者无论是蕾米还是其他人都允许暴击（游戏规则）
            label: '耀变暴击区',
            value: formatFormulaNumber(p.radianceCritZone),
            tipsKey: 'radianceCritZone',
          },
        ]
      : [
          { label: '异常基础期望', value: formatNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
          {
            label: '耀变综合增伤区',
            value: formatFormulaNumber(p.radianceCombinedDmgBonusZone),
            tipsKey: 'radianceCombinedDmgBonusZone',
          },
          {
            label: '耀变倍率区',
            value: formatFormulaNumber(p.radianceMultZone),
            tipsKey: 'radianceMultZone',
          },
          {
            label: '耀变暴击区',
            value: formatFormulaNumber(p.radianceCritZone),
            tipsKey: 'radianceCritZone',
          },
        ],
    result: formatNumber(p.radianceExpected),
    dualResults: expectedTriple(p.radianceExpected, p.radianceExpectedNoCrit, p.radianceExpectedFullCrit, formatNumber),
  }

  if (sub === 'disorder') return [base, disorder]
  if (sub === 'turbulence') return [base, turbulence]
  if (sub === 'anomalyRelease') return [base, release]
  if (sub === 'radiance') return [base, radianceChain]
  return [base, anomaly]
}

export function resolveAnomalyBaseWithMutation(
  p: Pick<DamageCalcResult, 'anomalyBaseExpected' | 'mutationZone' | 'remielSelfRadianceActive'>,
): number {
  if (p.remielSelfRadianceActive) return p.anomalyBaseExpected
  return p.mutationZone > 1 ? Math.round(p.anomalyBaseExpected * p.mutationZone) : p.anomalyBaseExpected
}
