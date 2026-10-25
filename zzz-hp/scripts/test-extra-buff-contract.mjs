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
    id: 'affix-gain:test',
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
  check('词条卡片绑定评估主角槽位', bound.extraGains[0]?.applySlot === 1, String(bound.extraGains[0]?.applySlot))
  const entries = buildBuffCatalog({
    teamSlots: panelCtx.teamSlots,
    agents: panelCtx.agents,
    wengines: [],
    driveDiscs: [],
    bangboo: dummyBangboo(),
    bangbooRefine: 1,
    environmentBuffs: [],
    extraGains: bound.extraGains,
  }).entries.filter((entry) => entry.sourceKey === 'extra-affix-gain:test')
  check('词条卡片按评估主角槽位生效', JSON.stringify(entries[0]?.applicableSlots) === '[1]', JSON.stringify(entries[0]?.applicableSlots))

console.log('\n[9] §7.2 第 1–12 项：固定夹具（甲/乙/丙，局外攻击 1000/2000/3000）')
{
  const { collectPanelBuffMods, computeFinalPanel, buildBuffCatalog } = await import('../src/utils/panelBuffCalc.ts')
  const { makePanelCtx, makePanel, testAgent, testSlot, dummyBangboo } = await import('./_effectPipelineHarness.mjs')
  const { createEmptyBuffEffect } = await import('../src/utils/buffEffect.ts')

  const jia = testAgent('a', { profession: '强攻', element: '电', name: '甲' })
  const yi = testAgent('b', { profession: '支援', element: '火', name: '乙' })
  const bing = testAgent('c', { profession: '支援', element: '冰', name: '丙' })
  const slots = [testSlot('a'), testSlot('b'), testSlot('c')]
  const agents = [jia, yi, bing]
  const ctxFor = (mainSlotIndex, extraGains, extra = {}) =>
    makePanelCtx({ teamSlots: slots, agents, mainSlotIndex, extraGains, ...extra })
  const mk = (id, effect = {}, card = {}) =>
    api.createExtraBuffGain({
      id,
      name: id,
      applySlot: card.applySlot ?? 0,
      sourceSlot: card.sourceSlot ?? 0,
      effects: [createEmptyBuffEffect({ id: `${id}-e`, stat: 'atk', kind: 'fixed', value: 50, ...effect })],
    })
  const atkOf = (mainSlotIndex, extraGains, extra) =>
    collectPanelBuffMods(ctxFor(mainSlotIndex, extraGains, extra)).atk ?? 0
  const near = (a, b) => Math.abs(a - b) < 1e-6

  // 1. 固定值
  {
    const g = mk('p1')
    check('#1 甲增量 50', near(atkOf(0, [g]), 50), String(atkOf(0, [g])))
    const finalAtk = computeFinalPanel(makePanel({ atk: 1000 }), ctxFor(0, [g])).finalPanel.atk
    check('#1 最终攻击 1050', near(finalAtk, 1050), String(finalAtk))
    check('#1 乙/丙 0', near(atkOf(1, [g]), 0) && near(atkOf(2, [g]), 0))
  }

  // 2. 受益槽位
  {
    const slot2 = mk('p2', {}, { applySlot: 1 })
    check('#2 目标槽位2：0/50/0',
      near(atkOf(0, [slot2]), 0) && near(atkOf(1, [slot2]), 50) && near(atkOf(2, [slot2]), 0))
    const team = mk('p2t', {}, { applySlot: 'team' })
    check('#2 全队：50/50/50',
      near(atkOf(0, [team]), 50) && near(atkOf(1, [team]), 50) && near(atkOf(2, [team]), 50))
  }

  // 3. 槽位换人：只认 applySlot，不跟随具体角色
  {
    const swapped = testAgent('d', { profession: '强攻', element: '电', name: '丁' })
    const card = mk('p3', {}, { applySlot: 1 })
    const catalog = buildBuffCatalog({
      teamSlots: [testSlot('a'), testSlot('d')],
      agents: [jia, swapped],
      wengines: [],
      driveDiscs: [],
      bangboo: dummyBangboo(),
      bangbooRefine: 1,
      environmentBuffs: [],
      extraGains: [card],
    }).entries.filter((entry) => entry.sourceKey === 'extra-p3')
    check('#3 换人后仍为槽位 2', JSON.stringify(catalog[0]?.applicableSlots) === '[1]', JSON.stringify(catalog[0]?.applicableSlots))
    const newAgentsCtx = makePanelCtx({
      teamSlots: [testSlot('a'), testSlot('d')],
      agents: [jia, swapped],
      mainSlotIndex: 1,
      extraGains: [mk('p3b', {}, { applySlot: 1 })],
    })
    check('#3 丁得到 +50', near(collectPanelBuffMods(newAgentsCtx).atk ?? 0, 50), String(collectPanelBuffMods(newAgentsCtx).atk))
  }

  // 4. 叠层
  {
    const stacked = (id, over) =>
      mk(id, { kind: 'stacked', value: 50, valuePerStack: 10, maxStacks: 5, ...over })
    check('#4 默认 3 层 → 30', near(atkOf(0, [stacked('p4a', { defaultStacks: 3 })]), 30), String(atkOf(0, [stacked('p4b', { defaultStacks: 3 })])))
    check('#4 默认 1.33 层 → 13.3', near(atkOf(0, [stacked('p4c', { defaultStacks: 1.33 })]), 13.3))
    check(
      '#4 选择器残留层数 4 不改变结果',
      near(atkOf(0, [stacked('p4d', { defaultStacks: 1.33 })], { buffSelection: { enabledIds: {}, stacksByEffectId: { 'p4d-e': 4 }, convertInputs: {} } }), 13.3),
    )
    check(
      '#4 行级 1.66 层 → 16.6',
      near(atkOf(0, [stacked('p4e', { defaultStacks: 1.33 })], { rowBuffOverride: { stacksByEffectId: { 'p4e-e': 1.66 } } }), 16.6),
    )
    check(
      '#4 行级 8 层 → 夹到 5 层 = 50',
      near(atkOf(0, [stacked('p4f', { defaultStacks: 1.33 })], { rowBuffOverride: { stacksByEffectId: { 'p4f-e': 8 } } }), 50),
    )
  }

  // 5. 手动转模
  {
    const manual = (id, over) =>
      mk(id, {
        kind: 'convert',
        value: 0,
        convert: { from: 'atk', panelSource: 'manual', ratioPercent: 10, initialBase: 0, cap: null, defaultBase: null, ...over },
      })
    check('#5 defaultBase 1000 ×10% → 100', near(atkOf(0, [manual('p5a', { defaultBase: 1000 })]), 100))
    check('#5 initialBase 200 / cap 60 → 60', near(atkOf(0, [manual('p5b', { initialBase: 200, cap: 60, defaultBase: 1000 })]), 60))
    check('#5 defaultBase 100 < initialBase 200 → 0', near(atkOf(0, [manual('p5c', { defaultBase: 100, initialBase: 200 })]), 0))
  }

  // 6. 外部来源与受益对象分离
  {
    const srcCtx = { panelSourceValuesBySlot: new Map([[1, { external: { atk: 2000 }, final: { atk: 2000 } }]]) }
    const external = (id, card) =>
      mk(id, { kind: 'convert', value: 0, convert: { from: 'atk', panelSource: 'external', ratioPercent: 10, initialBase: 0, cap: null, defaultBase: null } }, card)
    check('#6 受益槽位1（甲）→ 200', near(atkOf(0, [external('p6a', { applySlot: 0, sourceSlot: 1 })], srcCtx), 200))
    check('#6 受益槽位2 → 200', near(atkOf(1, [external('p6b', { applySlot: 1, sourceSlot: 1 })], srcCtx), 200))
    check(
      '#6 全队 → 三人都 200（不是 100/200/300）',
      near(atkOf(0, [external('p6c', { applySlot: 'team', sourceSlot: 1 })], srcCtx), 200) &&
        near(atkOf(1, [external('p6d', { applySlot: 'team', sourceSlot: 1 })], srcCtx), 200) &&
        near(atkOf(2, [external('p6e', { applySlot: 'team', sourceSlot: 1 })], srcCtx), 200),
    )
  }

  // 7. 非转模局内来源（final）
  {
    const finalCtx = { panelSourceValuesBySlot: new Map([[1, { external: { atk: 2000 }, final: { atk: 2500 } }]]) }
    const conv = (id, source) =>
      mk(id, { kind: 'convert', value: 0, convert: { from: 'atk', panelSource: source, ratioPercent: 10, initialBase: 0, cap: null, defaultBase: null } }, { applySlot: 1, sourceSlot: 1 })
    check('#7 final 2500 ×10% → 250', near(atkOf(1, [conv('p7a', 'final')], finalCtx), 250))
    check('#7 改读 external → 200', near(atkOf(1, [conv('p7b', 'external')], finalCtx), 200))
  }

  // 8. 来源换人 / 空槽
  {
    const srcCtx = { panelSourceValuesBySlot: new Map([[1, { external: { atk: 4000 }, final: { atk: 4000 } }]]) }
    const conv = (id, sourceSlot) =>
      mk(id, { kind: 'convert', value: 0, convert: { from: 'atk', panelSource: 'external', ratioPercent: 10, initialBase: 0, cap: null, defaultBase: null } }, { applySlot: 1, sourceSlot })
    check('#8 来源 4000 ×10% → 400', near(atkOf(1, [conv('p8a', 1)], srcCtx), 400))
    const emptyCtx = {
      teamSlots: [testSlot('a'), testSlot('')],
      agents: [jia],
      mainSlotIndex: 1,
      panelSourceValuesBySlot: new Map(),
    }
    check('#8 清空来源槽位 → 0（不回退甲）', near(atkOf(1, [conv('p8b', 1)], emptyCtx), 0))
  }

  // 9. 技能等级来源
  {
    const levels = {
      a: { basic: 6, dodge: 6, assist: 6, special: 6, chainUltimate: 6 },
      b: { basic: 12, dodge: 12, assist: 12, special: 12, chainUltimate: 12 },
    }
    const g = mk('p9', { kind: 'convert', value: 0, convert: { from: 'skillLevelBasic', panelSource: 'external', ratioPercent: 10, initialBase: 0, cap: null, defaultBase: null } }, { applySlot: 0, sourceSlot: 1 })
    check('#9 来源槽位普攻等级 12 → 1.2', near(atkOf(0, [g], { skillTalentLevelsByAgent: levels }), 1.2), String(atkOf(0, [g], { skillTalentLevelsByAgent: levels })))
  }

  // 10. 属性限定
  {
    const fire = mk('p10', { elementFilter: ['火'] }, { applySlot: 'team' })
    check('#10 火限定：0/50/0',
      near(atkOf(0, [fire]), 0) && near(atkOf(1, [fire]), 50) && near(atkOf(2, [fire]), 0))
  }

  // 11. 伤害类型
  {
    const types = mk('p11', { conditions: { damageTypes: ['normal', 'anomalyRelease'] } })
    const anomalyCtx = (sub) => ({ skillContext: { damageKind: 'anomaly', anomalySubKind: sub, categoryId: 'basic', subcategoryId: null, coords: [{ category: 'basic', subcategoryId: null }], element: '电', staggerPhase: 'stagger', isFollowUp: false } })
    check('#11 普通直伤 50', near(atkOf(0, [types]), 50))
    check('#11 异放 50', near(atkOf(0, [types], anomalyCtx('anomalyRelease')), 50))
    check('#11 乱流 0', near(atkOf(0, [types], anomalyCtx('turbulence')), 0))
    const all = mk('p11b', { conditions: null })
    check('#11 空类型条件：三者都 50',
      near(atkOf(0, [all]), 50) && near(atkOf(0, [all], anomalyCtx('anomalyRelease')), 50) && near(atkOf(0, [all], anomalyCtx('turbulence')), 50))
  }

  // 12. 招式多选
  {
    const twoTargets = mk('p12', {
      stat: 'skillDmgBonus',
      value: 30,
      skillTargets: [{ category: 'basic', subcategoryId: null }, { category: 'ultimate', subcategoryId: null }],
    })
    const catCtx = (category) => ({ skillContext: { damageKind: 'direct', categoryId: category, subcategoryId: null, coords: [{ category, subcategoryId: null }], element: '电', staggerPhase: 'stagger', isFollowUp: false } })
    const skillOf = (extra, ctx) => collectPanelBuffMods(ctxFor(0, [twoTargets], { ...ctx, ...extra })).skillDmgBonus ?? 0
    check('#12 普攻 30', near(skillOf({}, catCtx('basic')), 30))
    check('#12 终结技 30', near(skillOf({}, catCtx('ultimate')), 30))
    check('#12 特殊技 0', near(skillOf({}, catCtx('special')), 0))
    const oneTarget = mk('p12b', { stat: 'skillDmgBonus', value: 30, skillTargets: [{ category: 'basic', subcategoryId: null }] })
    check('#12 删除第二项后终结技 0', near(collectPanelBuffMods(ctxFor(0, [oneTarget], { skillContext: catCtx('ultimate').skillContext })).skillDmgBonus ?? 0, 0))
    const anomalyWithBasic = { skillContext: { damageKind: 'anomaly', anomalySubKind: 'anomaly', categoryId: 'basic', subcategoryId: null, coords: [{ category: 'basic', subcategoryId: null }], element: '电', staggerPhase: 'stagger', isFollowUp: false } }
    check('#12 异常坐标未勾异常生效 → 0', near(collectPanelBuffMods(ctxFor(0, [oneTarget], anomalyWithBasic)).skillDmgBonus ?? 0, 0))
    const anomOn = mk('p12c', { stat: 'skillDmgBonus', value: 30, skillTargets: [{ category: 'basic', subcategoryId: null }], appliesToAnomaly: true })
    check('#12 勾选后 → 30', near(collectPanelBuffMods(ctxFor(0, [anomOn], anomalyWithBasic)).skillDmgBonus ?? 0, 30))
    const anomSpecial = { skillContext: { damageKind: 'anomaly', anomalySubKind: 'anomaly', categoryId: 'special', subcategoryId: null, coords: [{ category: 'special', subcategoryId: null }], element: '电', staggerPhase: 'stagger', isFollowUp: false } }
    check('#12 特殊技坐标即使勾选仍 0', near(collectPanelBuffMods(ctxFor(0, [anomOn], anomSpecial)).skillDmgBonus ?? 0, 0))
  }

  // 17. 行级参数：行覆盖 > 卡片默认值；选择器残留不参与（§5.1 第 6 项、§7.2 第 17 项）
  {
    const manualCard = mk('p17a', {
      kind: 'convert',
      value: 0,
      convert: { from: 'atk', panelSource: 'manual', ratioPercent: 10, initialBase: 0, cap: null, defaultBase: 1000 },
    })
    check('#17 手动转模全局 100', near(atkOf(0, [manualCard]), 100), String(atkOf(0, [manualCard])))
    check(
      '#17 选择器残留输入 2000 不参与 → 仍 100',
      near(
        atkOf(0, [manualCard], {
          buffSelection: { enabledIds: {}, stacksByEffectId: {}, convertInputs: { 'p17a-e': 2000 } },
        }),
        100,
      ),
    )
    check(
      '#17 A 行基数 3000 → 300',
      near(
        atkOf(0, [manualCard], { rowBuffOverride: { convertInputsByEffectId: { 'p17a-e': 3000 } } }),
        300,
      ),
      String(atkOf(0, [manualCard], { rowBuffOverride: { convertInputsByEffectId: { 'p17a-e': 3000 } } })),
    )

    const srcCtx17 = { panelSourceValuesBySlot: new Map([[1, { external: { atk: 2000 }, final: { atk: 2000 } }]]) }
    const externalCard = mk('p17b', {
      kind: 'convert',
      value: 0,
      convert: { from: 'atk', panelSource: 'external', ratioPercent: 10, initialBase: 0, cap: null, defaultBase: null },
    }, { applySlot: 0, sourceSlot: 1 })
    check('#17 外部来源 B 行（无覆盖）→ 200', near(atkOf(0, [externalCard], srcCtx17), 200))
    check(
      '#17 外部来源 A 行覆盖 3000 → 300（普通属性行覆盖仍生效）',
      near(
        atkOf(0, [externalCard], {
          ...srcCtx17,
          rowBuffOverride: { convertInputsByEffectId: { 'p17b-e': 3000 } },
        }),
        300,
      ),
    )
    const emptySource17 = {
      teamSlots: [testSlot('a'), testSlot('')],
      agents: [jia],
      mainSlotIndex: 0,
      panelSourceValuesBySlot: new Map(),
    }
    check(
      '#17 清空来源槽位 + A 行覆盖 → A 300',
      near(
        atkOf(0, [externalCard], {
          ...emptySource17,
          rowBuffOverride: { convertInputsByEffectId: { 'p17b-e': 3000 } },
        }),
        300,
      ),
    )
    check('#17 清空来源槽位、无覆盖 → 0', near(atkOf(0, [externalCard], emptySource17), 0))

    const skillLevels17 = {
      a: { basic: 6, dodge: 6, assist: 6, special: 6, chainUltimate: 6 },
      b: { basic: 12, dodge: 12, assist: 12, special: 12, chainUltimate: 12 },
    }
    const skillCard = mk('p17c', {
      kind: 'convert',
      value: 0,
      convert: { from: 'skillLevelBasic', panelSource: 'external', ratioPercent: 10, initialBase: 0, cap: null, defaultBase: null },
    }, { applySlot: 0, sourceSlot: 1 })
    check(
      '#17 非手动技能等级 + 行覆盖 3000 → 仍 1.2（共享规则忽略覆盖）',
      near(
        atkOf(0, [skillCard], {
          skillTalentLevelsByAgent: skillLevels17,
          rowBuffOverride: { convertInputsByEffectId: { 'p17c-e': 3000 } },
        }),
        1.2,
      ),
      String(atkOf(0, [skillCard], { skillTalentLevelsByAgent: skillLevels17, rowBuffOverride: { convertInputsByEffectId: { 'p17c-e': 3000 } } })),
    )
  }

  // 16. 行级写回结构：整块禁用后只恢复一条（§5.1 第 10 项、§7.2 第 16 项）
  {
    const { setFlowBuffEffectDisabled } = await import('../src/utils/flowBuffTable.ts')
    const blockKey = 'extra-写回卡'
    const makeEntry = () => ({
      id: 'entry-a',
      buffOverrides: {
        disabledBlockIds: [blockKey],
        disabledEffectIds: [],
        stacksByEffectId: { 'wb-anomaly': 2 },
        convertInputsByEffectId: { 'wb-turbulence': 3 },
      },
    })
    const entry = makeEntry()
    setFlowBuffEffectDisabled({
      entry,
      effectId: 'wb-anomaly',
      blockKey,
      siblingEffectIds: ['wb-anomaly', 'wb-turbulence'],
      disabled: false,
    })
    const after = entry.buffOverrides
    check('#16 恢复一条后不再有块级禁用', JSON.stringify(after.disabledBlockIds), '[]')
    check('#16 同块其它效果保留为单条禁用', JSON.stringify(after.disabledEffectIds), '["wb-turbulence"]')
    check('#16 层数覆盖保留', JSON.stringify(after.stacksByEffectId), '{"wb-anomaly":2}')
    check('#16 转模覆盖保留', JSON.stringify(after.convertInputsByEffectId), '{"wb-turbulence":3}')

    // 对等普通增益走同一个函数 → 结构相同（额外 Buff 没有专属恢复规则）
    const normalEntry = { ...makeEntry(), id: 'entry-normal' }
    setFlowBuffEffectDisabled({
      entry: normalEntry,
      effectId: 'wb-anomaly',
      blockKey,
      siblingEffectIds: ['wb-anomaly', 'wb-turbulence'],
      disabled: false,
    })
    check(
      '#16 与普通增益写回结构一致',
      JSON.stringify(normalEntry.buffOverrides) === JSON.stringify(after),
      JSON.stringify(normalEntry.buffOverrides),
    )
  }
}

console.log('\n[10] §7.2 第 20 项：零值边界与共享归一化判定一致')
{
  const { createEmptyBuffEffect } = await import('../src/utils/buffEffect.ts')
  const build = (effectOverrides, cardId = 'zero-card') => ({
    id: cardId,
    name: '零值探针',
    applySlot: 0,
    sourceSlot: 0,
    effects: [createEmptyBuffEffect({ id: `${cardId}-e`, ...effectOverrides })],
  })
  const countOf = (card) => {
    const result = api.normalizeExtraGains([card])
    return { n: result.gains.length, d: result.discardedCount }
  }

  const zeroAnomalyMult = countOf(build({ stat: 'anomalyMultFactor', kind: 'fixed', value: 0 }, 'zero-a'))
  check('#20 anomalyMultFactor 固定 0 → 丢弃 1', zeroAnomalyMult.n === 0 && zeroAnomalyMult.d === 1, JSON.stringify(zeroAnomalyMult))
  const zeroStacked = countOf(build({ stat: 'anomalyMultFactor', kind: 'stacked', valuePerStack: 0 }, 'zero-b'))
  check('#20 anomalyMultFactor 叠层每层 0 → 丢弃 1', zeroStacked.n === 0 && zeroStacked.d === 1, JSON.stringify(zeroStacked))
  const zeroAtk = countOf(build({ stat: 'atk', kind: 'fixed', value: 0 }, 'zero-c'))
  check('#20 atk 固定 0 → 保留', zeroAtk.n === 1 && zeroAtk.d === 0, JSON.stringify(zeroAtk))
  const convertKept = countOf(
    build(
      {
        stat: 'anomalyMultFactor',
        kind: 'convert',
        value: 0,
        convert: { from: 'atk', panelSource: 'external', ratioPercent: 10, initialBase: 0, cap: null, defaultBase: null },
      },
      'zero-d',
    ),
  )
  check('#20 anomalyMultFactor 转模 0 → 保留', convertKept.n === 1 && convertKept.d === 0, JSON.stringify(convertKept))
  const stackedDefaultZero = countOf(
    build({ stat: 'anomalyMultFactor', kind: 'stacked', valuePerStack: 10, defaultStacks: 0 }, 'zero-e'),
  )
  check('#20 anomalyMultFactor 叠层默认 0 层 → 保留', stackedDefaultZero.n === 1 && stackedDefaultZero.d === 0, JSON.stringify(stackedDefaultZero))
  const onePercent = countOf(build({ stat: 'anomalyMultFactor', kind: 'fixed', value: 1 }, 'zero-f'))
  check('#20 anomalyMultFactor 固定 1 → 归零后丢弃', onePercent.n === 0 && onePercent.d === 1, JSON.stringify(onePercent))
}

console.log('\n[11] §7.2 第 19 项：未规范化输入的允许变化与必须保留')
{
  const { createEmptyBuffEffect, setEffectSkillTargets } = await import('../src/utils/buffEffect.ts')
  const card = (effects, id = 'unnorm-card') => ({ id, name: '未规范化', applySlot: 0, sourceSlot: 0, effects })
  const stable = (value) =>
    Array.isArray(value)
      ? `[${value.map(stable).join(',')}]`
      : value && typeof value === 'object'
        ? `{${Object.keys(value)
            .filter((key) => value[key] !== undefined)
            .sort()
            .map((key) => `${key}:${stable(value[key])}`)
            .join(',')}}`
        : JSON.stringify(value ?? null)

  // 叠层：保存的冗余 value 保留，恢复后清零，其余参数与身份不变
  {
    const effect = createEmptyBuffEffect({
      id: 'unnorm-e',
      kind: 'stacked',
      stat: 'atk',
      value: 50,
      valuePerStack: 10,
      defaultStacks: 1.33,
      maxStacks: 5,
    })
    const input = card([effect])
    const saved = api.serializeExtraGains([input])
    check('#19 保存时叠层冗余 value 仍为 50', saved[0].effects[0].value === 50, String(saved[0].effects[0].value))
    const restored = api.normalizeExtraGains(JSON.parse(JSON.stringify(saved)))
    check('#19 恢复后 value 归零', restored.gains[0]?.effects[0]?.value === 0, String(restored.gains[0]?.effects[0]?.value))
    check(
      '#19 每层值/默认层数/上限保留',
      restored.gains[0]?.effects[0]?.valuePerStack === 10 &&
        restored.gains[0]?.effects[0]?.defaultStacks === 1.33 &&
        restored.gains[0]?.effects[0]?.maxStacks === 5,
      JSON.stringify({
        v: restored.gains[0]?.effects[0]?.valuePerStack,
        d: restored.gains[0]?.effects[0]?.defaultStacks,
        m: restored.gains[0]?.effects[0]?.maxStacks,
      }),
    )
    check('#19 卡片与效果 id 不变', restored.gains[0]?.id === 'unnorm-card' && restored.gains[0]?.effects[0]?.id === 'unnorm-e')
    check('#19 原输入对象不被修改（value 仍 50）', input.effects[0].value === 50)
  }

  // 转模：冗余 value 清零，convert 全参数保留
  {
    const effect = createEmptyBuffEffect({
      id: 'unnorm-conv-e',
      kind: 'convert',
      stat: 'dmgBonus',
      value: 50,
      convert: { from: 'atk', panelSource: 'external', ratioPercent: 12, initialBase: 3, cap: 80, defaultBase: null },
    })
    const restored = api.normalizeExtraGains(JSON.parse(JSON.stringify(api.serializeExtraGains([card([effect], 'unnorm-conv')]))))
    check('#19 转模恢复后 value 归零', restored.gains[0]?.effects[0]?.value === 0)
    check(
      '#19 转模参数完整保留',
      stable(restored.gains[0]?.effects[0]?.convert) ===
        stable({ from: 'atk', panelSource: 'external', ratioPercent: 12, initialBase: 3, cap: 80, defaultBase: null }),
      stable(restored.gains[0]?.effects[0]?.convert),
    )
  }

  // 异常子类：冗余 conditions 被移除，stat/值/身份保持
  {
    const effect = createEmptyBuffEffect({
      id: 'unnorm-anomaly-e',
      kind: 'fixed',
      stat: 'anomalyDmgBonus',
      value: 75,
      conditions: { damageTypes: ['normal'] },
    })
    const restored = api.normalizeExtraGains(JSON.parse(JSON.stringify(api.serializeExtraGains([card([effect], 'unnorm-anomaly')]))))
    const got = restored.gains[0]?.effects[0]
    check('#19 异常子类冗余条件被移除', got?.conditions == null, JSON.stringify(got?.conditions))
    check('#19 异常子类 stat/值/身份保持', got?.stat === 'anomalyDmgBonus' && got?.value === 75 && got?.id === 'unnorm-anomaly-e')
  }

  // 招式多选：兼容字段与 skillTargets 一并保留
  {
    const effect = createEmptyBuffEffect({ id: 'unnorm-skill-e', stat: 'skillDmgBonus', value: 30 })
    setEffectSkillTargets(effect, [
      { category: 'basic', subcategoryId: null },
      { category: 'ultimate', subcategoryId: null },
    ])
    const restored = api.normalizeExtraGains(JSON.parse(JSON.stringify(api.serializeExtraGains([card([effect], 'unnorm-skill')]))))
    const got = restored.gains[0]?.effects[0]
    check('#19 两项招式目标保留', got?.skillTargets?.length === 2, JSON.stringify(got?.skillTargets))
    check(
      '#19 共享生成的兼容字段一并保留',
      got?.skillCategory === effect.skillCategory && got?.skillSubcategoryId === effect.skillSubcategoryId,
      JSON.stringify({ cat: got?.skillCategory, sub: got?.skillSubcategoryId }),
    )
  }

  // 身份缺省：效果缺 id → 共享归一化生成非空 id，卡保留，下一次保存沿用
  {
    const raw = { id: 'unnorm-noid', name: '缺效果 id', applySlot: 0, sourceSlot: 0, effects: [{ stat: 'atk', kind: 'fixed', value: 50 }] }
    const first = api.normalizeExtraGains([raw])
    const generated = first.gains[0]?.effects[0]?.id
    check('#19 缺效果 id → 生成非空 id 且保留卡片', first.gains.length === 1 && !!generated, String(generated))
    const second = api.normalizeExtraGains(JSON.parse(JSON.stringify(api.serializeExtraGains(first.gains))))
    check('#19 下一次保存恢复沿用生成的 id', second.gains[0]?.effects[0]?.id === generated, String(second.gains[0]?.effects[0]?.id))
  }
}
}

console.log('\n[12] §7.2 第 18/21 项：只施加一次、页级与词条增益共存')
{
  const {
    collectAllBuffEffects,
    collectPanelBuffMods,
    computeFinalPanel,
    buildBuffCatalog,
  } = await import('../src/utils/panelBuffCalc.ts')
  const { makePanelCtx, makePanel, testAgent, testSlot, dummyBangboo } = await import(
    './_effectPipelineHarness.mjs'
  )
  const { createEmptyBuffEffect } = await import('../src/utils/buffEffect.ts')
  const near = (a, b) => Math.abs(a - b) < 1e-6

  const agents = [testAgent('a')]
  const slots = [testSlot('a')]
  const fixedCard = (id, effectId, value = 50) =>
    api.createExtraBuffGain({
      id,
      name: id,
      applySlot: 0,
      effects: [createEmptyBuffEffect({ id: effectId, stat: 'atk', value })],
    })
  const ctxOf = (gains) =>
    makePanelCtx({ teamSlots: slots, agents, mainSlotIndex: 0, extraGains: gains })
  const finalAtk = (gains) =>
    computeFinalPanel(makePanel({ atk: 1000 }), ctxOf(gains)).finalPanel.atk

  const one = fixedCard('once-a', 'once-a-e')
  check('#18 一张卡：最终攻击 1050', near(finalAtk([one]), 1050), String(finalAtk([one])))
  const two = [one, fixedCard('once-b', 'once-b-e')]
  check('#18 两张同配置卡：1100', near(finalAtk(two), 1100), String(finalAtk(two)))
  check('#18 删掉一张回到 1050', near(finalAtk([two[1]]), 1050), String(finalAtk([two[1]])))
  check(
    '#18 收集里每条效果只出现一次',
    collectAllBuffEffects(ctxOf(two)).filter((item) => item.sourceKey.startsWith('extra-')).length === 2,
  )

  // 第 21 项：页级增益与词条增益共存，各算一次
  const pageCard = fixedCard('coexist-page', 'coexist-page-e', 10)
  const affixCard = api.createExtraBuffGain({
    id: 'affix-gain:coexist',
    name: '词条增益',
    applySlot: 0,
    effects: [createEmptyBuffEffect({ id: 'affix-gain:coexist-e', stat: 'atk', value: 20 })],
  })
  const coexistMods = collectPanelBuffMods(ctxOf([pageCard, affixCard])).atk ?? 0
  check('#21 页级 10 + 词条 20 各算一次 = 30', near(coexistMods, 30), String(coexistMods))
  const coexistEntries = buildBuffCatalog({
    teamSlots: slots,
    agents,
    wengines: [],
    driveDiscs: [],
    bangboo: dummyBangboo(),
    bangbooRefine: 1,
    environmentBuffs: [],
    extraGains: [pageCard, affixCard],
  }).entries.filter((entry) => entry.sourceKey.startsWith('extra-'))
  check('#21 两条卡片各出一列（不合并）', coexistEntries.length === 2, String(coexistEntries.length))
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
