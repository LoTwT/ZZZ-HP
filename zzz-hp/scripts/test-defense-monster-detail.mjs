/**
 * 防卫战往期详细 · 怪物详情弹窗：数据行组装口径 + 图表类别推导 + 接线守卫
 *
 * 运行：npx vite-node scripts/test-defense-monster-detail.mjs
 */
import { readFileSync } from 'node:fs'
import { encodeDefenseBossId } from '../src/utils/defenseId.ts'
import {
  buildDefenseBossChart,
  buildDefenseMonsterDetailRecord,
  getDefenseMonsterCategory,
  isDefenseEliteOrBoss,
} from '../src/utils/defenseCompare.ts'

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
  return {
    name: '霸主侵蚀体',
    hp: '1,423,183',
    hpValue: 1423183,
    defense: 683,
    staggerTime: 5,
    weakness: '冰、火',
    resistance: '电、无',
    resistanceHigh: '火',
    isBoss: true,
    ...overrides,
  }
}

function makeBossInfo(overrides) {
  return { level: 60, stagger_multiplier: 1.5, stagger_time: 5, ...overrides }
}

console.log('[1] buildDefenseMonsterDetailRecord：防卫战怪物 → 共享数据行')
const baseRecord = buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo())
check(
  '怪物名 / 血量 / 防御 / 失衡时间 / 弱抗取自 DefenseEnemy',
  baseRecord.boss_name === '霸主侵蚀体' &&
    baseRecord.hp === '1,423,183' &&
    baseRecord.defense === 683 &&
    baseRecord.stagger_time === 5 &&
    baseRecord.weakness === '冰、火' &&
    baseRecord.resistance === '电、无' &&
    baseRecord.resistance_high === '火',
  JSON.stringify(baseRecord),
)
check(
  '等级 / 失衡易伤来自 boss_info（DefenseEnemy 不带）',
  baseRecord.level === 60 && baseRecord.stagger_multiplier === 1.5,
)
check(
  '危局专属字段不填（基础血量 / 血量系数不出现在防卫战数据行）',
  baseRecord.crisis_base_hp === undefined &&
    baseRecord.hp_coeff_label === undefined &&
    baseRecord.hp_coeff_delta_label === undefined,
)
check(
  '无往期出现时不渲染血量膨胀 / 增量行',
  baseRecord.hp_expansion === null && baseRecord.hp_delta_label === null,
)

const compared = buildDefenseMonsterDetailRecord(
  makeEnemy(),
  { diff: 300000, expansion: '+25.0%' },
  makeBossInfo(),
)
check(
  '有往期出现时膨胀与增量按对比结果渲染（与卡片同口径）',
  compared.hp_expansion === '+25.0%' && compared.hp_delta_label === '+300,000',
  `${compared.hp_expansion} / ${compared.hp_delta_label}`,
)
check(
  '负向差值保留负号',
  buildDefenseMonsterDetailRecord(makeEnemy(), { diff: -1200, expansion: '-3.0%' }, null)
    .hp_delta_label === '-1,200',
)

const noBossInfo = buildDefenseMonsterDetailRecord(makeEnemy({ staggerTime: null }), null, null)
check(
  'boss_info 查无记录（含请求失败）时等级 / 失衡易伤 / 失衡时间为 null ⇒ 行隐藏',
  noBossInfo.level === null &&
    noBossInfo.stagger_multiplier === null &&
    noBossInfo.stagger_time === null,
  JSON.stringify(noBossInfo),
)
check(
  '怪物自带失衡时间优先于 boss_info 的回退值',
  buildDefenseMonsterDetailRecord(
    makeEnemy({ staggerTime: 4 }),
    null,
    makeBossInfo({ stagger_time: 5 }),
  ).stagger_time === 4,
)
check(
  '怪物未带失衡时间时回退 boss_info',
  buildDefenseMonsterDetailRecord(
    makeEnemy({ staggerTime: undefined }),
    null,
    makeBossInfo({ stagger_time: 6 }),
  ).stagger_time === 6,
)

const sparse = buildDefenseMonsterDetailRecord(
  { name: '无名小怪', hp: '10,000' },
  null,
  null,
)
check(
  '字段缺失时统一落 null（而非 undefined），对应行不渲染',
  sparse.defense === null &&
    sparse.weakness === null &&
    sparse.resistance === null &&
    sparse.resistance_high === null &&
    sparse.level === null &&
    sparse.stagger_multiplier === null &&
    sparse.stagger_time === null,
  JSON.stringify(sparse),
)

console.log('[2] getDefenseMonsterCategory：折线图类别推导')
const bossId = encodeDefenseBossId({
  version: '3.2',
  phase: 2,
  stage: 5,
  roomInStage: 1,
  wave: 2,
  monsterCategory: 'boss',
  monsterSubType: 1,
  count: 1,
})
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
check(
  'ID 编码优先：Boss / 精英分别解出对应类别',
  getDefenseMonsterCategory(makeEnemy({ id: bossId })) === 'boss' &&
    getDefenseMonsterCategory(makeEnemy({ id: eliteId })) === 'elite',
)
check(
  '旧数据无 ID 时回退 isBoss',
  getDefenseMonsterCategory(makeEnemy({ id: undefined, isBoss: true })) === 'boss',
)
check(
  '小怪（ID 为 minion / 无 ID 且非 Boss）推不出类别 ⇒ 弹窗不渲染图表区块',
  getDefenseMonsterCategory(makeEnemy({ id: minionId, isBoss: false })) === null &&
    getDefenseMonsterCategory(makeEnemy({ id: undefined, isBoss: false })) === null &&
    getDefenseMonsterCategory({ name: '小怪布', hp: '1' }) === null,
)
check(
  'isDefenseEliteOrBoss 与类别推导一致',
  isDefenseEliteOrBoss(makeEnemy({ id: bossId })) === true &&
    isDefenseEliteOrBoss({ name: '小怪布', hp: '1' }) === false,
)

console.log('[3] buildDefenseBossChart：按类别 + 名称取各期血量点')
function makeDefenseSeason(version, phase, enemies) {
  return {
    id: `${version}-${phase}`,
    version,
    phase,
    dateRange: '2026.6.26 - 2026.7.10',
    seasonId: '62051',
    nodeType: '剧变节点',
    rawHp: '1,000,000',
    frontiers: [
      {
        id: '6205105',
        title: '第五防线',
        level: 70,
        rooms: [
          {
            id: '62051051',
            label: '房间 1',
            level: 70,
            zoneBuffs: [],
            roomBuff: { name: '霜冻风暴', lines: ['效果'] },
            battleRooms: [
              {
                id: 'br1',
                label: '战斗房间 1',
                waveCount: 1,
                weakness: [],
                waves: [{ label: 'WAVE 1', enemies }],
              },
            ],
          },
        ],
      },
    ],
  }
}

const minionEnemy = { name: '特种抗暴布', hp: '1,423,183', hpValue: 1423183, count: 3 }
const chartSeasons = [
  makeDefenseSeason('3.0', '第 1 期', [makeEnemy({ id: bossId, hpValue: 1000000, hp: '1,000,000' }), minionEnemy]),
  makeDefenseSeason('3.1', '第 2 期', [makeEnemy({ id: bossId, hpValue: 1200000, hp: '1,200,000' })]),
]
const bossPoints = buildDefenseBossChart(chartSeasons, '霸主侵蚀体', 'boss')
check(
  '同一 Boss 的各期血量点齐全（期数标签 + 数值）',
  bossPoints.length === 2 &&
    bossPoints[0].label === '3.0第1期' &&
    bossPoints[1].totalHp === 1200000,
  JSON.stringify(bossPoints.map((point) => [point.label, point.totalHp])),
)
check(
  '类别不匹配的同类怪物不串入折线',
  buildDefenseBossChart(chartSeasons, '霸主侵蚀体', 'elite').length === 0,
)
check(
  '无出场记录时返回空数组 ⇒ 弹窗显示「暂无历史数据」',
  buildDefenseBossChart(chartSeasons, '不存在怪物', 'boss').length === 0,
)

console.log('[4] 源码守卫：弹窗与面板接线')
const modalSource = readFileSync(
  new URL('../src/components/defense/DefenseMonsterDetailModal.vue', import.meta.url),
  'utf8',
)
check('弹窗复用共享数据块组件', modalSource.includes('MonsterDetailStats'))
check('弹窗外壳用 IkModalShell（Teleport 到 body，层级高于往期详细弹窗）', modalSource.includes('IkModalShell'))
check('折线图走防卫战接口 fetchDefenseBossChart', modalSource.includes('fetchDefenseBossChart'))
check('等级 / 失衡易伤取 boss_info 基础库', modalSource.includes('lookupBossInfo'))
check('快切用请求序号丢弃过期响应', modalSource.includes('createRequestEpoch'))
check('图表区块按类别推导结果决定是否渲染', modalSource.includes('v-if="chartCategory"'))
check('图表用 page-scroll 形态（图表自然高度、弹窗 body 滚动）', modalSource.includes(':page-scroll="true"'))
check('不传危局专属的系数图开关', !modalSource.includes('enable-hp-coeff-charts'))

const panelSource = readFileSync(
  new URL('../src/components/defense/DefenseDetailPanel.vue', import.meta.url),
  'utf8',
)
check('可点击怪物卡片由 canOpenMonsterDetail 控制', panelSource.includes("'enemy-chip--clickable': canOpenMonsterDetail(enemy)"))
check('仅非管理端可点开', panelSource.includes('return !props.adminMode && Boolean(enemy.name)'))
check('卡片声明按钮语义 + 键盘可达', panelSource.includes("canOpenMonsterDetail(enemy) ? 'button' : undefined"))
check('卡片有手型光标与 focus-visible 轮廓', panelSource.includes('.enemy-chip--clickable:focus-visible'))
check('管理端编辑/删除按钮继续 @click.stop', (panelSource.match(/@click\.stop/g)?.length ?? 0) >= 2)
check('弹窗传当前版本以取对应期数', panelSource.includes(':variant="defenseVariant"'))

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
