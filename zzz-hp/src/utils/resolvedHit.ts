import type {
  AnomalyDamageSubKind,
  DamageCalcKind,
  DamageEventCritMode,
  DamageEventMultOverrides,
  FollowUpSkillRule,
  Skill,
  SkillCalcContext,
  SkillMatchCoord,
  SkillSubcategory,
  StaggerPhase,
} from '@/types/calculator'
import type {
  FlowEntry,
  PreparedSkill,
  PreparedSkillExtraMods,
  SchemeSlot,
} from '@/types/damageCalcHistory'
import type { DamageCalcInput, DamageCalcResult } from '@/utils/damageCalc'
import { computeDamageResult } from '@/utils/damageCalc'
import {
  DAMAGE_EVENT_KIND_OPTIONS,
  disorderLabelFromResult,
  getTurbulenceParticipationFailureReason,
  mapEventKindToCalc,
  pickEventDamage,
} from '@/utils/damageEvent'
import {
  canAgentBeAnomalyProducerForKind,
  findLuminousAgentInTeam,
  isLegacyAnomalyEventKind,
  isLuminousAgent,
} from '@/utils/remielUtils'
import { resolveIsFollowUp } from '@/utils/buffEffect'
import { buildSkillMatchCoords, skillTypesIncludeFollowUp } from '@/utils/skillTypes'

export function newLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function createEmptySchemeSlot(): SchemeSlot {
  return { prepared: [], flow: [] }
}

export function ensureSchemeSlots(
  slots: SchemeSlot[] | null | undefined,
  count = 3,
): SchemeSlot[] {
  const next = (slots ?? []).map((slot) => ({
    prepared: [...(slot.prepared ?? [])],
    flow: [...(slot.flow ?? [])],
  }))
  while (next.length < count) next.push(createEmptySchemeSlot())
  return next.slice(0, count)
}

/** 异常类伤害（含属性异常/异放/紊乱/乱流/耀变）都要选双代理人 */
export function skillNeedsDualAgents(damageType: Skill['damageType']): boolean {
  return mapEventKindToCalc(damageType).damageKind === 'anomaly'
}

export function defaultAnomalyAgents(
  damageType: Skill['damageType'],
  ownerAgentId: string,
): { anomalyPowerAgentId: string | null; triggerAgentId: string | null } {
  if (!skillNeedsDualAgents(damageType)) {
    return { anomalyPowerAgentId: null, triggerAgentId: null }
  }
  if (
    damageType === 'anomalyRelease' ||
    damageType === 'radiance' ||
    damageType === 'turbulence'
  ) {
    return { anomalyPowerAgentId: null, triggerAgentId: ownerAgentId }
  }
  return { anomalyPowerAgentId: null, triggerAgentId: null }
}

/**
 * 一次结算单元：流程里的一条，连同它引用的招式与准备阶段参数，全部解开摊平。
 *
 * 这是新架构下伤害计算的唯一输入。主计算页与最优词条分配吃同一份，
 * 因此「准备阶段改的倍率」「流程里的次数与失衡状态」对两者一致生效。
 */
export interface ResolvedHit {
  /** 取流程条目 id，方便回指 UI */
  id: string
  skill: Skill
  /** 流程归属角色；直伤取其面板，异常类只用于伤害归属统计 */
  ownerAgentId: string
  /** 异常强度提供者，留空则本条不计算 */
  anomalyPowerAgentId: string | null
  /** 异常类触发者，留空则本条不计算 */
  triggerAgentId: string | null
  count: number
  staggerPhase: StaggerPhase
  critMode: DamageEventCritMode
  damageKind: DamageCalcKind
  anomalySubKind: AnomalyDamageSubKind
  /** 招式类型翻译成的旧 Buff 坐标，命中任意一个即生效；空数组 = 不吃招式限定 Buff */
  coords: SkillMatchCoord[]
  isFollowUp: boolean
  /** 招式倍率 + 准备阶段增量，已并入旧的覆写结构 */
  multOverrides: DamageEventMultOverrides | null
  /** 准备阶段的属性增量（增伤/暴击等），加算并入对应乘区 */
  panelMods: PreparedSkillExtraMods | null
}

/** 每种伤害类型的倍率写到哪两个覆写字段 */
const MULT_FIELDS: Record<
  Skill['damageType'],
  { mult: keyof DamageEventMultOverrides; factor: keyof DamageEventMultOverrides }
> = {
  direct: { mult: 'directDmgMult', factor: 'directDmgMultFactor' },
  anomaly: { mult: 'anomalyMult', factor: 'anomalyMultFactor' },
  anomalyRelease: { mult: 'anomalyReleaseMult', factor: 'anomalyReleaseMultFactor' },
  disorder: { mult: 'disorderBaseMult', factor: 'disorderBaseMultFactor' },
  turbulence: { mult: 'turbulenceBaseMult', factor: 'turbulenceBaseMultFactor' },
  radiance: { mult: 'radianceMult', factor: 'radianceMultFactor' },
}

function buildMultOverrides(
  skill: Skill,
  extraMods: PreparedSkillExtraMods | null | undefined,
): DamageEventMultOverrides | null {
  const fields = MULT_FIELDS[skill.damageType]
  const overrides: DamageEventMultOverrides = {}

  // 倍率 0 沿用旧语义：未设置，回落面板 / 招式小类默认值
  const base = Number(skill.baseMult) || 0
  const extraBase = Number(extraMods?.baseMult) || 0
  const total = base + extraBase
  if (total !== 0) overrides[fields.mult] = total

  const factor = Number(skill.baseMultFactor)
  if (Number.isFinite(factor) && factor !== 100) overrides[fields.factor] = factor

  if (skill.damageType === 'direct') {
    const settlement = (Number(skill.settlementMult) || 0) + (Number(extraMods?.settlementMult) || 0)
    if (settlement !== 0) overrides.settlementDmgMult = settlement
  }

  return Object.keys(overrides).length > 0 ? overrides : null
}

function hasPanelMods(extraMods: PreparedSkillExtraMods | null | undefined): boolean {
  if (!extraMods) return false
  return [extraMods.dmgBonus, extraMods.critRate, extraMods.critDmg].some(
    (value) => Number(value) !== 0 && value != null,
  )
}

export interface ResolveFlowOptions {
  /** 按下标对齐 teamSlots */
  slots: SchemeSlot[]
  teamSlots: Array<{ agentId: string }>
  findSkill: (skillId: string) => Skill | null
  skillSubcategories?: SkillSubcategory[] | null
  followUpSkillRules?: FollowUpSkillRule[] | null
}

/** 招式被删后，引用它的准备阶段条目会解析失败，此处记下来给 UI 提示 */
export interface ResolveFlowResult {
  hits: ResolvedHit[]
  missingSkillIds: string[]
}

function resolveOne(
  entry: FlowEntry,
  prepared: PreparedSkill,
  skill: Skill,
  ownerAgentId: string,
  options: ResolveFlowOptions,
): ResolvedHit {
  const { damageKind, anomalySubKind } = mapEventKindToCalc(skill.damageType)
  const anchorId = skill.buffAnchorId?.trim() || null
  const anchorCategory = anchorId
    ? (options.skillSubcategories?.find((item) => item.id === anchorId)?.categoryId ?? null)
    : null

  const coords = buildSkillMatchCoords({
    skillTypes: skill.skillTypes,
    buffAnchorId: anchorId,
    buffAnchorCategory: anchorCategory,
  })

  // 追加攻击既可显式勾类型，也可由锚点所在小类 / 规则表推定
  const isFollowUp =
    skillTypesIncludeFollowUp(skill.skillTypes) ||
    (anchorCategory
      ? resolveIsFollowUp({
          agentId: ownerAgentId,
          categoryId: anchorCategory,
          subcategoryId: anchorId,
          skillSubcategories: options.skillSubcategories,
          followUpSkillRules: options.followUpSkillRules,
        })
      : false)

  return {
    id: entry.id,
    skill,
    ownerAgentId,
    anomalyPowerAgentId: prepared.anomalyPowerAgentId?.trim() || null,
    triggerAgentId: prepared.triggerAgentId?.trim() || null,
    count: Math.max(0, Number(entry.count) || 0),
    staggerPhase: entry.staggerPhase,
    critMode: entry.critMode,
    damageKind,
    anomalySubKind,
    coords,
    isFollowUp,
    multOverrides: buildMultOverrides(skill, prepared.extraMods),
    panelMods: hasPanelMods(prepared.extraMods) ? (prepared.extraMods ?? null) : null,
  }
}

/**
 * 展开方案的三条流程为一份扁平结算列表。
 *
 * 顺序即三条流程按槽位先后拼接——数据结构上没有「三条」的痕迹，
 * 将来要合并成一条时间轴只需换排序，不必动存盘。
 */
export function resolveFlow(options: ResolveFlowOptions): ResolveFlowResult {
  const hits: ResolvedHit[] = []
  const missing = new Set<string>()

  options.slots.forEach((slot, index) => {
    if (!slot) return
    const ownerAgentId = options.teamSlots[index]?.agentId ?? ''
    if (!ownerAgentId) return
    const preparedById = new Map(slot.prepared.map((item) => [item.id, item]))

    for (const entry of slot.flow) {
      const prepared = preparedById.get(entry.preparedId)
      if (!prepared) continue
      const skill = options.findSkill(prepared.skillId)
      if (!skill) {
        missing.add(prepared.skillId)
        continue
      }
      hits.push(resolveOne(entry, prepared, skill, ownerAgentId, options))
    }
  })

  return { hits, missingSkillIds: [...missing] }
}

/** 准备阶段的增伤/暴击加算并入局内面板 */
export function applyHitPanelMods(
  panel: import('@/types/calculatorPanel').PanelStats,
  mods: PreparedSkillExtraMods | null | undefined,
): import('@/types/calculatorPanel').PanelStats {
  if (!mods) return panel
  const next = { ...panel }
  if (Number(mods.dmgBonus)) next.dmgBonus += Number(mods.dmgBonus)
  if (Number(mods.critRate)) next.critRate += Number(mods.critRate)
  if (Number(mods.critDmg)) next.critDmg += Number(mods.critDmg)
  return next
}

/** 结算某一条时喂给 Buff 匹配的上下文 */
export function buildSkillContextFromHit(
  hit: ResolvedHit,
  element: string | undefined,
): SkillCalcContext {
  return {
    damageKind: hit.damageKind,
    // categoryId / subcategoryId 仅为兼容旧签名，实际匹配一律走 coords
    categoryId: hit.coords[0]?.category ?? 'basic',
    subcategoryId: hit.coords[0]?.subcategoryId ?? null,
    coords: hit.coords,
    element,
    staggerPhase: hit.staggerPhase,
    isFollowUp: hit.isFollowUp,
    anomalySubKind: hit.anomalySubKind,
  }
}

export interface HitLine {
  hit: ResolvedHit
  perHit: number
  total: number
  displayName: string
  /** 伤害类型标签，紊乱会带上极性后缀 */
  label: string
  result: DamageCalcResult
}

/**
 * 汇总一份结算列表。主计算与最优词条分配都走这里，
 * 保证准备阶段的倍率与流程的次数在两边一致生效（§15）。
 */
export function summarizeHits(
  hits: ResolvedHit[],
  buildInput: (hit: ResolvedHit) => DamageCalcInput | null,
  resolveOwnerName?: (hit: ResolvedHit) => string | undefined,
): { lines: HitLine[]; grandTotal: number } {
  const lines: HitLine[] = []
  let grandTotal = 0
  for (const hit of hits) {
    const input = buildInput(hit)
    if (!input) continue
    const result = computeDamageResult(input)
    const perHit = pickEventDamage(result, hit.skill.damageType, hit.critMode)
    const total = perHit * hit.count
    const kindLabel =
      DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === hit.skill.damageType)?.label ??
      hit.skill.damageType
    const suffix =
      hit.skill.damageType === 'disorder' ? `（${disorderLabelFromResult(result)}）` : ''
    const ownerName = resolveOwnerName?.(hit)
    lines.push({
      hit,
      perHit,
      total,
      label: `${kindLabel}${suffix}`,
      displayName: `${ownerName ? `${ownerName} · ` : ''}${hit.skill.name}${suffix}`,
      result,
    })
    grandTotal += total
  }
  return { lines, grandTotal }
}

export interface HitParticipationContext {
  teamSlots: Array<{ agentId: string; isMainC?: boolean }>
  agents: Array<{ id: string; element: string; name?: string; profession?: string | null }>
}

/**
 * 本条能否参与计算；返回原因字符串，null 表示可算。
 *
 * 与旧 `getDamageEventSkipReason` 的差别：产生角色不再有「计算时再选」的兜底，
 * 两个代理人任一留空即不出伤（§11.5）。
 */
export function getHitSkipReason(
  hit: ResolvedHit,
  ctx: HitParticipationContext,
): string | null {
  if (hit.count <= 0) return '次数为 0'
  if (hit.damageKind !== 'anomaly') return null

  const ownerAgent = ctx.agents.find((item) => item.id === hit.ownerAgentId)
  const damageType = hit.skill.damageType

  if (damageType === 'radiance') {
    if (!findLuminousAgentInTeam(ctx.teamSlots, ctx.agents)) {
      return '队伍需编入蕾米埃尔（流明）才可计算耀变'
    }
    if (!isLuminousAgent(ownerAgent)) return '耀变招式须放在蕾米埃尔的流程里'
  } else if (isLuminousAgent(ownerAgent) && isLegacyAnomalyEventKind(damageType)) {
    return '蕾米埃尔产生的旧四类异常不参与计算（请改用耀变）'
  }

  if (!hit.anomalyPowerAgentId) return '未选异常强度提供者'
  if (!hit.triggerAgentId) return '未选异常类触发者'

  const provider = ctx.agents.find((item) => item.id === hit.anomalyPowerAgentId)
  if (!canAgentBeAnomalyProducerForKind(provider, damageType)) {
    return '异常强度提供者须为队内代理人'
  }
  if (damageType !== 'radiance' && isLuminousAgent(provider)) {
    return '旧四类异常的强度提供者不能为蕾米埃尔（流明）'
  }

  if (damageType === 'turbulence') {
    const mainSlot = ctx.teamSlots.find((slot) => slot.isMainC) ?? ctx.teamSlots[0]
    return getTurbulenceParticipationFailureReason(
      ctx,
      mainSlot?.agentId ?? '',
      hit.ownerAgentId,
      hit.anomalyPowerAgentId,
    )
  }

  return null
}
