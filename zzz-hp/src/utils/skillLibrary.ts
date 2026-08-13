import type {
  DamageEvent,
  DamageEventMode,
  Skill,
  SkillDamageType,
  SkillSubcategory,
  SkillTypeId,
} from '@/types/calculator'
import { DAMAGE_EVENT_KIND_OPTIONS } from '@/utils/damageEvent'
import { loadCustomModes } from '@/utils/customDamageEventModes'
import {
  skillTypeFromLegacyCategory,
  skillTypeFromLegacyPublicSubcategory,
} from '@/utils/skillTypes'

const CUSTOM_KEY = 'zzz-hp-skill-library-custom'
const MODES_MIGRATED_KEY = 'zzz-hp-skill-library-modes-migrated'

// ===================== 自定义招式（浏览器，全局一份） =====================

function normalizeSkill(raw: Record<string, unknown>): Skill | null {
  const id = String(raw.id ?? '').trim()
  if (!id) return null
  const damageType = String(raw.damageType ?? 'direct') as SkillDamageType
  const skillTypes = Array.isArray(raw.skillTypes)
    ? raw.skillTypes.map((item) => String(item) as SkillTypeId)
    : []
  const anchor = raw.buffAnchorId
  return {
    id,
    name: String(raw.name ?? '').trim() || '未命名招式',
    agentId: String(raw.agentId ?? ''),
    source: 'custom',
    damageType,
    skillTypes,
    buffAnchorId: anchor == null || anchor === '' ? null : String(anchor),
    baseMult: Number(raw.baseMult) || 0,
    baseMultFactor: Number.isFinite(Number(raw.baseMultFactor))
      ? Number(raw.baseMultFactor)
      : undefined,
    settlementMult: Number.isFinite(Number(raw.settlementMult))
      ? Number(raw.settlementMult)
      : undefined,
  }
}

export function loadCustomSkills(): Skill[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(normalizeSkill)
      .filter((item): item is Skill => item !== null)
  } catch {
    return []
  }
}

export function saveCustomSkills(list: Skill[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
  } catch {
    /* 配额超限时静默，与方案库一致 */
  }
}

export function createCustomSkillId(): string {
  return `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function upsertCustomSkill(skill: Skill): Skill[] {
  const list = loadCustomSkills()
  const index = list.findIndex((item) => item.id === skill.id)
  if (index >= 0) list[index] = { ...skill, source: 'custom' }
  else list.push({ ...skill, source: 'custom' })
  saveCustomSkills(list)
  return list
}

export function removeCustomSkill(id: string): Skill[] {
  const list = loadCustomSkills().filter((item) => item.id !== id)
  saveCustomSkills(list)
  return list
}

// ===================== 旧全局事件模式 → 自定义招式（一次性） =====================

/** 一条事件只有一个 kind，故基础倍率只可能来自其中一个字段 */
function readBaseMult(event: DamageEvent): { baseMult: number; baseMultFactor?: number } {
  const o = event.multOverrides
  if (!o) return { baseMult: 0 }
  const pick = (
    value: number | null | undefined,
    factor?: number | null,
  ): { baseMult: number; baseMultFactor?: number } => ({
    baseMult: Number.isFinite(Number(value)) ? Number(value) : 0,
    baseMultFactor: Number.isFinite(Number(factor)) ? Number(factor) : undefined,
  })
  switch (event.kind) {
    case 'direct':
      return pick(o.directDmgMult, o.directDmgMultFactor)
    case 'anomaly':
      return pick(o.anomalyMult, o.anomalyMultFactor)
    case 'anomalyRelease':
      return pick(o.anomalyReleaseMult, o.anomalyReleaseMultFactor)
    case 'disorder':
      return pick(o.disorderBaseMult, o.disorderBaseMultFactor)
    case 'turbulence':
      return pick(o.turbulenceBaseMult, o.turbulenceBaseMultFactor)
    case 'radiance':
      return pick(o.radianceMult, o.radianceMultFactor)
    default:
      return { baseMult: 0 }
  }
}

/**
 * 一条旧事件 → 一条招式。
 *
 * 编排信息（count / staggerPhase / critMode）与结算参数（triggerAgentId / skillBound）
 * 一律丢弃：新架构里它们分别属于流程与准备阶段，迁移不产出这两者。
 */
function eventToSkill(
  event: DamageEvent,
  mode: DamageEventMode,
  subcategories: SkillSubcategory[],
): Skill {
  const isDirect = event.kind === 'direct'
  const boundToSkill = isDirect || event.skillBound === true
  const anchorId = boundToSkill ? (event.skillSubcategoryId ?? null) : null

  // 选了公共小类 = 其实是在选类型，还原成类型而非锚点
  const publicType = skillTypeFromLegacyPublicSubcategory(anchorId)
  const skillTypes: SkillTypeId[] = []
  if (boundToSkill) {
    if (publicType) skillTypes.push(publicType)
    else skillTypes.push(skillTypeFromLegacyCategory(event.categoryId))
  }

  const sub = anchorId ? subcategories.find((item) => item.id === anchorId) : null
  const kindLabel =
    DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === event.kind)?.label ?? event.kind
  const { baseMult, baseMultFactor } = readBaseMult(event)

  return {
    id: `skill-mig-${event.id}`,
    name: sub?.name?.trim() || kindLabel,
    agentId: event.ownerAgentId?.trim() || mode.agentId || '',
    source: 'custom',
    damageType: event.kind,
    skillTypes,
    buffAnchorId: publicType ? null : anchorId,
    baseMult,
    baseMultFactor,
    settlementMult:
      isDirect && Number.isFinite(Number(event.multOverrides?.settlementDmgMult))
        ? Number(event.multOverrides?.settlementDmgMult)
        : undefined,
  }
}

function dedupeKey(skill: Skill): string {
  return [
    skill.agentId,
    skill.damageType,
    skill.buffAnchorId ?? '',
    skill.baseMult,
    skill.baseMultFactor ?? '',
    skill.settlementMult ?? '',
    [...skill.skillTypes].sort().join('+'),
  ].join('|')
}

export function isLegacyModeMigrationDone(): boolean {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem(MODES_MIGRATED_KEY) === '1'
}

/**
 * 一次性迁移：旧全局事件模式库 → 全局自定义招式库。
 *
 * 全局 → 全局，**不触碰任何方案**：流程统一留空，由用户在新界面重排。
 * 旧模式库保留只读，不删不改，便于回滚与人工查对。
 */
export function migrateLegacyModesToSkills(options: {
  subcategories: SkillSubcategory[]
  force?: boolean
}): { added: number; merged: number } {
  if (typeof localStorage === 'undefined') return { added: 0, merged: 0 }
  if (!options.force && isLegacyModeMigrationDone()) return { added: 0, merged: 0 }

  const existing = loadCustomSkills()
  const seen = new Map(existing.map((item) => [dedupeKey(item), item]))
  let added = 0
  let merged = 0

  for (const mode of loadCustomModes()) {
    for (const event of mode.events) {
      const skill = eventToSkill(event, mode, options.subcategories)
      const key = dedupeKey(skill)
      if (seen.has(key)) {
        merged++
        continue
      }
      seen.set(key, skill)
      existing.push(skill)
      added++
    }
  }

  // 同名不同参：追加序号，避免列表里一堆重名
  const nameCount = new Map<string, number>()
  for (const skill of existing) {
    const base = skill.name
    const n = (nameCount.get(base) ?? 0) + 1
    nameCount.set(base, n)
    if (n > 1) skill.name = `${base} ${n}`
  }

  saveCustomSkills(existing)
  localStorage.setItem(MODES_MIGRATED_KEY, '1')
  return { added, merged }
}
