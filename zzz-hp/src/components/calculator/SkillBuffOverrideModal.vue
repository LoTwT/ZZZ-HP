<script setup lang="ts">
/**
 * 本行增益例外（按流程行禁用增益）的编辑弹窗。
 *
 * 设计（2026-09-20）：
 * - **入口与存储都在流程行**：这里改的是 `FlowEntry.buffOverrides`，缺省 = 全部继承全局
 * - 只允许"禁用"（减法语义）：勾掉 = 这一行不吃该增益
 * - 列表只列**该行本来可生效**的效果（由页面传入与全局选择器同一份 `CollectedEffect[]`）
 * - 只影响本行结算：不改面板、不动层数累计、不影响其它行
 */
import { computed } from 'vue'
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
}>()

const open = defineModel<boolean>('open', { default: false })
const override = defineModel<FlowBuffOverride | null>('override', { default: null })

type BlockGroup = { key: string; label: string; effects: BuffEffect[] }

/** 按效果块分组（块键与目录一致，直接用共享实现 —— 额外 Buff 的 `extra-<id>` 也在其中） */
const groups = computed<BlockGroup[]>(() => {
  const map = new Map<string, BlockGroup>()
  for (const item of props.effects) {
    const key = blockKeyOfCollected(item)
    const raw = item as unknown as { blockName?: string | null; sourceLabel?: string | null }
    const label = (raw.blockName ?? '').trim() || (raw.sourceLabel ?? '').trim() || '未命名效果块'
    const group = map.get(key) ?? { key, label, effects: [] }
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

function write(next: Partial<FlowBuffOverride>) {
  const merged: FlowBuffOverride = {
    disabledBlockIds: next.disabledBlockIds ?? override.value?.disabledBlockIds ?? [],
    disabledEffectIds: next.disabledEffectIds ?? override.value?.disabledEffectIds ?? [],
  }
  const empty = !merged.disabledBlockIds?.length && !merged.disabledEffectIds?.length
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
  <div v-if="open" class="bo-mask" @click.self="open = false">
    <div class="bo-card">
      <header class="bo-head">
        <span class="bo-title">本行增益例外</span>
        <span v-if="rowLabel" class="bo-row">{{ rowLabel }}</span>
        <span class="bo-badge">例外 {{ exceptionCount }}</span>
        <span class="bo-spacer" />
        <button type="button" class="mini-btn" :disabled="!exceptionCount" @click="restoreGlobal">
          恢复全局
        </button>
        <button type="button" class="mini-btn" @click="open = false">关闭</button>
      </header>
      <p class="bo-hint">
        勾掉 = <b>这一行不吃</b>该增益。只影响本行结算：不改面板、不影响层数累计、不影响其它行。
      </p>
      <div class="bo-body">
        <div v-for="group in groups" :key="group.key" class="bo-group">
          <!-- 分组标题只当标签（2026-09-22 定稿：没有"整组关"这个概念），每条增益一个勾 -->
          <div class="bo-block">
            <span class="bo-block-name">{{ group.label }}</span>
            <span class="bo-block-count">{{ group.effects.length }} 条</span>
          </div>
          <ul class="bo-list">
            <li v-for="effect in group.effects" :key="effect.id" class="bo-item">
              <label class="bo-item-label">
                <input
                  type="checkbox"
                  :checked="!isEffectOff(effect.id)"
                  @change="toggleEffect(effect.id)"
                />
                <span class="bo-item-text">{{ effectLabel(effect) }}</span>
              </label>
            </li>
          </ul>
        </div>
        <p v-if="!groups.length" class="bo-empty">这一行没有可调整的增益。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bo-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(6, 8, 12, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}
.bo-card {
  box-sizing: border-box;
  width: min(46rem, 100%);
  max-height: min(80vh, 46rem);
  display: flex;
  flex-direction: column;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: #141820;
  color: #dfe6ef;
  overflow: hidden;
}
.bo-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid #2a3038;
}
.bo-title {
  font-weight: 600;
}
.bo-row {
  color: #9fb0c6;
  max-width: 18rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bo-badge {
  padding: 0 0.4rem;
  border: 1px solid #3d4653;
  border-radius: 999px;
  font-size: 0.78rem;
  color: #ffd479;
}
.bo-spacer {
  flex: 1;
}
.bo-hint {
  margin: 0;
  padding: 0.45rem 0.75rem;
  color: #9fb0c6;
  font-size: 0.82rem;
  border-bottom: 1px solid #222833;
}
.bo-body {
  overflow: auto;
  padding: 0.5rem 0.75rem 0.75rem;
}
.bo-group + .bo-group {
  margin-top: 0.6rem;
}
.bo-block {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0;
  font-weight: 600;
}
.bo-block-count {
  color: #7f8fa3;
  font-weight: 400;
  font-size: 0.78rem;
}
.bo-list {
  list-style: none;
  margin: 0.2rem 0 0;
  padding: 0 0 0 1.1rem;
}
.bo-item-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.12rem 0;
  font-size: 0.86rem;
}
.bo-item-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bo-empty {
  margin: 0.6rem 0;
  color: #7f8fa3;
}
</style>
