/**
 * 运行时验证：方案库角色数与事件数统计
 *
 * 运行：npm run test:history-stats
 */

const { schemeStats } = await import('../src/utils/damageCalcHistory.ts')

let failed = 0
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      期望 ${e}\n      实际 ${a}`}`)
}

check(
  'v3 方案按所有槽位的流程条目计数',
  schemeStats({
    teamSlots: [{ agentId: 'alice' }, { agentId: '' }, { agentId: 'carol' }],
    slots: [
      { prepared: [], flow: [{}, {}] },
      { prepared: [], flow: [] },
      { prepared: [], flow: [{}] },
    ],
  }),
  { charN: 2, skillN: 3 },
)

check(
  'v3 槽位存在时不再读取废弃事件字段',
  schemeStats({
    teamSlots: [],
    slots: [],
    directEvents: [{}, {}],
    anomalyEvents: [{}],
  }),
  { charN: 0, skillN: 0 },
)

check(
  '旧方案没有槽位数据时兼容废弃事件字段',
  schemeStats({
    teamSlots: [{ agentId: 'alice' }],
    directEvents: [{}, {}],
    anomalyEvents: [{}],
  }),
  { charN: 1, skillN: 3 },
)

console.log('')
console.log(failed === 0 ? '全部通过' : `${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
