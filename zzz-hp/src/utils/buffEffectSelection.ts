/**
 * 管理端增益编辑器：左列选中态的解析（纯函数）。
 *
 * 背景：行的 `key` 会随数据 patch 重建（勾选伤害类型、拆开、合并会重建 effect id / groupId），
 * 所以选中态除 `rowKey` 之外还记一份锚点（块 id + 乘区 + groupId + 序号），数据变了也能落回同一行。
 *
 * 本模块负责两件事：
 * 1. 删掉某块的最后一条效果后，选中态落在**块**上（`rowKey` 为空），
 *    右列因此可以显示块信息（名称 / 备注 / 删除块 / 加效果），而不是跳到别的块的第一行；
 * 2. 块内还有别的行时，删除后选相邻行（同序号 → 前一行）。
 */
import type { EffectRow } from '@/utils/buffEffectRows'

/** 选中行的稳定锚点 */
export interface EffectRowAnchor {
  blockId: string
  zoneId: string
  groupId?: string
  index: number
}

/** 解析所需的行快照（`EffectRow` 的子集，便于测试构造） */
export interface SelectionRowRef {
  key: string
  blockId: string
  zoneId: string
  groupId?: string
}

export interface ResolvedSelection {
  /** 落在某一行；空串 = 只选中块（空块，或整个编辑器还没有行） */
  rowKey: string
  /** 选中行的块；空串 = 没有可编辑的块 */
  blockId: string
  anchor: EffectRowAnchor | null
}

/** 由行 + 块 + 行序号生成锚点 */
export function effectRowAnchor(
  row: { zone?: { id?: string } | null; groupId?: string },
  blockId: string,
  index: number,
): EffectRowAnchor {
  return {
    blockId,
    zoneId: row.zone?.id ?? '',
    groupId: row.groupId,
    index: index < 0 ? 0 : index,
  }
}

/** 把编辑器的行对象压成解析用的快照 */
export function toSelectionRowRefs(
  items: readonly { block: { id: string }; row: EffectRow }[],
): SelectionRowRef[] {
  return items.map((item) => ({
    key: item.row.key,
    blockId: item.block.id,
    zoneId: item.row.zone?.id ?? '',
    groupId: item.row.groupId,
  }))
}

/** 只选中块（该块没有行，或整个编辑器没有行） */
export function blockOnlySelection(blockId: string): ResolvedSelection {
  if (!blockId) return { rowKey: '', blockId: '', anchor: null }
  return {
    rowKey: '',
    blockId,
    anchor: { blockId, zoneId: '', groupId: undefined, index: 0 },
  }
}

function rowSelection(row: SelectionRowRef, rows: readonly SelectionRowRef[]): ResolvedSelection {
  const index = rows.findIndex((item) => item.key === row.key)
  return {
    rowKey: row.key,
    blockId: row.blockId,
    anchor: {
      blockId: row.blockId,
      zoneId: row.zoneId,
      groupId: row.groupId,
      index: index < 0 ? 0 : index,
    },
  }
}

/**
 * 数据 patch 后重新落位选中态。
 *
 * 优先级：同 key → 锚点（同块同乘区 → 同 groupId → 同序号 → 同块首行）→
 * 已知块且该块已无行（空块，保持块选中）→ 第一行 → 第一个块。
 */
export function resolveEffectSelection(input: {
  rows: readonly SelectionRowRef[]
  /** 现存块 id（含空块），按展示顺序 */
  blockIds: readonly string[]
  selectedRowKey: string
  anchor: EffectRowAnchor | null
  selectedBlockId: string
}): ResolvedSelection {
  const { rows, blockIds } = input

  const current = rows.find((row) => row.key === input.selectedRowKey)
  if (current) return rowSelection(current, rows)

  const anchor = input.anchor
  if (anchor && blockIds.includes(anchor.blockId)) {
    const inBlock = rows.filter((row) => row.blockId === anchor.blockId)
    // 该块已经没有行了（删掉最后一条）：选中块本身，不跳到别的块
    if (!inBlock.length) return blockOnlySelection(anchor.blockId)
    const sameZone = inBlock.filter((row) => row.zoneId === anchor.zoneId)
    const hit =
      (anchor.groupId ? sameZone.find((row) => row.groupId === anchor.groupId) : undefined) ??
      sameZone[anchor.index] ??
      sameZone[0] ??
      inBlock[anchor.index] ??
      inBlock[0]
    if (hit) return rowSelection(hit, rows)
  }

  // 只记得「选中过这个块」（例如点了空块的块头）→ 该块仍是空块时保持块选中
  if (input.selectedBlockId && blockIds.includes(input.selectedBlockId)) {
    const inBlock = rows.filter((row) => row.blockId === input.selectedBlockId)
    if (!inBlock.length) return blockOnlySelection(input.selectedBlockId)
  }

  if (!rows.length) return blockOnlySelection(blockIds[0] ?? '')
  return rowSelection(rows[0]!, rows)
}

/**
 * 删掉第 `removedIndex` 行后该选哪一行（同块内）：原位置现在是下一行，
 * 删的是最后一行时取前一行；块空了返回 null（调用方转成「选中块」）。
 */
export function pickRowAfterRemoval<T>(rowsAfter: readonly T[], removedIndex: number): T | null {
  if (!rowsAfter.length) return null
  const index = Math.max(0, Math.min(removedIndex, rowsAfter.length - 1))
  return rowsAfter[index] ?? null
}
