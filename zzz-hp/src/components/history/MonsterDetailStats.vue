<script setup lang="ts">
import { computed } from 'vue'
import ElementTraitIcons from '@/components/shared/ElementTraitIcons.vue'
import { DEFAULT_ENEMY_STAGGER_MULTIPLIER } from '@/utils/enemyResistance'
import { formatHp } from '@/utils/gameData'

/**
 * 数据行取值：基础字段沿用 boss_info（`BossInfoRecord`）的 snake_case 命名，
 * 使 `BossInfoRecord` 可直接作为 `record` 传入；危局往期详情弹窗按同一形状
 * 从 `EnemySlot` + 对比结果组装；后续防卫战详情弹窗同样复用。
 */
export interface MonsterDetailRecord {
  /** 怪物名，渲染为高亮的「怪物：」行；缺省不渲染该行 */
  boss_name?: string | null
  /** 血量文本（危局往期详情） */
  hp?: string | null
  /** 血量行的相对膨胀文本，如 +25.0% */
  hp_expansion?: string | null
  /** 血量增量行文本，如 +1200（与上一行「血量」标签对齐） */
  hp_delta_label?: string | null
  /** 危局基础血量，组件内用 formatHp 格式化 */
  crisis_base_hp?: number | null
  /** 危局血量系数展示，如 150% */
  hp_coeff_label?: string | null
  /** 危局血量系数差值文本，如 +5.0% */
  hp_coeff_delta_label?: string | null
  level?: number | null
  defense?: number | null
  /** 失衡时间（秒） */
  stagger_time?: number | null
  /** 失衡易伤乘数（1.5 = 150%）；缺省回退 DEFAULT_ENEMY_STAGGER_MULTIPLIER */
  stagger_multiplier?: number | null
  /** 弱点行常驻，无可识别属性时显示占位「无」 */
  weakness?: string | null
  /** 抗性行常驻，无可识别属性时显示占位「无」 */
  resistance?: string | null
  resistance_high?: string | null
}

const props = defineProps<{
  /** 右侧数据行取值；缺省时只渲染左侧图片列（单独怪物对比的未选择 / 查无基础库记录态） */
  record?: MonsterDetailRecord | null
  /** 左侧图片地址；缺省渲染「怪物图片」占位块 */
  imageUrl?: string | null
  /** 图片 alt；缺省回退 record.boss_name */
  imageAlt?: string
  /** 是否把图片（含占位块）作为点击入口：为真才有 role=button / 键盘可达 / 手型光标 */
  imageClickable?: boolean
  /** 图片列下方常驻提示，如「点击怪物图片可更换怪物」；缺省不渲染（可点击时也用作无障碍名称） */
  imageHint?: string | null
}>()

const emit = defineEmits<{
  imageClick: []
}>()

/** 失衡易伤展示：150%（1.5）；未配置时回退默认 1.5（与怪物详情弹窗同口径） */
const staggerMultiplierLabel = computed(() => {
  const multiplier = props.record?.stagger_multiplier ?? DEFAULT_ENEMY_STAGGER_MULTIPLIER
  return `${Math.round(multiplier * 100)}%（${multiplier}）`
})

function onImageClick() {
  if (!props.imageClickable) return
  emit('imageClick')
}

function onImageKeydown(event: KeyboardEvent) {
  if (!props.imageClickable) return
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  emit('imageClick')
}
</script>

<template>
  <div class="monster-detail-stats">
    <div class="monster-detail-media">
      <div
        class="monster-detail-image"
        :class="{ 'monster-detail-image--clickable': imageClickable }"
        :role="imageClickable ? 'button' : undefined"
        :aria-label="imageClickable ? imageHint || '更换怪物' : undefined"
        :tabindex="imageClickable ? 0 : undefined"
        @click="onImageClick"
        @keydown="onImageKeydown"
      >
        <img v-if="imageUrl" :src="imageUrl" :alt="imageAlt || record?.boss_name || ''" />
        <span v-else class="monster-detail-placeholder">怪物图片</span>
      </div>
      <p v-if="imageHint" class="monster-detail-image-hint">{{ imageHint }}</p>
    </div>

    <div v-if="record" class="monster-detail-data">
      <p v-if="record.boss_name" class="detail-row">
        <span class="detail-label">怪物：</span>
        <span class="detail-value detail-value--name">{{ record.boss_name }}</span>
      </p>
      <p v-if="record.hp" class="detail-row">
        <span class="detail-label">血量：</span>
        <span class="detail-value">{{ record.hp }}</span>
        <span v-if="record.hp_expansion" class="detail-hp-expansion">
          {{ record.hp_expansion }}
        </span>
      </p>
      <p v-if="record.hp_delta_label" class="detail-row">
        <span class="detail-label detail-label--ghost" aria-hidden="true">血量：</span>
        <span class="detail-hp-delta">{{ record.hp_delta_label }}</span>
      </p>
      <p v-if="record.level != null" class="detail-row">
        <span class="detail-label">等级：</span>
        <span class="detail-value">{{ record.level }}</span>
      </p>
      <p v-if="record.crisis_base_hp != null" class="detail-row">
        <span class="detail-label">基础血量：</span>
        <span class="detail-value">{{ formatHp(record.crisis_base_hp) }}</span>
      </p>
      <p v-if="record.hp_coeff_label" class="detail-row">
        <span class="detail-label">危局血量系数：</span>
        <span class="detail-value">{{ record.hp_coeff_label }}</span>
        <span v-if="record.hp_coeff_delta_label" class="detail-hp-expansion">
          {{ record.hp_coeff_delta_label }}
        </span>
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
      <p class="detail-row">
        <span class="detail-label">弱点：</span>
        <span class="detail-value">
          <ElementTraitIcons :value="record.weakness" variant="weak" show-percent empty-text="无" />
        </span>
      </p>
      <p class="detail-row">
        <span class="detail-label">抗性：</span>
        <span class="detail-value">
          <ElementTraitIcons
            :value="record.resistance"
            :high-value="record.resistance_high"
            variant="resist"
            show-percent
            empty-text="无"
          />
        </span>
      </p>
    </div>
  </div>
</template>

<style scoped>
/* 与怪物详情弹窗同构：左图右数据的两列布局 */
.monster-detail-stats {
  display: flex;
  align-items: flex-start;
  gap: clamp(0.75rem, 2vw, 1.25rem);
}

.monster-detail-media {
  flex-shrink: 0;
  width: clamp(140px, 24%, 220px);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.monster-detail-image {
  width: 100%;
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

.monster-detail-image--clickable {
  cursor: pointer;
  transition: border-color 0.18s;
}

.monster-detail-image--clickable:hover {
  border-color: var(--color-border-hover);
}

.monster-detail-image--clickable:focus-visible {
  outline: 2px solid var(--color-border-hover);
  outline-offset: 2px;
}

.monster-detail-image-hint {
  margin: 0;
  font-size: 0.72rem;
  line-height: 1.4;
  text-align: center;
  color: var(--color-text);
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

/* 与数值拉开层次的中性标签色，不用强调红（红色只留给血量增量等语义） */
.detail-label {
  flex-shrink: 0;
  font-weight: 700;
  color: var(--color-text);
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

.detail-label--ghost {
  visibility: hidden;
}

/* 与怪物卡片（.enemy-hp-delta / .enemy-hp-expansion）同色的增长标识 */
.detail-hp-delta {
  min-width: 0;
  font-size: 0.74rem;
  font-weight: 600;
  color: #e85d4c;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.detail-hp-expansion {
  font-size: 0.78rem;
  font-weight: 600;
  color: #4d9fff;
  white-space: normal;
  overflow-wrap: anywhere;
}

@media (max-width: 768px) {
  .monster-detail-stats {
    flex-direction: column;
    align-items: center;
  }

  .monster-detail-media {
    width: min(180px, 56vw);
  }

  .monster-detail-data {
    width: 100%;
  }
}
</style>
