<script setup lang="ts">
import { computed } from 'vue'
import ElementTraitIcons from '@/components/shared/ElementTraitIcons.vue'
import type { BossInfoRecord } from '@/api/bossInfo'
import { hasElementIcons } from '@/utils/elementIcons'
import { DEFAULT_ENEMY_STAGGER_MULTIPLIER } from '@/utils/enemyResistance'
import { formatHp } from '@/utils/gameData'

const props = defineProps<{
  /** boss_info 基础库记录；缺失时整块不渲染 */
  record: BossInfoRecord | null
}>()

/** 失衡易伤展示：150%（1.5）；未配置时回退默认 1.5（与怪物详情弹窗同口径） */
const staggerMultiplierLabel = computed(() => {
  const multiplier = props.record?.stagger_multiplier ?? DEFAULT_ENEMY_STAGGER_MULTIPLIER
  return `${Math.round(multiplier * 100)}%（${multiplier}）`
})
</script>

<template>
  <div v-if="record" class="monster-detail-data">
    <p v-if="record.level != null" class="detail-row">
      <span class="detail-label">等级：</span>
      <span class="detail-value">{{ record.level }}</span>
    </p>
    <p v-if="record.crisis_base_hp != null" class="detail-row">
      <span class="detail-label">基础血量：</span>
      <span class="detail-value">{{ formatHp(record.crisis_base_hp) }}</span>
    </p>
    <p v-if="record.defense != null" class="detail-row">
      <span class="detail-label">防御：</span>
      <span class="detail-value">{{ record.defense }}</span>
    </p>
    <p v-if="record.stagger_time != null" class="detail-row">
      <span class="detail-label">失衡时间：</span>
      <span class="detail-value">{{ record.stagger_time }} 秒</span>
    </p>
    <p class="detail-row">
      <span class="detail-label">失衡易伤：</span>
      <span class="detail-value">{{ staggerMultiplierLabel }}</span>
    </p>
    <p v-if="hasElementIcons(record.weakness)" class="detail-row">
      <span class="detail-label">弱点：</span>
      <span class="detail-value">
        <ElementTraitIcons :value="record.weakness" variant="weak" show-percent />
      </span>
    </p>
    <p v-if="hasElementIcons(record.resistance)" class="detail-row">
      <span class="detail-label">抗性：</span>
      <span class="detail-value">
        <ElementTraitIcons
          :value="record.resistance"
          :high-value="record.resistance_high"
          variant="resist"
          show-percent
        />
      </span>
    </p>
  </div>
</template>

<style scoped>
.monster-detail-data {
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
</style>
