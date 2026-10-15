import type { EnemySlot, PhaseData } from '@/types/history'

/** 场地 Buff 快照：来自某一期的怪物槽位，附该期的展示用标签 */
export interface MonsterFieldBuffSnapshot {
  fieldBuff: EnemySlot['fieldBuff']
  phaseLabel: string
}

/** 在 phases 里定位同一怪物：同一 Boss 名可同期出现在多个房间，必须同时匹配房间码 */
export interface MonsterLookupKey {
  bossName: string
  room?: string
}

/** 该怪物在某一期的一次出现 */
export interface MonsterOccurrence {
  phaseIndex: number
  phaseLabel: string
  enemy: EnemySlot
}

export function buildPhaseLabel(phase: PhaseData): string {
  return `${phase.version} ${phase.phase}`.trim()
}

function matchesLookupKey(enemy: EnemySlot, key: MonsterLookupKey): boolean {
  return enemy.bossName === key.bossName && (enemy.room ?? '') === (key.room ?? '')
}

function hasFieldBuffContent(fieldBuff: EnemySlot['fieldBuff']): boolean {
  return Boolean(
    fieldBuff && (fieldBuff.name?.trim() || fieldBuff.text?.trim() || fieldBuff.effectBlocks?.length),
  )
}

/** 该怪物在各期的全部出现（按期顺序），供「原 / 现」两侧取数 */
export function findMonsterEntries(
  phases: PhaseData[],
  key: MonsterLookupKey,
): MonsterOccurrence[] {
  if (!key.bossName) return []
  const entries: MonsterOccurrence[] = []
  phases.forEach((phase, phaseIndex) => {
    for (const enemy of phase.enemies) {
      if (matchesLookupKey(enemy, key)) {
        entries.push({ phaseIndex, phaseLabel: buildPhaseLabel(phase), enemy })
      }
    }
  })
  return entries
}

/**
 * 从当前期往前找最近的、场地 Buff 非空的该怪物出现，取其场地 Buff 与期数标签。
 * 往前不存在带内容的场地 Buff 时返回 null。
 */
export function findPreviousFieldBuff(
  phases: PhaseData[],
  currentPhaseIndex: number,
  key: MonsterLookupKey,
): MonsterFieldBuffSnapshot | null {
  if (!key.bossName) return null
  for (let index = currentPhaseIndex - 1; index >= 0; index--) {
    const phase = phases[index]
    if (!phase) continue
    const enemy = phase.enemies.find((item) => matchesLookupKey(item, key))
    if (!enemy || !hasFieldBuffContent(enemy.fieldBuff)) continue
    return { fieldBuff: enemy.fieldBuff, phaseLabel: buildPhaseLabel(phase) }
  }
  return null
}

/**
 * 是否构成一次真正的场地 Buff 转变：
 * 两侧都有内容且名称或正文不同。任一侧为空不算转变。
 */
export function isFieldBuffChanged(
  previous: EnemySlot['fieldBuff'],
  current: EnemySlot['fieldBuff'],
): boolean {
  if (!hasFieldBuffContent(previous) || !hasFieldBuffContent(current)) return false
  return (
    (previous?.name ?? '') !== (current?.name ?? '') ||
    (previous?.text ?? '') !== (current?.text ?? '')
  )
}
