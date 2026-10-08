<script setup lang="ts">
/**
 * 本行增益例外（按流程行禁用增益）的编辑弹窗。
 *
 * 设计（2026-09-20；2026-10-06 起视觉对齐「局内增益」选择器 `BuffEffectPickerModal`）：
 * - **入口与存储都在流程行**：这里改的是 `FlowEntry.buffOverrides`，缺省 = 全部继承全局
 * - 只允许"禁用"（减法语义）：勾掉 = 这一行不吃该增益
 * - 列表只列**该行本来可生效**的效果（由页面传入与全局选择器同一份 `CollectedEffect[]`）
 * - 只影响本行结算：不改面板、不动层数累计、不影响其它行
 * - 白天主题覆盖在 `assets/calculatorLight.css`（与局内增益同一处，惯例一致）
 */
import { computed } from 'vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import NumberStepper from '@/components/common/NumberStepper.vue'
import type { BuffEffect } from '@/types/calculator'
import type { CollectedEffect } from '@/utils/panelBuffCalc'
import { blockKeyOfCollected } from '@/utils/panelBuffCalc'
import { BUFF_STAT_FIELDS, buffStatFieldLabel } from '@/utils/calculatorUi'
import type { FlowBuffOverride } from '@/types/damageCalcHistory'

const props = defineProps<{
  /** 该行可生效的效果（与全局增益选择器同一份列表） */
  effects: CollectedEffect[]
  /** 行标题（招式名 / 组名），仅展示 */
  rowLabel?: string
  /** 全局当前层数（未做行级覆盖时的继承值；缺省按 defaultStacks） */
  globalStacksFor?: (effect: BuffEffect) => number
  /** 全局当前转模输入（manual 转模未做行级覆盖时的继承值） */
  globalConvertInput?: (effect: BuffEffect) => number | undefined
}>()

const open = defineModel<boolean>('open', { default: false })
const override = defineModel<FlowBuffOverride | null>('override', { default: null })

type BlockGroup = {
  key: string
  label: string
  providerName: string
  avatar: string | null
  note: string
  effects: BuffEffect[]
}

/** 按效果块分组（块键与目录一致，直接用共享实现 —— 额外 Buff 的 `extra-<id>` 也在其中） */
const groups = computed<BlockGroup[]>(() => {
  const map = new Map<string, BlockGroup>()
  for (const item of props.effects) {
    const key = blockKeyOfCollected(item)
    const raw = item as unknown as {
      blockName?: string | null
      sourceLabel?: string | null
      blockNote?: string | null
    }
    const label = (raw.blockName ?? '').trim() || (raw.sourceLabel ?? '').trim() || '未命名效果块'
    const group =
      map.get(key) ??
      {
        key,
        label,
        providerName: (item.providerName ?? '').trim(),
        avatar: item.providerAvatar ?? null,
        note: (raw.blockNote ?? '').trim(),
        effects: [],
      }
    group.effects.push(item.effect)
    map.set(key, group)
  }
  return [...map.values()]
})

const disabledEffects = computed(() => new Set(override.value?.disabledEffectIds ?? []))
const exceptionCount = computed(
  () =>
    (override.value?.disabledBlockIds?.length ?? 0) +
    (override.value?.disabledEffectIds?.length ?? 0),
)

function isEffectOff(id: string): boolean {
  return disabledEffects.value.has(id)
}

function isStackable(effect: BuffEffect): boolean {
  return effect.kind === 'stacked' || Boolean(effect.stackable)
}

function isManualConvert(effect: BuffEffect): boolean {
  return effect.kind === 'convert' && effect.convert?.panelSource === 'manual'
}

/** 本行生效层数 = 行级覆盖 ?? 继承全局 ?? defaultStacks */
function stacksModel(effect: BuffEffect): number {
  const overridden = override.value?.stacksByEffectId?.[effect.id]
  if (overridden != null) return overridden
  return props.globalStacksFor?.(effect) ?? effect.defaultStacks ?? 1
}

function setStacks(effect: BuffEffect, value: number) {
  const next = { ...(override.value?.stacksByEffectId ?? {}) }
  next[effect.id] = Math.max(0, value)
  write({ stacksByEffectId: next })
}

/** 本行生效转模输入 = 行级覆盖 ?? 继承全局输入 ?? defaultBase ?? 0 */
function convertModel(effect: BuffEffect): number {
  const overridden = override.value?.convertInputsByEffectId?.[effect.id]
  if (overridden != null) return overridden
  const inherited = props.globalConvertInput?.(effect)
  if (inherited != null) return inherited
  const base = effect.convert?.defaultBase
  return Number.isFinite(base) ? Number(base) : 0
}

function setConvertInput(effect: BuffEffect, value: number) {
  const next = { ...(override.value?.convertInputsByEffectId ?? {}) }
  next[effect.id] = Math.max(0, value)
  write({ convertInputsByEffectId: next })
}

/** 单条恢复继承：删掉该效果的行级覆盖值 */
function restoreEffectInherit(effect: BuffEffect) {
  if (!override.value) return
  const stacks = { ...(override.value.stacksByEffectId ?? {}) }
  const converts = { ...(override.value.convertInputsByEffectId ?? {}) }
  delete stacks[effect.id]
  delete converts[effect.id]
  write({ stacksByEffectId: stacks, convertInputsByEffectId: converts })
}

function hasEffectOverride(effect: BuffEffect): boolean {
  return (
    override.value?.stacksByEffectId?.[effect.id] != null ||
    override.value?.convertInputsByEffectId?.[effect.id] != null
  )
}

function write(next: Partial<FlowBuffOverride>) {
  const merged: FlowBuffOverride = {
    disabledBlockIds: next.disabledBlockIds ?? override.value?.disabledBlockIds ?? [],
    disabledEffectIds: next.disabledEffectIds ?? override.value?.disabledEffectIds ?? [],
    stacksByEffectId: next.stacksByEffectId ?? override.value?.stacksByEffectId ?? null,
    convertInputsByEffectId:
      next.convertInputsByEffectId ?? override.value?.convertInputsByEffectId ?? null,
  }
  const empty =
    !merged.disabledBlockIds?.length &&
    !merged.disabledEffectIds?.length &&
    !Object.keys(merged.stacksByEffectId ?? {}).length &&
    !Object.keys(merged.convertInputsByEffectId ?? {}).length
  // 空 = 回归"全部继承全局"，写 null（老数据同一口径）
  override.value = empty ? null : merged
}

function toggleEffect(id: string) {
  const set = new Set(override.value?.disabledEffectIds ?? [])
  if (set.has(id)) set.delete(id)
  else set.add(id)
  write({ disabledEffectIds: [...set] })
}

function restoreGlobal() {
  override.value = null
}

function effectLabel(effect: BuffEffect): string {
  const field = BUFF_STAT_FIELDS.find((item) => item.key === effect.stat)
  const stat = field ? buffStatFieldLabel(field) : String(effect.stat)
  if (effect.kind === 'convert') return `${stat}（转模）`
  const value = effect.kind === 'stacked' ? (effect.valuePerStack ?? 0) : (effect.value ?? 0)
  return `${stat} ${value > 0 ? '+' : ''}${value}`
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="bo-mask" role="presentation" @click.self="open = false">
      <div class="bo-card" role="dialog" aria-modal="true" aria-label="本行增益例外">
        <header class="bo-head">
          <div class="bo-title-row">
            <h3>本行增益例外</h3>
            <button type="button" class="bo-close" aria-label="关闭" @click="open = false">×</button>
          </div>
          <p class="bo-hint">
            勾掉 = <b>这一行不吃</b>该增益。只影响本行结算：不改面板、不影响层数累计、不影响其它行。
          </p>
        </header>

        <div class="bo-toolbar">
          <span v-if="rowLabel" class="bo-row" :title="rowLabel">{{ rowLabel }}</span>
          <span class="bo-badge">例外 {{ exceptionCount }}</span>
          <span class="bo-spacer" />
          <button type="button" class="bo-ghost" :disabled="!exceptionCount" @click="restoreGlobal">
            恢复全局
          </button>
          <button type="button" class="bo-ghost" @click="open = false">关闭</button>
        </div>

        <div class="bo-list">
          <article v-for="group in groups" :key="group.key" class="bo-row-card">
            <div class="bo-row-main">
              <CalculatorAvatar
                class="bo-avatar"
                :avatar-image="group.avatar"
                :name="group.providerName || group.label"
              />
              <span class="bo-copy">
                <strong :title="`${group.providerName} | ${group.label}`">
                  <template v-if="group.providerName">
                    {{ group.providerName }}
                    <span class="bo-sep">|</span>
                  </template>
                  {{ group.label }}
                </strong>
                <small v-if="group.note" :title="group.note">{{ group.note }}</small>
              </span>
              <span class="bo-count">{{ group.effects.length }} 条</span>
            </div>
            <div class="bo-effect-lines">
              <div v-for="effect in group.effects" :key="effect.id" class="bo-effect-row">
                <div class="bo-effect-line">
                  <label class="bo-effect-check">
                    <input
                      type="checkbox"
                      class="bo-check"
                      :checked="!isEffectOff(effect.id)"
                      @change="toggleEffect(effect.id)"
                    />
                    <span class="bo-effect-text">{{ effectLabel(effect) }}</span>
                  </label>
                  <label v-if="isStackable(effect)" class="bo-effect-control" @click.stop>
                    <span>层数</span>
                    <NumberStepper
                      :model-value="stacksModel(effect)"
                      :min="0"
                      :max="effect.maxStacks ?? 99"
                      :disabled="isEffectOff(effect.id)"
                      @update:model-value="setStacks(effect, $event)"
                    />
                  </label>
                  <label v-else-if="isManualConvert(effect)" class="bo-effect-control" @click.stop>
                    <span>数值</span>
                    <NumberStepper
                      :model-value="convertModel(effect)"
                      :min="0"
                      :max="999999"
                      :step="10"
                      :disabled="isEffectOff(effect.id)"
                      @update:model-value="setConvertInput(effect, $event)"
                    />
                  </label>
                  <button
                    v-if="hasEffectOverride(effect)"
                    type="button"
                    class="bo-ghost bo-inherit"
                    title="清除本行覆盖，恢复继承全局"
                    @click.stop="restoreEffectInherit(effect)"
                  >
                    ↺ 继承
                  </button>
                </div>
              </div>
            </div>
          </article>
          <p v-if="!groups.length" class="bo-empty">这一行没有可调整的增益。</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 视觉对齐「局内增益」选择器（BuffEffectPickerModal）：同一套卡片 / 效果行 / 工具行。
   白天主题覆盖在 assets/calculatorLight.css（与局内增益放一处）。 */
.bo-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(8, 12, 20, 0.72);
}
.bo-card {
  width: min(1080px, calc(100vw - 16px));
  max-height: min(88vh, 900px);
  display: flex;
  flex-direction: column;
  border: 1px solid #4a5563;
  border-radius: 14px;
  background: #141922;
  color: #e8ecf4;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.bo-head {
  padding: 1rem 1.1rem 0.85rem;
  border-bottom: 1px solid #2d3646;
}
.bo-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.bo-title-row h3 {
  margin: 0;
  font-size: 1.1rem;
}
.bo-close {
  border: none;
  background: transparent;
  font-size: 1.45rem;
  line-height: 1;
  cursor: pointer;
  color: #c5ccd8;
}
.bo-hint {
  margin: 0.45rem 0 0;
  font-size: 0.82rem;
  color: #9aa3b5;
}
.bo-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
  padding: 0.85rem 1.1rem 0.35rem;
}
.bo-row {
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
  color: #9aa3b5;
}
.bo-badge {
  padding: 0.25rem 0.65rem;
  border: 1px solid #4a5563;
  border-radius: 999px;
  font-size: 0.8rem;
  color: #ffd479;
}
.bo-spacer {
  flex: 1;
}
.bo-ghost {
  border: 1px solid #4a5563;
  border-radius: 8px;
  background: #1a1f2a;
  color: #c8d0dc;
  padding: 0.32rem 0.7rem;
  font-size: 0.82rem;
  cursor: pointer;
}
.bo-ghost:hover:not(:disabled) {
  border-color: #4f5d72;
  background: #1c2432;
}
.bo-ghost:disabled {
  opacity: 0.45;
  cursor: default;
}
.bo-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.5rem 1.1rem 0.9rem;
}
.bo-row-card {
  display: grid;
  gap: 0.4rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid #3a4456;
  border-radius: 12px;
  background: #181e2a;
}
.bo-row-main {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  min-width: 0;
}
.bo-avatar {
  width: 40px;
  height: 40px;
  margin-top: 0.1rem;
}
.bo-copy {
  flex: 1;
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}
.bo-copy strong {
  font-size: 0.95rem;
  color: #f2f5fb;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bo-copy small {
  font-size: 0.78rem;
  color: #9aa3b5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bo-sep {
  margin: 0 0.28rem;
  font-weight: 600;
  color: #9aa3b5;
}
.bo-count {
  flex: 0 0 auto;
  font-size: 0.78rem;
  color: #8b95a5;
}
.bo-effect-lines {
  display: grid;
  gap: 0;
  padding-left: 3.1rem;
}
.bo-effect-row {
  padding: 0.4rem 0;
  border-bottom: 1px solid #2d3646;
}
.bo-effect-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.bo-effect-line {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
}
.bo-effect-control {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex: 0 0 auto;
  margin-left: auto;
  font-size: 0.8rem;
  color: #9aa3b5;
  cursor: default;
}
.bo-inherit {
  flex: 0 0 auto;
  font-size: 0.75rem;
  padding: 0.2rem 0.45rem;
}
.bo-effect-check {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  min-width: 0;
  cursor: pointer;
}
.bo-check {
  width: 1.15rem;
  height: 1.15rem;
  flex: 0 0 auto;
  margin-top: 0.15rem;
  accent-color: #2f7df6;
}
.bo-effect-text {
  min-width: 0;
  font-size: 0.9rem;
  font-weight: 700;
  color: #f2f5fb;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.bo-empty {
  margin: 0.6rem 0;
  color: #8b95a5;
}
</style>
