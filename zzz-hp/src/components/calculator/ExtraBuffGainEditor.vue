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
    </div>

    <p v-if="!local.length" class="extra-buff-empty">
      还没有额外 Buff。点「添加增益」新建一张卡片；一张卡片只编辑一个乘区（可多选伤害类型）。
    </p>

    <ul v-else class="extra-buff-cards">
      <li v-for="card in local" :key="card.id" class="extra-buff-card">
        <header class="extra-buff-card-head">
          <input
            :ref="(el) => setInputRef(card.id, el)"
            v-model="card.name"
            type="text"
            class="extra-buff-name"
            placeholder="自定义增益"
            :aria-label="`额外 Buff 名称 ${card.name}`"
            @blur="normalizeName(card)"
          />
          <span class="extra-buff-scope" :title="appliesToLabel(card)">
            {{ appliesToLabel(card) }}
          </span>
          <button type="button" class="extra-buff-remove" @click="removeGain(card.id)">移除</button>
        </header>

        <div class="extra-buff-card-body">
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
.extra-buff-editor {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.extra-buff-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.add-btn {
  border: 1px solid #4a5563;
  border-radius: 8px;
  background: #1a1f2a;
  color: #dbe3ef;
  padding: 0.35rem 0.8rem;
  font-size: 0.84rem;
  cursor: pointer;
}

.add-btn:hover {
  border-color: #5d6b7f;
  background: #1c2432;
}

.extra-buff-count {
  font-size: 0.8rem;
  color: #9aa3b5;
}

.extra-buff-empty {
  margin: 0;
  font-size: 0.8rem;
  color: #9aa3b5;
}

.extra-buff-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.extra-buff-card {
  border: 1px solid #2d3646;
  border-radius: 10px;
  background: #141922;
  padding: 0.6rem 0.7rem 0.7rem;
}

.extra-buff-card-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.45rem;
}

.extra-buff-name {
  flex: 1;
  min-width: 0;
  border: 1px solid #3a4454;
  border-radius: 8px;
  background: #10141c;
  color: #edf1f7;
  padding: 0.3rem 0.5rem;
  font-size: 0.86rem;
}

.extra-buff-scope {
  flex-shrink: 0;
  font-size: 0.76rem;
  color: #9aa3b5;
  border: 1px solid #3a4454;
  border-radius: 999px;
  padding: 0.12rem 0.5rem;
}

.extra-buff-remove {
  flex-shrink: 0;
  border: 1px solid #6b4a4a;
  border-radius: 8px;
  background: transparent;
  color: #d79a9a;
  padding: 0.25rem 0.6rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.extra-buff-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

@media (max-width: 720px) {
  .extra-buff-card-head {
    flex-wrap: wrap;
  }

  .extra-buff-name {
    flex-basis: 100%;
  }
}
</style>
