<script setup lang="ts">
import { ref } from 'vue'
import AdminBuffEffectRow from '@/components/admin/calculator/AdminBuffEffectRow.vue'
import type {
  BuffDamageType,
  BuffEffect,
  BuffEffectBlock,
} from '@/types/calculator'
import { createEmptyBuffEffect, createEmptyBuffEffectBlock, packFromBlocks } from '@/utils/buffEffect'
import { findBuffStatZoneById } from '@/utils/buffStatZones'
import {
  alignRow,
  buildEffectRows,
  changeRowZone,
  confirmMergeRow,
  mergeRows,
  replaceRowEffects,
  splitRow,
  toggleRowDamageType,
  validateEffectGroups,
  type EffectRow,
} from '@/utils/buffEffectRows'

const props = defineProps<{
  lockApplyTarget?: 'self' | 'team' | null
  hint?: string
  /** 当前编辑的角色（招式小类创建/筛选） */
  agentId?: string
  /** 空列表时新增的第一个效果块默认名称（如「精1」） */
  defaultFirstBlockName?: string
  /** 空列表时新增的第一个效果块默认注释 */
  defaultFirstBlockNote?: string
  /** 仅允许能量回复效率（百分比）等受限场景用；现已统一百分比语义 */
  energyRegenFlatOnly?: boolean
  /**
   * 勾选「异常计算时也生效」时回调（用于邦布/音擎精炼跨精同步）。
   */
  onAppliesToAnomalyChange?: (effect: BuffEffect, value: boolean) => void
}>()

const model = defineModel<BuffEffectBlock[]>({ required: true })

/** [拆开] 后本次编辑里不再按启发式聚回去（只影响显示，不写数据） */
const suppressedByBlock = ref<Record<string, string[]>>({})
const mergeMode = ref(false)
const selectedRowKeys = ref<string[]>([])
const mergeError = ref('')

function rowsOf(block: BuffEffectBlock): EffectRow[] {
  const suppressed = new Set(suppressedByBlock.value[block.id] ?? [])
  return buildEffectRows(block.effects, { suppressHeuristicIds: suppressed })
}

function rememberSuppressed(blockId: string, effects: readonly BuffEffect[]) {
  const ids = new Set(suppressedByBlock.value[blockId] ?? [])
  for (const effect of effects) ids.add(effect.id)
  suppressedByBlock.value = {
    ...suppressedByBlock.value,
    [blockId]: [...ids],
  }
}

function clearSuppressed(blockId: string, effects: readonly BuffEffect[]) {
  const removed = new Set(effects.map((effect) => effect.id))
  const next = (suppressedByBlock.value[blockId] ?? []).filter((id) => !removed.has(id))
  suppressedByBlock.value = { ...suppressedByBlock.value, [blockId]: next }
}

function addBlock() {
  const isFirst = model.value.length === 0
  const name =
    isFirst && props.defaultFirstBlockName?.trim()
      ? props.defaultFirstBlockName.trim()
      : `效果块 ${model.value.length + 1}`
  const note =
    isFirst && props.defaultFirstBlockNote?.trim()
      ? props.defaultFirstBlockNote.trim()
      : ''
  model.value = [
    ...model.value,
    createEmptyBuffEffectBlock({
      name,
      note,
      effects: [
        createEmptyBuffEffect({
          applyTarget: props.lockApplyTarget ?? 'self',
          stat: props.energyRegenFlatOnly ? 'energyRegen' : 'dmgBonus',
        }),
      ],
    }),
  ]
}

function removeBlock(index: number) {
  const block = model.value[index]
  if (block) delete suppressedByBlock.value[block.id]
  model.value = model.value.filter((_, i) => i !== index)
}

function addEffect(block: BuffEffectBlock) {
  block.effects.push(
    createEmptyBuffEffect({
      applyTarget: props.lockApplyTarget ?? 'self',
      stat: props.energyRegenFlatOnly ? 'energyRegen' : 'dmgBonus',
    }),
  )
}

function removeRow(block: BuffEffectBlock, row: EffectRow) {
  const ids = new Set(row.effects.map((effect) => effect.id))
  block.effects = block.effects.filter((effect) => !ids.has(effect.id))
  clearSuppressed(block.id, row.effects)
  selectedRowKeys.value = selectedRowKeys.value.filter((key) => key !== row.key)
}

function onChangeZone(
  block: BuffEffectBlock,
  row: EffectRow,
  zoneId: string,
  types: BuffDamageType[],
) {
  const zone = findBuffStatZoneById(zoneId)
  if (!zone) return
  block.effects = changeRowZone(block.effects, row, zone, types)
  clearSuppressed(block.id, row.effects)
}

function onToggleType(
  block: BuffEffectBlock,
  row: EffectRow,
  type: BuffDamageType,
  checked: boolean,
) {
  block.effects = toggleRowDamageType(block.effects, row, type, checked)
  clearSuppressed(block.id, row.effects)
}

function onSplit(block: BuffEffectBlock, row: EffectRow) {
  const beforeIds = new Set(block.effects.map((effect) => effect.id))
  const oldIds = row.effects.map((effect) => effect.id)
  const next = splitRow(block.effects, row)
  block.effects = next
  const splitIds =
    row.effects.length > 1
      ? oldIds
      : [...oldIds, ...next.filter((effect) => !beforeIds.has(effect.id)).map((effect) => effect.id)]
  rememberSuppressed(
    block.id,
    splitIds.map((id) => next.find((effect) => effect.id === id)).filter(Boolean) as BuffEffect[],
  )
}

function onConfirmMerge(block: BuffEffectBlock, row: EffectRow) {
  block.effects = confirmMergeRow(block.effects, row)
}

function onAlign(block: BuffEffectBlock, row: EffectRow) {
  block.effects = replaceRowEffects(block.effects, row, alignRow(row))
}

function toggleMergeMode() {
  mergeMode.value = !mergeMode.value
  selectedRowKeys.value = []
  mergeError.value = ''
}

function toggleSelect(row: EffectRow) {
  const exists = selectedRowKeys.value.includes(row.key)
  selectedRowKeys.value = exists
    ? selectedRowKeys.value.filter((key) => key !== row.key)
    : [...selectedRowKeys.value, row.key]
}

function mergeSelected(block: BuffEffectBlock) {
  const rows = rowsOf(block).filter((row) => selectedRowKeys.value.includes(row.key))
  const result = mergeRows(block.effects, rows)
  if (!result.ok || !result.effects) {
    mergeError.value = result.error ?? '合并失败'
    return
  }
  block.effects = result.effects
  mergeError.value = ''
  selectedRowKeys.value = []
}

defineExpose({
  syncPack: () => {
    const validation = validateEffectGroups(model.value)
    if (!validation.ok) {
      throw new Error(validation.errors.join('；'))
    }
    return packFromBlocks(model.value)
  },
})
</script>

<template>
  <div class="effect-editor">
    <p v-if="hint !== ''" class="hint">
      {{
        hint ??
        '每行是一组同源效果：改数值 / 目标 / 条件会整组一起改；勾伤害类型加一条、取消删对应条；[拆开] 清 groupId；[合并] 把同块同族同值的行写成同一个 groupId。'
      }}
    </p>

    <div class="merge-toolbar">
      <button type="button" class="ghost-btn" @click="toggleMergeMode">
        {{ mergeMode ? '退出合并模式' : '合并行…' }}
      </button>
      <span v-if="mergeMode" class="hint">勾选同块、同族、同值的行，再点下面块内的「合并选中」。</span>
    </div>

    <div v-if="!model.length" class="empty">暂无效果块</div>

    <article v-for="(block, blockIndex) in model" :key="block.id" class="block-card">
      <header class="block-head">
        <label class="field name-field">
          <span>效果块名称</span>
          <input v-model="block.name" type="text" autocomplete="off" placeholder="可自定义名称" />
        </label>
        <button type="button" class="danger-btn" @click="removeBlock(blockIndex)">删除块</button>
      </header>

      <label class="field note-field">
        <span>块备注 / 注释</span>
        <textarea v-model="block.note" rows="2" autocomplete="off" placeholder="可选说明、触发条件等" />
      </label>

      <p v-if="mergeMode" class="merge-block-actions">
        <button
          type="button"
          class="ghost-btn"
          :disabled="selectedRowKeys.length < 2"
          @click="mergeSelected(block)"
        >
          合并选中（{{ selectedRowKeys.length }}）
        </button>
        <span v-if="mergeError" class="err">{{ mergeError }}</span>
      </p>

      <AdminBuffEffectRow
        v-for="row in rowsOf(block)"
        :key="row.key"
        :row="row"
        :agent-id="agentId"
        :lock-apply-target="lockApplyTarget"
        :merge-mode="mergeMode"
        :selected="selectedRowKeys.includes(row.key)"
        :on-applies-to-anomaly-change="onAppliesToAnomalyChange"
        @change-zone="(zoneId, types) => onChangeZone(block, row, zoneId, types)"
        @toggle-type="(type, checked) => onToggleType(block, row, type, checked)"
        @split="onSplit(block, row)"
        @remove="removeRow(block, row)"
        @confirm-merge="onConfirmMerge(block, row)"
        @align="onAlign(block, row)"
        @toggle-select="toggleSelect(row)"
      />

      <button type="button" class="add-btn" @click="addEffect(block)">＋ 在此块添加效果</button>
    </article>

    <button type="button" class="add-btn" @click="addBlock">＋ 添加效果块</button>
  </div>
</template>

<style scoped>
.effect-editor {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.hint {
  margin: 0;
  font-size: 0.76rem;
  opacity: 0.72;
  line-height: 1.45;
  color: var(--color-text);
}

.empty {
  font-size: 0.85rem;
  opacity: 0.65;
  padding: 0.5rem 0;
}

.merge-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.merge-block-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
}

.block-card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 0.85rem;
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.block-head {
  display: flex;
  gap: 0.75rem;
  align-items: end;
  justify-content: space-between;
}

.name-field {
  flex: 1;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.76rem;
  color: var(--color-text);
}

.field input[type='text'],
.field textarea,
.field select {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  padding: 0.4rem 0.5rem;
  font: inherit;
}

.field textarea {
  resize: vertical;
  min-height: 2.6rem;
  line-height: 1.4;
}

.note-field {
  width: 100%;
}

.add-btn,
.ghost-btn,
.danger-btn {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  padding: 0.4rem 0.7rem;
  cursor: pointer;
  font-size: 0.82rem;
}

.danger-btn {
  color: #c45c5c;
  border-color: rgba(196, 92, 92, 0.4);
}

.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.err {
  margin: 0;
  color: #c45c5c;
  font-size: 0.78rem;
}
</style>
