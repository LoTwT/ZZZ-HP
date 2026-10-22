<script setup lang="ts">
import { computed } from 'vue'
import { clampToStep, resolveButtonStep } from '@/utils/numberInputStep'

const props = withDefaults(
  defineProps<{
    min?: number
    max?: number
    /** 输入框精度：决定小数位数（1 = 整数、0.01 = 2 位、0.0001 = 4 位） */
    step?: number
    /** ± 按钮的步长；不传则与 `step` 相同（保留各处旧行为） */
    buttonStep?: number
    disabled?: boolean
  }>(),
  {
    min: 0,
    max: 999999,
    step: 1,
    buttonStep: undefined,
    disabled: false,
  },
)

const model = defineModel<number>({ required: true })

/** 按钮步长：与输入精度解耦，例如「输入 2 位小数、按钮一次 ±1 层」 */
const bumpStep = computed(() => resolveButtonStep(props.step, props.buttonStep))

function clamp(value: number) {
  return clampToStep(value, props.min, props.max, props.step)
}

function bump(delta: number) {
  if (props.disabled) return
  model.value = clamp((Number(model.value) || 0) + delta)
}

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return
  const n = Number(raw)
  if (!Number.isFinite(n)) return
  model.value = clamp(n)
}

function onBlur() {
  const n = Number(model.value)
  model.value = clamp(Number.isFinite(n) ? n : props.min)
}
</script>

<template>
  <div class="num-stepper" :class="{ disabled }">
    <input
      class="step-input"
      type="number"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :value="model"
      @input="onInput"
      @blur="onBlur"
    />
    <div class="step-btns">
      <button
        type="button"
        class="step-btn"
        :disabled="disabled || model <= min"
        @click="bump(-bumpStep)"
      >
        −
      </button>
      <button
        type="button"
        class="step-btn"
        :disabled="disabled || model >= max"
        @click="bump(bumpStep)"
      >
        +
      </button>
    </div>
  </div>
</template>

<style scoped>
.num-stepper {
  display: inline-flex;
  align-items: stretch;
  width: 100%;
  max-width: 14rem;
  min-width: 9.5rem;
  border: 1px solid var(--color-border, #2d323a);
  border-radius: 8px;
  background: var(--color-background, #0f1217);
  overflow: hidden;
}

.num-stepper.disabled {
  opacity: 0.5;
}

.step-input {
  flex: 1 1 auto;
  min-width: 0;
  width: auto;
  border: none;
  background: transparent;
  color: var(--color-text, #ebedf0);
  text-align: left;
  padding: 0.35rem 0.55rem;
  font: inherit;
  font-size: 0.85rem;
  -moz-appearance: textfield;
}

.step-input::-webkit-outer-spin-button,
.step-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.step-btns {
  display: inline-flex;
  flex: 0 0 auto;
  border-left: 1px solid var(--color-border, #2d323a);
}

.step-btn {
  flex: 0 0 1.85rem;
  width: 1.85rem;
  height: 1.85rem;
  border: none;
  border-left: 1px solid var(--color-border, #2d323a);
  background: transparent;
  color: var(--color-heading, #ebedf0);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.step-btns .step-btn:first-child {
  border-left: none;
}

.step-btn:hover:not(:disabled) {
  background: var(--color-background-mute, #1a1e25);
}

.step-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
