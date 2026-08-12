import type { BuffStatModifiers, DamageCalcKind, DamageEvent, StaggerPhase } from '@/types/calculator'
import type {
  AffixCounts,
  AffixDriveDiscMainStats,
  PanelCalcMode,
  PanelStats,
} from '@/types/calculatorPanel'
import type { CharacterAttrKey } from '@/types/calculator'
import type { DamageEnemyInput, EnemyResistanceType } from '@/utils/enemyResistance'
import type { MultiSlotBuffSelection } from '@/utils/panelBuffCalc'

/** 兼容旧存档的敌方环境快照 */
export type DamageCalcEnemyInputSnapshot = DamageEnemyInput & {
  resistanceType?: EnemyResistanceType
}

/** 转模增益角色局外面板（按 agentId 存部分属性） */
export type DamageCalcConvertSlotPanels = Record<
  string,
  Partial<Record<CharacterAttrKey, number>>
>

export interface DamageCalcTeamSlotSnapshot {
  agentId: string
  rank: number
  wengineId: string
  wengineRefine: number
  isMainC: boolean
  twoPieceDriveDiscId: string
  fourPieceDriveDiscId: string
}

export interface DamageCalcPanelSnapshot {
  baseDamageSource: 'atk' | 'pierce' | 'def'
  externalPanel: PanelStats
  affixCounts: AffixCounts
  affixDriveDiscMainStats: AffixDriveDiscMainStats
  extraMods: BuffStatModifiers
  /** 额外 Buff 增益条目（优先于扁平 extraMods） */
  extraGains?: Array<{
    id: string
    name: string
    stat: keyof BuffStatModifiers
    value: number
    applySituation?: import('@/types/calculator').BuffApplySituation
    scope?: import('@/types/calculator').BuffScope
    applyTarget?: import('@/types/calculator').BuffApplyTarget
    skillCategory?: import('@/types/calculator').BuffSkillTargetId
    skillSubcategoryId?: string | null
    appliesToAnomaly?: boolean
    applyProfession?: string | null
    teamProfession?: string | null
    teamProfessionValues?: Array<number | null> | null
    /** @deprecated */
    teamProfessionMinCount?: number | null
  }>
  enemyInput: DamageCalcEnemyInputSnapshot
}

export interface DamageCalcHistoryEntry {
  /** 路径式 ID，等于 `${folder}/${name}`（根目录下为 `/name`） */
  id: string
  name: string
  savedAt: number
  teamSlots: DamageCalcTeamSlotSnapshot[]
  activeSlot: number
  selectedBangbooId: string
  bangbooRefine: number
  panelCalcMode: PanelCalcMode
  panelState: DamageCalcPanelSnapshot
  /** 异常产生角色局外面板（按 agentId） */
  anomalySlotPanels?: Record<string, PanelStats>
  /** 转模增益角色局外面板（按 agentId） */
  convertSlotPanels?: DamageCalcConvertSlotPanels
  /** 招式事件（直接伤害） */
  directEvents?: DamageEvent[]
  /** 招式事件（异常伤害） */
  anomalyEvents?: DamageEvent[]
  /** 伤害类型（direct / anomaly） */
  damageKind?: DamageCalcKind
  /** 失衡阶段（stagger / normal） */
  staggerPhase?: StaggerPhase
  /** Buff 勾选状态（按槽位 + 全队） */
  multiSlotBuffSelection?: MultiSlotBuffSelection
  /** 方案库目录分组（路径，根目录为空串） */
  folder: string
  /** 同目录内排序权重（小在前） */
  order: number
}

/** 目录节点元数据 */
export interface SchemeFolderMeta {
  createdAt: number
  order: number
}

/** 方案库存储结构（对齐 zzz-dev 路径树） */
export interface SchemeStore {
  version: 2
  dirs: Record<string, SchemeFolderMeta>
  schemes: Record<string, DamageCalcHistoryEntry>
  /** 是否已把全局自定义事件模式库迁移进各方案（一次性，防重复注入） */
  customEventsMigrated?: boolean
}

/** 导出包结构 */
export interface DamageCalcHistoryExport {
  type: 'zzz-hp-schemes'
  version: 2
  exportedAt: number
  dirs: Record<string, SchemeFolderMeta>
  schemes: Record<string, DamageCalcHistoryEntry>
  currentId?: string | null
}

/** 导入结果 */
export interface DamageCalcHistoryImportResult {
  added: number
  skipped: number
  errors: string[]
}
