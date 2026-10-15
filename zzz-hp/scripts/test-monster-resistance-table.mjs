/**
 * 怪物详情「弱点与抗性」表：行序 / 百分比推导（锚定 RESISTANCE_VALUE_MAP）/ 截断口径 /
 * 最大异常积蓄 = 基础异常条 × 异常条系数 / 防卫战类别映射 / 展示层接线守卫
 *
 * 基础异常条表来自用户提供的真实游戏数据（按敌人类别 × 属性分组 × 已异常次数分档）；
 * 异常积蓄与失衡的 ±20% 截断属待验证知识；1.32 系数用例复现用户首发的 nanoka 截图
 * （首领 70 级样本：物理 4752 / 火组 3960 / 风 1980）。
 * 异常条系数另有按 Boss 名的内置默认表（`ANOMALY_BAR_COEFFICIENT_BY_NAME`），
 * 使同一组数字无需 boss_info 覆盖值、也无需跑 seed SQL 即可复现。
 *
 * 运行：npx vite-node scripts/test-monster-resistance-table.mjs
 */
import { readFileSync } from 'node:fs'
import { RESISTANCE_VALUE_MAP } from '../src/utils/enemyResistance.ts'
import {
  buildDefenseMonsterDetailRecord,
  defenseMonsterCategoryToTableCategory,
} from '../src/utils/defenseCompare.ts'
import { encodeDefenseBossId } from '../src/utils/defenseId.ts'
import {
  ANOMALY_BAR_COEFFICIENT_BY_NAME,
  MONSTER_RESISTANCE_TABLE_ELEMENTS,
  buildMonsterResistanceRows,
  getMonsterBaseAnomalyProgress,
  resolveAnomalyBarCoefficient,
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
  monster_category: 'boss',
  anomaly_bar_coefficient: 1.32,
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

console.log('[2] 截图用例（首领 × 系数 1.32）：弱点 冰/物理/风 + 高抗性 电')
check(
  '逐行百分比与最大异常积蓄与截图一致（1.32 复现）',
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
  '1.32 验证三元组：首领初始条 × 1.32 ⇒ 物理 4752 / 火组 3960 / 风 1980',
  (() => {
    const rows = byElement(buildMonsterResistanceRows({ monster_category: 'boss', anomaly_bar_coefficient: 1.32 }))
    return rows['物理'].maxAnomalyProgress === 4752 &&
      rows['火'].maxAnomalyProgress === 3960 &&
      rows['电'].maxAnomalyProgress === 3960 &&
      rows['冰'].maxAnomalyProgress === 3960 &&
      rows['以太'].maxAnomalyProgress === 3960 &&
      rows['风'].maxAnomalyProgress === 1980
  })(),
  maxAnomalyList(screenshotRows),
)
check(
  '最大异常积蓄按基础条 × 1.32 输出（物理 4752 / 风 1980 / 其余 3960）',
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

console.log('[3] 缺省入参：按首领 × 系数 1 兜底，百分比全 0')
const plainRows = buildMonsterResistanceRows({})
check(
  '三列百分比全为 0',
  plainRows.length === 6 &&
    plainRows.every((row) => row.damagePercent === 0 && row.anomalyPercent === 0 && row.staggerPercent === 0),
  tuples(plainRows),
)
check(
  '缺省（首领 × 系数 1）最大异常积蓄 = 初始条长（物理 3600 / 火·电·冰·以太 3000 / 风 1500）',
  maxAnomalyList(plainRows) === '3000 3000 3000 3000 3600 1500',
  maxAnomalyList(plainRows),
)
check(
  '显式 null 与缺省同口径（系数缺失按 1 处理）',
  tuples(buildMonsterResistanceRows({
    weakness: null,
    resistance: null,
    resistance_high: null,
    monster_category: null,
    anomaly_bar_coefficient: null,
  })) === tuples(plainRows),
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
  tuples(buildMonsterResistanceRows({ weakness: ['冰', '物理', '风'], resistance: ['电'], resistance_high: ['电'], monster_category: 'boss', anomaly_bar_coefficient: 1.32 })) ===
    tuples(screenshotRows),
)

console.log('[6] 基础异常条表：类别 × 属性分组 × 已异常次数（用户提供的游戏数据）')
check(
  '展示口径恒为初始条长（0 次已异常）：首领 3600 / 3000 / 1500',
  getMonsterBaseAnomalyProgress('boss', '物理', 0) === 3600 &&
    getMonsterBaseAnomalyProgress('boss', '火', 0) === 3000 &&
    getMonsterBaseAnomalyProgress('boss', '电', 0) === 3000 &&
    getMonsterBaseAnomalyProgress('boss', '冰', 0) === 3000 &&
    getMonsterBaseAnomalyProgress('boss', '以太', 0) === 3000 &&
    getMonsterBaseAnomalyProgress('boss', '风', 0) === 1500,
)
check(
  '已异常 1 次的首领基础条：3672 / 3060 / 2700（× 1.0）',
  getMonsterBaseAnomalyProgress('boss', '物理', 1) === 3672 &&
    getMonsterBaseAnomalyProgress('boss', '火', 1) === 3060 &&
    getMonsterBaseAnomalyProgress('boss', '风', 1) === 2700,
)
check(
  '9+ 档收敛：次数 ≥9 一律取最后一档（首领·物理 4298）',
  getMonsterBaseAnomalyProgress('boss', '物理', 9) === 4298 &&
    getMonsterBaseAnomalyProgress('boss', '物理', 99) === 4298,
)
check(
  '系数 1.0625（猎血清道夫）取整：首领·物理 3825 / 火组 round(3187.5)=3188',
  (() => {
    const rows = byElement(buildMonsterResistanceRows({ monster_category: 'boss', anomaly_bar_coefficient: 1.0625 }))
    return rows['物理'].maxAnomalyProgress === 3825 && rows['火'].maxAnomalyProgress === 3188
  })(),
  (() => {
    const rows = byElement(buildMonsterResistanceRows({ monster_category: 'boss', anomaly_bar_coefficient: 1.0625 }))
    return `物理=${rows['物理'].maxAnomalyProgress} 火=${rows['火'].maxAnomalyProgress}`
  })(),
)
check(
  '精英 × 系数 1（初始条长）：2700 / 2250 / 1150',
  maxAnomalyList(buildMonsterResistanceRows({ monster_category: 'elite', anomaly_bar_coefficient: 1 })) ===
    '2250 2250 2250 2250 2700 1150',
  maxAnomalyList(buildMonsterResistanceRows({ monster_category: 'elite', anomaly_bar_coefficient: 1 })),
)
check(
  '普通 × 系数 1（初始条长）：720 / 600 / 300',
  maxAnomalyList(buildMonsterResistanceRows({ monster_category: 'normal', anomaly_bar_coefficient: 1 })) ===
    '600 600 600 600 720 300',
  maxAnomalyList(buildMonsterResistanceRows({ monster_category: 'normal', anomaly_bar_coefficient: 1 })),
)
check(
  '精英已异常 1 次基础条：2754 / 2295 / 2000',
  getMonsterBaseAnomalyProgress('elite', '物理', 1) === 2754 &&
    getMonsterBaseAnomalyProgress('elite', '火', 1) === 2295 &&
    getMonsterBaseAnomalyProgress('elite', '风', 1) === 2000,
)
check(
  '普通已异常 1 次基础条：734 / 612 / 500',
  getMonsterBaseAnomalyProgress('normal', '物理', 1) === 734 &&
    getMonsterBaseAnomalyProgress('normal', '火', 1) === 612 &&
    getMonsterBaseAnomalyProgress('normal', '风', 1) === 500,
)

console.log('[7] defenseMonsterCategoryToTableCategory：防卫战类别映射')
check(
  '小怪（minion）→ 普通 / 精英 → 精英 / Boss → 首领',
  defenseMonsterCategoryToTableCategory('minion') === 'normal' &&
    defenseMonsterCategoryToTableCategory('elite') === 'elite' &&
    defenseMonsterCategoryToTableCategory('boss') === 'boss',
)
check(
  '推不出类别（null）→ undefined（字段缺省，由表按首领兜底）',
  defenseMonsterCategoryToTableCategory(null) === undefined,
)
check(
  '防卫战详情行带 monster_category（精英 ID ⇒ 精英）与 anomaly_bar_coefficient（boss_info 未填 ⇒ null）',
  (() => {
    const eliteId = encodeDefenseBossId({
      version: '3.2',
      phase: 2,
      stage: 5,
      roomInStage: 1,
      wave: 1,
      monsterCategory: 'elite',
      monsterSubType: 1,
      count: 1,
    })
    const record = buildDefenseMonsterDetailRecord(
      { name: '精英侵蚀体', hp: '10,000', id: eliteId, isBoss: false },
      null,
      { anomaly_bar_coefficient: 1.0625 },
    )
    return record.monster_category === 'elite' && record.anomaly_bar_coefficient === 1.0625
  })(),
)
check(
  '小怪（minion ID）类别取「普通」，无 ID 的 isBoss ⇒ 首领',
  (() => {
    const minionId = encodeDefenseBossId({
      version: '3.2',
      phase: 2,
      stage: 5,
      roomInStage: 1,
      wave: 1,
      monsterCategory: 'minion',
      monsterSubType: 1,
      count: 3,
    })
    const minionRecord = buildDefenseMonsterDetailRecord(
      { name: '特种抗暴布', hp: '10,000', id: minionId, isBoss: false },
      null,
      null,
    )
    const bossRecord = buildDefenseMonsterDetailRecord({ name: '霸主侵蚀体', hp: '10,000', isBoss: true }, null, null)
    // 小怪改由 resolveDefenseMonsterCategory 解出 minion ⇒ 「普通」基础条（详见 test-defense-monster-detail）
    return minionRecord.monster_category === 'normal' &&
      minionRecord.anomaly_bar_coefficient === null &&
      bossRecord.monster_category === 'boss'
  })(),
)

console.log('[8] 源码守卫：展示层接线')
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
  'record 的 monster_category / anomaly_bar_coefficient 传入抗性表',
  stats.includes('monster_category: props.record.monster_category') &&
    stats.includes('anomaly_bar_coefficient: props.record.anomaly_bar_coefficient'),
)
check(
  'record 的 boss_name 一并传入抗性表（内置默认表按名生效）',
  stats.includes('boss_name: props.record.boss_name'),
)
check('最大异常积蓄表头带初始条长提示', stats.includes('title="初始条长（0 次已异常）"'))
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
check('危局弹窗按首领敌人取基础异常条', modal.includes("monster_category: 'boss'"))
check('危局弹窗从 boss_info 拉异常条系数', modal.includes('lookupBossInfo'))
check('危局弹窗用请求序号丢弃过期 boss_info 响应', modal.includes('bossInfoLoadEpoch.isCurrent'))
check('危局弹窗按怪名缓存系数，重开不重复请求', modal.includes('anomalyCoefficientCache'))

const comparePanel = readFileSync(
  new URL('../src/components/history/MonsterComparePanel.vue', import.meta.url),
  'utf8',
)
check('单独怪物对比页不开启该表（保持两列）', !comparePanel.includes('show-resistance-table'))

console.log('[9] 内置异常条系数表（按 Boss 名；本表为内置默认，boss_info 为覆盖值）')
check(
  '内置表收录 18 条且系数均为有限正数',
  Object.keys(ANOMALY_BAR_COEFFICIENT_BY_NAME).length === 18 &&
    Object.values(ANOMALY_BAR_COEFFICIENT_BY_NAME).every(
      (coefficient) => Number.isFinite(coefficient) && coefficient > 0,
    ),
  `${Object.keys(ANOMALY_BAR_COEFFICIENT_BY_NAME).length} 条`,
)
check(
  '「亵渎者」→ 1.32（表内带括号写法）',
  resolveAnomalyBarCoefficient('「亵渎者」') === 1.32,
  `${resolveAnomalyBarCoefficient('「亵渎者」')}`,
)
check(
  '亵渎者 → 1.32（不带括号写法同样命中：归一化容忍括号差异）',
  resolveAnomalyBarCoefficient('亵渎者') === 1.32,
  `${resolveAnomalyBarCoefficient('亵渎者')}`,
)
check(
  '猎血清道夫 → 1.0625（内置默认）',
  resolveAnomalyBarCoefficient('猎血清道夫') === 1.0625,
  `${resolveAnomalyBarCoefficient('猎血清道夫')}`,
)
check(
  '内嵌括号名去括号后同值：霸主侵蚀体·庞培 → 1.1',
  resolveAnomalyBarCoefficient('「霸主侵蚀体·庞培」') === 1.1 &&
    resolveAnomalyBarCoefficient('霸主侵蚀体·庞培') === 1.1,
)
check(
  '未收录名称 → 1 兜底',
  resolveAnomalyBarCoefficient('不存在的怪物') === 1,
)
check(
  'null / undefined / 空串 / 纯空白 → 1 兜底',
  resolveAnomalyBarCoefficient(null) === 1 &&
    resolveAnomalyBarCoefficient(undefined) === 1 &&
    resolveAnomalyBarCoefficient('') === 1 &&
    resolveAnomalyBarCoefficient('  ') === 1,
)
check(
  '显式值（boss_info 覆盖）优先于内置默认表：1.5 而非 1.32',
  resolveAnomalyBarCoefficient('「亵渎者」', 1.5) === 1.5,
  `${resolveAnomalyBarCoefficient('「亵渎者」', 1.5)}`,
)
check(
  '显式值非法（0 / -1 / NaN / Infinity）按未提供处理，回退内置默认表',
  resolveAnomalyBarCoefficient('「亵渎者」', 0) === 1.32 &&
    resolveAnomalyBarCoefficient('「亵渎者」', -1) === 1.32 &&
    resolveAnomalyBarCoefficient('「亵渎者」', Number.NaN) === 1.32 &&
    resolveAnomalyBarCoefficient('「亵渎者」', Number.POSITIVE_INFINITY) === 1.32,
)
check(
  '未收录名称 + 显式值 ⇒ 用显式值（覆盖值不依赖名称）',
  resolveAnomalyBarCoefficient('不存在的怪物', 1.25) === 1.25,
)

console.log('[10] 端到端：仅凭 boss_name 复现首发截图（不传显式系数）')
const builtinCoefficientRows = buildMonsterResistanceRows({
  weakness: '冰、物理、风',
  resistance: '电',
  resistance_high: '电',
  boss_name: '「亵渎者」',
  monster_category: 'boss',
})
const builtinByElement = byElement(builtinCoefficientRows)
check(
  '内置默认 1.32 三元组：物理 4752 / 火组 3960 / 风 1980',
  builtinByElement['物理'].maxAnomalyProgress === 4752 &&
    builtinByElement['火'].maxAnomalyProgress === 3960 &&
    builtinByElement['电'].maxAnomalyProgress === 3960 &&
    builtinByElement['冰'].maxAnomalyProgress === 3960 &&
    builtinByElement['以太'].maxAnomalyProgress === 3960 &&
    builtinByElement['风'].maxAnomalyProgress === 1980,
  maxAnomalyList(builtinCoefficientRows),
)
check(
  '与显式 1.32 用例四列完全同口径（内置默认可替代手工填值）',
  tuples(builtinCoefficientRows) === tuples(screenshotRows),
  tuples(builtinCoefficientRows),
)
check(
  'boss_info 覆盖值优先：带 boss_name 传 1.5 ⇒ 物理 5400 / 火组 4500 / 风 2250',
  maxAnomalyList(
    buildMonsterResistanceRows({
      boss_name: '「亵渎者」',
      monster_category: 'boss',
      anomaly_bar_coefficient: 1.5,
    }),
  ) === '4500 4500 4500 4500 5400 2250',
  maxAnomalyList(
    buildMonsterResistanceRows({
      boss_name: '「亵渎者」',
      monster_category: 'boss',
      anomaly_bar_coefficient: 1.5,
    }),
  ),
)
check(
  '非法显式值（0）不生效：带 boss_name 时回退内置 1.32',
  tuples(
    buildMonsterResistanceRows({
      weakness: '冰、物理、风',
      resistance: '电',
      resistance_high: '电',
      boss_name: '「亵渎者」',
      monster_category: 'boss',
      anomaly_bar_coefficient: 0,
    }),
  ) === tuples(screenshotRows),
  maxAnomalyList(
    buildMonsterResistanceRows({
      weakness: '冰、物理、风',
      resistance: '电',
      resistance_high: '电',
      boss_name: '「亵渎者」',
      monster_category: 'boss',
      anomaly_bar_coefficient: 0,
    }),
  ),
)
check(
  '未传 boss_name 时行为不变：仍是首领 × 系数 1',
  tuples(buildMonsterResistanceRows({ monster_category: 'boss' })) === tuples(plainRows),
)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
