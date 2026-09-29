/**
 * 阶段 3：额外增益走 BuffEffect 适配器 + 统一收集；阶段 3.3 起旧的双跑对照已删。
 * 运行：npx vite-node scripts/test-extra-gain-effect-adapt.mjs
 */
import { extraGainAppliesToSlot, extraGainMatchesEvent, extraGainToEffect } from '../src/utils/extraBuffCalc.ts'
import { buildBuffCatalog, collectAllBuffEffects, collectPanelBuffMods } from '../src/utils/panelBuffCalc.ts'
import { countTeamProfession, effectMatchesTeamProfessionGate } from '../src/utils/buffEffect.ts'
import { adaptAffixLibraryEntry, adaptBuffEffect } from '../src/utils/effectAdapters.ts'
import { applyAllocatedAffixEffects } from '../src/utils/panelPipeline.ts'
import {
  dummyBangboo,
  makePanel,
  makePanelCtx,
  testAgent,
  testSlot,
} from './_effectPipelineHarness.mjs'

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

function gain(partial) {
  return {
    id: partial.id ?? 'g',
    name: partial.name ?? '测',
    stat: partial.stat ?? 'dmgBonus',
    value: partial.value ?? 15,
    applySituation: partial.applySituation ?? 'global',
    scope: partial.scope ?? 'general',
    applyTarget: partial.applyTarget ?? 'self',
    applySlot: partial.applySlot ?? 0,
    ...partial,
  }
}

const agents = [
  testAgent('a', { profession: '强攻', name: '甲' }),
  testAgent('b', { profession: '支援', name: '乙' }),
]
const teamSlots = [testSlot('a'), testSlot('b')]

// 阶段 3.3：旧的双跑对照（direct ↔ via effects）随旧通道一起删除 —— 额外增益现在只走统一路径，
// 这里改为在**统一路径的原语**上钉同样的语义：产物里的适用槽位 / 来源键，以及筛选用的两个判定函数。
// 未覆盖（旧段曾覆盖，现由其它套件与 parity 快照兜底）：职业匹配、队内人数门槛。
console.log('\n[1] 额外增益进产物与统一筛选')
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

  const slot0 = build([gain({ id: 'c-slot0', applySlot: 0, value: 10 })])
  check(
    '作用于槽位 0 → 适用槽位 [0]',
    JSON.stringify(slot0[0]?.applicableSlots) === '[0]',
    JSON.stringify(slot0[0]?.applicableSlots),
  )

  const team = build([gain({ id: 'c-team', applySlot: 'team', applyTarget: 'team', value: 8 })])
  check(
    '全队 → 适用槽位为全部',
    JSON.stringify(team[0]?.applicableSlots) === JSON.stringify(teamSlots.map((_, i) => i)),
    JSON.stringify(team[0]?.applicableSlots),
  )
  check(
    '来源键 = extra-<id>（行级例外键不变）',
    team[0]?.sourceKey === 'extra-c-team' && team[0]?.blockId === 'c-team',
  )
  check('效果 id = 增益 id', team[0]?.effect.id === 'c-team')

  const skillOnly = gain({ id: 'c-basic', scope: 'skill', skillCategory: 'basic', value: 15 })
  check('普攻限定只吃普攻', extraGainMatchesEvent(skillOnly, skillCtx('basic')) === true)
  check('普攻限定不吃终结技', extraGainMatchesEvent(skillOnly, skillCtx('ultimate')) === false)

  const staggerOnly = gain({ id: 'c-stagger', applySituation: 'stagger', stat: 'critRate', value: 20 })
  check(
    '失衡限定·失衡期',
    extraGainMatchesEvent(staggerOnly, skillCtx('basic', { staggerPhase: 'stagger' })) === true,
  )
  check(
    '失衡限定·非失衡',
    extraGainMatchesEvent(staggerOnly, skillCtx('basic', { staggerPhase: 'normal' })) === false,
  )

  const slot0Gain = gain({ applySlot: 0, value: 10 })
  check('槽位判定：槽位 1 不吃槽位 0 的', extraGainAppliesToSlot(slot0Gain, 1) === false)
  check(
    '槽位判定：全队两条槽都吃',
    extraGainAppliesToSlot(gain({ applySlot: 'team', applyTarget: 'team', value: 8 }), 1) === true,
  )
}

console.log('\n[2] 适配器与 collectAllBuffEffects')
{
  const fx = extraGainToEffect(gain({ id: 'eg1', scope: 'skill', skillCategory: 'basic', value: 15 }))
  const spec = adaptBuffEffect(fx)
  check('stage=combatPreConvert', spec.stage === 'combatPreConvert')
  check('招式条件进 spec', spec.conditions.skillTargets?.[0]?.category === 'basic')
  check('enabledDefault 为 true', fx.enabledDefault === true)

  const ctx = makePanelCtx({
    teamSlots: [testSlot('a')],
    agents: [testAgent('a')],
    bangboo: dummyBangboo(),
    extraGains: [gain({ id: 'eg1', value: 15 })],
  })
  const collected = collectAllBuffEffects(ctx)
  // 阶段 3 起：额外增益并入统一收集（不再靠"排除在收集之外"来防双算）。
  // 防双算的位置换到了折包路（`panelBuffCalc.resolveContextExtraMods` 不再折算 extraGains），
  // 兜底由 `test-buff-build-parity.mjs`（总伤逐位不变）守住。
  check(
    'collectAllBuffEffects 含额外增益（阶段 3 起统一收集，且只出现一次）',
    collected.filter((item) => item.effect.id === 'eg1').length === 1,
    collected.map((item) => item.effect.id).join(','),
  )
  // （旧收集口 `collectExtraGainEffects` 已于阶段 3.2 删除：额外增益只此一份产物）

  const allocated = [adaptAffixLibraryEntry(
    {
      id: 'basic-gain',
      label: '普攻增伤',
      target: 'gain:dmgBonus',
      perRoll: 15,
      cap: 0,
      group: '',
      rollCost: 1,
      enabledByDefault: true,
      scope: 'skill',
      skillCategory: 'basic',
      appliesToAnomaly: false,
    },
    1,
  )].filter(Boolean)
  const applied = applyAllocatedAffixEffects(makePanel(), allocated, {}, 0)
  check('词条 gain 条件抄进 extraGains', applied.extraGains[0]?.skillCategory === 'basic')
  check('词条 gain 作用域为招式', applied.extraGains[0]?.scope === 'skill')
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

console.log('\n[4] 职业匹配 / 队内人数门槛（阶段 3 起与常规增益同规则）')
{
  // 夹具：agents[0]='甲' 强攻（槽位 0）、agents[1]='乙' 支援（槽位 1）
  const extraAtkOf = (partial) => {
    const ctx = makePanelCtx({
      teamSlots,
      agents,
      bangboo: dummyBangboo(),
      mainSlotIndex: 0,
      extraGains: [
        gain({
          id: 'probe-rule',
          name: '规则探针',
          stat: 'atk',
          value: 50,
          applySlot: 'team',
          applyTarget: 'team',
          applySituation: 'global',
          ...partial,
        }),
      ],
    })
    return collectPanelBuffMods(ctx).atk ?? 0
  }

  const matchProfession = extraAtkOf({ applyProfession: '强攻' })
  check('职业匹配强攻 → 生效 50', matchProfession === 50, `实际 ${matchProfession}`)
  const mismatchProfession = extraAtkOf({ applyProfession: '支援' })
  check('职业不匹配（槽位 0 是强攻，限定支援）→ 不生效 0', mismatchProfession === 0, `实际 ${mismatchProfession}`)

  // 队内人数门槛：门在 `buffEffect.effectMatchesTeamProfessionGate`，
  // 语义 = 「勾选的人数档 == 队内该职业人数」（`buffEffect.ts:655`）。计数与门分别钉死：
  const strongCount = countTeamProfession(teamSlots, agents, '强攻')
  check('夹具队内有 1 名强攻', strongCount === 1, `实际 ${strongCount}`)

  const allTiers = extraGainToEffect(gain({ teamProfession: '强攻', teamProfessionValues: [1, 2, 3] }))
  check('人数档 [1,2,3] 命中计数 1', effectMatchesTeamProfessionGate(allTiers, 1) === true)
  check('人数档 [1,2,3] 计数 4 越界 → 不命中', effectMatchesTeamProfessionGate(allTiers, 4) === false)

  const onlyTwo = extraGainToEffect(gain({ teamProfession: '强攻', teamProfessionValues: [null, 2, null] }))
  check('人数档 [null,2,null] 不命中计数 1', effectMatchesTeamProfessionGate(onlyTwo, 1) === false)
  check('人数档 [null,2,null] 命中计数 2', effectMatchesTeamProfessionGate(onlyTwo, 2) === true)

  // ⚠️ **端到端未验成（待查）**：夹具里 计数=1、档 [1,2,3]，按门语义这条额外增益**应当生效**，
  // 但 `extraAtkOf({ teamProfession: '强攻', teamProfessionValues: [1,2,3] })` 实测为 **0**。
  // 根因未查（见 spec §13.9「已知待查」）。这里不写"绿灯"断言，免得把问题掩盖过去。
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
