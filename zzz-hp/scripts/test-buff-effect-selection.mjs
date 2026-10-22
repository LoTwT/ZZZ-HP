/**
 * 管理端增益编辑器：左列选中态解析（纯函数）。
 * 运行：npx vite-node scripts/test-buff-effect-selection.mjs
 *
 * 覆盖 2026-10-22 报的 bug：删掉某块的最后一条效果后，该块「点不进去还占界面」
 * ——根因是选中态回落到全编辑器第一行，右列只看选中行，于是空块既不能改名也不能删。
 */
import {
  blockOnlySelection,
  effectRowAnchor,
  pickRowAfterRemoval,
  resolveEffectSelection,
  toSelectionRowRefs,
} from '../src/utils/buffEffectSelection.ts'

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 构造行快照：['块id', '行key', '乘区', groupId?] */
function row(blockId, key, zoneId, groupId) {
  return { blockId, key, zoneId, groupId }
}

const resolve = (input) =>
  resolveEffectSelection({
    rows: input.rows ?? [],
    blockIds: input.blockIds ?? [],
    selectedRowKey: input.selectedRowKey ?? '',
    anchor: input.anchor ?? null,
    selectedBlockId: input.selectedBlockId ?? '',
  })

console.log('\n[1] 同 key 优先（数据没变就留在原地）')
{
  const rows = [row('b1', 'r1', 'zone:atk'), row('b1', 'r2', 'zone:dmg')]
  const out = resolve({ rows, blockIds: ['b1'], selectedRowKey: 'r2', selectedBlockId: 'b1' })
  check('停在 r2', out.rowKey === 'r2', out.rowKey)
  check('锚点记下块/乘区/序号', out.anchor.blockId === 'b1' && out.anchor.zoneId === 'zone:dmg' && out.anchor.index === 1)
}

console.log('\n[2] 删掉某块的最后一行 → 选中块本身（不跳到别的块第一行）')
{
  const anchor = { blockId: 'b5', zoneId: 'zone:dmg', groupId: undefined, index: 1 }
  // 效果块 2 已空；其它块还有行
  const out = resolve({
    rows: [row('b1', 'r1', 'zone:mastery'), row('b11', 'r2', 'zone:dmg')],
    blockIds: ['b1', 'b5', 'b11'],
    selectedRowKey: '',
    anchor,
    selectedBlockId: 'b5',
  })
  check('选中态落在空块 b5', out.rowKey === '' && out.blockId === 'b5', `${out.rowKey}|${out.blockId}`)
  check('锚点仍指向 b5（可继续解析）', out.anchor?.blockId === 'b5')
}

console.log('\n[3] 只点了空块的块头（没有锚点，只有 selectedBlockId）')
{
  const out = resolve({
    rows: [row('b1', 'r1', 'zone:mastery')],
    blockIds: ['b1', 'b9'],
    selectedRowKey: '',
    anchor: null,
    selectedBlockId: 'b9',
  })
  check('保持空块 b9 选中', out.blockId === 'b9' && out.rowKey === '')
}

console.log('\n[4] 块内还有别的行：落到同乘区的下一行 / 前一行')
{
  const anchor = { blockId: 'b1', zoneId: 'zone:dmg', groupId: undefined, index: 1 }
  const rows = [
    row('b1', 'r1', 'zone:mastery'),
    row('b1', 'r3', 'zone:dmg'),
    row('b1', 'r4', 'zone:dmg'),
  ]
  const out = resolve({ rows, blockIds: ['b1'], selectedRowKey: 'gone', anchor, selectedBlockId: 'b1' })
  check('落回同块同乘区（不跨块）', out.blockId === 'b1' && out.rowKey === 'r4', out.rowKey)
}

console.log('\n[5] 块被整个删掉 → 才回落到别的块')
{
  const anchor = { blockId: 'b2', zoneId: 'zone:dmg', index: 0 }
  const rows = [row('b1', 'r1', 'zone:mastery')]
  const out = resolve({ rows, blockIds: ['b1'], selectedRowKey: 'gone', anchor, selectedBlockId: 'b2' })
  check('落到现存第一行', out.rowKey === 'r1' && out.blockId === 'b1')
}

console.log('\n[6] 一条行都没有的情况')
{
  const out = resolve({ rows: [], blockIds: ['b1', 'b2'], selectedRowKey: '', anchor: { blockId: 'b2', zoneId: '', index: 0 }, selectedBlockId: 'b2' })
  check('空块 b2 仍被选中', out.blockId === 'b2' && out.rowKey === '')
  const none = resolve({ rows: [], blockIds: [] })
  check('没有任何块 → 全空', none.rowKey === '' && none.blockId === '' && none.anchor === null)
}

console.log('\n[7] 幂等：解析结果再喂回去不变')
{
  const first = resolve({
    rows: [row('b1', 'r1', 'zone:mastery')],
    blockIds: ['b1', 'b5'],
    selectedRowKey: '',
    anchor: { blockId: 'b5', zoneId: 'zone:dmg', index: 1 },
    selectedBlockId: 'b5',
  })
  const second = resolve({
    rows: [row('b1', 'r1', 'zone:mastery')],
    blockIds: ['b1', 'b5'],
    selectedRowKey: first.rowKey,
    anchor: first.anchor,
    selectedBlockId: first.blockId,
  })
  check('仍是空块 b5', second.blockId === 'b5' && second.rowKey === '')
}

console.log('\n[8] groupId 锚点优先于序号')
{
  const anchor = { blockId: 'b1', zoneId: 'zone:dmg', groupId: 'g-X', index: 0 }
  const rows = [
    row('b1', 'r1', 'zone:dmg', 'g-Y'),
    row('b1', 'r2', 'zone:dmg', 'g-X'),
    row('b1', 'r3', 'zone:dmg', 'g-Z'),
  ]
  const out = resolve({ rows, blockIds: ['b1'], selectedRowKey: 'gone', anchor, selectedBlockId: 'b1' })
  check('命中同 groupId 的行', out.rowKey === 'r2', out.rowKey)
}

console.log('\n[9] 删除后的相邻行选择')
{
  check('删中间 → 原位置的下一行', pickRowAfterRemoval(['a', 'c'], 1) === 'c')
  check('删最后 → 前一行', pickRowAfterRemoval(['a', 'b'], 2) === 'b')
  check('只删了一条 → null（转成选中块）', pickRowAfterRemoval([], 0) === null)
  check('空块 → null', pickRowAfterRemoval([], 3) === null)
}

console.log('\n[10] 辅助函数')
{
  check('blockOnlySelection 空 id 返回全空', blockOnlySelection('').blockId === '')
  const anchor = effectRowAnchor({ zone: { id: 'zone:atk' }, groupId: 'g1' }, 'b1', -1)
  check('effectRowAnchor 负数序号归 0', anchor.index === 0 && anchor.zoneId === 'zone:atk')
  const refs = toSelectionRowRefs([
    { block: { id: 'b1' }, row: { key: 'r1', zone: { id: 'zone:atk' }, groupId: 'g1' } },
    { block: { id: 'b2' }, row: { key: 'r2' } },
  ])
  check('toSelectionRowRefs 无乘区时给空串', refs[1].zoneId === '' && refs[1].blockId === 'b2')
}

console.log(`\n结果：${passed} passed / ${failed} failed`)
if (failed) process.exitCode = 1
