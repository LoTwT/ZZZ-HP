/**
 * 准备条目「按提供者拆次数」：展开口径 + 行键归并
 *
 * 钉住五件事：
 * 1. 无分段 = 现状（一条 hit、行次数全归一个提供者）
 * 2. 分段按顺序消耗行次数，第 0 段沿用行键、其余 `#alloc{i}`、剩余 `#rest`
 * 3. 分段合计超出 / 不足行次数的口径（截断 / 回落基础提供者）
 * 4. 组内成员各自分段（第 0 段 = `行键#成员index:skillId`）
 * 5. 预览取第 0 段提供者；非异常类即便带分段也不拆
 *
 * 用法：npx vite-node scripts/test-provider-count-split.mjs
 */
import {
  firstProviderAllocationAgentId,
  flowCountFloor,
  memberTuneCountFloor,
  resolveFlow,
  resolveProviderSegments,
  resolveSkillPreviews,
  rowKeyOfHitId,
  sumProviderAllocations,
} from '../src/utils/resolvedHit.ts'

let passed = 0
let failed = 0
function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

function makeSkill(id, damageType = 'radiance') {
  return {
    id,
    name: id,
    agentId: 'remiel',
    damageType,
    skillTypes: [],
    buffAnchorId: null,
    baseMult: 100,
    baseMultFactor: 100,
    settlementMult: 0,
  }
}

function makePrepared(patch = {}) {
  return {
    id: 'prep1',
    skillId: 'sk-r',
    skillGroupId: null,
    skillSource: 'preset',
    anomalyPowerAgentId: 'remiel',
    triggerAgentId: 'remiel',
    extraMods: null,
    ...patch,
  }
}

function makeEntry(patch = {}) {
  return {
    id: 'flow1',
    ownerAgentId: 'remiel',
    preparedId: 'prep1',
    count: 3,
    staggerPhase: 'normal',
    critMode: 'expected',
    ...patch,
  }
}

function makeOptions(slots, patch = {}) {
  return {
    slots,
    teamSlots: [{ agentId: 'remiel' }, { agentId: 'alice' }, { agentId: 'bob' }],
    findSkill: (id) => (id === 'sk-r' || id === 'sk-d' ? makeSkill(id, id === 'sk-d' ? 'direct' : 'radiance') : null),
    ...patch,
  }
}

function segmentText(hits) {
  return hits.map((hit) => `${hit.id}@${hit.anomalyPowerAgentId}:${hit.count}`).join(' | ')
}

console.log('')
console.log('--- 1. 无分段：行为与现状一致 ---')
{
  const hits = resolveFlow(makeOptions([{ prepared: [makePrepared()], flow: [makeEntry()] }])).hits
  check('一条流程行 = 一条 hit', hits.length === 1, segmentText(hits))
  check(
    'hit id = 行键、提供者 = 条目提供者、次数 = 行次数',
    hits[0].id === 'flow1' && hits[0].anomalyPowerAgentId === 'remiel' && hits[0].count === 3,
    segmentText(hits),
  )
}

console.log('')
console.log('--- 2. 分段恰好覆盖行次数 ---')
{
  const prepared = makePrepared({
    providerAllocations: [
      { agentId: 'alice', count: 1 },
      { agentId: 'bob', count: 2 },
    ],
  })
  const hits = resolveFlow(makeOptions([{ prepared: [prepared], flow: [makeEntry()] }])).hits
  check(
    '两段：行键 + #alloc1，无 #rest',
    hits.map((hit) => hit.id).join(',') === 'flow1,flow1#alloc1',
    segmentText(hits),
  )
  check(
    '提供者与次数按分段落',
    hits.map((hit) => `${hit.anomalyPowerAgentId}:${hit.count}`).join(',') === 'alice:1,bob:2',
    segmentText(hits),
  )
  check(
    '分段次数合计 = 行次数',
    hits.reduce((sum, hit) => sum + hit.count, 0) === 3,
    String(hits.reduce((sum, hit) => sum + hit.count, 0)),
  )
}

console.log('')
console.log('--- 3. 分段不足 / 超出：回落与截断 ---')
{
  const under = resolveFlow(
    makeOptions([
      {
        prepared: [makePrepared({ providerAllocations: [{ agentId: 'alice', count: 1 }] })],
        flow: [makeEntry()],
      },
    ]),
  ).hits
  check(
    '不足：剩余次数走 #rest，用基础提供者',
    under.map((hit) => hit.id).join(',') === 'flow1,flow1#rest' &&
      under[1].anomalyPowerAgentId === 'remiel' &&
      under[1].count === 2,
    segmentText(under),
  )

  const over = resolveFlow(
    makeOptions([
      {
        prepared: [
          makePrepared({
            providerAllocations: [
              { agentId: 'alice', count: 2 },
              { agentId: 'bob', count: 5 },
            ],
          }),
        ],
        flow: [makeEntry()],
      },
    ]),
  ).hits
  check(
    '超出：按行次数截断（合计仍是 3）',
    over.length === 2 &&
      over.map((hit) => hit.count).join(',') === '2,1' &&
      over.reduce((sum, hit) => sum + hit.count, 0) === 3,
    segmentText(over),
  )
}

console.log('')
console.log('--- 4. 组内成员各自分段 ---')
{
  const group = {
    id: 'g1',
    agentId: 'remiel',
    name: 'g',
    members: [{ skillId: 'sk-r', order: 0, count: 3, includeInFlow: true }],
  }
  const prepared = makePrepared({
    skillId: null,
    skillGroupId: 'g1',
    anomalyPowerAgentId: null,
    memberAgents: [
      {
        memberKey: '0:sk-r',
        skillId: 'sk-r',
        anomalyPowerAgentId: 'remiel',
        triggerAgentId: 'remiel',
        providerAllocations: [{ agentId: 'alice', count: 1 }],
      },
    ],
  })
  const hits = resolveFlow(
    makeOptions([{ prepared: [prepared], flow: [makeEntry({ count: 2 })] }], {
      findSkillGroup: () => group,
    }),
  ).hits
  check(
    '第 0 段沿用成员行键、剩余走 #rest',
    hits.map((hit) => hit.id).join(',') === 'flow1#0:sk-r,flow1#0:sk-r#rest',
    segmentText(hits),
  )
  check(
    '成员分段：1 次 alice + 剩余 5 次（3×2）按成员提供者',
    hits[0].anomalyPowerAgentId === 'alice' &&
      hits[0].count === 1 &&
      hits[1].anomalyPowerAgentId === 'remiel' &&
      hits[1].count === 5,
    segmentText(hits),
  )
}

console.log('')
console.log('--- 5. 预览与非异常类 ---')
{
  const prepared = makePrepared({
    providerAllocations: [
      { agentId: 'bob', count: 1 },
      { agentId: 'alice', count: 1 },
    ],
  })
  const previews = resolveSkillPreviews(makeOptions([{ prepared: [prepared], flow: [] }]))
  check(
    '预览取第 0 段提供者',
    previews.length === 1 && previews[0].anomalyPowerAgentId === 'bob',
    segmentText(previews),
  )

  const direct = makePrepared({
    skillId: 'sk-d',
    providerAllocations: [
      { agentId: 'alice', count: 1 },
      { agentId: 'bob', count: 1 },
    ],
  })
  const directHits = resolveFlow(
    makeOptions([{ prepared: [direct], flow: [makeEntry()] }]),
  ).hits
  check(
    '非异常类即便带分段也不拆',
    directHits.length === 1 && directHits[0].id === 'flow1' && directHits[0].count === 3,
    segmentText(directHits),
  )
}

console.log('')
console.log('--- 6. 行键归并与分段解析 ---')
{
  check('行键：#allocN 归并回行', rowKeyOfHitId('flow1#alloc2') === 'flow1')
  check('行键：#rest 归并回行', rowKeyOfHitId('flow1#rest') === 'flow1')
  check(
    '行键：组内成员键不受影响',
    rowKeyOfHitId('flow1#0:sk-r') === 'flow1#0:sk-r' &&
      rowKeyOfHitId('flow1#0:sk-r#alloc1') === 'flow1#0:sk-r',
  )
  check('行键：普通行原样返回', rowKeyOfHitId('flow1') === 'flow1')

  check(
    '分段解析：过滤空 agentId / 非正次数',
    JSON.stringify(resolveProviderSegments(
      [
        { agentId: '', count: 2 },
        { agentId: 'alice', count: 0 },
        { agentId: 'bob', count: 1 },
      ],
      3,
    )) === JSON.stringify([{ agentId: 'bob', count: 1 }]),
  )
  check('分段解析：次数 ≤ 0 直接不拆', resolveProviderSegments([{ agentId: 'a', count: 1 }], 0) === null)
  check('分段解析：空表不拆', resolveProviderSegments(null, 5) === null)
  check(
    '首段提供者：取第一个有效项',
    firstProviderAllocationAgentId([
      { agentId: '', count: 1 },
      { agentId: 'alice', count: 1 },
    ]) === 'alice',
  )
}

console.log('')
console.log('--- 7. 行次数下限（分段合计） ---')
{
  check(
    '合计：过滤无效项后求和',
    sumProviderAllocations([
      { agentId: 'alice', count: 2 },
      { agentId: '', count: 5 },
      { agentId: 'bob', count: 1 },
    ]) === 3,
  )
  check('合计：空表为 0', sumProviderAllocations(null) === 0)

  const single = {
    skillGroupId: null,
    providerAllocations: [
      { agentId: 'alice', count: 1 },
      { agentId: 'bob', count: 2 },
    ],
    memberAgents: null,
  }
  check('普通行下限 = 分段合计', flowCountFloor(single, null, () => 0) === 3)

  const groupPrepared = {
    skillGroupId: 'g1',
    providerAllocations: null,
    memberAgents: [
      {
        memberKey: '0:sk-r',
        skillId: 'sk-r',
        providerAllocations: [
          { agentId: 'alice', count: 1 },
          { agentId: 'bob', count: 1 },
        ],
      },
    ],
  }
  const group = {
    id: 'g1',
    agentId: 'remiel',
    name: 'g',
    members: [{ skillId: 'sk-r', order: 0, count: 2, includeInFlow: true }],
  }
  check(
    '组行下限 = Σ(成员合计 ÷ 成员次数)',
    flowCountFloor(groupPrepared, group, () => 2) === 1,
  )
  check(
    '组行下限：成员次数变小则下限升高',
    flowCountFloor(groupPrepared, group, () => 1) === 2,
  )
  check('组行下限：成员次数为 0 时跳过', flowCountFloor(groupPrepared, group, () => 0) === 0)
  check(
    '成员下限 = 合计 ÷ 整组次数',
    memberTuneCountFloor([{ agentId: 'alice', count: 5 }], 2) === 2.5,
  )
  check('成员下限：整组次数为 0 时退回合计', memberTuneCountFloor([{ agentId: 'alice', count: 5 }], 0) === 5)
  check('成员下限：无分段为 0', memberTuneCountFloor(null, 3) === 0)
}

console.log('')
console.log('--- 8. 准备 / 流程解耦：行级覆盖优先 ---')
{
  const prepared = makePrepared({
    providerAllocations: [{ agentId: 'alice', count: 3 }],
  })
  const hits = resolveFlow(
    makeOptions([
      {
        prepared: [prepared],
        flow: [
          makeEntry({ id: 'flowA', count: 3 }),
          makeEntry({ id: 'flowB', count: 3, providerAllocations: [{ agentId: 'bob', count: 3 }] }),
        ],
      },
    ]),
  ).hits
  const rowA = hits.filter((hit) => hit.id.startsWith('flowA'))
  const rowB = hits.filter((hit) => hit.id.startsWith('flowB'))
  check(
    '同一准备招式两行：A 行继承准备（alice）、B 行用自己的分段（bob）',
    rowA.length === 1 &&
      rowA[0].anomalyPowerAgentId === 'alice' &&
      rowB.length === 1 &&
      rowB[0].anomalyPowerAgentId === 'bob',
    segmentText(hits),
  )

  const overrideHits = resolveFlow(
    makeOptions([
      {
        prepared: [makePrepared()],
        flow: [makeEntry({ anomalyPowerAgentId: 'bob', triggerAgentId: 'alice' })],
      },
    ]),
  ).hits
  check(
    '行级提供者/触发者覆盖准备条目',
    overrideHits[0].anomalyPowerAgentId === 'bob' && overrideHits[0].triggerAgentId === 'alice',
    segmentText(overrideHits),
  )

  const group = {
    id: 'g1',
    agentId: 'remiel',
    name: 'g',
    members: [{ skillId: 'sk-r', order: 0, count: 2, includeInFlow: true }],
  }
  const groupPrepared = makePrepared({
    skillId: null,
    skillGroupId: 'g1',
    anomalyPowerAgentId: null,
    memberAgents: [
      {
        memberKey: '0:sk-r',
        skillId: 'sk-r',
        anomalyPowerAgentId: 'remiel',
        triggerAgentId: 'remiel',
        providerAllocations: [{ agentId: 'alice', count: 1 }],
      },
    ],
  })
  const groupHits = resolveFlow(
    makeOptions(
      [
        {
          prepared: [groupPrepared],
          flow: [
            makeEntry({
              count: 1,
              memberOverrides: [
                {
                  memberKey: '0:sk-r',
                  skillId: 'sk-r',
                  providerAllocations: [{ agentId: 'bob', count: 2 }],
                },
              ],
            }),
          ],
        },
      ],
      { findSkillGroup: () => group },
    ),
  ).hits
  check(
    '组内成员的行级覆盖生效（bob×2，无剩余段）',
    groupHits.length === 1 &&
      groupHits[0].anomalyPowerAgentId === 'bob' &&
      groupHits[0].count === 2,
    segmentText(groupHits),
  )
}

console.log('')
console.log(`=== 结果：passed = ${passed}, failed = ${failed} ===`)
if (failed > 0) process.exit(1)
