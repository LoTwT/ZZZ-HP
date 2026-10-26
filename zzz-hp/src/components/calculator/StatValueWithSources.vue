<script setup lang="ts">
/**
 * 数值 + 组成明细浮层。
 * 交互规则统一在 composables/useInfoTipPopover，外观在 assets/infoTip.css；
 * 这里只负责「数值怎么显示」与「明细怎么排版」。
 */
import { useInfoTipPopover } from '@/composables/useInfoTipPopover'
import type { StatSourceGroup } from '@/utils/statSourceTips'

defineProps<{
  value: string | number
  groups: StatSourceGroup[]
}>()

const {
  triggerRef,
  tipRef,
  visible,
  tipStyle,
  below,
  show,
  scheduleHide,
  onTipEnter,
  onTipLeave,
  onTriggerClick,
} = useInfoTipPopover()

const isClient = typeof window !== 'undefined'
</script>

<template>
  <span
    v-if="isClient"
    ref="triggerRef"
    class="stat-value"
    tabindex="0"
    @mouseenter="show"
    @mouseleave="scheduleHide"
    @focusin="show"
    @focusout="scheduleHide"
    @click="onTriggerClick"
  >
    <strong>{{ value }}</strong>
    <Teleport to="body">
      <div
        v-if="visible"
        ref="tipRef"
        class="info-tip stat-value-tip"
        :class="{ 'info-tip--below': below }"
        :style="tipStyle"
        role="tooltip"
        @mouseenter="onTipEnter"
        @mouseleave="onTipLeave"
      >
        <template v-if="groups.length">
          <p class="tip-title">数值组成</p>
          <div class="tip-groups">
            <article
              v-for="(group, index) in groups"
              :key="`${group.label}-${index}`"
              class="tip-group"
              :class="{ 'tip-group--full': group.fullWidth }"
            >
              <p class="tip-label">{{ group.label }}</p>
              <ul class="tip-items" :class="{ 'tip-items--process': group.fullWidth }">
                <li v-for="item in group.items" :key="item">{{ item }}</li>
              </ul>
            </article>
          </div>
        </template>
        <p v-else class="tip-empty">暂无组成明细</p>
      </div>
    </Teleport>
  </span>
  <span v-else class="stat-value"><strong>{{ value }}</strong></span>
</template>

<style scoped>
.stat-value {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: help;
}

.stat-value > strong {
  border-bottom: 1px dotted color-mix(in srgb, #e8d4a8 70%, transparent);
}

.stat-value:focus-visible {
  outline: 1px solid var(--calc-accent, #c9a55c);
  outline-offset: 2px;
  border-radius: 3px;
}
</style>

<style>
/* 明细排版（外壳底色 / 边框 / 箭头由 assets/infoTip.css 提供） */
[data-theme='light'] .stat-value > strong {
  border-bottom-color: color-mix(in srgb, #9f7d3f 70%, transparent);
}

.info-tip .tip-title {
  margin: 0;
  font-size: 0.8rem;
  color: #e8d4a8;
  font-weight: 600;
}

.info-tip .tip-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem 1rem;
}

.info-tip .tip-group {
  min-width: 0;
}

.info-tip .tip-group--full {
  grid-column: 1 / -1;
}

.info-tip .tip-items--process li:last-child {
  margin-top: 0.15rem;
  padding-top: 0.25rem;
  border-top: 1px solid #2d323a;
  color: #e8d4a8;
  font-weight: 600;
}

.info-tip .tip-label {
  margin: 0 0 0.3rem;
  font-size: 0.76rem;
  color: #d4b06a;
}

.info-tip .tip-items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.2rem;
}

.info-tip .tip-items li {
  color: #c3ccd8;
  word-break: break-word;
}

.info-tip .tip-empty {
  margin: 0;
  color: #8b949f;
}

[data-theme='light'] .info-tip .tip-title {
  color: #16324a;
}

[data-theme='light'] .info-tip .tip-label {
  color: #9f7d3f;
}

[data-theme='light'] .info-tip .tip-items li {
  color: #4d6a80;
}

[data-theme='light'] .info-tip .tip-items--process li:last-child {
  border-top-color: #d5e4f0;
  color: #16324a;
}

[data-theme='light'] .info-tip .tip-empty {
  color: #6d8598;
}

@media (max-width: 768px) {
  .info-tip .tip-groups {
    grid-template-columns: 1fr;
  }
}
</style>