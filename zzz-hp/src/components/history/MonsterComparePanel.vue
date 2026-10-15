<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import DualLineChartView from '@/components/history/DualLineChartView.vue'
import PhaseDetailModal from '@/components/history/PhaseDetailModal.vue'
import {
  fetchBossChart,
  fetchBossList,
  type BossOption,
  type HpChartPoint,
} from '@/api/crisisAssault'
import { fetchDefenseBossChart, fetchDefenseBossList } from '@/api/defense'
import {
  fetchDeductionBossChart,
  fetchDeductionBossList,
} from '@/api/deduction'
import { fetchBossInfoList, lookupBossInfo, type BossInfoRecord } from '@/api/bossInfo'
import BossPickerModal from '@/components/history/BossPickerModal.vue'
import MonsterDetailStats from '@/components/history/MonsterDetailStats.vue'
import { usePhaseDetailModal } from '@/composables/usePhaseDetailModal'
import type { DefenseVariant } from '@/types/defense'
import { modeTitles, type ModeKey } from '@/types/history'
import type { DefenseCompareMonsterCategory } from '@/utils/defenseCompare'
import { joinBossOptionsWithInfo } from '@/utils/bossPickerItems'
import { resolveAssetUrl } from '@/utils/gameData'
import { createRequestEpoch } from '@/utils/requestEpoch'

const props = defineProps<{
  mode: ModeKey
}>()

const route = useRoute()
const bossList = ref<BossOption[]>([])
const selectedBoss = ref('')
const selectedCategory = ref<DefenseCompareMonsterCategory>('elite')
const crisisRoomType = ref<'normal' | 'hard'>('normal')
const points = ref<HpChartPoint[]>([])
const bossListLoadEpoch = createRequestEpoch()
const bossChartLoadEpoch = createRequestEpoch()
const bossInfoLoadEpoch = createRequestEpoch()
const bossDetailLoadEpoch = createRequestEpoch()
const listLoading = ref(false)
const chartLoading = ref(false)
const listError = ref('')
const chartError = ref('')
const bossInfoRecords = ref<BossInfoRecord[]>([])
const selectedBossDetail = ref<BossInfoRecord | null>(null)
const pickerModalOpen = ref(false)
const { visible: detailVisible, point: detailPoint, open: openPhaseDetail, close: closePhaseDetail } =
  usePhaseDetailModal()

const defenseVariant = computed<DefenseVariant>(() =>
  route.meta.defenseVariant === 'new' ? 'new' : 'old',
)

const isDefenseMode = computed(() => props.mode === 'defense')
const isDeductionMode = computed(() => props.mode === 'deduction')

const pageTitle = computed(() => modeTitles[props.mode])

const panelDesc = computed(() => {
  if (isDeductionMode.value) {
    return '选择终局 Boss，查看其在各期出现的总血量与相对膨胀变化'
  }
  if (isDefenseMode.value) {
    return '先选择精英或 Boss，再选择怪物，查看其在各期出现时的血量与相对膨胀变化'
  }
  return crisisRoomType.value === 'hard'
    ? '选择绝境模式 Boss 后，查看其在各期出现时的血量、危局血量系数与相对变化'
    : '选择正常模式 Boss（房间 1/2/3）后，查看其在各期出现时的血量、危局血量系数与相对变化'
})

const selectedBossInfo = computed(() =>
  bossList.value.find((boss) => boss.boss_name === selectedBoss.value),
)

const categoryLabel = computed(() => (selectedCategory.value === 'elite' ? '精英' : 'Boss'))

const bossSelectLabel = computed(() =>
  isDeductionMode.value
    ? '选择 Boss'
    : isDefenseMode.value
      ? `选择${categoryLabel.value}`
      : crisisRoomType.value === 'hard'
        ? '选择绝境 Boss'
        : '选择正常 Boss',
)

const pickerItems = computed(() => joinBossOptionsWithInfo(bossList.value, bossInfoRecords.value))

async function loadBossList() {
  const token = bossListLoadEpoch.next()
  if (props.mode !== 'crisis-assault' && props.mode !== 'defense' && props.mode !== 'deduction') return

  listLoading.value = true
  listError.value = ''
  try {
    const list = isDeductionMode.value
      ? await fetchDeductionBossList()
      : isDefenseMode.value
        ? await fetchDefenseBossList(defenseVariant.value, selectedCategory.value)
        : await fetchBossList(crisisRoomType.value)
    if (!bossListLoadEpoch.isCurrent(token)) return

    bossList.value = list
    if (bossList.value.some((boss) => boss.boss_name === selectedBoss.value)) return
    selectedBoss.value = bossList.value[0]?.boss_name ?? ''
  } catch (error) {
    if (!bossListLoadEpoch.isCurrent(token)) return
    listError.value = error instanceof Error ? error.message : '加载怪物列表失败'
    bossList.value = []
    selectedBoss.value = ''
  } finally {
    if (!bossListLoadEpoch.isCurrent(token)) return
    listLoading.value = false
  }
}

async function loadBossChart() {
  const token = bossChartLoadEpoch.next()
  if (!selectedBoss.value) {
    points.value = []
    return
  }

  chartLoading.value = true
  chartError.value = ''
  try {
    const chartPoints = isDeductionMode.value
      ? await fetchDeductionBossChart(selectedBoss.value)
      : isDefenseMode.value
        ? await fetchDefenseBossChart(
            defenseVariant.value,
            selectedBoss.value,
            selectedCategory.value,
          )
        : await fetchBossChart(selectedBoss.value, crisisRoomType.value)
    if (!bossChartLoadEpoch.isCurrent(token)) return
    points.value = chartPoints
  } catch (error) {
    if (!bossChartLoadEpoch.isCurrent(token)) return
    chartError.value = error instanceof Error ? error.message : '加载折线图失败'
    points.value = []
  } finally {
    if (!bossChartLoadEpoch.isCurrent(token)) return
    chartLoading.value = false
  }
}

/**
 * 拉取 boss_info 基础库全量（后端单页上限 500），按 boss_name 给选择卡片补展示字段。
 * 加载失败只降级为卡片少字段，不阻断怪物列表与图表。
 */
async function loadBossInfoCatalog() {
  const token = bossInfoLoadEpoch.next()
  try {
    const collected: BossInfoRecord[] = []
    let offset = 0
    while (offset < 2000) {
      const result = await fetchBossInfoList({ limit: 500, offset })
      if (!bossInfoLoadEpoch.isCurrent(token)) return
      collected.push(...result.items)
      offset += result.items.length
      if (!result.items.length || offset >= result.total) break
    }
    bossInfoRecords.value = collected
  } catch {
    if (!bossInfoLoadEpoch.isCurrent(token)) return
    bossInfoRecords.value = []
  }
}

/** 选中怪物后拉取基础库详情用于数据块；快切时丢弃过期响应，查无记录时整块隐藏 */
async function loadSelectedBossDetail() {
  const bossName = selectedBoss.value
  if (!bossName) {
    selectedBossDetail.value = null
    return
  }

  const token = bossDetailLoadEpoch.next()
  try {
    const record = await lookupBossInfo(bossName)
    if (!bossDetailLoadEpoch.isCurrent(token)) return
    selectedBossDetail.value = record
  } catch {
    if (!bossDetailLoadEpoch.isCurrent(token)) return
    selectedBossDetail.value = null
  }
}

function handleBossPicked(bossName: string) {
  selectedBoss.value = bossName
  pickerModalOpen.value = false
}

onMounted(() => {
  loadBossList()
  loadBossInfoCatalog()
})

watch(defenseVariant, () => {
  if (isDefenseMode.value) {
    selectedBoss.value = ''
    loadBossList()
  }
})

watch(selectedCategory, () => {
  if (!isDefenseMode.value) return
  selectedBoss.value = ''
  loadBossList()
})

watch(crisisRoomType, () => {
  if (isDefenseMode.value) return
  selectedBoss.value = ''
  loadBossList()
})

watch(selectedBoss, () => {
  loadBossChart()
  loadSelectedBossDetail()
})
</script>

<template>
  <div class="monster-compare-panel">
    <header class="panel-header">
      <h1 class="page-title">{{ pageTitle }} · 单独怪物对比</h1>
      <p class="panel-desc">{{ panelDesc }}</p>
    </header>

    <p v-if="listLoading" class="status-text">加载怪物列表中...</p>
    <p v-else-if="listError" class="status-text error">{{ listError }}</p>

    <template v-else>
      <div class="selector-toolbar" :class="{ 'selector-toolbar--defense': isDefenseMode }">
        <div v-if="isDefenseMode" class="selector-field">
          <label class="selector-label" for="category-select">怪物类型</label>
          <select id="category-select" v-model="selectedCategory" class="boss-select">
            <option value="elite">精英</option>
            <option value="boss">Boss</option>
          </select>
        </div>

        <div class="selector-field">
          <span class="selector-label">{{ bossSelectLabel }}</span>
          <div class="selector-row">
            <img
              v-if="selectedBossInfo?.boss_image"
              :src="resolveAssetUrl(selectedBossInfo.boss_image)"
              :alt="selectedBoss"
              class="boss-thumb"
            />
            <span class="boss-selected-name" :class="{ 'boss-selected-name--empty': !selectedBoss }">
              {{ selectedBoss || '未选择' }}
            </span>
            <button
              type="button"
              class="boss-picker-btn"
              :disabled="!pickerItems.length"
              @click="pickerModalOpen = true"
            >
              {{ selectedBoss ? '更换' : '选择' }}
            </button>
          </div>
        </div>
      </div>

      <MonsterDetailStats class="monster-compare-stats" :record="selectedBossDetail" />

      <p v-if="chartLoading" class="status-text">图表加载中...</p>
      <p v-else-if="chartError" class="status-text error">{{ chartError }}</p>
      <p v-else-if="selectedBoss && !points.length" class="status-text">该怪物暂无历史数据</p>

      <DualLineChartView
        v-else-if="points.length"
        class="chart-view"
        v-model:hp-mode="crisisRoomType"
        :show-hp-mode-toggle="!isDefenseMode && !isDeductionMode"
        :enable-hp-coeff-charts="!isDefenseMode && !isDeductionMode"
        :points="points"
        :hp-chart-title="`${selectedBoss} 血量折线图`"
        :expansion-chart-title="`${selectedBoss} 血量相对膨胀折线图`"
        :hp-aria-label="`${selectedBoss} 血量折线图`"
        :expansion-aria-label="`${selectedBoss} 血量相对膨胀折线图`"
        :enable-point-click="!isDefenseMode && !isDeductionMode"
        :enable-boss-preview="false"
        :enable-room-buff-preview="isDefenseMode"
        :enable-hp-converted953-toggle="!isDefenseMode"
        :page-scroll="true"
        @point-click="openPhaseDetail"
      />

      <BossPickerModal
        :open="pickerModalOpen"
        :items="pickerItems"
        :title="bossSelectLabel"
        :selected-name="selectedBoss"
        @select="handleBossPicked"
        @close="pickerModalOpen = false"
      />

      <PhaseDetailModal
        v-if="!isDefenseMode && !isDeductionMode"
        :visible="detailVisible"
        :point="detailPoint"
        :mode="mode"
        @close="closePhaseDetail"
      />
    </template>
  </div>
</template>

<style scoped>
.monster-compare-panel {
  width: 100%;
  max-width: none;
  height: auto;
  min-height: 100%;
  margin: 0;
  padding: 0.35rem 0.25rem 0.5rem;
  display: flex;
  flex-direction: column;
  overflow: visible;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.65rem;
  flex-shrink: 0;
}

.page-title {
  font-size: clamp(1.5rem, 3.5vw, 2rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
  text-align: center;
}

.panel-desc {
  font-size: 0.85rem;
  opacity: 0.7;
  color: var(--color-text);
  text-align: center;
}

.category-selector,
.boss-selector,
.selector-toolbar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.75rem;
  flex-shrink: 0;
}

.selector-toolbar--defense {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: center;
  gap: 1rem 1.25rem;
}

.selector-field {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.selector-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-heading);
}

.selector-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.boss-thumb {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.boss-select {
  min-width: 240px;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.95rem;
}

.boss-selected-name {
  min-width: 0;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-heading);
}

.boss-selected-name--empty {
  font-weight: 500;
  opacity: 0.6;
}

.boss-picker-btn {
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.9rem;
  cursor: pointer;
}

.boss-picker-btn:hover:not(:disabled) {
  border-color: var(--color-heading);
}

.boss-picker-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.monster-compare-stats {
  flex-shrink: 0;
  width: min(640px, 100%);
  margin: 0 auto 0.85rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
  box-sizing: border-box;
}

.status-text {
  min-height: 30vh;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  opacity: 0.75;
}

.status-text.error {
  color: #e85d4c;
  opacity: 1;
}

/* `DualLineChartView` 根节点就是 `.charts-panel`：整页形态下高度必须交给内容，
   否则 `flex: 1`/`min-height: 0` 会把图表容器压扁（与 `.charts-panel--page` 取值一致，避免层叠顺序之争） */
.chart-view {
  flex: none;
  min-height: auto;
  overflow: visible;
  display: flex;
}

@media (max-width: 768px) {
  .monster-compare-panel {
    min-height: auto;
    padding: 0.35rem 0.15rem 0.55rem;
  }

  .page-title {
    font-size: 1.05rem;
  }

  .panel-desc {
    font-size: 0.72rem;
    padding-inline: 0.35rem;
  }

  .selector-toolbar--defense {
    flex-direction: column;
    align-items: stretch;
    gap: 0.55rem;
  }

  .selector-field {
    align-items: stretch;
    width: 100%;
  }

  .selector-row {
    width: 100%;
    justify-content: center;
  }

  .boss-select {
    min-width: 0;
    flex: 1;
    width: 100%;
  }

  .boss-selected-name {
    max-width: none;
    flex: 1;
  }

  .monster-compare-stats {
    width: 100%;
  }
}
</style>
