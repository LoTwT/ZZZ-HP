import type { Skill, SkillGroup } from '@/types/calculator'
import type { DamageCalcHistoryEntry, DamageCalcHistoryExport } from '@/types/damageCalcHistory'
import { SCHEME_STORE_VERSION } from '@/types/damageCalcHistory'

/** 服务端共用方案的最小形状（与 api/sharedSchemes.ts 的 SharedSchemeDoc 对齐） */
export interface SharedSchemePackInput {
  id: string
  name: string
  folder: string
  payload?: DamageCalcHistoryEntry
  dependencies?: {
    customSkills?: Skill[]
    skillGroups?: SkillGroup[]
  }
}

/**
 * 把一条服务端预设包成「zzz-hp-schemes」导出包，交给现有合并导入逻辑。
 * 只含这一条方案与它引用的自建招式 / 技能组，不会把别人的整库带进来。
 */
export function buildSharedSchemePack(preset: SharedSchemePackInput): DamageCalcHistoryExport {
  const payload = preset.payload
  if (!payload) throw new Error('该预设缺少方案内容')
  const folder = preset.folder || payload.folder || ''
  const name = preset.name || payload.name
  const key = payload.id || `${folder}/${name}`
  return {
    type: 'zzz-hp-schemes',
    version: SCHEME_STORE_VERSION,
    exportedAt: Date.now(),
    dirs: {},
    schemes: {
      [key]: {
        ...payload,
        name,
        folder,
      },
    },
    customSkills: preset.dependencies?.customSkills ?? [],
    skillGroups: preset.dependencies?.skillGroups ?? [],
  }
}
