import type { Skill } from '@/types/calculator'

/**
 * 公共预设只有「属性异常」，按元素各一条。异放/紊乱/乱流/耀变不是公共预设。
 *
 * 倍率写在招式 `baseMult` 上，不绑角色面板：
 * 面板仍是电 125 / 火 50 / 以太 62.5；招式侧电 ×10、火/以太 ×20。
 * 无流明。霜 500，即使暂无霜角色。
 */
export const PUBLIC_ANOMALY_SKILLS = [
  { id: 'sk-public-anomaly-wind', element: '风', name: '风属性异常', baseMult: 1250, sortOrder: 10 },
  { id: 'sk-public-anomaly-fire', element: '火', name: '火属性异常', baseMult: 1000, sortOrder: 20 },
  { id: 'sk-public-anomaly-electric', element: '电', name: '电属性异常', baseMult: 1250, sortOrder: 30 },
  { id: 'sk-public-anomaly-physical', element: '物理', name: '物理属性异常', baseMult: 713, sortOrder: 40 },
  { id: 'sk-public-anomaly-ether', element: '以太', name: '以太属性异常', baseMult: 1250, sortOrder: 50 },
  { id: 'sk-public-anomaly-ice', element: '冰', name: '冰属性异常', baseMult: 500, sortOrder: 60 },
  { id: 'sk-public-anomaly-frost', element: '霜', name: '霜属性异常', baseMult: 500, sortOrder: 70 },
] as const

export type PublicAnomalyElement = (typeof PUBLIC_ANOMALY_SKILLS)[number]['element']

export const PUBLIC_ANOMALY_ELEMENTS = PUBLIC_ANOMALY_SKILLS.map((item) => item.element)

function toPublicAnomalySkill(def: (typeof PUBLIC_ANOMALY_SKILLS)[number]): Skill {
  return {
    id: def.id,
    name: def.name,
    agentId: '',
    source: 'preset',
    damageType: 'anomaly',
    skillTypes: [],
    buffAnchorId: null,
    baseMult: def.baseMult,
    baseMultFactor: 100,
    settlementMult: 0,
    element: def.element,
  }
}

/** 后端还没种上时，前端补齐，避免必须先重启 Express 才看得到。 */
export function mergePublicAnomalyPresets(existing: Skill[]): Skill[] {
  const byId = new Set(existing.map((item) => item.id))
  const boundElements = new Set(
    existing
      .filter((item) => !item.agentId && item.damageType === 'anomaly' && item.element)
      .map((item) => item.element),
  )
  const extras: Skill[] = []
  for (const def of PUBLIC_ANOMALY_SKILLS) {
    if (byId.has(def.id) || boundElements.has(def.element)) continue
    extras.push(toPublicAnomalySkill(def))
  }
  return extras.length ? [...existing, ...extras] : existing
}
