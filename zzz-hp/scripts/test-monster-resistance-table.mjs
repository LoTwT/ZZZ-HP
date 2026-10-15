/**
 * 怪物详情「弱点与抗性」表：行序 / 百分比推导（锚定 RESISTANCE_VALUE_MAP）/ 截断口径 /
 * 最大异常积蓄 = 基础异常条 × 异常条系数 × 版本系数 / 防卫战类别映射 / 展示层接线守卫
 *
 * 基础异常条表来自用户提供的真实游戏数据（按敌人类别 × 属性分组 × 已异常次数分档）；
 * 异常积蓄与失衡的 ±20% 截断属待验证知识；1.32 系数用例复现用户首发的 nanoka 截图
 * （首领 70 级样本：物理 4752 / 火组 3960 / 风 1980）。
 * 异常条系数一律由数据侧下发（`boss_info.anomaly_bar_coefficient`；危局由 phases 随 boss 下发，
 * 按 Boss 名的内置默认表在后端读取时解析），前端只在字段缺失 / 非法时按 1 兜底，
 * 并把该行标记为估算（`maxAnomalyProgressEstimated`），不冒充真实最大异常积蓄。
 * 版本系数同为用户提供的游戏数据：2.1 第一期及以后 ×1.1，版本号解析不出时不乘。
 *
 * 运行：npx vite-node scripts/test-monster-resistance-table.mjs
 */
import { readFileSync } from 'node:fs'
import { fetchCrisisAssaultPhases } from '../src/api/crisisAssault.ts'
import { RESISTANCE_VALUE_MAP } from '../src/utils/enemyResistance.ts'
import {
  buildDefenseMonsterDetailRecord,
  defenseMonsterCategoryToTableCategory,
} from '../src/utils/defenseCompare.ts'
import { encodeDefenseBossId } from '../src/utils/defenseId.ts'
import {
  ANOMALY_BAR_VERSION_MULTIPLIER,
  ANOMALY_BAR_VERSION_MULTIPLIER_FROM,
  MONSTER_RESISTANCE_TABLE_ELEMENTS,
  buildMonsterResistanceRows,
  getMonsterBaseAnomalyProgress,
  isAnomalyBarCoefficientConfigured,
  isAnomalyBarVersionMultiplier,
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
  'record 的 version 传入抗性表（版本系数判定依据）',
  stats.includes('version: props.record.version'),
)
check('最大异常积蓄表头带初始条长提示', stats.includes('title="初始条长（0 次已异常）"'))
check(
  '详情数据块渲染「异常条系数」行，未配置显示「未配置」（不拿 1 冒充）',
  stats.includes('异常条系数：') &&
    stats.includes('anomalyBarCoefficientLabel') &&
    stats.includes('isAnomalyBarCoefficientConfigured') &&
    stats.includes("'未配置'"),
)
check(
  '系数未配置的最大异常积蓄加 * 标注并在表下加脚注',
  stats.includes('row.maxAnomalyProgressEstimated') &&
    stats.includes('monster-resistance-estimated') &&
    stats.includes('* 未配置异常条系数，数值为估算值'),
)
check(
  '「异常条系数」行在版本系数生效时追加 ×1.1 并用强调红标出',
  stats.includes('anomalyBarVersionMultiplierActive') &&
    stats.includes('isAnomalyBarVersionMultiplier(props.record?.version)') &&
    stats.includes('× {{ ANOMALY_BAR_VERSION_MULTIPLIER }}') &&
    /\.detail-version-multiplier \{[\s\S]*?color: #e85d4c;/.test(stats),
)
check(
  '图片列与数据列在桌面端等分宽度（图片放大 / 列表减半）',
  /@media \(min-width: 769px\) \{[\s\S]*?\.monster-detail-media,\s*\.monster-detail-data \{\s*flex: 1 1 0;/.test(stats),
)
check(
  '图片本身设宽度上限，避免半宽列下 3:4 竖图过高',
  stats.includes('width: min(100%, 320px)'),
)
check('三列档位不再单独把图片列压到 11% 宽', !stats.includes('clamp(96px, 11%, 150px)'))
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
check('危局弹窗不再请求 boss_info 取系数（系数随 phases 下发）', !modal.includes('lookupBossInfo'))
check(
  '危局弹窗直接读槽位下发的系数',
  modal.includes('anomaly_bar_coefficient: enemy.anomalyBarCoefficient ?? null'),
)
check(
  '危局弹窗不再持有系数缓存 / 请求序号',
  !modal.includes('anomalyCoefficientCache') && !modal.includes('bossInfoLoadEpoch'),
)

const comparePanel = readFileSync(
  new URL('../src/components/history/MonsterComparePanel.vue', import.meta.url),
  'utf8',
)
check('单独怪物对比页不开启该表（保持两列）', !comparePanel.includes('show-resistance-table'))

console.log('[9] 异常条系数兜底：值只来自数据侧，前端只按 1 兜底')
const tableSource = readFileSync(
  new URL('../src/utils/monsterResistanceTable.ts', import.meta.url),
  'utf8',
)
check(
  '前端不再持有按 Boss 名的内置系数表（默认值单点在后端）',
  !tableSource.includes('boss_name') && !tableSource.includes('ANOMALY_BAR_COEFFICIENT_BY_NAME'),
)
check(
  'API 下发 1.32 ⇒ 物理 4752 / 火组 3960 / 风 1980',
  maxAnomalyList(buildMonsterResistanceRows({ monster_category: 'boss', anomaly_bar_coefficient: 1.32 })) ===
    '3960 3960 3960 3960 4752 1980',
  maxAnomalyList(buildMonsterResistanceRows({ monster_category: 'boss', anomaly_bar_coefficient: 1.32 })),
)
check(
  '系数为 null ⇒ 1：首领 3600 / 火组 3000 / 风 1500',
  maxAnomalyList(buildMonsterResistanceRows({ monster_category: 'boss', anomaly_bar_coefficient: null })) ===
    '3000 3000 3000 3000 3600 1500',
  maxAnomalyList(buildMonsterResistanceRows({ monster_category: 'boss', anomaly_bar_coefficient: null })),
)
check(
  '系数缺省（字段缺失）⇒ 1，与显式 null 同口径',
  maxAnomalyList(buildMonsterResistanceRows({ monster_category: 'boss' })) ===
    '3000 3000 3000 3000 3600 1500',
  maxAnomalyList(buildMonsterResistanceRows({ monster_category: 'boss' })),
)
check(
  '非法系数（0 / -1 / NaN / Infinity）⇒ 1，不把最大异常积蓄算成 0 或负数',
  [0, -1, Number.NaN, Number.POSITIVE_INFINITY].every(
    (coefficient) =>
      maxAnomalyList(
        buildMonsterResistanceRows({ monster_category: 'boss', anomaly_bar_coefficient: coefficient }),
      ) === '3000 3000 3000 3000 3600 1500',
  ),
)
check(
  '系数 1.5 ⇒ 物理 5400 / 火组 4500 / 风 2250（数值随下发值线性变化）',
  maxAnomalyList(buildMonsterResistanceRows({ monster_category: 'boss', anomaly_bar_coefficient: 1.5 })) ===
    '4500 4500 4500 4500 5400 2250',
  maxAnomalyList(buildMonsterResistanceRows({ monster_category: 'boss', anomaly_bar_coefficient: 1.5 })),
)

console.log('[10] 端到端：phases 载荷 → EnemySlot → 数据行（系数由 API 下发）')
/** 与 MonsterDetailModal 的 detailRecord 同口径：危局怪按首领取基础异常条 + 槽位下发的系数 */
const rowsFromCrisisSlot = (slot) =>
  buildMonsterResistanceRows({
    weakness: slot.weakness,
    resistance: slot.resistance,
    resistance_high: slot.resistanceHigh,
    monster_category: 'boss',
    anomaly_bar_coefficient: slot.anomalyBarCoefficient,
  })

const phasePayload = {
  code: 200,
  message: 'ok',
  data: [
    {
      id: '3.2-4',
      version: '3.2',
      phase: '4',
      phaseLabel: '第 4 期',
      startDate: null,
      endDate: null,
      totalHp: 100,
      tid: 1,
      bosses: [
        {
          id: 1001,
          boss_name: '「亵渎者」',
          hp: 100,
          defense: 953,
          level: 70,
          room: '1',
          weakness: '冰、物理、风',
          resistance: '电',
          resistance_high: '电',
          boss_image: null,
          anomaly_bar_coefficient: 1.32,
        },
        {
          id: 1002,
          boss_name: '未配系数怪',
          hp: 100,
          defense: 953,
          level: 70,
          room: '2',
          weakness: null,
          resistance: null,
          boss_image: null,
          anomaly_bar_coefficient: null,
        },
      ],
      buffs: [],
    },
  ],
}

const originalFetch = globalThis.fetch
globalThis.fetch = async () =>
  new Response(JSON.stringify(phasePayload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
const crisisPhases = await fetchCrisisAssaultPhases()
globalThis.fetch = originalFetch

const apiRoom1Slot = crisisPhases[0].enemies.find((enemy) => enemy.label === '房间 1 Lv70')
const apiRoom2Slot = crisisPhases[0].enemies.find((enemy) => enemy.label === '房间 2 Lv70')
const apiEmptySlot = crisisPhases[0].enemies.find((enemy) => enemy.label === '房间 3')
check(
  'phases 的 anomaly_bar_coefficient 透传到怪物槽位（原先一律显示 1 的根因）',
  apiRoom1Slot?.anomalyBarCoefficient === 1.32,
  String(apiRoom1Slot?.anomalyBarCoefficient),
)
check(
  '槽位 1.32 ⇒ 数据行四列与首发截图一致（物理 4752 / 火组 3960 / 风 1980）',
  apiRoom1Slot != null && tuples(rowsFromCrisisSlot(apiRoom1Slot)) === tuples(screenshotRows),
  apiRoom1Slot ? tuples(rowsFromCrisisSlot(apiRoom1Slot)) : '未取到房间 1 槽位',
)
check(
  '槽位系数为 null ⇒ 前端按 1 兜底（首领 3600 / 火组 3000 / 风 1500）',
  apiRoom2Slot?.anomalyBarCoefficient === null &&
    maxAnomalyList(rowsFromCrisisSlot(apiRoom2Slot)) === '3000 3000 3000 3000 3600 1500',
  apiRoom2Slot ? maxAnomalyList(rowsFromCrisisSlot(apiRoom2Slot)) : '未取到房间 2 槽位',
)
check(
  '空槽位不带系数（undefined）⇒ 仍按 1',
  apiEmptySlot != null &&
    apiEmptySlot.anomalyBarCoefficient === undefined &&
    maxAnomalyList(rowsFromCrisisSlot(apiEmptySlot)) === '3000 3000 3000 3000 3600 1500',
)

const apiSource = readFileSync(new URL('../src/api/crisisAssault.ts', import.meta.url), 'utf8')
const enemySlotTypes = readFileSync(new URL('../src/types/history.ts', import.meta.url), 'utf8')
check(
  'phases API 的 boss 载荷声明 anomaly_bar_coefficient',
  apiSource.includes('anomaly_bar_coefficient?: number | null'),
)
check(
  'phases API 把系数随 boss 透传到槽位',
  apiSource.includes('anomalyBarCoefficient: boss.anomaly_bar_coefficient ?? null'),
)
check(
  'EnemySlot 声明 anomalyBarCoefficient',
  enemySlotTypes.includes('anomalyBarCoefficient?: number | null'),
)

console.log(`[11] 版本系数：${ANOMALY_BAR_VERSION_MULTIPLIER_FROM} 第一期及以后异常条 ×${ANOMALY_BAR_VERSION_MULTIPLIER}`)
const coefficient132 = 1.32
/** 期望值一律由基础条表 × 常量推导，不写死结果 */
const bossBase = (element) => getMonsterBaseAnomalyProgress('boss', element, 0)
const expectedWithVersion = (base) => Math.round(base * coefficient132 * ANOMALY_BAR_VERSION_MULTIPLIER)
const rowsNoVersion = byElement(
  buildMonsterResistanceRows({ monster_category: 'boss', anomaly_bar_coefficient: coefficient132 }),
)
const rowsVersion32 = byElement(
  buildMonsterResistanceRows({
    monster_category: 'boss',
    anomaly_bar_coefficient: coefficient132,
    version: '3.2',
  }),
)

check(
  '版本判定：2.1 / 3.2 为真，2.0 / 1.4 为假',
  isAnomalyBarVersionMultiplier('2.1') &&
    isAnomalyBarVersionMultiplier('3.2') &&
    !isAnomalyBarVersionMultiplier('2.0') &&
    !isAnomalyBarVersionMultiplier('1.4'),
  ['2.1', '3.2', '2.0', '1.4'].map((v) => `${v}=${isAnomalyBarVersionMultiplier(v)}`).join(' '),
)
check(
  '版本缺失 / 空串 / 非数字一律不乘（保守）',
  [null, undefined, '', '   ', 'abc', '2.x'].every((version) => !isAnomalyBarVersionMultiplier(version)),
  [null, '', 'abc'].map((v) => `${JSON.stringify(v)}=${isAnomalyBarVersionMultiplier(v)}`).join(' '),
)
check(
  `阈值常量导出：${ANOMALY_BAR_VERSION_MULTIPLIER_FROM} ⇒ ${ANOMALY_BAR_VERSION_MULTIPLIER}`,
  ANOMALY_BAR_VERSION_MULTIPLIER === 1.1 && ANOMALY_BAR_VERSION_MULTIPLIER_FROM === '2.1',
)
check(
  `无版本 ⇒ 维持原值：物理 ${rowsNoVersion['物理'].maxAnomalyProgress}（基础条 ${bossBase('物理')} × ${coefficient132}）`,
  rowsNoVersion['物理'].maxAnomalyProgress === Math.round(bossBase('物理') * coefficient132) &&
    rowsNoVersion['物理'].maxAnomalyProgress === 4752,
  String(rowsNoVersion['物理'].maxAnomalyProgress),
)
check(
  `版本 3.2 ⇒ 物理 ${rowsVersion32['物理'].maxAnomalyProgress}（${bossBase('物理')} × ${coefficient132} × ${ANOMALY_BAR_VERSION_MULTIPLIER}）`,
  rowsVersion32['物理'].maxAnomalyProgress === expectedWithVersion(bossBase('物理')) &&
    rowsVersion32['物理'].maxAnomalyProgress === 5227,
  String(rowsVersion32['物理'].maxAnomalyProgress),
)
check(
  `版本 3.2 ⇒ 火组 ${rowsVersion32['火'].maxAnomalyProgress} / 风 ${rowsVersion32['风'].maxAnomalyProgress} 同步放大（分组不影响版本系数）`,
  rowsVersion32['火'].maxAnomalyProgress === expectedWithVersion(bossBase('火')) &&
    rowsVersion32['风'].maxAnomalyProgress === expectedWithVersion(bossBase('风')) &&
    rowsVersion32['火'].maxAnomalyProgress === 4356 &&
    rowsVersion32['风'].maxAnomalyProgress === 2178,
  `火=${rowsVersion32['火'].maxAnomalyProgress} 风=${rowsVersion32['风'].maxAnomalyProgress} 电=${rowsVersion32['电'].maxAnomalyProgress}`,
)
check(
  '版本 2.0（未跨 2.1）⇒ 不乘版本系数，仍为 4752',
  byElement(
    buildMonsterResistanceRows({
      monster_category: 'boss',
      anomaly_bar_coefficient: coefficient132,
      version: '2.0',
    }),
  )['物理'].maxAnomalyProgress === 4752,
)
check(
  '版本系数与异常条系数相乘后只取整一次（1.0625 × 1.1：先取整会差 1）',
  (() => {
    const rows = byElement(
      buildMonsterResistanceRows({
        monster_category: 'boss',
        anomaly_bar_coefficient: 1.0625,
        version: '3.2',
      }),
    )
    const base = bossBase('火')
    const roundedOnce = Math.round(base * 1.0625 * ANOMALY_BAR_VERSION_MULTIPLIER)
    const roundedTwice = Math.round(Math.round(base * 1.0625) * ANOMALY_BAR_VERSION_MULTIPLIER)
    return rows['火'].maxAnomalyProgress === roundedOnce && roundedOnce !== roundedTwice
  })(),
)

console.log('[12] maxAnomalyProgressEstimated：系数未配置时不冒充最大异常积蓄')
const rowsWithCoefficient = (coefficient, version) =>
  buildMonsterResistanceRows({
    monster_category: 'boss',
    anomaly_bar_coefficient: coefficient,
    version,
  })
check(
  '系数缺省 / null / 0 / -1 / NaN ⇒ 六行全标估算',
  [undefined, null, 0, -1, Number.NaN].every((coefficient) =>
    rowsWithCoefficient(coefficient).every((row) => row.maxAnomalyProgressEstimated === true),
  ),
)
check(
  '有效系数（1 / 1.32 / 1.0625 / 2）⇒ 不标估算',
  [1, 1.32, 1.0625, 2].every((coefficient) =>
    rowsWithCoefficient(coefficient).every((row) => row.maxAnomalyProgressEstimated === false),
  ),
)
check(
  'Infinity ⇒ 同样按未配置处理（脏数据不当作已配置）',
  rowsWithCoefficient(Number.POSITIVE_INFINITY).every(
    (row) => row.maxAnomalyProgressEstimated === true,
  ),
)
check(
  '估算标记与 isAnomalyBarCoefficientConfigured 同规则（单一事实来源）',
  [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.5, 1, 1.32].every((coefficient) =>
    rowsWithCoefficient(coefficient).every(
      (row) => row.maxAnomalyProgressEstimated === !isAnomalyBarCoefficientConfigured(coefficient),
    ),
  ),
)
check(
  '估算行数值仍保留（首领 3600 / 火组 3000 / 风 1500），不因标记而清零',
  maxAnomalyList(rowsWithCoefficient(undefined)) === '3000 3000 3000 3000 3600 1500',
  maxAnomalyList(rowsWithCoefficient(undefined)),
)
check(
  '系数未配置但版本 ≥2.1 ⇒ 数值仍乘版本系数并标估算（版本是独立已知事实）',
  (() => {
    const rows = byElement(rowsWithCoefficient(undefined, '3.2'))
    return (
      rows['物理'].maxAnomalyProgress ===
        Math.round(bossBase('物理') * ANOMALY_BAR_VERSION_MULTIPLIER) &&
      rows['物理'].maxAnomalyProgressEstimated === true
    )
  })(),
  String(byElement(rowsWithCoefficient(undefined, '3.2'))['物理'].maxAnomalyProgress),
)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
