/**
 * 招式流程「命中求值上下文」指纹的守卫测试（`buildSkillFlowHitContextSignature`）。
 *
 * 背景（2026-10-20 用户实测）：页内改**影画档位 / 音擎精炼**后，招式流程的伤害数字不刷新，
 * 部分档位「碰巧」会刷新，其余要 F5。根因是这份指纹没带队伍槽位 —— 于是 watch 不触发、
 * `hitEvalCache` 的上下文令牌也不变，旧结果被一直复用。
 *
 * 这张表漏字段的症状是「数字看着正常但是旧的」，且不会报任何错，所以逐字段钉住：
 * 1. 同内容 → 同签名（缓存才可能复用）；
 * 2. 任一影响结果的字段变化 → 签名必变（镜像 `test-hit-eval-cache.mjs` 的做法）；
 * 3. 真实方案 fixture：改影画 / 改精炼 → 签名必变（本次 bug 的回归点）；
 * 4. 组件确实走这份单点字段表（防止有人再写回内联 JSON）。
 *
 * 链路依据见 dev-docs/affix-calc-manual.md §11.6。
 * 运行：npx vite-node scripts/test-skill-flow-hit-context.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

import { buildSkillFlowHitContextSignature } from '../src/utils/skillFlowPanelSource.ts'
import { FRONTEND_ROOT } from './_paths.mjs'

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

function slot(agentId, rank = 0, wengineId = 'none', wengineRefine = 1) {
  return {
    agentId,
    rank,
    wengineId,
    wengineRefine,
    twoPieceDriveDiscId: 'none',
    fourPieceDriveDiscId: 'none',
  }
}

/** 一份「能出伤害」的最小上下文；每个用例只改一个字段 */
function baseInput() {
  return {
    enemy: { level: 60, defense: 953, resistanceType: 'normal' },
    extraGains: [],
    sourceExtraGains: [],
    buffSelection: { enabledIds: { 'eff-a': true }, stacksByEffectId: {}, convertInputs: {} },
    slotBuffSelections: {
      team: { enabledIds: {}, stacksByEffectId: {}, convertInputs: {} },
      bySlot: { 0: { enabledIds: { 'eff-a': true }, stacksByEffectId: {}, convertInputs: {} } },
    },
    convertSlotPanels: {},
    activeSlotPanels: { velina: { atk: 2000 } },
    environmentBuffIds: [],
    bangbooId: 'none',
    bangbooRefine: 1,
    driveDiscMainStats: { slot4MainStat: 'mastery', slot5MainStat: 'dmgBonus', slot6MainStat: 'energyRegen' },
    baseDamageSource: 'atk',
    damageKind: 'direct',
    staggerPhase: 'stagger',
    teamSlots: [slot('velina', 1, 'weapon-a', 1), slot('piper'), slot('remiel')],
    mainSlotIndex: 0,
    skillTalentLevelsByAgent: { velina: { basic: 12, dodge: 12, assist: 12, special: 12, chainUltimate: 12 } },
  }
}

console.log('== 稳定性：同内容 → 同签名 ==')
{
  const a = buildSkillFlowHitContextSignature(baseInput())
  const b = buildSkillFlowHitContextSignature(baseInput())
  check('默认上下文两次签名一致', a === b)
  check('签名非空且是字符串', typeof a === 'string' && a.length > 0)
}

console.log('== 字段敏感度：任一输入变化 → 签名变化 ==')
{
  const base = baseInput()
  const baseSig = buildSkillFlowHitContextSignature(base)
  const changed = [
    ['enemy', { enemy: { level: 60, defense: 954, resistanceType: 'normal' } }],
    ['extraGains', { extraGains: [{ id: 'g1' }] }],
    ['sourceExtraGains', { sourceExtraGains: [{ id: 'g2' }] }],
    ['buffSelection', { buffSelection: { enabledIds: { 'eff-a': false } } }],
    [
      'slotBuffSelections',
      {
        slotBuffSelections: {
          team: { enabledIds: { 'eff-b': true } },
          bySlot: { 0: { enabledIds: {} } },
        },
      },
    ],
    ['convertSlotPanels', { convertSlotPanels: { piper: { atk: 10 } } }],
    ['activeSlotPanels', { activeSlotPanels: { velina: { atk: 2001 } } }],
    ['environmentBuffIds', { environmentBuffIds: ['env-1'] }],
    ['bangbooId', { bangbooId: 'bangboo-a' }],
    ['bangbooRefine', { bangbooRefine: 2 }],
    [
      'driveDiscMainStats',
      { driveDiscMainStats: { ...base.driveDiscMainStats, slot4MainStat: 'atkPercent' } },
    ],
    ['baseDamageSource', { baseDamageSource: 'pierce' }],
    ['damageKind', { damageKind: 'anomaly' }],
    ['staggerPhase', { staggerPhase: 'normal' }],
    ['mainSlotIndex', { mainSlotIndex: 1 }],
    [
      'skillTalentLevelsByAgent',
      { skillTalentLevelsByAgent: { velina: { basic: 16 } } },
    ],
    // —— 本次缺陷的三项（此前完全不在签名里）——
    ['teamSlots[0].rank', { teamSlots: [slot('velina', 6, 'weapon-a', 1), slot('piper'), slot('remiel')] }],
    [
      'teamSlots[0].wengineRefine',
      { teamSlots: [slot('velina', 1, 'weapon-a', 5), slot('piper'), slot('remiel')] },
    ],
    [
      'teamSlots[0].wengineId',
      { teamSlots: [slot('velina', 1, 'weapon-b', 1), slot('piper'), slot('remiel')] },
    ],
    [
      'teamSlots[0].twoPieceDriveDiscId',
      {
        teamSlots: [
          { ...slot('velina', 1, 'weapon-a', 1), twoPieceDriveDiscId: 'disc-a' },
          slot('piper'),
          slot('remiel'),
        ],
      },
    ],
    [
      'teamSlots[0].fourPieceDriveDiscId',
      {
        teamSlots: [
          { ...slot('velina', 1, 'weapon-a', 1), fourPieceDriveDiscId: 'disc-b' },
          slot('piper'),
          slot('remiel'),
        ],
      },
    ],
    [
      'teamSlots[1].agentId（队友换人）',
      { teamSlots: [slot('velina', 1, 'weapon-a', 1), slot('lina'), slot('remiel')] },
    ],
    [
      'teamSlots[1].rank（队友影画）',
      { teamSlots: [slot('velina', 1, 'weapon-a', 1), slot('piper', 6), slot('remiel')] },
    ],
  ]
  for (const [label, patch] of changed) {
    const sig = buildSkillFlowHitContextSignature({ ...base, ...patch })
    check(`改 ${label} → 签名变化`, sig !== baseSig)
  }
}

console.log('== 真实方案 fixture：影画 / 音擎精炼（本次 bug 的回归点）==')
{
  const schemePath = path.join(
    FRONTEND_ROOT,
    'fixtures/pen-rate-alloc/ye-shiyuan-pen-rate.json',
  )
  if (!fs.existsSync(schemePath)) {
    check('fixture 存在', false, schemePath)
  } else {
    const pack = JSON.parse(fs.readFileSync(schemePath, 'utf8'))
    const scheme = Object.values(pack.schemes)[0]
    const teamOf = (rank, refine) =>
      scheme.teamSlots.map((item, index) => ({
        agentId: item.agentId,
        rank: index === 0 ? rank : item.rank,
        wengineId: item.wengineId,
        wengineRefine: index === 0 ? refine : item.wengineRefine,
        twoPieceDriveDiscId: item.twoPieceDriveDiscId,
        fourPieceDriveDiscId: item.fourPieceDriveDiscId,
      }))
    const sigOf = (rank, refine) =>
      buildSkillFlowHitContextSignature({ ...baseInput(), teamSlots: teamOf(rank, refine) })

    const at1 = sigOf(1, 1)
    check('影画 1 → 6 签名变化', sigOf(6, 1) !== at1)
    check('影画 1 → 2 签名变化（同档位也可能只差影画本身）', sigOf(2, 1) !== at1)
    check('精炼 1 → 5 签名变化', sigOf(1, 5) !== at1)
    check('精炼 5 → 1 签名变化（降档同向）', sigOf(1, 5) !== sigOf(1, 1))
    check('同参数两次签名一致', sigOf(1, 1) === at1)
  }
}

console.log('== 单点字段表：组件必须调用它，不许再内联 ==')
{
  const componentPath = path.join(
    FRONTEND_ROOT,
    'src/components/calculator/OptimalAffixAllocSection.vue',
  )
  const source = fs.readFileSync(componentPath, 'utf8')
  check('组件引用了 buildSkillFlowHitContextSignature', source.includes('buildSkillFlowHitContextSignature'))
  const inlined = /skillFlowContextFingerprint\s*=\s*computed\(\(\)\s*=>\s*JSON\.stringify\(/.test(source)
  check('组件不再内联 JSON.stringify 字段表', !inlined)
}

{
  const ice = buildSkillFlowHitContextSignature({ ...baseInput(), agentElements: [['a', '冰']] })
  const fire = buildSkillFlowHitContextSignature({ ...baseInput(), agentElements: [['a', '火']] })
  check('E8 source role element invalidates shared context', ice !== fire)
}

console.log('')
console.log(`结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
