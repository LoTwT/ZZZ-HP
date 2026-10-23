/**
 * 额外 Buff 契约测试（Spec §7.2；本文件从骨架起步，缺口以真实断言失败呈现）。
 *
 * 规则：能力缺失时**不用跳过或固定成功**代替，直接记为 FAIL（Spec §8 第 1 项）。
 * 用法：npx vite-node scripts/test-extra-buff-contract.mjs
 */
const api = await import('../src/utils/extraBuffCalc.ts').catch((error) => {
  console.log(`  FAIL  导入 extraBuffCalc.ts 失败 — ${String(error)}`)
  process.exit(1)
})

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
/** 取一个必须存在的函数；缺失时记 FAIL 并返回 null */
function need(name) {
  const fn = api[name]
  if (typeof fn !== 'function') {
    check(`${name} 已实现`, false, `当前类型：${typeof fn}`)
    return null
  }
  return fn
}

console.log('\n[1] createExtraBuffGain：默认卡片结构')
{
  const create = need('createExtraBuffGain')
  if (create) {
    const card = create()
    const effect = card?.effects?.[0]
    check('卡片有非空 id', typeof card?.id === 'string' && card.id.length > 0)
    check('默认名称「自定义增益」', card?.name === '自定义增益', String(card?.name))
    check('受益槽位默认 0', card?.applySlot === 0, String(card?.applySlot))
    check('来源槽位默认 0', card?.sourceSlot === 0, String(card?.sourceSlot))
    check('恰好一个底层效果', card?.effects?.length === 1, String(card?.effects?.length))
    check('默认 dmgBonus / fixed / 0', effect?.stat === 'dmgBonus' && effect?.kind === 'fixed' && effect?.value === 0,
      `${effect?.stat}/${effect?.kind}/${effect?.value}`)
    check('默认启用', effect?.enabledDefault === true)
    check('效果 id 与卡片 id 不同', effect?.id != null && effect.id !== card.id)
    let threw = false
    try {
      create({ applySlot: 5 })
    } catch (error) {
      threw = error instanceof TypeError
    }
    check('非法覆盖值抛 TypeError', threw)
  }
}

console.log('\n[2] normalizeExtraGain / normalizeExtraGains')
{
  const create = need('createExtraBuffGain')
  const normalizeOne = need('normalizeExtraGain')
  const normalizeMany = need('normalizeExtraGains')
  if (create && normalizeOne && normalizeMany) {
    const card = create()
    const ok = normalizeOne(JSON.parse(JSON.stringify(card)))
    check('合法卡片归一化成功', ok != null)
    check('返回深拷贝（不是同一个对象）', ok !== card && ok?.effects !== card.effects)
    check('非对象 → null', normalizeOne(null) === null && normalizeOne('x') === null)
    check('缺卡片 id → null', normalizeOne({ ...card, id: '' }) === null)
    check('effects 空 → null', normalizeOne({ ...card, effects: [] }) === null)
    check('受益槽位非法 → null', normalizeOne({ ...card, applySlot: 7 }) === null)

    const empty = normalizeMany(null)
    check('非数组 → 空数组 + 0', Array.isArray(empty?.gains) && empty.gains.length === 0 && empty.discardedCount === 0,
      JSON.stringify(empty))
    const dupId = normalizeMany([card, { ...card }])
    check('重复卡片 id → 只留一条并计 1', dupId?.gains?.length === 1 && dupId?.discardedCount === 1,
      JSON.stringify({ n: dupId?.gains?.length, d: dupId?.discardedCount }))
  }
}

console.log('\n[3] serializeExtraGains：深拷贝、不改身份')
{
  const create = need('createExtraBuffGain')
  const serialize = need('serializeExtraGains')
  if (create && serialize) {
    const card = create({ name: '测' })
    const before = JSON.stringify(card)
    const out = serialize([card])
    check('输出数组长度一致', Array.isArray(out) && out.length === 1)
    check('不改输入对象', JSON.stringify(card) === before)
    check('id 不变', out?.[0]?.id === card.id)
    check('不持有 effects 引用', out?.[0]?.effects !== card.effects)
    check('可 JSON 往返', JSON.stringify(JSON.parse(JSON.stringify(out))) === JSON.stringify(out))
  }
}

console.log('\n[4] extraGainToEffects：多效果与派生字段')
{
  const create = need('createExtraBuffGain')
  const toEffects = need('extraGainToEffects')
  if (create && toEffects) {
    const single = create()
    const one = toEffects(single)
    check('单效果卡片输出 1 条', one?.length === 1, String(one?.length))
    check('保留效果 id', one?.[0]?.id === single.effects[0].id)
    check('运行期标记 extraGain=true', one?.[0]?.extraGain === true)
    check('applyTarget 由 applySlot 派生（槽位→self）', one?.[0]?.applyTarget === 'self')

    const team = create({ applySlot: 'team' })
    check('全队 → applyTarget=team', toEffects(team)?.[0]?.applyTarget === 'team')

    const two = create()
    two.effects = [
      { ...two.effects[0], id: 'e-anomaly', stat: 'anomalyDmgBonus', value: 75 },
      { ...two.effects[0], id: 'e-turbulence', stat: 'turbulenceDmgBonus', value: 75 },
    ]
    const many = toEffects(two)
    check('多效果卡片输出条数一致', many?.length === 2, String(many?.length))
    check('不把多选条件缩减为第一条', many?.[1]?.stat === 'turbulenceDmgBonus', String(many?.[1]?.stat))
  }
}

console.log('\n[5] 来源槽位：转模读卡片来源槽位，来源不可用算 0（§5.1 第 4 项、§5.2 第 6 项）')
{
  const { collectPanelBuffMods, invalidateBuffCatalogCache } = await import('../src/utils/panelBuffCalc.ts')
  const { makePanelCtx, testAgent, testSlot } = await import('./_effectPipelineHarness.mjs')
  const { createEmptyBuffEffect } = await import('../src/utils/buffEffect.ts')

  const convertCard = (sourceSlot) =>
    api.createExtraBuffGain({
      id: 'conv-src',
      name: '来源转模',
      applySlot: 'team',
      sourceSlot,
      effects: [
        createEmptyBuffEffect({
          id: 'conv-src-eff',
          kind: 'convert',
          stat: 'dmgBonus',
          value: 0,
          convert: {
            from: 'atk',
            panelSource: 'external',
            ratioPercent: 10,
            initialBase: 0,
            cap: null,
            defaultBase: null,
          },
        }),
      ],
    })

  invalidateBuffCatalogCache()
  const ctx = makePanelCtx({
    teamSlots: [testSlot('a'), testSlot('b')],
    agents: [testAgent('a'), testAgent('b')],
    extraGains: [convertCard(1)],
    panelSourceValuesBySlot: new Map([
      [0, { external: { atk: 1000 }, final: { atk: 1000 } }],
      [1, { external: { atk: 2000 }, final: { atk: 2000 } }],
    ]),
  })
  const withSource = collectPanelBuffMods(ctx).dmgBonus ?? 0
  check('来源槽位 2 攻击 2000 × 10% = 200（不吃主槽 1000）', withSource === 200, `实际 ${withSource}`)

  invalidateBuffCatalogCache()
  const emptySourceCtx = makePanelCtx({
    teamSlots: [testSlot('a'), testSlot('')],
    agents: [testAgent('a')],
    extraGains: [convertCard(1)],
    panelSourceValuesBySlot: new Map([[0, { external: { atk: 1000 }, final: { atk: 1000 } }]]),
  })
  const noSource = collectPanelBuffMods(emptySourceCtx).dmgBonus ?? 0
  check('来源槽位无角色 → 0，不回退受益槽位面板', noSource === 0, `实际 ${noSource}`)
}

console.log('\n[6] 选择器列表只列普通增益（§4.3 第 3 项、§5.1 第 6 项）')
{
  const { collectAllBuffEffects, excludeExtraGainEntries, invalidateBuffCatalogCache } = await import(
    '../src/utils/panelBuffCalc.ts'
  )
  const { makePanelCtx, testAgent, testSlot } = await import('./_effectPipelineHarness.mjs')
  const { createEmptyBuffEffect } = await import('../src/utils/buffEffect.ts')

  const card = api.createExtraBuffGain({
    id: 'picker-extra',
    name: '不该进选择器',
    applySlot: 'team',
    effects: [createEmptyBuffEffect({ id: 'picker-extra-eff', stat: 'atk', value: 10 })],
  })
  invalidateBuffCatalogCache()
  const ctx = makePanelCtx({
    teamSlots: [testSlot('a')],
    agents: [testAgent('a')],
    extraGains: [card],
  })
  const all = collectAllBuffEffects(ctx)
  const picker = excludeExtraGainEntries(all)
  check('收集结果里有额外 Buff', all.some((item) => item.sourceKey === 'extra-picker-extra'))
  check(
    '选择器列表里没有额外 Buff',
    !picker.some((item) => item.sourceKey === 'extra-picker-extra'),
  )
  check(
    '选择器列表其余条目数量不变',
    picker.length === all.length - 1,
    `${picker.length}/${all.length}`,
  )
}

console.log('\n[7] 同 id 卡片逐字段改动：缓存与清缓存结果一致（§7.2 第 21 项）')
{
  const { collectPanelBuffMods, invalidateBuffCatalogCache } = await import(
    '../src/utils/panelBuffCalc.ts'
  )
  const { makePanelCtx, testAgent, testSlot } = await import('./_effectPipelineHarness.mjs')
  const { createEmptyBuffEffect } = await import('../src/utils/buffEffect.ts')

  const baseEffect = {
    id: 'cache-eff',
    kind: 'fixed',
    stat: 'atk',
    value: 10,
  }
  /** 每次改动都造**新对象 + 新数组**（编辑器就是这么广播的） */
  const variants = [
    { label: '初始', card: { applySlot: 0, sourceSlot: 0 }, effect: {} },
    { label: '作用对象→全队', card: { applySlot: 'team', sourceSlot: 0 }, effect: {} },
    { label: '来源槽位→2', card: { applySlot: 'team', sourceSlot: 1 }, effect: {} },
    { label: '属性→增伤', card: { applySlot: 'team', sourceSlot: 1 }, effect: { stat: 'dmgBonus' } },
    {
      label: '招式限定→普攻',
      card: { applySlot: 'team', sourceSlot: 1 },
      effect: { stat: 'dmgBonus', skillTargets: [{ category: 'basic', subcategoryId: null }] },
    },
    {
      label: '人数档→2人',
      card: { applySlot: 'team', sourceSlot: 1 },
      effect: {
        stat: 'dmgBonus',
        skillTargets: [{ category: 'basic', subcategoryId: null }],
        teamProfession: '强攻',
        teamProfessionValues: [null, 0, null],
      },
    },
    {
      label: '小数层数→2.5',
      card: { applySlot: 'team', sourceSlot: 1 },
      effect: {
        kind: 'stacked',
        stat: 'dmgBonus',
        valuePerStack: 5,
        maxStacks: 5,
        defaultStacks: 2.5,
        skillTargets: [{ category: 'basic', subcategoryId: null }],
        teamProfession: '强攻',
        teamProfessionValues: [null, 0, null],
      },
    },
    {
      label: '转模比例→20%',
      card: { applySlot: 'team', sourceSlot: 1 },
      effect: {
        kind: 'convert',
        stat: 'dmgBonus',
        convert: {
          from: 'atk',
          panelSource: 'external',
          ratioPercent: 20,
          initialBase: 0,
          cap: null,
          defaultBase: null,
        },
      },
    },
  ]

  const results = []
  for (const variant of variants) {
    const card = api.createExtraBuffGain({
      id: 'cache-card',
      name: '缓存探针',
      applySlot: variant.card.applySlot,
      sourceSlot: variant.card.sourceSlot,
      effects: [createEmptyBuffEffect({ ...baseEffect, ...variant.effect })],
    })
    const makeCtx = () =>
      makePanelCtx({
        teamSlots: [testSlot('a'), testSlot('b')],
        agents: [testAgent('a'), testAgent('b')],
        mainSlotIndex: 0,
        extraGains: [card],
        panelSourceValues: { external: { atk: 2000 }, final: { atk: 2000 } },
      })

    invalidateBuffCatalogCache()
    const warm = collectPanelBuffMods(makeCtx())
    invalidateBuffCatalogCache()
    const cold = collectPanelBuffMods(makeCtx())
    const same =
      warm.atk === cold.atk && warm.dmgBonus === cold.dmgBonus
    check(`缓存命中与清缓存一致：${variant.label}`, same, `warm atk=${warm.atk} dmg=${warm.dmgBonus} / cold atk=${cold.atk} dmg=${cold.dmgBonus}`)
    results.push(`${warm.atk}/${warm.dmgBonus}`)
  }
  check('改动确实逐次生效（结果序列不是同一个值）', new Set(results).size > 3, results.join(' → '))
}

console.log('\n[8] 词条入口：卡片绑定评估主角槽位（§7.2 第 22 项、§5.3 第 2 项）')
{
  const { withAffixLibraryExtraGains } = await import('../src/utils/optimalAffixAlloc.ts')
  const { buildBuffCatalog } = await import('../src/utils/panelBuffCalc.ts')
  const { makePanelCtx, testAgent, testSlot, dummyBangboo } = await import(
    './_effectPipelineHarness.mjs'
  )
  const { createEmptyBuffEffect } = await import('../src/utils/buffEffect.ts')

  const card = api.createExtraBuffGain({
    id: 'affix-card',
    name: '词条增益',
    applySlot: 2,
    effects: [createEmptyBuffEffect({ id: 'affix-card-eff', stat: 'atk', value: 30 })],
  })
  const panelCtx = makePanelCtx({
    teamSlots: [testSlot('a'), testSlot('b'), testSlot('c')],
    agents: [testAgent('a'), testAgent('b'), testAgent('c')],
    mainSlotIndex: 1,
    extraGains: [],
  })
  // 词条评估上下文是 { panelContext, skillContext, ... }：只取它需要的两段
  const bound = withAffixLibraryExtraGains(
    { panelContext: { ...panelCtx }, skillContext: panelCtx.skillContext },
    [card],
  )
  check('词条卡片绑定评估主角槽位', bound.extraGains[0]?.applySlot, 1)
  const entries = buildBuffCatalog({
    teamSlots: panelCtx.teamSlots,
    agents: panelCtx.agents,
    wengines: [],
    driveDiscs: [],
    bangboo: dummyBangboo(),
    bangbooRefine: 1,
    environmentBuffs: [],
    extraGains: bound.extraGains,
  }).entries.filter((entry) => entry.sourceKey === 'extra-affix-card')
  check('词条卡片按评估主角槽位生效', JSON.stringify(entries[0]?.applicableSlots), '[1]')
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
