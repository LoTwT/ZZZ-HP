<script setup lang="ts">
/**
 * 额外 Buff 编辑器（Spec §4.1 / §4.2）。
 *
 * 一维卡片列表：一张卡片 = 一个命名增益 = 恰好一行共享效果行。
 * - `v-model` 的入参/出参是 `ExtraBuffGain[]`，类型定义只在 `@/types/extraBuff`。
 * - 卡片头只有「名称」和「移除」；底层效果数不暴露给用户。
 * - 任何字段改动都**重建卡片对象并广播新数组**：目录缓存键按对象身份记忆化，
 *   就地改同一个数组会让计算结果不刷新（Spec §4.2 第 6 项）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import AdminBuffEffectRow from '@/components/admin/calculator/AdminBuffEffectRow.vue'
import type { AgentBuffDoc, BuffDamageType, BuffEffect } from '@/types/calculator'
import type { ExtraBuffApplySlot, ExtraBuffGain, ExtraBuffSlotIndex } from '@/types/extraBuff'
import {
  createExtraBuffGain,
  extraGainAppliesToSlot,
  serializeExtraGains,
} from '@/utils/extraBuffCalc'
import { buildEffectRows, changeRowZone, toggleRowDamageType, type EffectRow } from '@/utils/buffEffectRows'
import { findBuffStatZoneById } from '@/utils/buffStatZones'
import { teamSlotDisplayLabel } from '@/utils/teamSlotLabel'

const props = defineProps<{
  teamSlots?: Array<{ agentId?: string | null }>
  agents?: AgentBuffDoc[]
}>()

const gains = defineModel<ExtraBuffGain[]>({ required: true })

/** 编辑副本：共享效果行会就地改传入的对象，所以这里只碰副本，改完再广播 */
const local = ref<ExtraBuffGain[]>(serializeExtraGains(gains.value))
let lastSignature = JSON.stringify(serializeExtraGains(gains.value))

function signatureOf(cards: readonly ExtraBuffGain[]): string {
  return JSON.stringify(serializeExtraGains([...cards]))
}

watch(
  () => gains.value,
  (next) => {
    const signature = signatureOf(next ?? [])
    if (signature === lastSignature) return
    local.value = serializeExtraGains(next ?? [])
    lastSignature = signature
  },
)

/** 广播：把副本重建为新数组（派生 applyTarget，保持 id/顺序） */
function broadcast() {
  const rebuilt = serializeExtraGains(local.value).map((card) => ({
    ...card,
    effects: card.effects.map((effect) => ({
      ...effect,
      applyTarget: (card.applySlot === 'team' ? 'team' : 'self') as BuffEffect['applyTarget'],
    })),
  }))
  const signature = signatureOf(rebuilt)
  if (signature === lastSignature) return
  lastSignature = signature
  gains.value = rebuilt
}

watch(local, broadcast, { deep: true })

const nameInputs = ref<Record<string, HTMLInputElement | null>>({})

function setInputRef(id: string, element: unknown) {
  nameInputs.value[id] = (element as HTMLInputElement | null) ?? null
}

/** 槽位选项：作用对象与来源槽位共用（Spec §4.2 第 1 项） */
const slotOptions = computed(() => {
  const slots = props.teamSlots ?? []
  const agents = props.agents ?? []
  return [0, 1, 2].map((index) => {
    const slot = slots[index] ?? { agentId: '' }
    const label = teamSlotDisplayLabel(slot, index, agents)
    return { value: index as ExtraBuffSlotIndex, label: `${label}（槽位 ${index + 1}）` }
  })
})

const applySlotOptions = computed(() => slotOptions.value)

function addGain() {
  const card = createExtraBuffGain({ applySlot: 0, sourceSlot: 0 })
  local.value = [...local.value, card]
  void nextTick(() => {
    const input = nameInputs.value[card.id]
    input?.focus()
    input?.select()
  })
}

function removeGain(id: string) {
  local.value = local.value.filter((card) => card.id !== id)
}

function normalizeName(card: ExtraBuffGain) {
  const text = card.name.trim()
  card.name = text || '自定义增益'
}

function setApplySlot(card: ExtraBuffGain, value: ExtraBuffApplySlot) {
  card.applySlot = value
}

function setSourceSlot(card: ExtraBuffGain, value: ExtraBuffSlotIndex) {
  card.sourceSlot = value
}

/** 一张卡片在共享效果行里的当前行（一卡恰好一行） */
function rowsOf(card: ExtraBuffGain): EffectRow[] {
  return buildEffectRows(card.effects)
}

function onChangeZone(card: ExtraBuffGain, row: EffectRow, zoneId: string, types: BuffDamageType[]) {
  const zone = findBuffStatZoneById(zoneId)
  if (!zone) return
  card.effects = changeRowZone(card.effects, row, zone, types)
}

function onToggleType(card: ExtraBuffGain, row: EffectRow, type: BuffDamageType, checked: boolean) {
  card.effects = toggleRowDamageType(card.effects, row, type, checked)
}

/**
 * 卡片展开 / 收起（默认展开）。
 * 只是显示状态，不进 `ExtraBuffGain`（不改数据契约、不落草稿），换弹窗即回到默认展开。
 */
const collapsedIds = ref<string[]>([])

function isCollapsed(cardId: string): boolean {
  return collapsedIds.value.includes(cardId)
}

function toggleCollapsed(cardId: string) {
  collapsedIds.value = isCollapsed(cardId)
    ? collapsedIds.value.filter((id) => id !== cardId)
    : [...collapsedIds.value, cardId]
}

/** 全部展开 / 全部收起：`便于控制` 的总开关 */
const allCollapsed = computed(
  () => local.value.length > 0 && local.value.every((card) => isCollapsed(card.id)),
)

function toggleAllCollapsed() {
  collapsedIds.value = allCollapsed.value ? [] : local.value.map((card) => card.id)
}

const appliesToLabel = (card: ExtraBuffGain): string =>
  card.applySlot === 'team'
    ? '全队'
    : (slotOptions.value.find((opt) => opt.value === card.applySlot)?.label ?? '槽位 1')

defineExpose({
  /** 给测试/调试用：当前卡片数 */
  gainCount: computed(() => local.value.length),
  appliesToLabel,
  extraGainAppliesToSlot,
})
</script>

<template>
  <div class="extra-buff-editor">
    <div class="extra-buff-toolbar">
      <button type="button" class="add-btn" @click="addGain">＋ 添加增益</button>
      <span class="extra-buff-count">共 {{ local.length }} 条</span>
      <button
        v-if="local.length > 1"
        type="button"
        class="collapse-all-btn"
        @click="toggleAllCollapsed"
      >
        {{ allCollapsed ? '全部展开' : '全部收起' }}
      </button>
    </div>

    <p v-if="!local.length" class="extra-buff-empty">
      还没有额外 Buff。点「添加增益」新建一张卡片；一张卡片只编辑一个乘区（可多选伤害类型）。
    </p>

    <ul v-else class="extra-buff-cards">
      <li
        v-for="card in local"
        :key="card.id"
        class="extra-buff-card"
        :class="{ 'is-collapsed': isCollapsed(card.id) }"
      >
        <header class="extra-buff-card-head">
          <button
            type="button"
            class="extra-buff-toggle"
            :aria-expanded="!isCollapsed(card.id)"
            :aria-label="isCollapsed(card.id) ? '展开这张卡片' : '收起这张卡片'"
            :title="isCollapsed(card.id) ? '展开' : '收起'"
            @click="toggleCollapsed(card.id)"
          >
            <span class="extra-buff-toggle-icon">{{ isCollapsed(card.id) ? '▸' : '▾' }}</span>
          </button>
          <input
            :ref="(el) => setInputRef(card.id, el)"
            v-model="card.name"
            type="text"
            class="extra-buff-name"
            placeholder="自定义增益"
            :aria-label="`额外 Buff 名称 ${card.name}`"
            @focus="collapsedIds = collapsedIds.filter((id) => id !== card.id)"
            @blur="normalizeName(card)"
          />
          <span class="extra-buff-scope" :title="appliesToLabel(card)">
            {{ appliesToLabel(card) }}
          </span>
          <button type="button" class="extra-buff-remove" @click="removeGain(card.id)">移除</button>
        </header>

        <div v-show="!isCollapsed(card.id)" class="extra-buff-card-body">
          <AdminBuffEffectRow
            v-for="row in rowsOf(card)"
            :key="row.key"
            :row="row"
            :agent-id="undefined"
            context-mode="extra"
            :apply-slot="card.applySlot"
            :source-slot="card.sourceSlot"
            :slot-options="applySlotOptions"
            @change-zone="(zoneId, types) => onChangeZone(card, row, zoneId, types)"
            @toggle-type="(type, checked) => onToggleType(card, row, type, checked)"
            @update:applySlot="(value) => setApplySlot(card, value)"
            @update:sourceSlot="(value) => setSourceSlot(card, value)"
          />
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/*
 * 主题：弹窗 Teleport 到 body，拿不到 `.calculator-page` 上的 `--calc-*`，
 * 所以这里用全局 `--color-*`（随 `html[data-theme]` 翻转）+ `color-mix` 派生，
 * 白天/暗夜共用一套声明，不再各写一份覆盖。
 * 字号按"能直接读"来定：名称 1rem、正文 0.95rem，最小可点高度 2.2rem。
 */
.extra-buff-editor {
  --eb-surface: var(--color-background-soft, #141922);
  --eb-surface-2: var(--color-background-mute, #1a1f2a);
  --eb-border: var(--color-border, #2d3646);
  --eb-text: var(--color-text, #e8ecf4);
  --eb-muted: color-mix(in srgb, var(--color-text, #e8ecf4) 64%, transparent);
  --eb-input-bg: color-mix(in srgb, var(--color-background, #10141c) 88%, var(--color-text, #e8ecf4) 5%);
  --eb-accent: #c9a55c;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  font-size: 0.95rem;
  color: var(--eb-text);
}

.extra-buff-toolbar {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.add-btn {
  border: 1px solid var(--eb-border);
  border-radius: 10px;
  background: var(--eb-surface-2);
  color: var(--eb-text);
  padding: 0.5rem 1.05rem;
  font-size: 0.95rem;
  font-weight: 600;
  min-height: 2.4rem;
  cursor: pointer;
}

.add-btn:hover {
  border-color: var(--eb-accent);
  background: color-mix(in srgb, var(--eb-accent) 12%, var(--eb-surface-2));
}

.extra-buff-count {
  font-size: 0.85rem;
  color: var(--eb-muted);
}

.extra-buff-empty {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--eb-muted);
}

.extra-buff-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.extra-buff-card {
  border: 1px solid var(--eb-border);
  border-radius: 12px;
  /* 白天要接近白色、暗夜要能跟弹窗分开：只在暗夜加暗一档（浅色下 2% 已经够区分） */
  background: color-mix(in srgb, var(--eb-surface) 97%, var(--eb-text) 2%);
  padding: 0.8rem 0.9rem 1rem;
}

[data-theme='dark'] .extra-buff-card {
  background: color-mix(in srgb, var(--eb-surface) 84%, var(--eb-text) 10%);
}

.extra-buff-card.is-collapsed {
  padding-bottom: 0.8rem;
}

.extra-buff-card.is-collapsed .extra-buff-card-head {
  margin-bottom: 0;
}

.extra-buff-toggle {
  flex-shrink: 0;
  width: 1.9rem;
  height: 1.9rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--eb-border);
  border-radius: 8px;
  background: transparent;
  color: var(--eb-muted);
  font-size: 0.9rem;
  line-height: 1;
  cursor: pointer;
}

.extra-buff-toggle:hover {
  color: var(--eb-text);
  border-color: var(--eb-accent);
}

.collapse-all-btn {
  border: 1px solid var(--eb-border);
  border-radius: 8px;
  background: transparent;
  color: var(--eb-muted);
  padding: 0.3rem 0.7rem;
  font-size: 0.85rem;
  min-height: 2rem;
  cursor: pointer;
}

.collapse-all-btn:hover {
  color: var(--eb-text);
  border-color: var(--eb-accent);
}

.extra-buff-card-head {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-bottom: 0.6rem;
}

.extra-buff-name {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--eb-border);
  border-radius: 9px;
  background: var(--eb-input-bg);
  color: var(--eb-text);
  padding: 0.45rem 0.65rem;
  font-size: 1rem;
  line-height: 1.4;
}

.extra-buff-name:focus-visible {
  outline: 2px solid var(--eb-accent);
  outline-offset: 1px;
}

.extra-buff-scope {
  flex-shrink: 0;
  font-size: 0.85rem;
  color: var(--eb-muted);
  border: 1px solid var(--eb-border);
  border-radius: 999px;
  padding: 0.25rem 0.65rem;
  white-space: nowrap;
}

.extra-buff-remove {
  flex-shrink: 0;
  border: 1px solid color-mix(in srgb, #d9534f 55%, var(--eb-border));
  border-radius: 9px;
  background: transparent;
  color: color-mix(in srgb, #d9534f 78%, var(--eb-text) 22%);
  padding: 0.4rem 0.8rem;
  font-size: 0.9rem;
  min-height: 2.2rem;
  cursor: pointer;
}

.extra-buff-remove:hover {
  background: color-mix(in srgb, #d9534f 14%, transparent);
}

.extra-buff-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  /* 展开内容在头部之下缩进一级，视觉上从属于这张卡 */
  padding-left: 2.2rem;
}

/*
 * 共享效果行本身是管理端的紧凑排版（字号 0.8rem 左右，一屏塞很多行）。
 * 额外 Buff 一屏只有一两张卡片，空间充足 —— 这里只在**本容器内**把它放大，
 * 不改共享组件，也不影响增益库那侧的密度。
 */
.extra-buff-card-body :deep(.effect-row) {
  font-size: 0.95rem;
  padding: 0.75rem 0.85rem;
  /* 共享行自带的底色比卡片更暖（偏褐），在额外 Buff 里让它跟着卡片走 */
  background: transparent;
  border-color: color-mix(in srgb, var(--eb-border) 80%, transparent);
}

.extra-buff-card-body :deep(.effect-title strong) {
  font-size: 1rem;
}

.extra-buff-card-body :deep(.line-label),
.extra-buff-card-body :deep(.inline-field > span) {
  font-size: 0.9rem;
}

.extra-buff-card-body :deep(select),
.extra-buff-card-body :deep(input[type='text']),
.extra-buff-card-body :deep(.step-input) {
  font-size: 0.95rem;
  min-height: 2.1rem;
}

.extra-buff-card-body :deep(.summary-value) {
  font-size: 1rem;
}

@media (max-width: 720px) {
  .extra-buff-card-head {
    flex-wrap: wrap;
  }

  .extra-buff-name {
    flex-basis: 100%;
  }

  .extra-buff-scope,
  .extra-buff-remove {
    font-size: 0.85rem;
  }
}
</style>
