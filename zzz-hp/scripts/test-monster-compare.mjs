/**
 * 怪物数据库：面板命名（含三模式全名）+ BossOption × boss_info 基础库联表归一化
 * + 选择器/数据块/「弱点与抗性」表接线守卫
 *
 * 运行：npx vite-node scripts/test-monster-compare.mjs
 */
import { readFileSync } from 'node:fs'
import { getModePanelLabel, MODE_PANEL_DEFINITIONS } from '../src/config/modePanels.ts'
import { joinBossOptionsWithInfo } from '../src/utils/bossPickerItems.ts'

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

function makeOption(overrides) {
  return { boss_name: '霸主侵蚀体', boss_image: null, ...overrides }
}

function makeRecord(overrides) {
  return {
    id: 1,
    boss_name: '霸主侵蚀体',
    defense: 953,
    level: 60,
    boss_image: 'boss_image/霸主侵蚀体.png',
    weakness: '冰、火',
    resistance: '电',
    resistance_high: '火',
    crisis_base_hp: 123456,
    stagger_multiplier: 1.5,
    stagger_time: 5,
    ...overrides,
  }
}

console.log('[1] joinBossOptionsWithInfo：按精确 boss_name 联表')
const items = joinBossOptionsWithInfo(
  [makeOption({ boss_name: '霸主侵蚀体' }), makeOption({ boss_name: '其他怪物' })],
  [makeRecord()],
)
check('条目数量与顺序跟 BossOption 一致', items.length === 2 && items[1].bossName === '其他怪物')
check(
  '命中记录时补齐防御/等级/失衡/弱点/抗性/高抗',
  items[0].defense === 953 &&
    items[0].level === 60 &&
    items[0].staggerMultiplier === 1.5 &&
    items[0].weakness === '冰、火' &&
    items[0].resistance === '电' &&
    items[0].resistanceHigh === '火',
)
check(
  '基础库缺失的怪物仍保留条目，展示字段为 null',
  items[1].bossName === '其他怪物' &&
    items[1].defense === null &&
    items[1].level === null &&
    items[1].staggerMultiplier === null &&
    items[1].weakness === null &&
    items[1].resistance === null &&
    items[1].resistanceHigh === null,
)

console.log('[2] 图片回退：BossOption 优先，缺省回退 boss_info')
check(
  'BossOption 有图时用 BossOption 的图',
  joinBossOptionsWithInfo([makeOption({ boss_image: 'a.png' })], [makeRecord()])[0].bossImage === 'a.png',
)
check(
  'BossOption 无图时回退 boss_info 的图',
  joinBossOptionsWithInfo([makeOption({ boss_image: null })], [makeRecord()])[0].bossImage ===
    'boss_image/霸主侵蚀体.png',
)
check(
  '两侧都无图时为 null',
  joinBossOptionsWithInfo(
    [makeOption({ boss_image: null })],
    [makeRecord({ boss_image: null })],
  )[0].bossImage === null,
)

console.log('[3] 名字精确匹配（不做模糊/前后缀匹配）')
check(
  '名字带前后缀差异时不联表',
  joinBossOptionsWithInfo(
    [makeOption({ boss_name: '霸主侵蚀体·前哨' })],
    [makeRecord()],
  )[0].defense === null,
)
check('空列表输入返回空数组', joinBossOptionsWithInfo([], []).length === 0)

console.log('[4] 面板命名：侧栏 / 移动端副标题都走 getModePanelLabel')
const monsterPanel = MODE_PANEL_DEFINITIONS.find((definition) => definition.id === 'monster-compare')
check('兜底 label 为「怪物数据库」', monsterPanel?.label === '怪物数据库')
check(
  '三模式全名：危局 / 防卫战 / 临界推演',
  getModePanelLabel('crisis-assault', 'monster-compare') === '危局怪物数据库' &&
    getModePanelLabel('defense', 'monster-compare') === '防卫战怪物数据库' &&
    getModePanelLabel('deduction', 'monster-compare') === '临界推演怪物数据库',
)

console.log('[5] 源码守卫：面板接线')
const panel = readFileSync(
  new URL('../src/components/history/MonsterComparePanel.vue', import.meta.url),
  'utf8',
)
check('选择器仍走各模式 fetch*BossList（模式过滤不动）', panel.includes('fetchDeductionBossList()') && panel.includes('fetchDefenseBossList(defenseVariant.value, selectedCategory.value)') && panel.includes('fetchBossList(crisisRoomType.value)'))
check('联表结果喂给选择弹窗', panel.includes(':items="pickerItems"'))
check('选中后用 lookupBossInfo 拉详情并有独立 epoch 守卫', panel.includes('lookupBossInfo(bossName)') && panel.includes('bossDetailLoadEpoch.isCurrent(token)'))
check(
  '详情数据块挂载在图表上方并接 record + 图片更换入口',
  panel.includes('class="monster-compare-stats"') &&
    panel.includes(':record="detailRecord"') &&
    panel.includes('image-clickable') &&
    panel.includes('@image-click="pickerModalOpen = true"'),
)
check('数据块开启「弱点与抗性」表（与怪物详情弹窗同款三列）', panel.includes(':show-resistance-table="true"'))
check('页面标题用「怪物数据库」', panel.includes('{{ pageTitle }} · 怪物数据库'))
check('图表 v-model:hp-mode 仍耦合 crisisRoomType', panel.includes('v-model:hp-mode="crisisRoomType"'))
check('防卫战怪物类型 select 保留', panel.includes('v-model="selectedCategory"'))
check('原有 epoch 守卫保留', panel.includes('bossListLoadEpoch.isCurrent(token)') && panel.includes('bossChartLoadEpoch.isCurrent(token)'))

const pickerModal = readFileSync(
  new URL('../src/components/history/BossPickerModal.vue', import.meta.url),
  'utf8',
)
check('弹窗 select 事件只上抛 bossName', pickerModal.includes("emit('select', item.bossName)"))
check('弹窗卡片抗性带 40% 档（resistanceHigh）', pickerModal.includes('formatTraitTextWithPercent(item.resistance, item.resistanceHigh)'))
check(
  '弹窗取消只 close，不改选中',
  // 遮罩不再用 @click.self（会把「弹窗里按下、拖到遮罩上松手」误判成点遮罩），
  // 改成 pointerdown/click 落点双判定；这里的契约不变：关窗只 emit('close')，不碰选中。
  pickerModal.includes('@pointerdown="onMaskPointerDown"') &&
    pickerModal.includes('@click="onMaskClick"') &&
    pickerModal.includes("useMaskClose(() => emit('close'))"),
)

const stats = readFileSync(
  new URL('../src/components/history/MonsterDetailStats.vue', import.meta.url),
  'utf8',
)
check('失衡易伤回退 DEFAULT_ENEMY_STAGGER_MULTIPLIER', stats.includes('DEFAULT_ENEMY_STAGGER_MULTIPLIER'))
check('基础血量走 formatHp', stats.includes('formatHp(record.crisis_base_hp)'))
check('抗性行传 resistance_high（snake_case BossInfoRecord）', stats.includes(':high-value="record.resistance_high"'))

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
