import type { NanokaSkillPlan, NanokaSkillSelection } from '@/api/nanokaBasics'

export interface NanokaSkillReviewEntry extends NanokaSkillSelection {
  name: string
  current: number | null
  incoming: number
  checked: boolean
  written: boolean
}

/** 与面板字段一致：新增默认勾选，覆盖必须由用户明确勾选。 */
export function createNanokaSkillReview(plan: NanokaSkillPlan): NanokaSkillReviewEntry[] {
  return [
    ...plan.create.map((item) => ({
      id: item.id,
      action: 'create' as const,
      name: item.name,
      current: null,
      incoming: item.baseMult,
      checked: true,
      written: false,
    })),
    ...plan.overwrite.map((item) => ({
      id: item.id,
      action: 'overwrite' as const,
      name: item.name,
      current: item.from,
      incoming: item.to,
      expect: item.expect,
      checked: false,
      written: false,
    })),
  ]
}

export function selectedNanokaSkills(entries: NanokaSkillReviewEntry[]): NanokaSkillSelection[] {
  return entries
    .filter((entry) => entry.checked && !entry.written)
    .map(({ id, action, expect }) => ({
      id,
      action,
      ...(action === 'overwrite' ? { expect } : {}),
    }))
}
