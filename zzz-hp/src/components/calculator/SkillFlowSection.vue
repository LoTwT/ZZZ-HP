<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, Skill, SkillDamageType, SkillTypeId } from '@/types/calculator'
import type { FlowEntry, PreparedSkill, SchemeSlot } from '@/types/damageCalcHistory'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import {
  DAMAGE_EVENT_CRIT_MODE_OPTIONS,
  DAMAGE_EVENT_KIND_OPTIONS,
} from '@/utils/damageEvent'
import {
  defaultAnomalyAgents,
  ensureSchemeSlots,
  newLocalId,
  skillNeedsDualAgents,
} from '@/utils/resolvedHit'
import { createCustomSkillId } from '@/utils/skillLibrary'
import { SKILL_TYPE_OPTIONS } from '@/utils/skillTypes'

const props = defineProps<{
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
}>()

const slots = defineModel<SchemeSlot[]>('slots', { default: () => ensureSchemeSlots([], 3) })

const buffStore = useCalculatorBuffStore()
const { skillSubcategories } = storeToRefs(buffStore)

const activeSlotIndex = ref(0)
const libraryQuery = ref('')
const showCustomForm = ref(false)

watch(
  () => props.teamSlots.length,
  (count) => {
    slots.value = ensureSchemeSlots(slots.value, Math.max(3, count))
  },
  { immediate: true },
)

watch(
  () => props.teamSlots.map((slot) => slot.agentId).join(','),
  () => {
    const firstFilled = props.teamSlots.findIndex((slot) => slot.agentId)
    if (firstFilled >= 0 && !props.teamSlots[activeSlotIndex.value]?.agentId) {
      activeSlotIndex.value = firstFilled
    }
  },
)

const currentSlot = computed(() => slots.value[activeSlotIndex.value] ?? { prepared: [], flow: [] })
const currentAgentId = computed(() => props.teamSlots[activeSlotIndex.value]?.agentId ?? '')
const currentAgent = computed(() =>
  props.agents.find((item) => item.id === currentAgentId.value) ?? null,
)

const teamAgentOptions = computed(() =>
  props.teamSlots
    .map((slot) => props.agents.find((item) => item.id === slot.agentId))
    .filter((item): item is AgentBuffDoc => Boolean(item)),
)

const librarySkills = computed(() => {
  if (!currentAgentId.value) return [] as Skill[]
  const list = buffStore.skillsForAgent(currentAgentId.value)
  const q = libraryQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((skill) => skill.name.toLowerCase().includes(q))
})

function damageTypeLabel(type: SkillDamageType) {
  return DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === type)?.label ?? type
}

function skillTypesLabel(skill: Skill) {
  if (!skill.skillTypes.length) return '无'
  return skill.skillTypes
    .map((id) => SKILL_TYPE_OPTIONS.find((item) => item.id === id)?.label ?? id)
    .join(' / ')
}

function preparedSkill(prepared: PreparedSkill): Skill | null {
  return buffStore.findSkill(prepared.skillId)
}

function addPrepared(skill: Skill) {
  const ownerId = currentAgentId.value
  if (!ownerId) return
  const agents = defaultAnomalyAgents(skill.damageType, ownerId)
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  slot.prepared.push({
    id: newLocalId('prep'),
    skillId: skill.id,
    skillSource: skill.source,
    anomalyPowerAgentId: agents.anomalyPowerAgentId,
    triggerAgentId: agents.triggerAgentId,
    extraMods: null,
  })
  slots.value = next
}

function removePrepared(preparedId: string) {
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  slot.prepared = slot.prepared.filter((item) => item.id !== preparedId)
  slot.flow = slot.flow.filter((item) => item.preparedId !== preparedId)
  slots.value = next
}

function updatePrepared(preparedId: string, patch: Partial<PreparedSkill>) {
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  const index = slot.prepared.findIndex((item) => item.id === preparedId)
  if (index < 0) return
  slot.prepared[index] = { ...slot.prepared[index]!, ...patch }
  slots.value = next
}

function addToFlow(prepared: PreparedSkill) {
  const ownerId = currentAgentId.value
  if (!ownerId) return
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  slot.flow.push({
    id: newLocalId('flow'),
    ownerAgentId: ownerId,
    preparedId: prepared.id,
    count: 1,
    staggerPhase: 'stagger',
    critMode: 'expected',
  })
  slots.value = next
}

function updateFlow(entryId: string, patch: Partial<FlowEntry>) {
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  const index = slot.flow.findIndex((item) => item.id === entryId)
  if (index < 0) return
  slot.flow[index] = { ...slot.flow[index]!, ...patch }
  slots.value = next
}

function removeFlow(entryId: string) {
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  slot.flow = slot.flow.filter((item) => item.id !== entryId)
  slots.value = next
}

function moveFlow(entryId: string, delta: number) {
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  const index = slot.flow.findIndex((item) => item.id === entryId)
  const target = index + delta
  if (index < 0 || target < 0 || target >= slot.flow.length) return
  const [item] = slot.flow.splice(index, 1)
  slot.flow.splice(target, 0, item!)
  slots.value = next
}

const customDraft = reactive({
  name: '',
  damageType: 'direct' as SkillDamageType,
  skillTypes: [] as SkillTypeId[],
  buffAnchorId: '' as string,
  baseMult: 0,
})

const anchorOptions = computed(() => {
  const agentId = currentAgentId.value
  return skillSubcategories.value.filter(
    (item) => !item.agentId || item.agentId === agentId,
  )
})

function toggleCustomSkillType(id: SkillTypeId) {
  const index = customDraft.skillTypes.indexOf(id)
  if (index >= 0) customDraft.skillTypes.splice(index, 1)
  else customDraft.skillTypes.push(id)
}

function saveCustomSkill() {
  const name = customDraft.name.trim()
  if (!name) return
  const skill: Skill = {
    id: createCustomSkillId(),
    name,
    agentId: currentAgentId.value,
    source: 'custom',
    damageType: customDraft.damageType,
    skillTypes: skillNeedsDualAgents(customDraft.damageType) ? [] : [...customDraft.skillTypes],
    buffAnchorId: customDraft.buffAnchorId || null,
    baseMult: Number(customDraft.baseMult) || 0,
  }
  buffStore.upsertCustomSkillDoc(skill)
  addPrepared(skill)
  customDraft.name = ''
  customDraft.baseMult = 0
  customDraft.skillTypes = []
  customDraft.buffAnchorId = ''
  showCustomForm.value = false
}

function flowSkillName(entry: FlowEntry): string {
  const prepared = currentSlot.value.prepared.find((item) => item.id === entry.preparedId)
  if (!prepared) return '未知招式'
  return preparedSkill(prepared)?.name ?? '未知招式'
}

function extraNumber(
  prepared: PreparedSkill,
  key: 'baseMult' | 'dmgBonus' | 'critRate' | 'critDmg',
) {
  const value = prepared.extraMods?.[key]
  return value == null ? '' : String(value)
}

function setExtraNumber(
  prepared: PreparedSkill,
  key: 'baseMult' | 'dmgBonus' | 'critRate' | 'critDmg',
  raw: string,
) {
  const nextMods = { ...(prepared.extraMods ?? {}) }
  if (raw.trim() === '') delete nextMods[key]
  else nextMods[key] = Number(raw)
  updatePrepared(prepared.id, {
    extraMods: Object.keys(nextMods).length ? nextMods : null,
  })
}
</script>

<template>
  <section id="skill-flow" class="calc-mode-section damage-anchor">
    <header class="calc-mode-header">
      <h2>招式库 / 准备阶段 / 流程</h2>
      <p class="calc-mode-desc">
        从招式库按需加入当前角色的准备阶段；异常类在此选定双代理人。流程只编排已准备的招式。
      </p>
    </header>

    <div class="calc-mode-tabs" role="tablist" aria-label="角色流程">
      <button
        v-for="(slot, index) in teamSlots"
        :key="index"
        type="button"
        class="calc-mode-tab"
        :class="{ active: activeSlotIndex === index }"
        @click="activeSlotIndex = index"
      >
        {{ agents.find((item) => item.id === slot.agentId)?.name || `角色 ${index + 1}` }}
      </button>
    </div>

    <p v-if="!currentAgentId" class="empty-hint">请先在编队里选择角色。</p>

    <div v-else class="flow-grid">
      <div class="flow-col">
        <h3>招式库</h3>
        <input v-model="libraryQuery" class="search-input" placeholder="搜索招式名" />
        <ul class="skill-list">
          <li v-for="skill in librarySkills" :key="skill.id" class="skill-row">
            <div>
              <strong>{{ skill.name }}</strong>
              <span class="meta">
                {{ damageTypeLabel(skill.damageType) }} · {{ skillTypesLabel(skill) }}
                · {{ skill.source === 'preset' ? '预设' : '自定义' }}
              </span>
            </div>
            <button type="button" class="mini-btn" @click="addPrepared(skill)">加入准备</button>
          </li>
        </ul>
        <button type="button" class="mini-btn" @click="showCustomForm = !showCustomForm">
          {{ showCustomForm ? '收起新建' : '新建自定义招式' }}
        </button>
        <div v-if="showCustomForm" class="custom-form">
          <label>
            <span>名称</span>
            <input v-model="customDraft.name" />
          </label>
          <label>
            <span>伤害类型</span>
            <select v-model="customDraft.damageType">
              <option v-for="opt in DAMAGE_EVENT_KIND_OPTIONS" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <div v-if="!skillNeedsDualAgents(customDraft.damageType)" class="type-checks">
            <label v-for="opt in SKILL_TYPE_OPTIONS" :key="opt.id" class="check">
              <input
                type="checkbox"
                :checked="customDraft.skillTypes.includes(opt.id)"
                @change="toggleCustomSkillType(opt.id)"
              />
              {{ opt.label }}
            </label>
          </div>
          <label>
            <span>增益锚点</span>
            <select v-model="customDraft.buffAnchorId">
              <option value="">无</option>
              <option v-for="item in anchorOptions" :key="item.id" :value="item.id">
                {{ item.name }}
              </option>
            </select>
          </label>
          <label>
            <span>基础倍率%</span>
            <input v-model.number="customDraft.baseMult" type="number" />
          </label>
          <button type="button" class="mini-btn" @click="saveCustomSkill">保存并加入准备</button>
        </div>

        <h3>准备阶段</h3>
        <p v-if="!currentSlot.prepared.length" class="empty-hint">还没有加入招式。</p>
        <ul class="skill-list">
          <li v-for="prepared in currentSlot.prepared" :key="prepared.id" class="skill-card">
            <template v-if="preparedSkill(prepared)">
              <div class="card-head">
                <strong>{{ preparedSkill(prepared)!.name }}</strong>
                <span class="meta">{{ damageTypeLabel(preparedSkill(prepared)!.damageType) }}</span>
              </div>
              <div v-if="skillNeedsDualAgents(preparedSkill(prepared)!.damageType)" class="agent-row">
                <label>
                  <span>异常强度提供者</span>
                  <select
                    :value="prepared.anomalyPowerAgentId ?? ''"
                    @change="
                      updatePrepared(prepared.id, {
                        anomalyPowerAgentId: ($event.target as HTMLSelectElement).value || null,
                      })
                    "
                  >
                    <option value="">未选</option>
                    <option v-for="agent in teamAgentOptions" :key="agent.id" :value="agent.id">
                      {{ agent.name }}
                    </option>
                  </select>
                </label>
                <label>
                  <span>异常类触发者</span>
                  <select
                    :value="prepared.triggerAgentId ?? ''"
                    @change="
                      updatePrepared(prepared.id, {
                        triggerAgentId: ($event.target as HTMLSelectElement).value || null,
                      })
                    "
                  >
                    <option value="">未选</option>
                    <option v-for="agent in teamAgentOptions" :key="agent.id" :value="agent.id">
                      {{ agent.name }}
                    </option>
                  </select>
                </label>
              </div>
              <div class="extra-row">
                <label>
                  <span>倍率加算</span>
                  <input
                    :value="extraNumber(prepared, 'baseMult')"
                    @change="setExtraNumber(prepared, 'baseMult', ($event.target as HTMLInputElement).value)"
                  />
                </label>
                <label>
                  <span>增伤加算</span>
                  <input
                    :value="extraNumber(prepared, 'dmgBonus')"
                    @change="setExtraNumber(prepared, 'dmgBonus', ($event.target as HTMLInputElement).value)"
                  />
                </label>
              </div>
              <div class="card-actions">
                <button type="button" class="mini-btn" @click="addToFlow(prepared)">加入流程</button>
                <button type="button" class="mini-btn danger" @click="removePrepared(prepared.id)">
                  移除
                </button>
              </div>
            </template>
            <template v-else>
              <span class="missing">招式已从库中删除（{{ prepared.skillId }}）</span>
              <button type="button" class="mini-btn danger" @click="removePrepared(prepared.id)">
                移除
              </button>
            </template>
          </li>
        </ul>
      </div>

      <div class="flow-col">
        <h3>{{ currentAgent?.name }} 的流程</h3>
        <p v-if="!currentSlot.flow.length" class="empty-hint">从准备阶段把招式加进来编排。</p>
        <ul class="skill-list">
          <li v-for="(entry, index) in currentSlot.flow" :key="entry.id" class="skill-card">
            <div class="card-head">
              <strong>{{ flowSkillName(entry) }}</strong>
            </div>
            <div class="flow-fields">
              <label>
                <span>次数</span>
                <input
                  type="number"
                  min="0"
                  :value="entry.count"
                  @change="
                    updateFlow(entry.id, {
                      count: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0),
                    })
                  "
                />
              </label>
              <label>
                <span>失衡</span>
                <select
                  :value="entry.staggerPhase"
                  @change="
                    updateFlow(entry.id, {
                      staggerPhase: ($event.target as HTMLSelectElement).value as FlowEntry['staggerPhase'],
                    })
                  "
                >
                  <option value="stagger">失衡期</option>
                  <option value="normal">非失衡期</option>
                </select>
              </label>
              <label>
                <span>暴击</span>
                <select
                  :value="entry.critMode"
                  @change="
                    updateFlow(entry.id, {
                      critMode: ($event.target as HTMLSelectElement).value as FlowEntry['critMode'],
                    })
                  "
                >
                  <option v-for="opt in DAMAGE_EVENT_CRIT_MODE_OPTIONS" :key="opt.id" :value="opt.id">
                    {{ opt.label }}
                  </option>
                </select>
              </label>
            </div>
            <div class="card-actions">
              <button type="button" class="mini-btn" :disabled="index === 0" @click="moveFlow(entry.id, -1)">
                上移
              </button>
              <button
                type="button"
                class="mini-btn"
                :disabled="index === currentSlot.flow.length - 1"
                @click="moveFlow(entry.id, 1)"
              >
                下移
              </button>
              <button type="button" class="mini-btn danger" @click="removeFlow(entry.id)">移除</button>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.calc-mode-section {
  border: 1px solid #2a2d33;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  padding: 1rem;
}
.calc-mode-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}
.calc-mode-desc {
  margin: 0.25rem 0 0.75rem;
  font-size: 0.8rem;
  color: #9aa3b0;
}
.calc-mode-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.calc-mode-tab {
  border: 1px solid #2d323a;
  border-radius: 999px;
  background: #0f1217;
  color: #d5dae4;
  padding: 0.35rem 0.95rem;
  font-size: 0.84rem;
  cursor: pointer;
}
.calc-mode-tab.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
  font-weight: 600;
}
.flow-grid {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 1rem;
  margin-top: 0.85rem;
}
.flow-col h3 {
  margin: 0.6rem 0 0.4rem;
  font-size: 0.92rem;
  color: #e8edf5;
}
.search-input,
.custom-form input,
.custom-form select,
.skill-card input,
.skill-card select {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #e8edf5;
  padding: 0.3rem 0.45rem;
}
.search-input {
  width: 100%;
  margin-bottom: 0.5rem;
}
.skill-list {
  list-style: none;
  margin: 0 0 0.6rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.skill-row,
.skill-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: #141820;
}
.skill-row {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}
.meta,
.empty-hint,
.missing {
  color: #9aa3b0;
  font-size: 0.78rem;
}
.missing {
  color: #c07a7a;
}
.mini-btn {
  border: 1px solid #3a4150;
  border-radius: 8px;
  background: #1a2030;
  color: #dce4f0;
  padding: 0.2rem 0.55rem;
  cursor: pointer;
  font-size: 0.78rem;
}
.mini-btn.danger {
  border-color: #6b3a3a;
  color: #f0c0c0;
}
.mini-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.agent-row,
.extra-row,
.flow-fields,
.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.7rem;
}
.agent-row label,
.extra-row label,
.flow-fields label,
.custom-form label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.76rem;
  color: #9aa3b0;
}
.type-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.7rem;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: #d5dae4;
}
.custom-form {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin: 0.5rem 0 0.75rem;
}
@media (max-width: 960px) {
  .flow-grid {
    grid-template-columns: 1fr;
  }
}
</style>
