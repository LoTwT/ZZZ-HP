<script setup lang="ts">
import { nextTick, shallowRef, useTemplateRef } from 'vue'
import {
  reloadCalculatorData,
  type CalculatorDataLoader,
  type CalculatorLoadState,
} from '@/utils/calculatorLoadState'

interface Props {
  state: CalculatorLoadState
  error: string
  loader: CalculatorDataLoader
}

const props = defineProps<Props>()

const statusRegionRef = useTemplateRef<HTMLDivElement>('statusRegion')
const retryButtonRef = useTemplateRef<HTMLButtonElement>('retryButton')
const retryInFlight = shallowRef(false)

function focusWithoutScroll(element: HTMLElement | null) {
  element?.focus({ preventScroll: true })
}

async function handleRetry() {
  if (retryInFlight.value) return

  retryInFlight.value = true

  let request: Promise<void>
  try {
    request = reloadCalculatorData(props.loader)
  } catch {
    request = Promise.resolve()
  }

  await nextTick()
  focusWithoutScroll(statusRegionRef.value)

  await request.catch(() => {})
  retryInFlight.value = false

  await nextTick()
  if (props.state === 'error') {
    focusWithoutScroll(retryButtonRef.value)
    return
  }
  if (props.state === 'ready') {
    focusWithoutScroll(statusRegionRef.value?.closest<HTMLElement>('.content') ?? null)
  }
}
</script>

<template>
  <div ref="statusRegion" class="load-status-region" tabindex="-1">
    <p
      role="status"
      aria-live="polite"
      aria-atomic="true"
      :class="state === 'loading' ? 'load-hint' : 'visually-hidden'"
    >
      <template v-if="state === 'loading'">
        {{ retryInFlight ? '正在重新加载计算器数据...' : '正在从数据库加载计算器数据...' }}
      </template>
      <template v-else-if="state === 'ready'">计算器数据加载完成</template>
    </p>
    <p class="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true">
      {{ state === 'error' ? error : '' }}
    </p>
    <div v-if="state === 'error'" class="load-error">
      <span aria-hidden="true">{{ error }}</span>
      <button
        ref="retryButton"
        type="button"
        class="load-retry-btn"
        :disabled="retryInFlight"
        @click="handleRetry"
      >
        重新加载
      </button>
    </div>
  </div>
</template>

<style scoped>
.load-status-region:focus {
  outline: none;
}

.load-status-region:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.load-hint,
.load-error {
  margin: 0 0 1rem;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  font-size: 0.9rem;
}

.load-hint {
  border: 1px solid #34302a;
  background: #14120f;
  color: #d8c39a;
}

.load-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  border: 1px solid #5a2f2f;
  background: #241515;
  color: #ffb4b4;
}

.load-retry-btn {
  flex-shrink: 0;
  padding: 0.4rem 0.7rem;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.load-retry-btn:hover {
  background: rgba(255, 180, 180, 0.12);
}

.load-retry-btn:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

:global(.calculator-page.theme-light) .load-hint {
  border-color: #e6d7b0;
  background: #fff9ef;
  color: #6b5420;
}
</style>
