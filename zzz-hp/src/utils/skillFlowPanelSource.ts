import type { PanelStats } from '@/types/calculatorPanel'
import type { AgentPanelSources } from '@/types/damageCalcHistory'
import type { BaseDamageSource } from '@/types/calculator'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { ExtraBuffGain } from '@/utils/extraBuffCalc'

/**
 * 招式流程「用哪份面板」的三态。
 *
 * ```
 * 当前编辑角色的局外面板 = 角色配置面板 + 叠加( 无 | 最优分配的词条数 | 当前点击柱的词条数 )
 * ```
 *
 * 三个选项的差别全在「叠不叠、叠哪一组」，除此之外没有第二套算法
 * （见 `dev-docs/affix-calc-manual.md` §4；实施见提交「计算链路统一·步骤④」）。
 *
 * `gain:` 条目不进局外面板，随选项带 `extraGains`；流程重算必须并入。
 */
export type SkillFlowPanelSourceMode = 'config' | 'allocation' | 'sweep'

/** 词条分析侧上报的候选来源（`config` 不需要上报：它就是角色配置面板） */
export interface SkillFlowPanelOption {
  mode: 'allocation' | 'sweep'
  /**
   * 该来源的当前编辑角色局外面板（已由词条分析自己算出）。
   *
   * 传「算好的面板」而不是「词条数」：两个消费者拿到的必须是同一份数值，
   * 各自再叠一次会引入分叉（`computeExternalForEval` 的上下文在两侧并不完全相同）。
   */
  mainExternal: PanelStats
  /** 展示用摘要，如「最优分配 30 条」「柱图 · 大攻击 12 + 爆伤 18」 */
  label: string
  /** 算出这份面板时的上下文签名；与当前页级签名不一致 = 过期 */
  signature: string
  /** 算出这份面板时用的基础伤害来源（展示/排查用；它已含在页级签名里） */
  baseDamageSource: BaseDamageSource
  /**
   * 该次分配的 `gain:` 条目（局内字段）。不进 `mainExternal`。
   * 选 ②③ 时流程重算必须并入；页级额外 Buff 仍走 `evalCtx.extraGains`。
   */
  extraGains?: ExtraBuffGain[]
}

/**
 * 面板展示专用候选（独立通道，与流程计算用的 `SkillFlowPanelOption` 分开）。
 *
 * 只服务「查看面板」展示功能（招式流程区三选项下方）：展示 ②③ 的局外 + 局内。
 * 由词条分析侧在算出结果时一并上报（external / finalPanel 都是已算好的值，
 * 与词条分析侧「局内（含增益）」结果同一份数值），不在展示侧重复计算、防止分叉。
 */
export interface SkillFlowDisplayOption {
  mode: 'allocation' | 'sweep'
  /** 局外：该来源的当前编辑角色局外面板 */
  mainExternal: PanelStats
  /** 局内（含增益）：实际参与伤害结算的最终面板 */
  finalPanel: PanelStats
  /** 展示用摘要，如「最优分配 30 条」 */
  label: string
  /** 算出这份面板时的上下文签名；与当前页级签名不一致 = 过期 */
  signature: string
}

/**
 * 页级上下文签名：**由页级能看到、且影响招式结算结果的输入拼成**。
 *
 * 用途只有一个：判断词条分析上报的那份面板是否还能代表「当前配置」。
 * 宁可多判过期（禁用选项），不可拿过期数字当有效 —— 后者会静默显示错的伤害。
 *
 * 逐字段从**响应式来源**读取：读取本身就是依赖收集，配置一变签名就变。
 * （曾经试过从深解包后的 ctx 取字段：那样读不建立依赖，配置变了签名也不变，
 * 会命中过期结果，实测踩过。）
 *
 * 刻意不放进签名的：`agents` / `wengines` / `driveDiscs` 文档本体（体积以 MB 计，
 * 且页面加载后不变）；逐条招式的差异由招式指纹承担。
 */
export function buildSkillFlowPageSignature(input: {
  teamSlots: TeamSlot[]
  slotPanels?: Record<string, AgentPanelSources>
  activeSlotPanels: Record<string, PanelStats>
  convertSlotPanels?: Record<string, Partial<Record<string, number>>>
  mainSlotIndex: number
  selectedBangbooId: string
  bangbooRefine: number
  slotBuffSelections?: unknown
  environmentBuffIds: readonly string[]
  extraGains: unknown
  enemyInput: unknown
  staggerPhase?: string
  damageKind?: string
  anomalySubKind?: string
  skillCategoryId?: string
  skillSubcategoryId?: string | null
  triggerAnomalyAgentId?: string | null
  /** 基础伤害来源（页级唯一一份，2026-09-11 起收到页级） */
  baseDamageSource?: string
}): string {
  return serializeSignatureFields({
    v: 1,
    src: input.baseDamageSource ?? null,
    main: input.mainSlotIndex,
    slots: input.teamSlots.map((slot) => [
      slot.agentId,
      slot.rank,
      slot.wengineId,
      slot.wengineRefine,
      slot.twoPieceDriveDiscId,
      slot.fourPieceDriveDiscId,
    ]),
    // 来源记录（含各份面板与 4/5/6 主属性）与已解析的激活面板都要进：任一改动都影响结果
    sources: input.slotPanels ?? null,
    panels: input.activeSlotPanels,
    convert: input.convertSlotPanels ?? null,
    bangboo: [input.selectedBangbooId, input.bangbooRefine],
    buffs: input.slotBuffSelections ?? null,
    env: [...input.environmentBuffIds],
    extra: input.extraGains,
    enemy: input.enemyInput,
    stagger: input.staggerPhase ?? null,
    kind: [
      input.damageKind ?? null,
      input.anomalySubKind ?? null,
      input.skillCategoryId ?? null,
      input.skillSubcategoryId ?? null,
      input.triggerAnomalyAgentId ?? null,
    ],
  })
}

/**
 * 招式流程「命中求值上下文」的输入。
 *
 * 与上面的 `buildSkillFlowPageSignature` 同类（都由**响应式来源**逐字段取，不由 ctx 取），
 * 但用途不同：这份是 `hitEvalCache` 的**上下文令牌**来源 —— 它一变，流程命中必须重算、
 * 旧命中条目不得复用。两处缺一不可：只改 watch 依赖不换令牌会命中旧值；
 * 只换令牌不改 watch 则根本不会触发重算。
 */
export interface SkillFlowHitContextInput {
  enemy: unknown
  /** 页级额外 Buff */
  extraGains: unknown
  /** 选 ②③ 时该次分配的 `gain:`（不在局外面板上） */
  sourceExtraGains: unknown
  /** 主槽已解析的勾选状态（`resolveBuffSelectionForSlot`） */
  buffSelection: unknown
  slotBuffSelections: unknown
  convertSlotPanels: unknown
  /** 已解析的激活局外面板（每人一份） */
  activeSlotPanels: unknown
  environmentBuffIds: readonly string[]
  bangbooId: string
  bangbooRefine: number
  driveDiscMainStats: unknown
  baseDamageSource: string
  damageKind: string | null
  staggerPhase: string | null | undefined
  /**
   * 队伍槽位 —— **必须进签名**（2026-10-20 修复）：
   * 影画档位 / 音擎精炼只体现在这里，而它们会改变命中结果。
   * 漏掉的症状：页内改影画或精炼后流程数字不动，要 F5；有的档位「碰巧」会刷新
   * （勾选表被剪、或技能等级跨 3/5 影档），有的不会（team 目标影画、精炼全档同 id）。
   */
  teamSlots: readonly TeamSlot[]
  /** 当前编辑槽位（= 上下文 `mainSlotIndex`）：决定哪些「自身」增益算给谁 */
  mainSlotIndex: number
  /** 按角色 id 的五大类技能等级：技能等级转模 / 倍率的来源 */
  skillTalentLevelsByAgent: unknown
}

/**
 * 招式流程命中求值上下文的指纹（`internHitEvalContext` 的输入）。
 *
 * **刻意不进签名**：`agents` / `wengines` / `driveDiscs` 文档本体（MB 级、页面加载后不变；
 * 若将来支持数据热更，要同时清 `hitEvalCache`，不能只靠这里）。逐条招式的差异由
 * `buildHitEvalFingerprint(hit)` 承担，不在这里重复。
 */
export function buildSkillFlowHitContextSignature(input: SkillFlowHitContextInput): string {
  return serializeSignatureFields({
    v: 1,
    src: input.baseDamageSource ?? null,
    enemy: input.enemy,
    extra: input.extraGains,
    sourceExtra: input.sourceExtraGains ?? [],
    // 原文里同一份「激活面板」写了两次（anomaly / participants），合并为一个字段
    panels: input.activeSlotPanels ?? null,
    convert: input.convertSlotPanels ?? null,
    buffs: input.buffSelection ?? null,
    slotBuffs: input.slotBuffSelections ?? null,
    env: [...input.environmentBuffIds],
    bangboo: [input.bangbooId, input.bangbooRefine],
    mains: input.driveDiscMainStats ?? null,
    kind: input.damageKind ?? null,
    stagger: input.staggerPhase ?? null,
    // 队伍档位：六项都影响结果（换人 / 改影画 / 换音擎 / 改精炼 / 换两件套或四件套）
    slots: input.teamSlots.map((slot) => [
      slot.agentId,
      slot.rank,
      slot.wengineId,
      slot.wengineRefine,
      slot.twoPieceDriveDiscId,
      slot.fourPieceDriveDiscId,
    ]),
    main: input.mainSlotIndex,
    levels: input.skillTalentLevelsByAgent ?? null,
  })
}

/**
 * 逐字段序列化：任何一个字段序列化失败（最常见的是**误传了 ref 而不是 `.value`** ——
 * ref 内部有 `dep` → `ReactiveEffect`，会成环）都直接抛出并把字段名带出来。
 *
 * 为什么不静默跳过出问题的字段：那是缓存键，少一个字段 = 配置变了反而命中旧结果
 * —— 数字看着对但是错的。宁可当场炸掉。
 */
function serializeSignatureFields(fields: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    let encoded: string
    try {
      encoded = JSON.stringify(value ?? null)
    } catch (error) {
      throw new Error(
        `[skillFlowPanelSource] 签名字段 ${key} 无法序列化（是否误传 ref 而不是 .value？）：${String(error)}`,
      )
    }
    parts.push(`${key}=${encoded ?? 'null'}`)
  }
  return parts.join('|')
}

/** 一份可用来源的判定结果 */
export interface ResolvedSkillFlowPanelSource {
  /** 实际要用的当前编辑角色局外面板；null = 用角色配置面板（选项①） */
  mainExternal: PanelStats | null
  /** 当前选项在这份配置下是否仍然有效 */
  active: boolean
  /** 失效原因（给界面提示用） */
  reason: string | null
  /** 选 ②③ 时该次分配的 `gain:`；① 或回落为 null */
  extraGains?: ExtraBuffGain[] | null
}

/**
 * 从「当前选择 + 页级签名 + 词条分析上报的候选」解出实际要用的面板。
 *
 * 规则：选 ① 直接用配置面板；选 ②③ 但候选缺失或签名过期 → **回落到配置面板**
 * （不得显示 0 或旧值），并把原因回传给界面。
 */
export function resolveSkillFlowPanelSource(input: {
  mode: SkillFlowPanelSourceMode
  options: Partial<Record<'allocation' | 'sweep', SkillFlowPanelOption | null>>
  currentSignature: string
}): ResolvedSkillFlowPanelSource {
  if (input.mode === 'config') {
    return { mainExternal: null, active: true, reason: null, extraGains: null }
  }
  const option = input.options[input.mode] ?? null
  if (!option) {
    return {
      mainExternal: null,
      active: false,
      reason: '尚未计算，先到「词条配比分析」里算一次',
      extraGains: null,
    }
  }
  if (option.signature !== input.currentSignature) {
    return {
      mainExternal: null,
      active: false,
      reason: '配置已改动，请重新计算词条分析',
      extraGains: null,
    }
  }
  return {
    mainExternal: option.mainExternal,
    active: true,
    reason: null,
    extraGains: option.extraGains ?? [],
  }
}

/** 词条数的可读摘要（给选项②③的 tooltip 用；词条键到中文名的映射由调用方给） */
export function formatAffixCountsSummary(
  counts: Record<string, number | undefined>,
  labels: Record<string, string>,
): string {
  const parts = Object.entries(counts)
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .slice(0, 3)
    .map(([key, value]) => `${labels[key] ?? key} ${value}`)
  return parts.length ? parts.join(' + ') : '零词条'
}
