/**
 * 导入预设弹窗（UnifiedPresetPicker）打开时的「筛选自动跟随选中项」。
 *
 * 用户口径（2026-10-22）：弹窗打开时除了**选中**当前槽位的角色与音擎，筛选也要自动打开 ——
 * 例如当前音擎是「壳中之灵」，武器页一打开就应是「特性=异常 + 稀有度=S」，
 * 而不是把 100 多把武器全铺出来让用户自己筛。
 *
 * 判定规则（都取**物件自己的**属性，不拿角色的职业去套武器，否则异装备搭配时会把当前选中项筛没）：
 * - 角色页：特性 = 该角色的特性（职业）；属性**不自动筛**（再叠属性只剩一两条，等于没列表）。
 * - 武器页：特性 = 该音擎的特性、稀有度 = 该音擎的稀有度。
 * - 取值必须落在既有的筛选项常量里，否则留空（不筛），避免出现点不亮的假筛选项。
 * - 「不佩戴」或找不到对应物件时不筛。
 *
 * 单独抽出来是为了能脱离组件测（见 `scripts/test-preset-picker-auto-filter.mjs`）。
 */
import { AGENT_ROLES, WENGINE_RARITIES } from '@/utils/calculatorUi'

export type PresetPickerFilterSubject = {
  /** 兜底判定用；音擎传 'none' 表示不佩戴 */
  id?: string | null
  /** 角色 / 音擎的「特性」 */
  profession?: string | null
  /** 角色的属性（目前不参与自动筛选，保留给后续口径） */
  element?: string | null
  /** 音擎的稀有度 S/A/B */
  rarity?: string | null
}

export type PresetPickerAutoFilters = {
  agentRoleFilter: string
  agentElementFilter: string
  wengineRoleFilter: string
  wengineRarityFilter: string
}

const EMPTY: PresetPickerAutoFilters = {
  agentRoleFilter: '',
  agentElementFilter: '',
  wengineRoleFilter: '',
  wengineRarityFilter: '',
}

function pickFrom<T extends string>(value: string | null | undefined, allowed: readonly T[]): string {
  const text = (value ?? '').trim()
  return allowed.includes(text as T) ? text : ''
}

export function resolvePresetPickerAutoFilters(params: {
  agent?: PresetPickerFilterSubject | null
  wengine?: PresetPickerFilterSubject | null
}): PresetPickerAutoFilters {
  const agent = params.agent ?? null
  const wengine = params.wengine ?? null
  const result: PresetPickerAutoFilters = { ...EMPTY }

  if (agent) {
    result.agentRoleFilter = pickFrom(agent.profession, AGENT_ROLES)
  }

  // 不佩戴 / 没有音擎：武器页保持全量，不留下上一次的筛选
  if (wengine && wengine.id !== 'none') {
    result.wengineRoleFilter = pickFrom(wengine.profession, AGENT_ROLES)
    result.wengineRarityFilter = pickFrom(wengine.rarity, WENGINE_RARITIES)
  }

  return result
}
