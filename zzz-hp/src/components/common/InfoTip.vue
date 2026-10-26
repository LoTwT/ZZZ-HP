<script setup lang="ts">
/**
 * 问号说明浮层：页面上只留一个 ? 图标，解释性说明悬停可读、可拖选复制。
 * 交互规则在 composables/useInfoTipPopover；浮层外观在 assets/infoTip.css。
 *
 * 内容三种形态：只要 `text`；`title` + `text`；`title` + `items` 要点。
 */
import { useInfoTipPopover } from '@/composables/useInfoTipPopover'

const props = withDefaults(
  defineProps<{
    /** 无障碍标签：读屏念出的说明名，如「驱动盘套装说明」 */
    label: string
    /** 单段说明正文 */
    text?: string
    /** 可选小标题 */
    title?: string
    /** 可选要点列表 */
    items?: string[]
  }>(),
  { text: '', title: '', items: () => [] },
)

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

/** SSR / 预渲染只输出占位：交互全在浏览器端 */
const isClient = typeof window !== 'undefined'
</script>

<template>
  <span v-if="!isClient" class="info-tip-host" aria-hidden="true" />
  <span
    v-else
    ref="triggerRef"
    class="info-tip-host"
    @mouseenter="show"
    @mouseleave="scheduleHide"
    @focusin="show"
    @focusout="scheduleHide"
    @click="onTriggerClick"
  >
    <button
      type="button"
      class="info-tip-dot"
      :aria-label="props.label"
      :aria-expanded="visible ? 'true' : 'false'"
    >
      ?
    </button>
    <Teleport to="body">
      <div
        v-if="visible"
        ref="tipRef"
        class="info-tip"
        :class="{ 'info-tip--below': below }"
        :style="tipStyle"
        role="tooltip"
        @mouseenter="onTipEnter"
        @mouseleave="onTipLeave"
      >
        <p v-if="props.title" class="info-tip-title">{{ props.title }}</p>
        <p v-if="props.text" class="info-tip-text">{{ props.text }}</p>
        <ul v-if="props.items.length" class="info-tip-list">
          <li v-for="item in props.items" :key="item">{{ item }}</li>
        </ul>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.info-tip-host {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}

.info-tip-dot {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  margin: 0 0 0 0.28em;
  padding: 0;
  border: 1px solid currentColor;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  opacity: 0.55;
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  cursor: help;
  transition:
    color 0.15s,
    border-color 0.15s,
    background-color 0.15s,
    opacity 0.15s;
}

/* 视觉 15px，可点范围外扩到 25px，手机更好点中 */
.info-tip-dot::before {
  content: '';
  position: absolute;
  inset: -5px;
  border-radius: 50%;
}

.info-tip-dot:hover,
.info-tip-dot:focus-visible,
.info-tip-dot[aria-expanded='true'] {
  border-color: var(--calc-accent, #c9a55c);
  background: color-mix(in srgb, var(--calc-accent, #c9a55c) 16%, transparent);
  color: var(--calc-accent, #c9a55c);
  opacity: 1;
  outline: none;
}
</style>