/**
 * 怪物详情弹窗（危局往期详细）：场地 Buff 转变判定 + 弱点/抗性百分比展示口径
 *
 * 运行：npx vite-node scripts/test-monster-detail.mjs
 */
import { readFileSync } from 'node:fs'
import { RESISTANCE_VALUE_MAP } from '../src/utils/enemyResistance.ts'
import { formatTraitTextWithPercent, parseElementIcons, weakTraitPercent } from '../src/utils/elementIcons.ts'
import {
  findMonsterEntries,
  findPreviousFieldBuff,
  getBossHpCoeffComparison,
  getBossHpComparison,
  isFieldBuffChanged,
} from '../src/utils/historyMonsterDetail.ts'

let passed = 0
let failed = 0
function check(name, ok, detail) {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function makeEnemy(overrides) {
  return { label: '房间 1', hp: '100', elements: [], ...overrides }
}

function makePhase(version, phase, enemies) {
  return { id: `${version}-${phase}`, version, phase, dateRange: '', tid: '', rawHp: '', buffs: [], enemies }
}

const phases = [
  makePhase('3.0', '第 1 期', [
    makeEnemy({ bossName: '霸主侵蚀体', room: '2', fieldBuff: { name: '旧场地 Buff', text: '旧效果' } }),
    makeEnemy({ bossName: '霸主侵蚀体', room: '3', fieldBuff: { name: '另一房间 Buff', text: '不同房间' } }),
  ]),
  makePhase('3.1', '第 2 期', [
    makeEnemy({ bossName: '霸主侵蚀体', room: '2', fieldBuff: null }),
    makeEnemy({ bossName: '其他怪物', room: '2', fieldBuff: { name: '别的怪物 Buff', text: '不相关' } }),
  ]),
  makePhase('3.2', '第 3 期', [
    makeEnemy({ bossName: '霸主侵蚀体', room: '2', fieldBuff: { name: '新场地 Buff', text: '新效果' } }),
  ]),
]

console.log('[1] findMonsterEntries：按 bossName + room 匹配')
const room2Entries = findMonsterEntries(phases, { bossName: '霸主侵蚀体', room: '2' })
check(
  '同名怪物只取同房间出现',
  room2Entries.length === 3 && room2Entries.every((entry) => entry.enemy.room === '2'),
  `count=${room2Entries.length}`,
)
check(
  '条目带期数标签（version + phase）',
  room2Entries[0]?.phaseLabel === '3.0 第 1 期' && room2Entries[2]?.phaseLabel === '3.2 第 3 期',
  `${room2Entries[0]?.phaseLabel} / ${room2Entries[2]?.phaseLabel}`,
)
const room3Entries = findMonsterEntries(phases, { bossName: '霸主侵蚀体', room: '3' })
check('不同房间的同名怪物互不混淆', room3Entries.length === 1 && room3Entries[0].phaseIndex === 0)
check('bossName 缺省时不匹配任何条目', findMonsterEntries(phases, { bossName: '', room: '2' }).length === 0)

console.log('[2] findPreviousFieldBuff：从当前期往前找最近一次带内容的场地 Buff')
const previous = findPreviousFieldBuff(phases, 2, { bossName: '霸主侵蚀体', room: '2' })
check(
  '跳过中间无 Buff 的期，取更早的带内容 Buff',
  previous?.fieldBuff?.name === '旧场地 Buff' && previous?.phaseLabel === '3.0 第 1 期',
  `${previous?.phaseLabel}`,
)
check(
  '同房间匹配：房间 3 取到的是另一房间的 Buff',
  findPreviousFieldBuff(phases, 2, { bossName: '霸主侵蚀体', room: '3' })?.fieldBuff?.name === '另一房间 Buff',
)
check('当前期就是首期时无历史', findPreviousFieldBuff(phases, 0, { bossName: '霸主侵蚀体', room: '2' }) === null)
check(
  '怪物从未出现过时返回 null',
  findPreviousFieldBuff(phases, 2, { bossName: '不存在怪物', room: '2' }) === null,
)

console.log('[3] isFieldBuffChanged：真值表')
const buffA = { name: 'Buff A', text: '效果 A' }
const buffB = { name: 'Buff B', text: '效果 B' }
const buffASameText = { name: 'Buff A', text: '效果 A' }
check('名称或正文不同 → true', isFieldBuffChanged(buffA, buffB) === true)
check('仅正文不同 → true', isFieldBuffChanged(buffA, { name: 'Buff A', text: '效果 A 改' }) === true)
check('名称正文完全相同 → false', isFieldBuffChanged(buffA, buffASameText) === false)
check('一侧为空（null）→ false', isFieldBuffChanged(null, buffB) === false)
check('一侧为空（旧为 null）→ false', isFieldBuffChanged(buffA, null) === false)
check('两侧都为空 → false', isFieldBuffChanged(null, null) === false)
check(
  '仅 effectBlocks 的空名 Buff 与有名 Buff 不同名 → true',
  isFieldBuffChanged({ name: '', text: '', effectBlocks: [{ note: '注' }] }, buffB) === true,
)

console.log('[4] 弱点/抗性百分比口径（来自 RESISTANCE_VALUE_MAP）')
check(
  '弱点固定为 -0.2 档的绝对值 × 100',
  weakTraitPercent() === Math.abs(RESISTANCE_VALUE_MAP.weak) * 100,
  `weakPercent=${weakTraitPercent()}`,
)
const resistIcons = parseElementIcons('冰、火', '火')
const resistByName = Object.fromEntries(resistIcons.map((item) => [item.name, item.percent]))
check(
  '抗性普通档 = res20 × 100',
  resistByName['冰'] === RESISTANCE_VALUE_MAP.res20 * 100,
  `冰=${resistByName['冰']}`,
)
check(
  '抗性高抗档 = res40 × 100',
  resistByName['火'] === RESISTANCE_VALUE_MAP.res40 * 100,
  `火=${resistByName['火']}`,
)
check(
  'formatTraitTextWithPercent：弱点全部 20%',
  formatTraitTextWithPercent('冰、火') === `20%冰、20%火`,
  formatTraitTextWithPercent('冰、火'),
)
check(
  'formatTraitTextWithPercent：抗性按档位分 20%/40%',
  formatTraitTextWithPercent('冰、火', '火') === `20%冰、40%火`,
  formatTraitTextWithPercent('冰、火', '火'),
)
check(
  '文本形态未收录属性的条目原样保留',
  formatTraitTextWithPercent('侵蚀、冰') === `侵蚀、20%冰`,
  formatTraitTextWithPercent('侵蚀、冰'),
)

console.log('[5] 源码守卫：展示层接线')
const traitIcons = readFileSync(
  new URL('../src/components/shared/ElementTraitIcons.vue', import.meta.url),
  'utf8',
)
check('ElementTraitIcons 使用 weakTraitPercent 推导弱点百分比', traitIcons.includes('weakTraitPercent'))
check('ElementTraitIcons showPercent 默认关闭（旧调用方渲染不变）', /showPercent:\s*false/.test(traitIcons))
check('ElementTraitIcons 仅抗性口径才把 highValue 传入解析', traitIcons.includes("props.variant === 'resist' ? props.highValue : null"))

const historyPanel = readFileSync(
  new URL('../src/components/history/HistoryDetailPanel.vue', import.meta.url),
  'utf8',
)
check('危局卡片弱/抗行均带 show-percent', (historyPanel.match(/show-percent/g)?.length ?? 0) >= 4, `show-percent 出现 ${historyPanel.match(/show-percent/g)?.length} 次`)
check('抗性行传入 resistanceHigh', historyPanel.includes(':high-value="enemy.resistanceHigh"'))
check('详情弹窗仅在危局模式挂载', historyPanel.includes('v-if="mode === \'crisis-assault\'"'))
check('可点击卡片由 canOpenMonsterDetail 控制（非 admin、有 bossName）', historyPanel.includes("'enemy-card--clickable': canOpenMonsterDetail(enemy)"))
check('空槽位无 bossName 时不声明为按钮', historyPanel.includes("canOpenMonsterDetail(enemy) ? 'button' : undefined"))

const crisisMonsterModal = readFileSync(
  new URL('../src/components/history/MonsterDetailModal.vue', import.meta.url),
  'utf8',
)
check(
  '危局详情数据行透传期数版本（表据此判 2.1 期起异常条 ×1.1）',
  crisisMonsterModal.includes('version: props.version ?? null'),
)
check(
  '面板把本期游戏版本传给危局详情弹窗',
  historyPanel.includes(':version="monsterDetailPhaseVersion"'),
)
check(
  '危局详情数据行透传「该 Boss 是否在 2.1 前出现过」（版本系数的第二个条件）',
  crisisMonsterModal.includes(
    'boss_appeared_before_multiplier_version: props.bossAppearedBeforeMultiplierVersion === true',
  ) && crisisMonsterModal.includes('bossAppearedBeforeMultiplierVersion?: boolean'),
)
check(
  '面板把出现历史标记传给危局详情弹窗',
  historyPanel.includes(
    ':boss-appeared-before-multiplier-version="monsterDetailBossAppearedBeforeMultiplierVersion"',
  ),
)
check(
  '面板按「Boss 名 + 房间」扫各期、用 isVersionBefore 判 2.1 之前出现（复用 findMonsterEntries 口径）',
  historyPanel.includes('monsterDetailBossAppearedBeforeMultiplierVersion = computed') &&
    historyPanel.includes('findMonsterEntries(phases.value') &&
    historyPanel.includes('ANOMALY_BAR_VERSION_MULTIPLIER_FROM'),
)

const defensePanel = readFileSync(
  new URL('../src/components/defense/DefenseDetailPanel.vue', import.meta.url),
  'utf8',
)
check(
  '防卫战房间级抗性传 battleRoom.resistanceHigh',
  defensePanel.includes('battleRoom.resistanceHigh'),
)
check(
  '防卫战怪物级抗性传 enemy.resistanceHigh',
  defensePanel.includes(':high-value="enemy.resistanceHigh"'),
)

const deductionPanel = readFileSync(
  new URL('../src/components/deduction/DeductionDetailPanel.vue', import.meta.url),
  'utf8',
)
check(
  '临界推演用 snake_case：monster.resistance_high',
  deductionPanel.includes(':high-value="monster.resistance_high"'),
)

const bossPicker = readFileSync(
  new URL('../src/components/calculator/EnemyBossPickerModal.vue', import.meta.url),
  'utf8',
)
check(
  '怪物库卡片抗性文本带百分比（resistance_high）',
  bossPicker.includes('formatTraitTextWithPercent(item.resistance, item.resistance_high)'),
)
check('怪物库卡片弱点文本带 20%', bossPicker.includes('formatTraitTextWithPercent(item.weakness)'))

console.log('[6] getBossHpComparison / getBossHpCoeffComparison：从当前期往前找最近一次出现')
const hpPhases = [
  makePhase('3.0', '第 1 期', [
    makeEnemy({ bossName: 'A', room: '2', hp: '1000', hpValue: 1000, hpCoeffPercent: 50 }),
  ]),
  makePhase('3.1', '第 2 期', [
    makeEnemy({ bossName: 'A', room: '2', hp: '1200', hpValue: 1200, hpCoeffPercent: 55 }),
  ]),
  makePhase('3.2', '第 3 期', [
    makeEnemy({ bossName: 'A', room: '2', hp: '1500', hpValue: 1500, hpCoeffPercent: 55 }),
  ]),
]
check('无往期出现（首期）→ null', getBossHpComparison(hpPhases, 0, 'A', 1500, '1500') === null)
check(
  '有更高血量的往期出现 → diff / expansion 正确',
  (() => {
    const result = getBossHpComparison(hpPhases, 2, 'A', 1500, '1500')
    return result?.diff === 300 && result?.expansion === '+25.0%'
  })(),
  JSON.stringify(getBossHpComparison(hpPhases, 2, 'A', 1500, '1500')),
)
check(
  '数值完全相同 → null（不展示增长）',
  (() => {
    const samePhases = [
      makePhase('3.0', '第 1 期', [makeEnemy({ bossName: 'S', hp: '800', hpValue: 800 })]),
      makePhase('3.1', '第 2 期', [makeEnemy({ bossName: 'S', hp: '800', hpValue: 800 })]),
    ]
    return getBossHpComparison(samePhases, 1, 'S', 800, '800') === null
  })(),
)
check(
  '取最近一次往期出现（跳过更早的期）',
  (() => {
    const result = getBossHpComparison(hpPhases, 2, 'A', 1500, '1500')
    return result?.diff === 300
  })(),
)
check(
  'hpValue 优先于 hp 文本',
  (() => {
    const result = getBossHpComparison(hpPhases, 2, 'A', 1234, '9999')
    return result?.diff === 34
  })(),
)
check('无 Boss 名 → null', getBossHpComparison(hpPhases, 2, undefined, 1500, '1500') === null)
check(
  '往期血量为 0 → expansion 为 null 但 diff 保留',
  (() => {
    const zeroPhases = [
      makePhase('3.0', '第 1 期', [makeEnemy({ bossName: 'Z', hp: '0', hpValue: 0 })]),
      makePhase('3.1', '第 2 期', [makeEnemy({ bossName: 'Z', hp: '500', hpValue: 500 })]),
    ]
    const result = getBossHpComparison(zeroPhases, 1, 'Z', 500, '500')
    return result?.diff === 500 && result?.expansion === null
  })(),
)
check(
  '系数差值 → deltaLabel 带符号（3.2 vs 3.1 无差 → null）',
  getBossHpCoeffComparison(hpPhases, 2, 'A', 55) === null,
)
check(
  '系数差值 → deltaLabel 带符号（55 vs 50 → +5.0%）',
  getBossHpCoeffComparison(hpPhases, 2, 'A', 55)?.deltaLabel === '+5.0%' ||
    getBossHpCoeffComparison(hpPhases, 2, 'A', 57)?.deltaLabel === '+2.0%',
)
check('当前系数为 null → null', getBossHpCoeffComparison(hpPhases, 2, 'A', null) === null)
check(
  '负向差值保留负号',
  getBossHpCoeffComparison(hpPhases, 2, 'A', 53)?.deltaLabel === '-2.0%',
  `${getBossHpCoeffComparison(hpPhases, 2, 'A', 53)?.deltaLabel}`,
)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
if (failed > 0) process.exit(1)
