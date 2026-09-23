/**
 * 流程增益表（2026-09-22 定稿）的数据层。
 *
 * 把「流程招式 × 增益」组织成表格需要的**行 / 列 / 单元格状态**，并提供一个写回函数。
 * 全部是纯逻辑（除写回外），便于单测；UI 只管画。
 *
 * 定稿口径（用户逐条确认，见 dev-docs/skill-buff-per-row.md 第十/十一轮）：
 * - **一条增益 = 一列**：一个来源天生几条效果就出几列（同名靠圆圈数字区分）
 * - **列的分组 = 提供者**：角色1/2/3（按队伍顺序）→「其它」→「额外 Buff」
 * - **同名标记**：同一分组内第几次出现（只在重名时给）；招式行按全表编号
 * - **灰（不可点）的判据 = 受益者**：这条增益的受益者不在"这一行的受益者集合"里 → 灰
 * - **不参与的角色，其个人增益列不出现**（由页面传入的 items 保证，见 DamageCalcPage）
 * - 行级**只做减法**：与全局一致的不写；空 = `null`（全部继承）
 * - 技能组：组行 = `entry.buffOverrides`，成员行 = `memberOverrides[].buffOverrides`（缺省继承整组）
 */
import type { SkillGroup } from '@/types/calculator'
import type { FlowBuffOverride, FlowEntry } from '@/types/damageCalcHistory'
import { isEffectEnabled, formatBuffEffectResultText, resolveConvertValue } from '@/utils/buffEffect'
import {
  blockKeyOfCollected,
  getBuffEffectStacks,
  parseSourceKeySlotIndex,
  type BuffSelectionState,
  type CollectedEffect,
} from '@/utils/panelBuffCalc'
import { BUFF_STAT_FIELDS, buffStatFieldLabel } from '@/utils/calculatorUi'

export interface FlowBuffTableRow {
  /** 唯一键：普通行 = 流程行 id；组成员 = `${行id}#${序号}:${skillId}` */
  key: string
  entryId: string
  label: string
  kind: 'skill' | 'group' | 'member'
  /** 同名招式第几次出现（圆圈数字用；不重名时为 null） */
  badge?: string | null
  memberKey?: string | null
  skillId?: string | null
}

export interface FlowBuffTableColumn {
  /** 唯一键 = `effect.id` */
  key: string
  /** 列名 = 来源名（blockName / sourceLabel） */
  label: string
  /** 同组内第几次出现（圆圈数字用；不重名时为 null） */
  badge?: string | null
  /** 提供者分组：`slot-<n>` / `other` / `extra` */
  groupKey: string
  /** 提供者分组名（角色名 / 其它 / 额外 Buff） */
  groupLabel: string
  /** 效果块键（判"整组关"的老数据用） */
  blockKey: string
  /** 提供者槽位（其它 / 额外 Buff = null） */
  providerSlotIndex: number | null
  /** 受益者槽位；null = 全队（所有行都吃） */
  beneficiarySlots: number[] | null
  /** 受益者文字（`全队` 或角色名）—— 界面显示用 */
  beneficiaryLabel: string
  /** 悬停卡片：这条效果是什么、谁提供 */
  details?: string[]
}

export type FlowBuffCellState = 'on' | 'off' | 'na'

function rawField(
  item: CollectedEffect,
  field: 'blockName' | 'sourceLabel' | 'blockNote' | 'providerName',
): string {
  const value = (item as unknown as Record<string, unknown>)[field]
  return typeof value === 'string' ? value.trim() : ''
}

/** 效果摘要：`+20 电增伤` 这种（属性名走现有 label 表，取不到就退回 key） */
function effectSummary(item: CollectedEffect): string {
  const effect = item.effect
  const field = BUFF_STAT_FIELDS.find((entry) => entry.key === effect.stat)
  const label = field ? buffStatFieldLabel(field) : String(effect.stat ?? '')
  const value = typeof effect.value === 'number' && effect.value !== 0 ? `+${effect.value}` : ''
  return `${value} ${label}`.trim()
}

/**
 * 每条增益在界面上的显示文本（`+123 攻击力（数值）` 这种）。
 *
 * 与局内 Buff 勾选器**同一套取值口径**（否则转模效果会显示成 0）：
 * - `convert`（转模）→ `resolveConvertValue(...)` 算出来的值
 * - `stacked`（叠层）→ 层数 × 每层
 * - 其它 → `effect.value`
 *
 * 跨槽位的效果（比如队友提供、作用到别人身上的）取值要走
 * `panelSourceValuesBySlot[该效果所属槽位]`，不能用当前槽位那一份。
 */
export function buildFlowBuffEffectTexts(
  items: CollectedEffect[] | null | undefined,
  options: {
    /** **全队勾选对象**（不是单槽位解析结果）—— 与局内 Buff 勾选器传的是同一个东西 */
    selection: Parameters<typeof getBuffEffectStacks>[0] | null | undefined
    /** 当前槽位（叠层取值用） */
    slotIndex: number
    /** 槽位 → 角色 id（技能等级转模按效果所属角色取） */
    agentIdBySlot?: (string | null | undefined)[]
    attrDefaults?: Parameters<typeof resolveConvertValue>[1]
    panelSourceValues?: Parameters<typeof resolveConvertValue>[3]
    panelSourceValuesBySlot?: Record<number, Parameters<typeof resolveConvertValue>[3]>
    skillTalentLevelsByAgent?: Record<string, Parameters<typeof resolveConvertValue>[4]>
    skillSubcategories?: NonNullable<
      Parameters<typeof formatBuffEffectResultText>[2]
    >['skillSubcategories']
  },
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of items ?? []) {
    const effect = item.effect
    const sourceSlot = parseSourceKeySlotIndex(item.sourceKey)
    let amount = 0
    if (effect.kind === 'stacked' || effect.stackable) {
      // ⚠️ 与局内 Buff 勾选器同一套调用：getBuffEffectStacks(全队勾选对象, 槽位, 效果 id, 作用目标, 兜底值)。
      // 这个 computed 在**渲染期**跑，形状不对就退回默认层数、绝不抛
      // —— 2026-09-22 踩过：这里一抛，整个伤害页的交互（含方案库按钮）全挂。
      const multi = options.selection as Parameters<typeof getBuffEffectStacks>[0] | null | undefined
      const stacks =
        multi && (multi as { bySlot?: unknown }).bySlot
          ? getBuffEffectStacks(
              multi,
              options.slotIndex,
              effect.id,
              effect.applyTarget,
              effect.defaultStacks ?? 1,
            )
          : (effect.defaultStacks ?? 1)
      amount = (effect.valuePerStack ?? 0) * stacks
    } else if (effect.kind === 'convert') {
      const panelSourceValues =
        sourceSlot != null && options.panelSourceValuesBySlot?.[sourceSlot]
          ? options.panelSourceValuesBySlot[sourceSlot]
          : options.panelSourceValues
      const agentId = sourceSlot != null ? options.agentIdBySlot?.[sourceSlot] : null
      amount = resolveConvertValue(
        effect,
        options.attrDefaults ?? {},
        null,
        panelSourceValues,
        agentId ? (options.skillTalentLevelsByAgent?.[agentId] ?? null) : null,
      )
    } else {
      amount = Number(effect.value) || 0
    }
    const amountText = amount > 0 ? `+${amount}` : String(amount)
    out[effect.id] = formatBuffEffectResultText(effect, amountText, {
      statLabelFn: (stat) => {
        const field = BUFF_STAT_FIELDS.find((entry) => entry.key === stat)
        return field ? buffStatFieldLabel(field) : String(stat)
      },
      skillSubcategories: options.skillSubcategories,
    })
  }
  return out
}

/**
 * 列 = **一条增益一列**，按提供者分组。
 *
 * `items` 由页面给出，已经是「所有人的 team 增益 + 参与角色的 self 增益」并集
 * （按 `effect.id` 去重），所以**不参与的角色，其个人增益天然不在这里**。
 */
export function buildFlowBuffTableColumns(input: {
  items: CollectedEffect[] | null | undefined
  slotLabels: string[]
  /**
   * 每条效果在悬停卡片里显示成什么（`+123 攻击力（数值）` 这种）。
   * 由页面给出（与局内 Buff 勾选器**同一套取值与格式化**，保证两边一致）；
   * 缺省退回 `effectSummary`（只有 `effect.value`，转模效果会显示成 0）。
   */
  textById?: Record<string, string> | null
}): FlowBuffTableColumn[] {
  const slotCount = input.slotLabels.length
  const groups = new Map<string, FlowBuffTableColumn[]>()
  for (const item of input.items ?? []) {
    const slotIndex = parseSourceKeySlotIndex(item.sourceKey)
    const isExtra = item.sourceKey.startsWith('extra-')
    const groupKey = isExtra
      ? 'extra'
      : slotIndex != null && slotIndex < slotCount
        ? `slot-${slotIndex}`
        : 'other'
    const groupLabel = isExtra
      ? '额外 Buff'
      : groupKey === 'other'
        ? '其它'
        : (input.slotLabels[slotIndex ?? 0] ?? `角色${(slotIndex ?? 0) + 1}`)

    const blockName = rawField(item, 'blockName')
    const sourceLabel = rawField(item, 'sourceLabel')
    const label = blockName || sourceLabel || '未命名增益'
    // `team` = 全队都吃（null）；否则受益者 = 这条增益所属槽位的角色
    const beneficiarySlots =
      item.effect.applyTarget === 'team'
        ? null
        : slotIndex != null && slotIndex < slotCount
          ? [slotIndex]
          : null
    const beneficiaryLabel =
      beneficiarySlots == null
        ? '全队'
        : (input.slotLabels[beneficiarySlots[0] ?? 0] ?? `角色${(beneficiarySlots[0] ?? 0) + 1}`)
    const details = [
      rawField(item, 'blockNote'),
      input.textById?.[item.effect.id] || effectSummary(item),
      `生效者：${beneficiaryLabel}`,
      `提供者：${rawField(item, 'providerName') || sourceLabel || '未知'}`,
    ].filter(Boolean)

    const list = groups.get(groupKey) ?? []
    list.push({
      key: item.effect.id,
      label,
      badge: null,
      groupKey,
      groupLabel,
      blockKey: blockKeyOfCollected(item),
      providerSlotIndex: isExtra ? null : slotIndex,
      beneficiarySlots,
      beneficiaryLabel,
      details,
    })
    groups.set(groupKey, list)
  }

  // 分组顺序：角色1..N（按队伍顺序）→ 其它 → 额外 Buff
  const groupOrder = [
    ...[...Array(slotCount).keys()].map((index) => `slot-${index}`),
    'other',
    'extra',
  ]
  const out: FlowBuffTableColumn[] = []
  for (const groupKey of groupOrder) {
    const columns = groups.get(groupKey)
    if (!columns?.length) continue
    // 组内同名编号（不重名不给标记）
    const total = new Map<string, number>()
    for (const column of columns) total.set(column.label, (total.get(column.label) ?? 0) + 1)
    const seen = new Map<string, number>()
    for (const column of columns) {
      const nth = (seen.get(column.label) ?? 0) + 1
      seen.set(column.label, nth)
      column.badge = (total.get(column.label) ?? 0) > 1 ? String(nth) : null
      out.push(column)
    }
  }
  return out
}

/** 行 = 流程招式（与流程列表同源同序）；技能组展开为「组行 + 成员行」 */
export function buildFlowBuffTableRows(input: {
  flow: FlowEntry[]
  preparedName: (entry: FlowEntry) => string
  groupOf: (entry: FlowEntry) => SkillGroup | null
  memberKeyOf: (member: SkillGroup['members'][number]) => string
  sortMembers: (members: SkillGroup['members']) => SkillGroup['members']
  skillName: (skillId: string) => string | undefined
}): FlowBuffTableRow[] {
  const rows: FlowBuffTableRow[] = []
  const total = new Map<string, number>()
  for (const entry of input.flow) {
    const name = input.preparedName(entry)
    total.set(name, (total.get(name) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  for (const entry of input.flow) {
    const name = input.preparedName(entry)
    const nth = (seen.get(name) ?? 0) + 1
    seen.set(name, nth)
    // 重名才给标记：圆圈数字（2026-09-22 定稿，取代原来的「第 x 次」文字）
    const badge = (total.get(name) ?? 0) > 1 ? String(nth) : null
    const group = input.groupOf(entry)
    if (group) {
      rows.push({
        key: entry.id,
        entryId: entry.id,
        label: group.name?.trim() || '技能组',
        kind: 'group',
        badge,
      })
      input.sortMembers(group.members).forEach((member, memberIndex) => {
        rows.push({
          key: `${entry.id}#${memberIndex}:${member.skillId}`,
          entryId: entry.id,
          label: input.skillName(member.skillId) ?? '招式已删除',
          kind: 'member',
          memberKey: input.memberKeyOf(member),
          skillId: member.skillId,
        })
      })
      continue
    }
    rows.push({ key: entry.id, entryId: entry.id, label: name, kind: 'skill', badge })
  }
  return rows
}

/** 某行的有效例外：成员缺省继承整行 */
export function effectiveRowOverride(
  entry: FlowEntry | null | undefined,
  memberKey: string | null | undefined,
): FlowBuffOverride | null {
  if (!entry) return null
  if (memberKey) {
    const found = (entry.memberOverrides ?? []).find((item) => item.memberKey === memberKey)
    return found?.buffOverrides ?? entry.buffOverrides ?? null
  }
  return entry.buffOverrides ?? null
}

/**
 * 单元格状态表：`${rowKey}|${columnKey}` → on / off / na
 *
 * `na`（不可点）三种来源：
 * ① 全局未启用（行级不能单独打开）
 * ② **这一行不吃这条**：受益者对不上（2026-09-22 定稿的灰法）
 * ③ 成员行：整组已关（继承自组）
 */
export function buildFlowBuffTableStates(input: {
  rows: FlowBuffTableRow[]
  columns: FlowBuffTableColumn[]
  items: CollectedEffect[] | null | undefined
  flow: FlowEntry[]
  selection: BuffSelectionState | null | undefined
  /** 每一行的受益者槽位集合（持有者 / 强度提供者 / 触发者），按**行键**取 */
  beneficiarySlotsOf: (rowKey: string) => number[]
}): Record<string, FlowBuffCellState> {
  const itemByEffectId = new Map<string, CollectedEffect>()
  for (const item of input.items ?? []) itemByEffectId.set(item.effect.id, item)

  const entryById = new Map(input.flow.map((entry) => [entry.id, entry]))
  const out: Record<string, FlowBuffCellState> = {}
  for (const row of input.rows) {
    const entry = entryById.get(row.entryId) ?? null
    const rowOverride = effectiveRowOverride(entry, row.memberKey ?? null)
    const groupOverride = row.kind === 'member' ? effectiveRowOverride(entry, null) : null
    const beneficiaries = input.beneficiarySlotsOf(row.key)
    for (const column of input.columns) {
      const cellKey = `${row.key}|${column.key}`
      const item = itemByEffectId.get(column.key)
      if (!item || !isEffectEnabled(item.effect, input.selection ?? null)) {
        out[cellKey] = 'na'
        continue
      }
      if (
        column.beneficiarySlots &&
        !column.beneficiarySlots.some((slot) => beneficiaries.includes(slot))
      ) {
        out[cellKey] = 'na'
        continue
      }
      const groupOff =
        groupOverride?.disabledEffectIds?.includes(column.key) ||
        groupOverride?.disabledBlockIds?.includes(column.blockKey)
      if (groupOff) {
        out[cellKey] = 'na'
        continue
      }
      const off =
        rowOverride?.disabledEffectIds?.includes(column.key) ||
        rowOverride?.disabledBlockIds?.includes(column.blockKey)
      out[cellKey] = off ? 'off' : 'on'
    }
  }
  return out
}

/**
 * 写回一个单元格（就地改对象；由调用方换数组引用以触发上层重算）。
 *
 * 写**单条**（`disabledEffectIds`）。老数据里可能有"整组关"（`disabledBlockIds`）：
 * 这时把某一条**开回来** = 只留这一条 —— 该块移出块关名单，同块其它条转成单条关。
 */
export function setFlowBuffEffectDisabled(input: {
  entry: FlowEntry
  effectId: string
  blockKey: string
  /** 同块其它效果 id（"只留这一条"的归一化用） */
  siblingEffectIds: string[]
  disabled: boolean
  memberKey?: string | null
  skillId?: string | null
}): void {
  const { entry, effectId, blockKey, siblingEffectIds, disabled, memberKey, skillId } = input
  const current = effectiveRowOverride(entry, memberKey ?? null)
  const blocks = new Set(current?.disabledBlockIds ?? [])
  const effects = new Set(current?.disabledEffectIds ?? [])

  if (disabled) {
    effects.add(effectId)
  } else {
    effects.delete(effectId)
    if (blocks.delete(blockKey)) {
      for (const id of siblingEffectIds) if (id !== effectId) effects.add(id)
    }
  }

  const merged: FlowBuffOverride = {
    disabledBlockIds: [...blocks],
    disabledEffectIds: [...effects],
  }
  const empty = !merged.disabledBlockIds?.length && !merged.disabledEffectIds?.length
  const value: FlowBuffOverride | null = empty ? null : merged

  if (memberKey) {
    const list = [...(entry.memberOverrides ?? [])]
    const index = list.findIndex((item) => item.memberKey === memberKey)
    const existing = index >= 0 ? list[index] : undefined
    if (existing) list[index] = { ...existing, buffOverrides: value }
    else list.push({ memberKey, skillId: skillId ?? '', buffOverrides: value })
    entry.memberOverrides = list
    return
  }
  entry.buffOverrides = value
}
