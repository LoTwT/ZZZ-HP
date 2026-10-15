/**
 * 怪物详情「弱点与抗性」表：行序 / 百分比推导（锚定 RESISTANCE_VALUE_MAP）/ 截断口径 / 最大异常积蓄常量
 *
 * 表值来自用户提供的 nanoka 怪物页截图；异常积蓄与失衡的 ±20% 截断、以及
 * 最大异常积蓄常量均属待验证知识，本测试只固定当前实现口径。
 *
 * 运行：npx vite-node scripts/test-monster-resistance-table.mjs
 */
import { readFileSync } from 'node:fs'
import { RESISTANCE_VALUE_MAP } from '../src/utils/enemyResistance.ts'
import {
  MONSTER_RESISTANCE_TABLE_ELEMENTS,
  buildMonsterResistanceRows,
} from '../src/utils/monsterResistanceTable.ts'

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

/** 百分比一律由 RESISTANCE_VALUE_MAP 推导，测试内不重复写 -20/0/20/40 档位字面量 */
const mapPercent = (type) => Math.round(RESISTANCE_VALUE_MAP[type] * 100)

const byElement = (rows) => Object.fromEntries(rows.map((row) => [row.element, row]))
/** 压成「属性:伤害/异常积蓄/失衡/最大异常积蓄」便于逐行比对 */
const tuples = (rows) =>
  rows
    .map((row) => `${row.element}:${row.damagePercent}/${row.anomalyPercent}/${row.staggerPercent}/${row.maxAnomalyProgress}`)
    .join(' ')
const maxAnomalyList = (rows) => rows.map((row) => row.maxAnomalyProgress).join(' ')

console.log('[1] 行序：恒为 冰 / 火 / 电 / 以太 / 物理 / 风')
const screenshotRows = buildMonsterResistanceRows({
  weakness: '冰、物理、风',
  resistance: '电',
  resistance_high: '电',
})
check(
  '表内属性顺序与截图一致',
  MONSTER_RESISTANCE_TABLE_ELEMENTS.join('、') === '冰、火、电、以太、物理、风',
  MONSTER_RESISTANCE_TABLE_ELEMENTS.join('、'),
)
check(
  '输出行序与顺序常量一致（六行）',
  screenshotRows.length === 6 && screenshotRows.map((row) => row.element).join('、') === '冰、火、电、以太、物理、风',
  screenshotRows.map((row) => row.element).join('、'),
)
check(
  '每行带 /attribute_image/ 图标',
  screenshotRows.every((row) => typeof row.icon === 'string' && row.icon.startsWith('/attribute_image/')),
  screenshotRows.map((row) => row.icon).join(' '),
)

console.log('[2] 截图用例：弱点 冰/物理/风 + 高抗性 电')
check(
  '逐行百分比与最大异常积蓄与截图一致',
  tuples(screenshotRows) ===
    [
      '冰:-20/-20/-20/3960',
      '火:0/0/0/3960',
      '电:40/20/20/3960',
      '以太:0/0/0/3960',
      '物理:-20/-20/-20/4752',
      '风:-20/-20/-20/1980',
    ].join(' '),
  tuples(screenshotRows),
)
check(
  '最大异常积蓄为各属性常量（物理 4752 / 风 1980 / 其余 3960）',
  maxAnomalyList(screenshotRows) === '3960 3960 3960 3960 4752 1980',
  maxAnomalyList(screenshotRows),
)
const screenshotByElement = byElement(screenshotRows)
check(
  '弱点属性伤害为负（-20%），高抗性属性伤害为正 40%',
  screenshotByElement['冰'].damagePercent === mapPercent('weak') &&
    screenshotByElement['电'].damagePercent === mapPercent('res40') &&
    screenshotByElement['电'].damagePercent > 0 &&
    screenshotByElement['冰'].damagePercent < 0,
  `冰=${screenshotByElement['冰'].damagePercent} 电=${screenshotByElement['电'].damagePercent}`,
)
check(
  '40% 抗性属性的异常积蓄 / 失衡被截断到 20% 档',
  screenshotByElement['电'].anomalyPercent === mapPercent('res20') &&
    screenshotByElement['电'].staggerPercent === mapPercent('res20') &&
    mapPercent('res40') > mapPercent('res20'),
  `异常积蓄=${screenshotByElement['电'].anomalyPercent} 失衡=${screenshotByElement['电'].staggerPercent}`,
)

console.log('[3] 无弱点无抗性：百分比全 0，最大异常积蓄仍为常量')
const plainRows = buildMonsterResistanceRows({})
check(
  '三列百分比全为 0',
  plainRows.length === 6 &&
    plainRows.every((row) => row.damagePercent === 0 && row.anomalyPercent === 0 && row.staggerPercent === 0),
  tuples(plainRows),
)
check(
  '最大异常积蓄按属性常量输出',
  maxAnomalyList(plainRows) === '3960 3960 3960 3960 4752 1980',
  maxAnomalyList(plainRows),
)
check(
  '显式 null 与缺省同口径',
  tuples(buildMonsterResistanceRows({ weakness: null, resistance: null, resistance_high: null })) ===
    tuples(plainRows),
)
check(
  '正常档伤害 = RESISTANCE_VALUE_MAP.normal × 100（0）',
  plainRows.every((row) => row.damagePercent === mapPercent('normal')),
)

console.log('[4] 20% 抗性档：伤害 / 异常积蓄 / 失衡 均为 20%')
const midRows = byElement(buildMonsterResistanceRows({ resistance: '电' }))
check(
  '抗性（未标 high）→ 三列同为 res20 档',
  midRows['电'].damagePercent === mapPercent('res20') &&
    midRows['电'].anomalyPercent === mapPercent('res20') &&
    midRows['电'].staggerPercent === mapPercent('res20'),
  `${midRows['电'].damagePercent}/${midRows['电'].anomalyPercent}/${midRows['电'].staggerPercent}`,
)
check(
  '抗性外的属性保持 normal 档',
  midRows['冰'].damagePercent === mapPercent('normal') &&
    midRows['物理'].damagePercent === mapPercent('normal'),
)
const weakRows = byElement(buildMonsterResistanceRows({ weakness: '冰' }))
check(
  '弱点 → 三列同为 weak 档（-20%）',
  weakRows['冰'].damagePercent === mapPercent('weak') &&
    weakRows['冰'].anomalyPercent === mapPercent('weak') &&
    weakRows['冰'].staggerPercent === mapPercent('weak'),
  `${weakRows['冰'].damagePercent}/${weakRows['冰'].anomalyPercent}/${weakRows['冰'].staggerPercent}`,
)

console.log('[5] 推导锚定与属性文本解析边界')
check(
  '伤害档位全部来自 RESISTANCE_VALUE_MAP（四档无字面量）',
  [mapPercent('weak'), mapPercent('normal'), mapPercent('res20'), mapPercent('res40')].join(',') ===
    '-20,0,20,40',
)
check(
  'resistance_high 中未列入 resistance 的属性不产生抗性',
  byElement(buildMonsterResistanceRows({ resistance: '电', resistance_high: '冰' }))['冰'].damagePercent ===
    mapPercent('normal'),
)
check(
  '同一属性既标弱点又标抗性时抗性覆盖弱点（对齐计算器口径）',
  byElement(buildMonsterResistanceRows({ weakness: '冰', resistance: '冰', resistance_high: '冰' }))['冰']
    .damagePercent === mapPercent('res40'),
)
check(
  '未收录属性（流明 / 侵蚀）不产生额外行，也不影响已收录属性',
  (() => {
    const rows = buildMonsterResistanceRows({ weakness: '冰、流明、侵蚀' })
    return rows.length === 6 && byElement(rows)['冰'].damagePercent === mapPercent('weak')
  })(),
  tuples(buildMonsterResistanceRows({ weakness: '冰、流明、侵蚀' })),
)
check(
  '数组形态入参与文本形态同口径',
  tuples(buildMonsterResistanceRows({ weakness: ['冰', '物理', '风'], resistance: ['电'], resistance_high: ['电'] })) ===
    tuples(screenshotRows),
)

console.log('[6] 源码守卫：展示层接线')
const stats = readFileSync(
  new URL('../src/components/history/MonsterDetailStats.vue', import.meta.url),
  'utf8',
)
check('数据块组件使用纯函数 buildMonsterResistanceRows', stats.includes('buildMonsterResistanceRows'))
check(
  '仅在 showResistanceTable 开启且存在 record 时成表',
  stats.includes('!props.showResistanceTable || !props.record') &&
    stats.includes('v-if="resistanceRows.length"'),
)
check('关闭时（默认 false）不渲染表格容器', /showResistanceTable\?: boolean/.test(stats))
check('百分比展示不带正号', stats.includes('return `${percent}%`'))
check('最大异常积蓄按千分位展示', stats.includes("toLocaleString('en-US')"))
check(
  '窄屏（≤768px）表宽跟随数据块占满整行',
  /@media \(max-width: 768px\)[\s\S]*\.monster-resistance-table \{\s*width: 100%;/.test(stats),
)
check(
  '中等宽度（769–900px）表整行落到数据块下方，避免挤压数据行',
  stats.includes('@media (min-width: 769px) and (max-width: 900px)') &&
    stats.includes('monster-detail-stats--with-resistance-table'),
)

const modal = readFileSync(
  new URL('../src/components/history/MonsterDetailModal.vue', import.meta.url),
  'utf8',
)
check('怪物详情弹窗开启该表', modal.includes(':show-resistance-table="true"'))

const comparePanel = readFileSync(
  new URL('../src/components/history/MonsterComparePanel.vue', import.meta.url),
  'utf8',
)
check('单独怪物对比页不开启该表（保持两列）', !comparePanel.includes('show-resistance-table'))

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
