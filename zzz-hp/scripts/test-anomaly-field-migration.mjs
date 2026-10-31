/**
 * 属性异常口径统一：旧个人数据 / 历史工具说明转换回归（Spec §7 C6、C8）。
 *
 * 覆盖：
 * - 面板字段、增益 `stat`、词条目标 `panel:`/`gain:`、效果模板 `spec.stat`/`legacyTarget`；
 * - 子类类型值 `anomaly` → `attributeAnomaly`，类级 `damageKind` / `modeType` 保持 `anomaly`；
 * - 方案包覆盖/合并导入、词条库导入、自建招式、旧自建事件模式、流程伤害记录；
 * - 新值优先（含新值为 0）、旧键移除、重复转换幂等；
 * - 历史工具生成行 `属性=` 槽位改名，原文与自由备注不动。
 *
 * 运行：npx --no-install vite-node scripts/test-anomaly-field-migration.mjs
 */

// localStorage 桩必须在导入被测模块前装好
const memory = new Map()
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  key: (index) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size
  },
}

const {
  ATTRIBUTE_ANOMALY_FIELD_RENAMES,
  migrateAttributeAnomalyFieldKeys,
  migrateAttributeAnomalyNamingDeep,
  migrateAttributeAnomalyNoteText,
  migrateAttributeAnomalyTargetString,
  migrateAttributeAnomalyTypeValue,
} = await import('../src/utils/attributeAnomalyMigration.ts')
const { createEmptyExternalPanel } = await import('../src/types/calculatorPanel.ts')
const { normalizeBuffEffect } = await import('../src/utils/buffEffect.ts')
const { computeDamageResult } = await import('../src/utils/damageCalc.ts')
const { parseAffixEffectTemplate } = await import('../src/utils/affixEffectTemplate.ts')
const { importAffixLibrarySet, createDefaultAffixLibraryStore } = await import('../src/utils/affixLibrary.ts')
const { importDamageCalcHistory } = await import('../src/utils/damageCalcHistory.ts')
const { skillFingerprint } = await import('../src/utils/schemePack.ts')
const { parseCustomSkillList } = await import('../src/utils/skillLibrary.ts')
const { loadCustomModes } = await import('../src/utils/customDamageEventModes.ts')
const { loadSkillFlowDamageRecords } = await import('../src/utils/skillFlowDamageRecords.ts')

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
const same = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `实际 ${JSON.stringify(actual)}`)

/** 旧格式局外面板快照（不含新键） */
function legacyPanelSnapshot() {
  const panel = { ...createEmptyExternalPanel() }
  for (const key of Object.values(ATTRIBUTE_ANOMALY_FIELD_RENAMES)) delete panel[key]
  panel.atk = 2000
  panel.anomalyDmgBonus = 30
  panel.anomalyCritRate = 20
  panel.anomalyCritDmg = 50
  panel.anomalyMult = 100
  panel.anomalyMultFactor = 100
  return panel
}

/* ===================== C6：英文改名与旧个人数据 ===================== */
console.log('\n[C6-1] 面板字段：旧键搬到新键')
{
  // 真实旧存档里没有新键：先摘掉新键，再写旧键
  const legacyPanel = { ...createEmptyExternalPanel() }
  for (const key of Object.values(ATTRIBUTE_ANOMALY_FIELD_RENAMES)) delete legacyPanel[key]
  legacyPanel.anomalyDmgBonus = 30
  legacyPanel.anomalyCritRate = 20
  legacyPanel.anomalyCritDmg = 50
  legacyPanel.anomalyMult = 100
  legacyPanel.anomalyMultFactor = 100
  const migrated = migrateAttributeAnomalyNamingDeep(legacyPanel)
  check('五个新键取值 30/20/50/100/100',
    migrated.attributeAnomalyDmgBonus === 30 &&
      migrated.attributeAnomalyCritRate === 20 &&
      migrated.attributeAnomalyCritDmg === 50 &&
      migrated.attributeAnomalyMult === 100 &&
      migrated.attributeAnomalyMultFactor === 100,
    JSON.stringify([migrated.attributeAnomalyDmgBonus, migrated.attributeAnomalyCritRate, migrated.attributeAnomalyCritDmg, migrated.attributeAnomalyMult, migrated.attributeAnomalyMultFactor]))
  const leftovers = Object.keys(migrated).filter((key) => key in ATTRIBUTE_ANOMALY_FIELD_RENAMES)
  check('不残留旧键', leftovers.length === 0, leftovers.join(','))

  // 新值优先（含 0），不相加
  const both = migrateAttributeAnomalyFieldKeys({ anomalyDmgBonus: 30, attributeAnomalyDmgBonus: 20 })
  same('新键已存在 → 保留新值 20（不相加）', both, { attributeAnomalyDmgBonus: 20 })
  const zeroNew = migrateAttributeAnomalyFieldKeys({ anomalyDmgBonus: 30, attributeAnomalyDmgBonus: 0 })
  same('新值为 0 也保留（不回退旧值）', zeroNew, { attributeAnomalyDmgBonus: 0 })
  const onlyNew = migrateAttributeAnomalyFieldKeys({ attributeAnomalyDmgBonus: 20 })
  same('已转换对象再转一次不变', migrateAttributeAnomalyNamingDeep(migrateAttributeAnomalyNamingDeep(onlyNew)), { attributeAnomalyDmgBonus: 20 })
  same('连续转换三次仍稳定', migrateAttributeAnomalyNamingDeep(migrateAttributeAnomalyNamingDeep(migrateAttributeAnomalyNamingDeep({ anomalyDmgBonus: 30 }))), { attributeAnomalyDmgBonus: 30 })
  check('转换不就地修改入参', (() => {
    const source = { anomalyDmgBonus: 30 }
    migrateAttributeAnomalyNamingDeep(source)
    return Object.prototype.hasOwnProperty.call(source, 'anomalyDmgBonus')
  })())
}

console.log('\n[C6-2] 增益 stat / 词条目标 / 效果模板')
{
  const effect = normalizeBuffEffect({
    id: 'e1',
    kind: 'fixed',
    stat: 'anomalyDmgBonus',
    value: 30,
    applyTarget: 'self',
    scope: ['anomaly'],
  })
  check('额外 Buff stat 用新名', effect.stat === 'attributeAnomalyDmgBonus', effect.stat)
  // 子类字段本身表达类型，conditions 会被清空；旧 scope 的转换用普通字段验
  const genericEffect = normalizeBuffEffect({
    id: 'e2',
    kind: 'fixed',
    stat: 'dmgBonus',
    value: 10,
    applyTarget: 'self',
    scope: ['anomaly'],
  })
  check('旧 scope anomaly 归一化到新子类类型', (genericEffect.conditions?.damageTypes ?? []).join(',') === 'attributeAnomaly', (genericEffect.conditions?.damageTypes ?? []).join(','))
  const legacyConditionsEffect = normalizeBuffEffect({
    id: 'e3',
    kind: 'fixed',
    stat: 'dmgBonus',
    value: 10,
    applyTarget: 'self',
    conditions: { damageTypes: ['anomaly', 'radiance'] },
  })
  check('旧 conditions.damageTypes 换新名且不扩成全部', (legacyConditionsEffect.conditions?.damageTypes ?? []).join(',') === 'attributeAnomaly,radiance', (legacyConditionsEffect.conditions?.damageTypes ?? []).join(','))

  same('词条目标 panel: 后缀换新名', migrateAttributeAnomalyTargetString('panel:anomalyDmgBonus'), 'panel:attributeAnomalyDmgBonus')
  same('词条目标 gain: 后缀换新名', migrateAttributeAnomalyTargetString('gain:anomalyDmgBonus'), 'gain:attributeAnomalyDmgBonus')
  same('非属性异常目标不动', migrateAttributeAnomalyTargetString('panel:anomalyReleaseDmgBonus'), 'panel:anomalyReleaseDmgBonus')

  const template = parseAffixEffectTemplate({
    version: 1,
    allocation: 'effect',
    legacyTarget: 'gain:anomalyDmgBonus',
    spec: { version: 1, stat: 'anomalyDmgBonus', operation: 'add', stage: 'damageZone', beneficiary: 'self' },
  })
  check('效果模板 legacyTarget 换新名', template?.legacyTarget === 'gain:attributeAnomalyDmgBonus', template?.legacyTarget)
  check('效果模板 spec.stat 换新名', template?.spec?.stat === 'attributeAnomalyDmgBonus', template?.spec?.stat)

  const library = createDefaultAffixLibraryStore()
  const pack = {
    kind: 'zzz-hp-affix-library',
    name: '旧词条库',
    state: {
      origin: 'custom',
      customEntries: [
        { id: 'custom-1', label: '旧属性异常增伤', target: 'gain:anomalyDmgBonus', perRoll: 6, cap: 12, group: '', rollCost: 1, enabledByDefault: true },
        { id: 'custom-2', label: '旧面板属性异常暴击', target: 'panel:anomalyCritRate', perRoll: 3, cap: 9, group: '', rollCost: 1, enabledByDefault: true },
      ],
      groups: [],
    },
  }
  const imported = importAffixLibrarySet(library, JSON.stringify(pack), 'new')
  check('词条库导入无错误', !imported.error, String(imported.error))
  const importedTargets = JSON.stringify(imported.store)
  check('导入后的词条目标不含旧名', !importedTargets.includes('anomalyDmgBonus') && !importedTargets.includes('anomalyCritRate'), importedTargets.slice(0, 200))
  check('导入后的词条目标用新名', importedTargets.includes('gain:attributeAnomalyDmgBonus') && importedTargets.includes('panel:attributeAnomalyCritRate'), importedTargets.slice(0, 300))
}

console.log('\n[C6-3] 子类类型值 vs 类级值')
{
  same('子类值 anomaly → attributeAnomaly', migrateAttributeAnomalyTypeValue('anomaly'), 'attributeAnomaly')
  const converted = migrateAttributeAnomalyNamingDeep({
    damageKind: 'anomaly',
    modeType: 'anomaly',
    damageType: 'anomaly',
    kind: 'anomaly',
    anomalySubKind: 'anomaly',
    conditions: { damageTypes: ['anomaly', 'radiance'] },
    scope: ['anomaly'],
  })
  same('damageKind 保持类级 anomaly', converted.damageKind, 'anomaly')
  same('modeType 保持类级 anomaly', converted.modeType, 'anomaly')
  same('damageType 换成子类新值', converted.damageType, 'attributeAnomaly')
  same('事件 kind 换成子类新值', converted.kind, 'attributeAnomaly')
  same('anomalySubKind 换成子类新值', converted.anomalySubKind, 'attributeAnomaly')
  same('conditions.damageTypes 换新名且不扩成全部', converted.conditions.damageTypes, ['attributeAnomaly', 'radiance'])
  same('旧 scope 换新名', converted.scope, ['attributeAnomaly'])
  check('界面异常类分组 id = anomalyClass', (await import('../src/types/calculator.ts')).BUFF_DAMAGE_TYPE_GROUPS.find((g) => g.label === '异常类')?.id === 'anomalyClass')
}

console.log('\n[C6-4] 旧方案包覆盖导入 / 合并导入')
{
  const oldPack = {
    type: 'zzz-hp-schemes',
    dirs: {},
    schemes: {
      's:/旧方案': {
        id: 's:/旧方案',
        name: '旧方案',
        folder: '/',
        order: 0,
        savedAt: 1,
        teamSlots: [],
        slots: [],
        panelState: {
          externalPanel: legacyPanelSnapshot(),
          extraGains: [
            {
              id: 'gain-1',
              label: '旧额外增益',
              applySlot: 0,
              effects: [
                {
                  id: 'gain-eff-1',
                  kind: 'fixed',
                  stat: 'anomalyDmgBonus',
                  value: 15,
                  applyTarget: 'self',
                  scope: ['anomaly'],
                },
              ],
            },
          ],
          enemyInput: { level: 60, defense: 953, resistanceType: 'normal', vulnerableMultiplier: 1, staggerMultiplier: 1, specialMultiplier: 1 },
        },
        customSkills: [
          { id: 'sk-1', name: '属性异常招式', agentId: 'a', source: 'custom', damageType: 'anomaly', skillTypes: [], baseMult: 100 },
        ],
        skillGroups: [],
      },
    },
    customSkills: [
      { id: 'sk-1', name: '属性异常招式', agentId: 'a', source: 'custom', damageType: 'anomaly', skillTypes: [], baseMult: 100 },
    ],
    skillGroups: [],
  }
  const replaced = importDamageCalcHistory(JSON.stringify(oldPack), { mode: 'replace' })
  check('覆盖导入无错误', replaced.errors.length === 0, JSON.stringify(replaced.errors))
  const replacedText = JSON.stringify(memory.get('zzz-hp-damage-calc-history') ?? '')
  check('覆盖导入后存档不含旧字段名', !/"anomalyDmgBonus"/.test(replacedText) && !/"anomalyCritRate"/.test(replacedText), '')
  check('覆盖导入后存档用新字段名', replacedText.includes('attributeAnomalyDmgBonus'), replacedText.slice(0, 160))
  const customText = memory.get('zzz-hp-skill-library-custom') ?? ''
  check('自建招式保存用新类型值', customText.includes('attributeAnomaly') && !customText.includes('"anomaly"'), customText.slice(0, 120))

  const merged = importDamageCalcHistory(JSON.stringify(oldPack), { mode: 'merge' })
  check('合并导入无错误', merged.errors.length === 0, JSON.stringify(merged.errors))
  const mergedStore = JSON.parse(memory.get('zzz-hp-damage-calc-history') ?? '{}')
  const mergedSkills = JSON.parse(memory.get('zzz-hp-skill-library-custom') ?? '[]')
  check('合并导入不因类型拼写重复自建招式', mergedSkills.length === 1, JSON.stringify(mergedSkills.map((item) => [item.id, item.damageType])))
  check('合并导入后存档无旧字段名', !JSON.stringify(mergedStore).includes('"anomalyDmgBonus"'), '')
  check('合并导入后自建招式类型为新值', mergedSkills.every((item) => item.damageType === 'attributeAnomaly'), JSON.stringify(mergedSkills.map((item) => item.damageType)))

  // 已转换内容再导入一次 → 结果不变（幂等）
  const again = importDamageCalcHistory(JSON.stringify(oldPack), { mode: 'replace' })
  check('重复覆盖导入结果稳定', again.errors.length === 0 && JSON.stringify(JSON.parse(memory.get('zzz-hp-skill-library-custom') ?? '[]').map((item) => item.damageType)) === '["attributeAnomaly"]')

  // 指纹：同名招式只是旧/新类型拼写不同 → 指纹相同
  const oldSkill = { name: '属性异常招式', agentId: 'a', element: '', damageType: 'anomaly', skillTypes: [], buffAnchorId: null, baseMult: 100, settlementMult: null, note: '', baseMultFactor: 100 }
  const newSkill = { ...oldSkill, damageType: 'attributeAnomaly' }
  check('旧/新类型拼写不改变招式指纹', skillFingerprint(oldSkill) === skillFingerprint(newSkill))
}

console.log('\n[C6-5] 自建招式 / 旧事件模式 / 流程伤害记录')
{
  const skills = parseCustomSkillList([
    { id: 'sk-a', name: '属性异常招式', agentId: 'a', source: 'custom', damageType: 'anomaly', skillTypes: [], baseMult: 100 },
  ])
  check('parseCustomSkillList 转换 damageType', skills?.[0]?.damageType === 'attributeAnomaly', skills?.[0]?.damageType)

  memory.set(
    'zzz-hp-custom-damage-event-modes',
    JSON.stringify([
      {
        id: 'mode-1',
        agentId: 'a',
        name: '旧模式',
        modeType: 'anomaly',
        events: [
          { id: 'ev1', kind: 'anomaly', categoryId: 'basic', skillSubcategoryId: null, count: 1, staggerPhase: 'stagger', critMode: 'expected', multOverrides: { anomalyMult: 200, anomalyMultFactor: 100 } },
        ],
      },
    ]),
  )
  const modes = loadCustomModes()
  check('旧模式的 modeType 保持 anomaly', modes[0]?.modeType === 'anomaly', modes[0]?.modeType)
  check('旧事件 kind 换成 attributeAnomaly', modes[0]?.events?.[0]?.kind === 'attributeAnomaly', modes[0]?.events?.[0]?.kind)
  check('事件倍率覆盖字段换新名', modes[0]?.events?.[0]?.multOverrides?.attributeAnomalyMult === 200 && modes[0]?.events?.[0]?.multOverrides?.attributeAnomalyMultFactor === 100, JSON.stringify(modes[0]?.events?.[0]?.multOverrides))

  memory.set(
    'zzz-hp-skill-flow-damage-records',
    JSON.stringify([
      {
        id: 'rec-1',
        savedAt: 1,
        current: 500,
        team: 1000,
        agentName: '甲',
        schemeName: '方案',
        agentNames: ['甲', '乙', '丙'],
        snapshot: {
          version: 1,
          agentIds: ['a', 'b', 'c'],
          uncomputedCount: 0,
          lines: [
            { slotIndex: 0, skillId: 'sk-a', skillName: '属性异常招式', damageType: 'anomaly', staggerPhase: 'stagger', count: 2, total: 1000 },
          ],
        },
      },
    ]),
  )
  const records = loadSkillFlowDamageRecords()
  const line = records[0]?.snapshot?.lines?.[0]
  check('历史明细类型换成 attributeAnomaly', line?.damageType === 'attributeAnomaly', line?.damageType)
  check('历史明细 count 仍为 2', line?.count === 2, `${line?.count}`)
  check('历史明细 total 仍为 1000', line?.total === 1000, `${line?.total}`)
  check('记录本身未被丢弃', records.length === 1)
}

console.log('\n[C6-6] 结果键：目标键在、旧 Combined 键不在')
{
  const panel = createEmptyExternalPanel()
  panel.atk = 2000
  panel.mastery = 100
  panel.attributeAnomalyMult = 713
  panel.anomalyDuration = 10
  panel.disorderBaseMult = 450
  panel.disorderCompMult = 7.5
  panel.turbulenceBaseMult = 450
  panel.turbulenceCompMult = 7.5
  panel.radianceMult = 360
  panel.anomalyReleaseMult = 700
  panel.attributeAnomalyDmgBonus = 30
  panel.turbulenceDmgBonus = 20
  panel.radianceDmgBonus = 20
  panel.anomalyReleaseDmgBonus = 20
  const result = computeDamageResult({
    finalPanel: panel,
    piercePower: 3000,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: { level: 60, defense: 953, resistanceType: 'normal', vulnerableMultiplier: 1, staggerMultiplier: 1, specialMultiplier: 1 },
    combatVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatSpecial: 0,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
    triggerFinalPanel: panel,
    triggerAgentLevel: 60,
    anomalyTriggerPanel: panel,
    anomalySubKind: 'attributeAnomaly',
  })
  for (const key of ['attributeAnomalyDmgBonusZone', 'attributeAnomalyMultZone', 'attributeAnomalyCritZone', 'attributeAnomalyFullCritZone', 'attributeAnomalyExpected', 'attributeAnomalyExpectedNoCrit', 'attributeAnomalyExpectedFullCrit', 'turbulenceDmgBonusZone', 'anomalyReleaseDmgBonusZone', 'radianceDmgBonusZone']) {
    check(`结果键 ${key} 存在`, key in result, `${key in result}`)
  }
  for (const key of ['turbulenceCombinedDmgBonusZone', 'anomalyReleaseCombinedDmgBonusZone', 'radianceCombinedDmgBonusZone', 'anomalyDmgBonusZone', 'anomalyMultZone', 'anomalyExpected']) {
    check(`旧结果键 ${key} 不再输出`, !(key in result))
  }
  check('三类增伤区都是单字段值（1.2）', result.turbulenceDmgBonusZone === 1.2 && result.anomalyReleaseDmgBonusZone === 1.2 && result.radianceDmgBonusZone === 1.2, `${result.turbulenceDmgBonusZone}/${result.anomalyReleaseDmgBonusZone}/${result.radianceDmgBonusZone}`)
}

/* ===================== C8：历史来源说明改名与原文保护 ===================== */
console.log('\n[C8] 历史工具来源说明')
{
  const single = '原文：属性异常伤害的暴击率提升30%。\n[关键字] 属性=异常暴击率 元素=无 动作=提升 数值=30 单位=% 目标=全队 条件=无 作用域=无 层数=无 时长=无 对象=无'
  const expected = '原文：属性异常伤害的暴击率提升30%。\n[关键字] 属性=属性异常暴击率 元素=无 动作=提升 数值=30 单位=% 目标=全队 条件=无 作用域=无 层数=无 时长=无 对象=无'
  same('单行：只改属性槽位、原文逐字不变', migrateAttributeAnomalyNoteText(single), expected)

  same(
    '属性=异常增伤 → 属性=属性异常增伤',
    migrateAttributeAnomalyNoteText('[关键字] 属性=异常增伤 元素=无 动作=提升 数值=30 单位=%'),
    '[关键字] 属性=属性异常增伤 元素=无 动作=提升 数值=30 单位=%',
  )
  same(
    '属性=异常暴击伤害 → 属性=属性异常暴击伤害',
    migrateAttributeAnomalyNoteText('[关键字 2] 属性=异常暴击伤害 元素=无 动作=提升 数值=25 单位=%'),
    '[关键字 2] 属性=属性异常暴击伤害 元素=无 动作=提升 数值=25 单位=%',
  )

  const multi = '[关键字 1] 属性=异常暴击率 元素=无 动作=提升 数值=30 单位=%\n[关键字 2] 属性=属性异常暴击伤害 元素=无 动作=提升 数值=25 单位=%'
  same(
    '多行：只改旧名那行，已新名那行不加前缀',
    migrateAttributeAnomalyNoteText(multi),
    '[关键字 1] 属性=属性异常暴击率 元素=无 动作=提升 数值=30 单位=%\n[关键字 2] 属性=属性异常暴击伤害 元素=无 动作=提升 数值=25 单位=%',
  )
  same('重复转换结果不变', migrateAttributeAnomalyNoteText(migrateAttributeAnomalyNoteText(multi)), migrateAttributeAnomalyNoteText(multi))
  check('不生成「属性属性异常」', !migrateAttributeAnomalyNoteText(expected).includes('属性属性异常'))

  const freeNote = '原文：触发属性异常时，敌人的异常增伤抗性降低10%。\n备注：异常增伤这条我先留着，回头再核对。'
  same('原文段落与自由备注里的「异常增伤」逐字不变', migrateAttributeAnomalyNoteText(freeNote), freeNote)

  // 统一数据副本 / 方案包里的说明：随 deep 转换一起改
  const holder = {
    mindscapeNotes: ['原文：某效果。\n[关键字] 属性=异常暴击伤害 元素=无 动作=提升 数值=25 单位=%'],
    mindscapeBuffs: [
      { effectBlocks: [{ id: 'b', name: '块', note: '[关键字] 属性=异常增伤 元素=无 动作=提升 数值=30 单位=%', effects: [] }] },
    ],
    note: '原文：触发属性异常时伤害提升30%。',
  }
  const migratedHolder = migrateAttributeAnomalyNamingDeep(holder)
  check('mindscapeNotes 里的生成行改名', migratedHolder.mindscapeNotes[0].includes('属性=属性异常暴击伤害'), migratedHolder.mindscapeNotes[0])
  check('效果块 note 里的生成行改名', migratedHolder.mindscapeBuffs[0].effectBlocks[0].note.includes('属性=属性异常增伤'), migratedHolder.mindscapeBuffs[0].effectBlocks[0].note)
  same('自由 note 不改', migratedHolder.note, holder.note)
}

console.log(`\n${failed ? `❌ ${failed} failed, ${passed} passed` : `✅ all passed（${passed}）`}`)
if (failed) process.exit(1)
