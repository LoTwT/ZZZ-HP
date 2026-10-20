<script setup lang="ts">
import { computed } from 'vue'
import type { BuffDamageType } from '@/types/calculator'
import { BUFF_DAMAGE_TYPE_GROUPS } from '@/types/calculator'
import { normalizeDamageTypes } from '@/utils/buffDamageTypes'

const props = defineProps<{
  modelValue: readonly BuffDamageType[]
  /** 允许选择的第二级类型；缺省 = 全部 8 项 */
  allowedTypes?: readonly BuffDamageType[]
  /** 类1：锁死（灰显不可改） */
  locked?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  toggle: [type: BuffDamageType, checked: boolean]
}>()

const selected = computed(() => normalizeDamageTypes(props.modelValue))
const allowed = computed(() => new Set(props.allowedTypes ?? []))

function isAllowed(type: BuffDamageType) {
  return !props.allowedTypes || allowed.value.has(type)
}

function isChecked(type: BuffDamageType) {
  return selected.value.includes(type)
}

function onToggle(type: BuffDamageType, event: Event) {
  if (props.locked || props.disabled) return
  if (!isAllowed(type)) return
  emit('toggle', type, (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <div class="damage-type-picker">
    <div v-for="group in BUFF_DAMAGE_TYPE_GROUPS" :key="group.id" class="damage-type-group">
      <span class="group-label">{{ group.label }}</span>
      <div class="chip-row">
        <label
          v-for="opt in group.types"
          :key="opt.id"
          class="chip"
          :class="{ 'chip-disabled': locked || disabled || !isAllowed(opt.id) }"
          :title="
            locked
              ? '该属性的伤害类型已锁定'
              : !isAllowed(opt.id)
                ? '该属性只允许异常类 5 项'
                : ''
          "
        >
          <input
            type="checkbox"
            :checked="isChecked(opt.id)"
            :disabled="locked || disabled || !isAllowed(opt.id)"
            @change="onToggle(opt.id, $event)"
          />
          <span>{{ opt.label }}</span>
        </label>
      </div>
    </div>
    <p v-if="!selected.length" class="hint">不勾 = 全部</p>
  </div>
</template>

<style scoped>
.damage-type-picker {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.damage-type-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.group-label {
  font-size: 0.72rem;
  opacity: 0.7;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.74rem;
  background: var(--color-background);
  cursor: pointer;
}

.chip-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hint {
  margin: 0;
  font-size: 0.72rem;
  opacity: 0.65;
}
</style>
