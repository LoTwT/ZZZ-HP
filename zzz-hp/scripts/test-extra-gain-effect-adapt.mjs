/**
 * 额外 Buff 走统一收集与适配器（2026-10-23 改为新结构：卡片 + effects[]）。
 *
 * 运行：npx vite-node scripts/test-extra-gain-effect-adapt.mjs
 */
import {
  buildBuffCatalog,
  collectAllBuffEffects,
  collectPanelBuffMods,
} from '../src/utils/panelBuffCalc.ts'
import { adaptBuffEffect } from '../src/utils/effectAdapters.ts'
import { applyAllocatedAffixEffects } from '../src/utils/panelPipeline.ts'
import {
  createExtraBuffGain,
  extraGainAppliesToSlot,
  extraGainToEffects,
} from '../src/utils/extraBuffCalc.ts'
import {
  countTeamProfession,
  createEmptyBuffEffect,
  effectMatchesContext,
  effectMatchesTeamProfessionGate,
} from '../src/utils/buffEffect.ts'
import { dummyBangboo, makePanel, makePanelCtx, testAgent, testSlot } from './_effectPipelineHarness.mjs'

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

function skillCtx(categoryId, extra = {}) {
  return {
    damageKind: 'direct',
    categoryId,
    subcategoryId: null,
    coords: [{ category: categoryId, subcategoryId: null }],
    element: '电',
    staggerPhase: 'stagger',
    isFollowUp: false,
    ...extra,
  }
}

/** 一张单效果卡片（效果字段按需覆盖） */
function gain(id, effectOverrides = {}, cardOverrides = {}) {
  return createExtraBuffGain({
    id,
    name: cardOverrides.name ?? '测',
    applySlot: cardOverrides.applySlot ?? 0,
    effects: [createEmptyBuffEffect({ stat: 'dmgBonus', kind: 'fixed', value: 15, enabledDefault: true, ...effectOverrides })],
  })
}

const agents = [
  testAgent('a', { profession: '强攻', name: '甲' }),
  testAgent('b', { profession: '支援', name: '乙' }),
]
const teamSlots = [testSlot('a'), testSlot('b')]

console.log('\n[1] 额外 Buff 进统一产物与筛选')
{
  const build = (gains) =>
    buildBuffCatalog({
      teamSlots,
      agents,
      wengines: [],
      driveDiscs: [],
      bangboo: dummyBangboo(),
      bangbooRefine: 1,
      environmentBuffs: [],
      extraGains: gains,
    }).entries.filter((entry) => entry.sourceKey.startsWith('extra-'))

  const slot0 = build([gain('c-slot0', { value: 10 }, { applySlot: 0 })])
  check(
    '作用于槽位 0 → 适用槽位 [0]',
    JSON.stringify(slot0[0]?.applicableSlots) === '[0]',
    JSON.stringify(slot0[0]?.applicableSlots),
  )

  const team = build([gain('c-team', { value: 8 }, { applySlot: 'team' })])
  check(
    '全队 → 适用槽位为全部',
    JSON.stringify(team[0]?.applicableSlots) === JSON.stringify(teamSlots.map((_, i) => i)),
    JSON.stringify(team[0]?.applicableSlots),
  )
  check('来源键 = extra-<卡片id>（行级例外键不变）', team[0]?.sourceKey === 'extra-c-team')
  check('块键 = 卡片 id', team[0]?.blockId === 'c-team')
  check('条目的效果 id 是底层效果 id（不是卡片 id）', team[0]?.effect.id !== 'c-team', String(team[0]?.effect.id))
  check('额外来源槽位写进 extraGainSourceSlot', team[0]?.extraGainSourceSlot === 0, String(team[0]?.extraGainSourceSlot))
  check('providerSlot 仍为 null', team[0]?.providerSlot === null)

  const skillOnly = gain('c-basic', {
    value: 15,
    skillTargets: [{ category: 'basic', subcategoryId: null }],
  })
  const skillEffect = extraGainToEffects(skillOnly)[0]
  check('普攻限定只吃普攻', effectMatchesContext(skillEffect, skillCtx('basic')) === true)
  check('普攻限定不吃终结技', effectMatchesContext(skillEffect, skillCtx('ultimate')) === false)

  const staggerOnly = gain('c-stagger', { stat: 'critRate', value: 20, applySituation: 'stagger' })
  const staggerEffect = extraGainToEffects(staggerOnly)[0]
  check('失衡限定·失衡期', effectMatchesContext(staggerEffect, skillCtx('basic', { staggerPhase: 'stagger' })) === true)
  check('失衡限定·非失衡', effectMatchesContext(staggerEffect, skillCtx('basic', { staggerPhase: 'normal' })) === false)

  check('槽位判定：槽位 1 不吃槽位 0 的', extraGainAppliesToSlot(gain('g0', {}, { applySlot: 0 }), 1) === false)
  check('槽位判定：全队两条槽都吃', extraGainAppliesToSlot(gain('gt', {}, { applySlot: 'team' }), 1) === true)
}

console.log('\n[2] 适配器与 collectAllBuffEffects')
{
  const card = gain('eg1', { value: 15, skillTargets: [{ category: 'basic', subcategoryId: null }] })
  const fx = extraGainToEffects(card)[0]
  const spec = adaptBuffEffect(fx)
  check('stage=combatPreConvert', spec.stage === 'combatPreConvert')
  check('招式条件进 spec', spec.conditions.skillTargets?.[0]?.category === 'basic')
  check('enabledDefault 为 true', fx.enabledDefault === true)

  const ctx = makePanelCtx({
    teamSlots: [testSlot('a')],
    agents: [testAgent('a')],
    bangboo: dummyBangboo(),
    extraGains: [gain('eg1', { value: 15 })],
  })
  const collected = collectAllBuffEffects(ctx)
  check(
    'collectAllBuffEffects 含额外 Buff（只出现一次）',
    collected.filter((item) => item.sourceKey === 'extra-eg1').length === 1,
    collected.map((item) => item.sourceKey).join(','),
  )

  const allocated = [
    {
      type: 'effect',
      instance: {
        version: 1,
        stat: 'dmgBonus',
        operation: 'add',
        stage: 'combatPreConvert',
        beneficiary: 'self',
        conditions: { skillTargets: [{ category: 'basic', subcategoryId: null }] },
        instanceId: 'affix:basic-gain',
        sourceKey: 'affix:basic-gain',
        sourceFamily: 'affix-gain',
        quantity: 1,
        magnitude: 15,
        displayName: '普攻增伤',
      },
    },
  ]
  const applied = applyAllocatedAffixEffects(makePanel(), allocated, {}, 0)
  const affixCard = applied.extraGains[0]
  check('词条 gain 产出新结构卡片', Array.isArray(affixCard?.effects) && affixCard.effects.length === 1)
  check(
    '词条 gain 的招式条件完整进 effects',
    affixCard?.effects[0]?.skillTargets?.[0]?.category === 'basic',
    JSON.stringify(affixCard?.effects[0]?.skillTargets),
  )
}

console.log('\n[3] 空增益：产物里没有额外条目')
{
  const built = buildBuffCatalog({
    teamSlots,
    agents,
    wengines: [],
    driveDiscs: [],
    bangboo: dummyBangboo(),
    bangbooRefine: 1,
    environmentBuffs: [],
    extraGains: [],
  }).entries.filter((entry) => entry.sourceKey.startsWith('extra-'))
  check('无额外增益时产物里没有额外条目', built.length === 0, `实际 ${built.length} 条`)
}

console.log('\n[4] 职业匹配 / 队内人数门槛')
{
  const extraAtkOf = (effectOverrides) => {
    const ctx = makePanelCtx({
      teamSlots,
      agents,
      bangboo: dummyBangboo(),
      mainSlotIndex: 0,
      extraGains: [gain('probe-rule', { stat: 'atk', value: 50, ...effectOverrides }, { applySlot: 'team' })],
    })
    return collectPanelBuffMods(ctx).atk ?? 0
  }

  const matchProfession = extraAtkOf({ applyProfession: '强攻' })
  check('职业匹配强攻 → 生效 50', matchProfession === 50, `实际 ${matchProfession}`)
  const mismatchProfession = extraAtkOf({ applyProfession: '支援' })
  check('职业不匹配 → 0', mismatchProfession === 0, `实际 ${mismatchProfession}`)

  const strongCount = countTeamProfession(teamSlots, agents, '强攻')
  check('夹具队内有 1 名强攻', strongCount === 1, `实际 ${strongCount}`)

  const allTiers = extraGainToEffects(gain('t-all', { teamProfession: '强攻', teamProfessionValues: [0, null, null] }))[0]
  check('人数档 [0,null,null] 命中计数 1', effectMatchesTeamProfessionGate(allTiers, 1) === true)
  check('人数档 [0,null,null] 计数 2 不命中', effectMatchesTeamProfessionGate(allTiers, 2) === false)

  const onlyTwo = extraGainToEffects(gain('t-two', { teamProfession: '强攻', teamProfessionValues: [null, 0, null] }))[0]
  check('人数档 [null,0,null] 不命中计数 1', effectMatchesTeamProfessionGate(onlyTwo, 1) === false)
  check('人数档 [null,0,null] 命中计数 2', effectMatchesTeamProfessionGate(onlyTwo, 2) === true)

  // 端到端：带人数档的额外 Buff 需要真的生效（T24 回归，Spec §7.2 第 14 项）
  const gated = extraAtkOf({ teamProfession: '强攻', teamProfessionValues: [0, null, null] })
  check('人数档满足时端到端生效 50', gated === 50, `实际 ${gated}`)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
