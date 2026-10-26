<script setup lang="ts">
import ElementTraitIcons from '@/components/shared/ElementTraitIcons.vue'

defineProps<{
  /** 原弱点/抗性（较早一期） */
  previous: {
    phaseLabel: string
    weakness?: string
    resistance?: string
    resistanceHigh?: string
  } | null
  /** 现弱点/抗性（当期） */
  current: {
    phaseLabel: string
    weakness?: string
    resistance?: string
    resistanceHigh?: string
  } | null
}>()
</script>

<template>
  <div v-if="previous && current" class="trait-transition">
    <p class="trait-transition-title">弱点 / 抗性转变</p>
    <div class="trait-transition-columns">
      <div class="trait-column">
        <p class="trait-column-label">
          原弱点 / 抗性<span v-if="previous.phaseLabel" class="trait-column-phase">
            {{ previous.phaseLabel }}</span>
        </p>
        <p class="trait-line">
          <ElementTraitIcons
            :value="previous.weakness"
            label="弱点"
            variant="weak"
            show-percent
            empty-text="无"
          />
        </p>
        <p class="trait-line">
          <ElementTraitIcons
            :value="previous.resistance"
            :high-value="previous.resistanceHigh"
            label="抗性"
            variant="resist"
            show-percent
            empty-text="无"
          />
        </p>
      </div>
      <div class="trait-column">
        <p class="trait-column-label">
          现弱点 / 抗性<span v-if="current.phaseLabel" class="trait-column-phase">
            {{ current.phaseLabel }}</span>
        </p>
        <p class="trait-line">
          <ElementTraitIcons
            :value="current.weakness"
            label="弱点"
            variant="weak"
            show-percent
            empty-text="无"
          />
        </p>
        <p class="trait-line">
          <ElementTraitIcons
            :value="current.resistance"
            :high-value="current.resistanceHigh"
            label="抗性"
            variant="resist"
            show-percent
            empty-text="无"
          />
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trait-transition {
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
  border-left: 3px solid color-mix(in srgb, #7aa7d8 75%, transparent);
  background: color-mix(in srgb, var(--color-background-soft) 75%, transparent);
}

.trait-transition-title {
  margin: 0 0 0.4rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-heading);
}

.trait-transition-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem 0.9rem;
}

.trait-column {
  min-width: 0;
}

.trait-column-label {
  margin: 0 0 0.3rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--color-heading);
  opacity: 0.85;
}

.trait-column-phase {
  margin-left: 0.35rem;
  font-weight: 400;
  opacity: 0.75;
}

.trait-line {
  margin: 0.15rem 0 0;
  font-size: 0.74rem;
  line-height: 1.45;
  color: var(--color-heading);
  opacity: 0.9;
}

@media (max-width: 768px) {
  .trait-transition-columns {
    grid-template-columns: 1fr;
  }
}
</style>
