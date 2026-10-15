<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import IkModalShell from '@/components/common/IkModalShell.vue'
import DualLineChartView from '@/components/history/DualLineChartView.vue'
import RoomBuffTransitionPanel from '@/components/history/RoomBuffTransitionPanel.vue'
import ElementTraitIcons from '@/components/shared/ElementTraitIcons.vue'
import { fetchBossChart, type CrisisBossRoomType, type CrisisHpChartMode, type HpChartPoint } from '@/api/crisisAssault'
import type { EnemySlot, ModeKey } from '@/types/history'
import { DEFAULT_ENEMY_STAGGER_MULTIPLIER } from '@/utils/enemyResistance'
import { formatHp } from '@/utils/gameData'
import { hasElementIcons } from '@/utils/elementIcons'
import { isFieldBuffChanged, type MonsterFieldBuffSnapshot } from '@/utils/historyMonsterDetail'
import { createRequestEpoch } from '@/utils/requestEpoch'

const props = defineProps<{
  open: boolean
  enemy: EnemySlot | null
  /** 目前仅危局模式接入了图表数据源 */
  mode: ModeKey
  /** 如「3.2 第4期 · 房间 2」 */
  phaseLabel: string
  /** 原场地 Buff（较早一期），由父组件从 phases 解析 */
  previousFieldBuff?: MonsterFieldBuffSnapshot | null
  /** 现场地 Buff（当期），由父组件从 phases 解析 */
  currentFieldBuff?: MonsterFieldBuffSnapshot | null
}>()

const emit = defineEmits<{
  close: []
}>()

const points = ref<HpChartPoint[]>([])
const chartLoadEpoch = createRequestEpoch()
const chartLoading = ref(false)
const chartError = ref('')
const hpMode = ref<CrisisHpChartMode>('normal')

const chartRoomType = computed<CrisisBossRoomType>(() => (props.enemy?.isHardRoom ? 'hard' : 'normal'))

/** 失衡易伤展示：150%（1.5）；未配置时回退默认 1.5 */
const staggerMultiplier = computed(() => props.enemy?.staggerMultiplier ?? DEFAULT_ENEMY_STAGGER_MULTIPLIER)
const staggerMultiplierLabel = computed(
  () => `${Math.round(staggerMultiplier.value * 100)}%（${staggerMultiplier.value}）`,
)

const showRoomBuffTransition = computed(() =>
  isFieldBuffChanged(props.previousFieldBuff?.fieldBuff ?? null, props.currentFieldBuff?.fieldBuff ?? null),
)

async function loadBossChartPoints() {
  const bossName = props.enemy?.bossName
  if (!bossName || props.mode !== 'crisis-assault') {
    points.value = []
    chartError.value = ''
    chartLoading.value = false
    return
  }

  const token = chartLoadEpoch.next()
  chartLoading.value = true
  chartError.value = ''
  try {
    const data = await fetchBossChart(bossName, chartRoomType.value)
    if (!chartLoadEpoch.isCurrent(token)) return
    points.value = data
  } catch (error) {
    if (!chartLoadEpoch.isCurrent(token)) return
    chartError.value = error instanceof Error ? error.message : '加载折线图失败'
    points.value = []
  } finally {
    if (!chartLoadEpoch.isCurrent(token)) return
    chartLoading.value = false
  }
}

watch(
  () => [props.open, props.enemy?.bossName, props.enemy?.isHardRoom] as const,
  ([open]) => {
    if (!open) return
    hpMode.value = props.enemy?.isHardRoom ? 'hard' : 'normal'
    void loadBossChartPoints()
  },
  { immediate: true },
)
</script>

<template>
  <IkModalShell :open="open" size="wide" @close="emit('close')">
    <template #header>
      <div class="monster-detail-header">
        <h2 class="monster-detail-title">怪物详情</h2>
        <span v-if="phaseLabel" class="monster-detail-phase">{{ phaseLabel }}</span>
      </div>
    </template>

    <div v-if="enemy" class="monster-detail-body">
      <section class="monster-detail-top">
        <div class="monster-detail-image">
          <img v-if="enemy.imageUrl" :src="enemy.imageUrl" :alt="enemy.bossName || enemy.label" />
          <span v-else class="monster-detail-placeholder">怪物图片</span>
        </div>
        <div class="monster-detail-data">
          <p v-if="enemy.bossName" class="detail-row">
            <span class="detail-label">怪物：</span>
            <span class="detail-value detail-value--name">{{ enemy.bossName }}</span>
          </p>
          <p v-if="enemy.hp" class="detail-row">
            <span class="detail-label">血量：</span>
            <span class="detail-value">{{ enemy.hp }}</span>
          </p>
          <p v-if="enemy.crisisBaseHp != null" class="detail-row">
            <span class="detail-label">基础血量：</span>
            <span class="detail-value">{{ formatHp(enemy.crisisBaseHp) }}</span>
          </p>
          <p v-if="enemy.hpCoeffLabel" class="detail-row">
            <span class="detail-label">危局血量系数：</span>
            <span class="detail-value">{{ enemy.hpCoeffLabel }}</span>
          </p>
          <p v-if="enemy.defense !== undefined" class="detail-row">
            <span class="detail-label">防御：</span>
            <span class="detail-value">{{ enemy.defense }}</span>
          </p>
          <p v-if="enemy.staggerTime != null" class="detail-row">
            <span class="detail-label">失衡时间：</span>
            <span class="detail-value">{{ enemy.staggerTime }} 秒</span>
          </p>
          <p class="detail-row">
            <span class="detail-label">失衡易伤：</span>
            <span class="detail-value">{{ staggerMultiplierLabel }}</span>
          </p>
          <p v-if="hasElementIcons(enemy.weakness)" class="detail-row">
            <span class="detail-label">弱点：</span>
            <span class="detail-value">
              <ElementTraitIcons :value="enemy.weakness" variant="weak" show-percent />
            </span>
          </p>
          <p v-if="hasElementIcons(enemy.resistance)" class="detail-row">
            <span class="detail-label">抗性：</span>
            <span class="detail-value">
              <ElementTraitIcons
                :value="enemy.resistance"
                :high-value="enemy.resistanceHigh"
                variant="resist"
                show-percent
              />
            </span>
          </p>
        </div>
      </section>

      <RoomBuffTransitionPanel
        v-if="showRoomBuffTransition"
        class="monster-detail-buff-transition"
        :previous-field-buff="previousFieldBuff ?? null"
        :current-field-buff="currentFieldBuff ?? null"
      />

      <section v-if="enemy.bossName" class="monster-detail-chart">
        <p v-if="chartLoading" class="status-text">图表加载中...</p>
        <p v-else-if="chartError" class="status-text error">{{ chartError }}</p>
        <p v-else-if="!points.length" class="status-text">该怪物暂无历史数据</p>
        <DualLineChartView
          v-else
          class="monster-detail-chart-view"
          v-model:hp-mode="hpMode"
          :points="points"
          :hp-chart-title="`${enemy.bossName} 血量折线图`"
          :expansion-chart-title="`${enemy.bossName} 血量相对膨胀折线图`"
          :hp-aria-label="`${enemy.bossName} 血量折线图`"
          :expansion-aria-label="`${enemy.bossName} 血量相对膨胀折线图`"
          :enable-point-click="false"
          :enable-boss-preview="false"
          :enable-room-buff-preview="false"
          :enable-hp-converted953-toggle="true"
          :enable-hp-coeff-charts="true"
          :page-scroll="true"
        />
      </section>
    </div>
  </IkModalShell>
</template>

<style scoped>
.monster-detail-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  flex: 1;
}

.monster-detail-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.04em;
}

.monster-detail-phase {
  min-width: 0;
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.72);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.monster-detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1rem 1.15rem 1.25rem;
  background: var(--color-background-soft);
}

.monster-detail-top {
  display: flex;
  align-items: flex-start;
  gap: clamp(0.75rem, 2vw, 1.25rem);
}

.monster-detail-image {
  flex-shrink: 0;
  width: clamp(140px, 24%, 220px);
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-background-mute);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.monster-detail-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.monster-detail-placeholder {
  font-size: 0.85rem;
  opacity: 0.45;
  padding: 0.5rem;
  text-align: center;
}

.monster-detail-data {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.detail-row {
  margin: 0;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.1rem 0.15rem;
  font-size: clamp(0.82rem, 1.4vw, 0.92rem);
  line-height: 1.45;
}

.detail-label {
  flex-shrink: 0;
  font-weight: 700;
  color: #e85d4c;
}

.detail-value {
  min-width: 0;
  font-weight: 600;
  color: var(--color-heading);
  overflow-wrap: anywhere;
}

.detail-value--name {
  font-weight: 700;
  color: #e8a838;
}

.status-text {
  min-height: 4rem;
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

/* `page-scroll` 形态下图表高度以窗口为基准、容器高度交给内容，不能被 flex 压缩 */
.monster-detail-chart-view {
  flex: none;
  min-height: auto;
  overflow: visible;
  display: flex;
}

@media (max-width: 768px) {
  .monster-detail-top {
    flex-direction: column;
    align-items: center;
  }

  .monster-detail-image {
    width: min(180px, 56vw);
  }

  .monster-detail-data {
    width: 100%;
  }
}
</style>
