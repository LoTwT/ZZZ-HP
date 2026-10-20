/**
 * 管理侧行聚合 / 联动重建（纯函数）。
 * 运行：npx vite-node scripts/test-buff-effect-rows.mjs
 */
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import {
  alignRow,
  buildEffectRows,
  canConfirmMerge,
  changeRowZone,
  confirmMergeRow,
  mergeRows,
  rowHasAllTypes,
  splitRow,
  toggleRowDamageType,
  validateEffectGroups,
} from '../src/utils/buffEffectRows.ts'
import { findBuffStatZoneById } from '../src/utils/buffStatZones.ts'

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

let seq = 0
const makeId = () => `id-${++seq}`
let groupSeq = 0
const makeGroup = () => `grp-test-${++groupSeq}`

function fx(stat, value, extra = {}) {
  return createEmptyBuffEffect({
    id: extra.id ?? `e-${++seq}`,
    stat,
    value,
    applyTarget: extra.applyTarget ?? 'self',
    groupId: extra.groupId,
    scope: extra.scope,
  })
}

const zoneDmg = findBuffStatZoneById('zone:anomalyDmg')
const zoneAtk = findBuffStatZoneById('zone:atk')
const zonePierce = findBuffStatZoneById('zone:pierceDmgBonus')

console.log('\n[1] 启发式聚合（未分组）')
{
  const effects = [fx('anomalyDmgBonus', 12), fx('disorderDmgBonus', 12)]
  const rows = buildEffectRows(effects)
  check('同值同目标 → 1 行', rows.length === 1, `${rows.length}`)
  check('标未分组/启发式', rows[0].heuristic && !rows[0].groupId)
  check('类型集 = 属性异常 + 紊乱', rows[0].damageTypes.join(',') === 'anomaly,disorder')
  check('可点确认合并', canConfirmMerge(rows[0]))
}

console.log('\n[2] 不同值 / 不同目标不聚合')
{
  const rows = buildEffectRows([fx('anomalyDmgBonus', 12), fx('disorderDmgBonus', 13)])
  check('值不同 → 2 行', rows.length === 2)
  const rows2 = buildEffectRows([
    fx('anomalyDmgBonus', 12, { applyTarget: 'self' }),
    fx('disorderDmgBonus', 12, { applyTarget: 'team' }),
  ])
  check('目标不同 → 2 行', rows2.length === 2)
}

console.log('\n[3] 显式 groupId 聚合')
{
  const effects = [
    fx('anomalyDmgBonus', 12, { groupId: 'g1' }),
    fx('disorderDmgBonus', 12, { groupId: 'g1' }),
    fx('turbulenceDmgBonus', 12, { groupId: 'g1' }),
  ]
  const rows = buildEffectRows(effects)
  check('3 条同组 → 1 行', rows.length === 1)
  check('groupId 保留', rows[0].groupId === 'g1' && !rows[0].heuristic)
  check('类型集 3 项', rows[0].damageTypes.join(',') === 'anomaly,turbulence,disorder')
  check('不是启发式', !canConfirmMerge(rows[0]))
}

console.log('\n[4] 类2 改类型 / 勾选 / 取消')
{
  const effects = [fx('anomalyDmgBonus', 12, { groupId: 'g2' }), fx('disorderDmgBonus', 12, { groupId: 'g2' })]
  const row = buildEffectRows(effects)[0]
  const next = toggleRowDamageType(effects, row, 'radiance', true, { makeId, makeGroup })
  const nextRow = buildEffectRows(next)[0]
  check('勾耀变 → 3 条同组', nextRow.effects.length === 3 && nextRow.groupId === 'g2')
  check('耀变字段正确', nextRow.effects.some((item) => item.stat === 'radianceDmgBonus'))

  const removed = toggleRowDamageType(next, nextRow, 'anomaly', false, { makeId, makeGroup })
  const removedRow = buildEffectRows(removed)[0]
  check('取消属性异常 → 2 条', removedRow.effects.length === 2)
  check('属性异常字段已删', !removedRow.effects.some((item) => item.stat === 'anomalyDmgBonus'))
}

console.log('\n[5] 类2 清空 → 回到全部 5 条')
{
  const effects = [fx('anomalyDmgBonus', 12, { groupId: 'g3' })]
  const row = buildEffectRows(effects)[0]
  const next = toggleRowDamageType(effects, row, 'anomaly', false, { makeId, makeGroup })
  const nextRow = buildEffectRows(next)[0]
  check('0 项 = 全部 5 条', nextRow.effects.length === 5)
  check('全部覆盖', rowHasAllTypes(nextRow))
}

console.log('\n[6] 类3 勾类型：永远 1 条，只写 conditions')
{
  const effects = [fx('atk', 30)]
  const row = buildEffectRows(effects)[0]
  const next = toggleRowDamageType(effects, row, 'pierce', true, { makeId, makeGroup })
  const nextRow = buildEffectRows(next)[0]
  check('仍 1 条', nextRow.effects.length === 1)
  check('stat 仍是 atk', nextRow.effects[0].stat === 'atk')
  check(
    'conditions = [pierce]',
    JSON.stringify(nextRow.effects[0].conditions) === JSON.stringify({ damageTypes: ['pierce'] }),
  )
  check('无 groupId', !nextRow.effects[0].groupId)

  const next2 = toggleRowDamageType(next, nextRow, 'anomaly', true, { makeId, makeGroup })
  const nextRow2 = buildEffectRows(next2)[0]
  check('跨类多选仍 1 条', nextRow2.effects.length === 1)
  check(
    'conditions 跨类 2 项',
    JSON.stringify(nextRow2.effects[0].conditions.damageTypes) === JSON.stringify(['pierce', 'anomaly']),
  )
}

console.log('\n[7] 类1 锁定不可改')
{
  const effects = [fx('pierceDmgBonus', 10)]
  const row = buildEffectRows(effects)[0]
  check('类型锁命破', row.damageTypes.join(',') === 'pierce')
  const next = toggleRowDamageType(effects, row, 'normal', true, { makeId, makeGroup })
  check('勾普通直伤被忽略', next[0].conditions === undefined)
  check('zone 是类1', zonePierce?.tier === 1)
}

console.log('\n[8] 改属性 → 类2 重建 / 类3 收成 1 条')
{
  const effects = [fx('atk', 30), fx('dmgBonus', 10)]
  const rows = buildEffectRows(effects)
  const atkRow = rows.find((row) => row.effects[0].stat === 'atk')
  const next = changeRowZone(effects, atkRow, zoneDmg, ['anomaly', 'disorder'], {
    makeId,
    makeGroup,
  })
  const nextRows = buildEffectRows(next)
  check('改类2 → 2 条异常 + 1 条旧行', next.length === 3, `${next.length}`)
  check(
    '两条异常字段同组',
    next.filter((item) => item.groupId).length === 2 &&
      next.find((item) => item.stat === 'anomalyDmgBonus')?.groupId ===
        next.find((item) => item.stat === 'disorderDmgBonus')?.groupId,
  )
  check('旧 dmgBonus 行保留', nextRows.some((row) => row.effects[0].stat === 'dmgBonus'))
}

console.log('\n[9] 拆开')
{
  const grouped = [
    fx('anomalyDmgBonus', 12, { groupId: 'g4' }),
    fx('disorderDmgBonus', 12, { groupId: 'g4' }),
  ]
  const row = buildEffectRows(grouped)[0]
  const split = splitRow(grouped, row, makeId)
  check('组 → 2 条独立', split.length === 2 && split.every((item) => !item.groupId))
  check(
    '拆开后 2 行（本地抑制启发式）',
    buildEffectRows(split, { suppressHeuristicIds: new Set(split.map((item) => item.id)) })
      .length === 2,
  )

  const single = [fx('atk', 10)]
  const ctx = changeRowZone(single, buildEffectRows(single)[0], zoneAtk, ['normal', 'pierce'], {
    makeId,
    makeGroup,
  })
  const singleRow = buildEffectRows(ctx)[0]
  const splitTypes = splitRow(ctx, singleRow, makeId)
  check('单条多类型 → 2 条', splitTypes.length === 2)
  check(
    '每条一个类型',
    splitTypes.every((item) => item.conditions?.damageTypes?.length === 1),
  )
}

console.log('\n[10] 合并 / 校验 / 对齐 / 确认合并')
{
  const base = [fx('anomalyDmgBonus', 12), fx('disorderDmgBonus', 12)]
  const rows = buildEffectRows(base)
  // 启发式已聚成 1 行，先拆开再合并（拆开后在本次编辑里抑制启发式）
  const split = splitRow(base, rows[0], makeId)
  const suppress = new Set(split.map((item) => item.id))
  const splitRows = buildEffectRows(split, { suppressHeuristicIds: suppress })
  check('拆开后 2 行', splitRows.length === 2, `${splitRows.length}`)
  const merged = mergeRows(split, splitRows, makeGroup)
  check('同值同族可合并', merged.ok, merged.error)
  check('合并后 1 组', merged.effects?.filter((item) => item.groupId).length === 2)
  check('合并后 1 行', buildEffectRows(merged.effects ?? []).length === 1)

  const mixed = [fx('anomalyDmgBonus', 12), fx('disorderDmgBonus', 13)]
  const mixedRows = buildEffectRows(mixed)
  const bad = mergeRows(mixed, mixedRows, makeGroup)
  check('值不同拒绝合并', !bad.ok)

  const heuristicEffects = [fx('anomalyDmgBonus', 12), fx('disorderDmgBonus', 12)]
  const heuristic = buildEffectRows(heuristicEffects)
  const confirmed = confirmMergeRow(heuristicEffects, heuristic[0], makeGroup)
  check('确认合并只写 groupId', confirmed.every((item) => item.groupId))
  check('确认合并后 1 行', buildEffectRows(confirmed).length === 1)

  const aligned = alignRow({
    key: 'x',
    effects: [
      { ...fx('anomalyDmgBonus', 12), elementFilter: ['火'] },
      { ...fx('disorderDmgBonus', 12), elementFilter: 'all' },
    ],
    groupId: 'g5',
    heuristic: false,
    zone: zoneDmg,
    damageTypes: ['anomaly', 'disorder'],
    issues: [],
  })
  check('一键对齐复制属性限定', JSON.stringify(aligned[1].elementFilter) === JSON.stringify(['火']))
}

console.log('\n[11] 保存前整组校验')
{
  const blocks = [
    {
      id: 'b1',
      name: '块1',
      effects: [
        fx('anomalyDmgBonus', 12, { groupId: 'g6' }),
        fx('disorderDmgBonus', 12, { groupId: 'g6' }),
      ],
    },
    { id: 'b2', name: '块2', effects: [] },
  ]
  check('同块同值通过', validateEffectGroups(blocks).ok)
  const bad = [
    {
      id: 'b1',
      name: '块1',
      effects: [
        fx('anomalyDmgBonus', 12, { groupId: 'g7' }),
        { ...fx('disorderDmgBonus', 13, { groupId: 'g7' }) },
      ],
    },
  ]
  const badResult = validateEffectGroups(bad)
  check('组内值不一致被拦', !badResult.ok && badResult.errors.length > 0)
  const cross = [
    { id: 'b1', name: '块1', effects: [fx('anomalyDmgBonus', 12, { groupId: 'g8' })] },
    { id: 'b2', name: '块2', effects: [fx('disorderDmgBonus', 12, { groupId: 'g8' })] },
  ]
  check('跨块同组被拦', !validateEffectGroups(cross).ok)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
