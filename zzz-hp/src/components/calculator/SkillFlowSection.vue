<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, Skill, SkillDamageType, SkillTypeId } from '@/types/calculator'
import type { FlowEntry, PreparedSkill, SchemeSlot } from '@/types/damageCalcHistory'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import { listAllDamageCalcHistory } from '@/utils/damageCalcHistory'
import {
  DAMAGE_EVENT_KIND_OPTIONS,
} from '@/utils/damageEvent'
import {
  defaultAnomalyAgents,
  ensureSchemeSlots,
  getHitSkipReason,
  newLocalId,
  skillNeedsDualAgents,
  type ResolvedHit,
} from '@/utils/resolvedHit'
import { createCustomSkillId } from '@/utils/skillLibrary'
import { SKILL_TYPE_OPTIONS } from '@/utils/skillTypes'

const props = defineProps<{
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  hits?: ResolvedHit[]
}>()

const slots = defineModel<SchemeSlot[]>('slots', { default: () => ensureSchemeSlots([], 3) })

const buffStore = useCalculatorBuffStore()
const { skillSubcategories } = storeToRefs(buffStore)

const activeSlotIndex = ref(0)
const libraryQuery = ref('')
const libraryFilter = ref<'all' | 'publicAnomaly'>('all')
const showCustomForm = ref(false)
const modalOpen = ref(false)
const modalTab = ref<'prep' | 'flow'>('prep')

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
const currentTeamSlotLabel = computed(() => {
  const slot = props.teamSlots[activeSlotIndex.value]
  return slot ? slotLabel(slot, activeSlotIndex.value) : '空位'
})

const teamAgentOptions = computed(() =>
  props.teamSlots
    .map((slot) => props.agents.find((item) => item.id === slot.agentId))
    .filter((item): item is AgentBuffDoc => Boolean(item)),
)

const preparedSkillIds = computed(
  () => new Set(currentSlot.value.prepared.map((item) => item.skillId)),
)

const librarySkills = computed(() => {
  if (!currentAgentId.value) return [] as Skill[]
  let list = buffStore.skillsForAgent(currentAgentId.value)
  if (libraryFilter.value === 'publicAnomaly') {
    list = list.filter((skill) => !skill.agentId && skillNeedsDualAgents(skill.damageType))
  }
  const q = libraryQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((skill) => skill.name.toLowerCase().includes(q))
})

const unpreparedFilteredCount = computed(
  () => librarySkills.value.filter((skill) => !preparedSkillIds.value.has(skill.id)).length,
)

function damageTypeLabel(type: SkillDamageType) {
  return DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === type)?.label ?? type
}

function skillTypesLabel(skill: Skill) {
  if (!skill.skillTypes.length) return '无类型'
  return skill.skillTypes
    .map((id) => SKILL_TYPE_OPTIONS.find((item) => item.id === id)?.label ?? id)
    .join(' / ')
}

function preparedSkill(prepared: PreparedSkill): Skill | null {
  return buffStore.findSkill(prepared.skillId)
}

function slotLabel(slot: TeamSlot, index: number) {
  const agent = props.agents.find((item) => item.id === slot.agentId)
  if (!agent) return `空位 ${index + 1}`
  return slot.isMainC ? `${agent.name}（主C）` : agent.name
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

function addFilteredToPrepared() {
  const ownerId = currentAgentId.value
  if (!ownerId) return
  const existing = new Set(currentSlot.value.prepared.map((item) => item.skillId))
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  for (const skill of librarySkills.value) {
    if (existing.has(skill.id)) continue
    existing.add(skill.id)
    const agents = defaultAnomalyAgents(skill.damageType, ownerId)
    slot.prepared.push({
      id: newLocalId('prep'),
      skillId: skill.id,
      skillSource: skill.source,
      anomalyPowerAgentId: agents.anomalyPowerAgentId,
      triggerAgentId: agents.triggerAgentId,
      extraMods: null,
    })
  }
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

function movePrepared(preparedId: string, delta: number) {
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  const index = slot.prepared.findIndex((item) => item.id === preparedId)
  const target = index + delta
  if (index < 0 || target < 0 || target >= slot.prepared.length) return
  const [item] = slot.prepared.splice(index, 1)
  slot.prepared.splice(target, 0, item!)
  slots.value = next
}

function flowSkipReason(entry: FlowEntry): string | null {
  const hit = props.hits?.find((item) => item.id === entry.id)
  if (!hit) {
    const prepared = currentSlot.value.prepared.find((item) => item.id === entry.preparedId)
    if (!prepared) return '准备阶段里找不到这条招式'
    if (!preparedSkill(prepared)) return '招式已从库中删除'
    return null
  }
  return getHitSkipReason(hit, { teamSlots: props.teamSlots, agents: props.agents })
}

function dualAgentHint(prepared: PreparedSkill, skill: Skill): string | null {
  if (!skillNeedsDualAgents(skill.damageType)) return null
  const teamIds = new Set(props.teamSlots.map((slot) => slot.agentId).filter(Boolean))
  if (!prepared.anomalyPowerAgentId || !prepared.triggerAgentId) {
    return '双代理人未选全，加入流程后不会出伤'
  }
  if (!teamIds.has(prepared.anomalyPowerAgentId) || !teamIds.has(prepared.triggerAgentId)) {
    return '选定的代理人已不在当前队伍'
  }
  return null
}

const customDraft = reactive({
  name: '',
  damageType: 'direct' as SkillDamageType,
  skillTypes: [] as SkillTypeId[],
  buffAnchorId: '' as string,
  baseMult: 0,
  settlementMult: 0,
})

watch(
  () => customDraft.damageType,
  (type) => {
    if (skillNeedsDualAgents(type)) {
      customDraft.skillTypes = []
      customDraft.buffAnchorId = ''
    }
  },
)

const anchorOptions = computed(() =>
  skillSubcategories.value.filter((item) => item.agentId === currentAgentId.value),
)

function toggleCustomSkillType(id: SkillTypeId) {
  const index = customDraft.skillTypes.indexOf(id)
  if (index >= 0) customDraft.skillTypes.splice(index, 1)
  else customDraft.skillTypes.push(id)
}

function saveCustomSkill() {
  const name = customDraft.name.trim()
  if (!name) return
  const anomaly = skillNeedsDualAgents(customDraft.damageType)
  const skill: Skill = {
    id: createCustomSkillId(),
    name,
    agentId: currentAgentId.value,
    source: 'custom',
    damageType: customDraft.damageType,
    skillTypes: anomaly ? [] : [...customDraft.skillTypes],
    buffAnchorId: anomaly ? null : customDraft.buffAnchorId || null,
    baseMult: Number(customDraft.baseMult) || 0,
    settlementMult:
      !anomaly && Number(customDraft.settlementMult)
        ? Number(customDraft.settlementMult)
        : undefined,
  }
  buffStore.upsertCustomSkillDoc(skill)
  addPrepared(skill)
  customDraft.name = ''
  customDraft.baseMult = 0
  customDraft.settlementMult = 0
  customDraft.skillTypes = []
  customDraft.buffAnchorId = ''
  showCustomForm.value = false
}

function skillIsReferenced(skillId: string): boolean {
  if (slots.value.some((slot) => slot.prepared.some((item) => item.skillId === skillId))) {
    return true
  }
  return listAllDamageCalcHistory().some((entry) =>
    (entry.slots ?? []).some((slot) => slot.prepared.some((item) => item.skillId === skillId)),
  )
}

function deleteCustomSkill(skill: Skill) {
  if (skill.source !== 'custom') return
  const referenced = skillIsReferenced(skill.id)
  const ok = window.confirm(
    referenced
      ? `「${skill.name}」仍被方案引用。删除后那些条目会显示招式已删除且不出伤。确定删除？`
      : `删除自定义招式「${skill.name}」？`,
  )
  if (!ok) return
  buffStore.removeCustomSkillDoc(skill.id)
}

function flowSkillName(entry: FlowEntry): string {
  const prepared = currentSlot.value.prepared.find((item) => item.id === entry.preparedId)
  if (!prepared) return '未知招式'
  return preparedSkill(prepared)?.name ?? '招式已删除'
}

type ExtraModKey = 'baseMult' | 'settlementMult' | 'dmgBonus' | 'critRate' | 'critDmg'

function extraNumber(prepared: PreparedSkill, key: ExtraModKey) {
  const value = prepared.extraMods?.[key]
  return value == null ? '' : String(value)
}

function setExtraNumber(prepared: PreparedSkill, key: ExtraModKey, raw: string) {
  const nextMods = { ...(prepared.extraMods ?? {}) }
  if (raw.trim() === '') delete nextMods[key]
  else nextMods[key] = Number(raw)
  updatePrepared(prepared.id, {
    extraMods: Object.keys(nextMods).length ? nextMods : null,
  })
}

function onModalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && modalOpen.value) modalOpen.value = false
}

onMounted(() => window.addEventListener('keydown', onModalKeydown))
onUnmounted(() => window.removeEventListener('keydown', onModalKeydown))
</script>

<template>
  <section id="skill-flow" class="calc-mode-section damage-anchor">
    <header class="calc-mode-header">
      <h2>招式流程</h2>
      <p class="calc-mode-desc">
        从招式库加入当前角色的准备招式，再排进流程。异常类必须选定双代理人才能出伤；换掉队伍角色后不会自动改成新人。
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
        {{ slotLabel(slot, index) }}
      </button>
    </div>

    <div class="flow-summary">
      <span class="flow-summary-counts">
        {{ currentTeamSlotLabel }} · 已准备 {{ currentSlot.prepared.length }} 条 · 流程 {{ currentSlot.flow.length }} 项
      </span>
      <button type="button" class="primary-btn" @click="modalOpen = true">编辑招式流程</button>
    </div>
  </section>

  <Teleport to="body">
    <div v-if="modalOpen" class="skill-flow-overlay" @click.self="modalOpen = false">
      <div class="skill-flow-modal" role="dialog" aria-modal="true" aria-label="招式流程">
        <header class="skill-flow-modal-header">
          <h2>招式流程</h2>
          <button type="button" class="close-btn" aria-label="关闭" @click="modalOpen = false">×</button>
        </header>

        <div class="modal-agent-row" role="tablist" aria-label="角色">
          <button
            v-for="(slot, index) in teamSlots"
            :key="index"
            type="button"
            class="modal-agent-tab"
            :class="{ active: activeSlotIndex === index }"
            @click="activeSlotIndex = index"
          >
            {{ slotLabel(slot, index) }}
          </button>
        </div>

        <div class="modal-tabs" role="tablist" aria-label="阶段">
          <button
            type="button"
            role="tab"
            class="modal-tab"
            :class="{ active: modalTab === 'prep' }"
            @click="modalTab = 'prep'"
          >
            准备阶段
          </button>
          <button
            type="button"
            role="tab"
            class="modal-tab"
            :class="{ active: modalTab === 'flow' }"
            @click="modalTab = 'flow'"
          >
            流程
          </button>
        </div>

        <p v-if="!currentAgentId" class="empty-hint modal-empty">请先在编队里选择角色。</p>

        <div v-else class="flow-grid" :class="`tab-${modalTab}`">
          <!-- Col 1: 招式库 (仅 准备阶段 tab) -->
          <div v-show="modalTab === 'prep'" class="flow-col flow-col--library">
            <h3>招式库</h3>
            <input v-model="libraryQuery" class="search-input" placeholder="搜索招式名" />
            <div class="filter-row">
              <button
                type="button"
                class="chip"
                :class="{ active: libraryFilter === 'all' }"
                @click="libraryFilter = 'all'"
              >
                全部
              </button>
              <button
                type="button"
                class="chip"
                :class="{ active: libraryFilter === 'publicAnomaly' }"
                @click="libraryFilter = 'publicAnomaly'"
              >
                仅公共异常
              </button>
            </div>
            <button
              type="button"
              class="mini-btn"
              :disabled="!unpreparedFilteredCount"
              @click="addFilteredToPrepared"
            >
              将筛选结果全部加入准备
              <template v-if="unpreparedFilteredCount">（{{ unpreparedFilteredCount }}）</template>
            </button>
            <ul class="skill-list library-list">
              <li v-for="skill in librarySkills" :key="skill.id" class="skill-row">
                <div class="skill-row-main">
                  <strong>{{ skill.name }}</strong>
                  <span class="meta">
                    {{ damageTypeLabel(skill.damageType) }} · {{ skillTypesLabel(skill) }}
                    · {{ skill.source === 'preset' ? '预设' : '自定义' }}
                  </span>
                </div>
                <div class="card-actions">
                  <button type="button" class="mini-btn" @click="addPrepared(skill)">
                    {{ preparedSkillIds.has(skill.id) ? '再加一条' : '加入准备' }}
                  </button>
                  <button
                    v-if="skill.source === 'custom'"
                    type="button"
                    class="mini-btn danger"
                    @click="deleteCustomSkill(skill)"
                  >
                    删除
                  </button>
                </div>
              </li>
            </ul>
            <p v-if="!librarySkills.length" class="empty-hint">
              该角色还没有招式。可先新建自定义，或到管理端录入预设。
            </p>
            <button type="button" class="mini-btn" @click="showCustomForm = !showCustomForm">
              {{ showCustomForm ? '收起新建' : '新建自定义招式' }}
            </button>
            <div v-if="showCustomForm" class="custom-form">
              <label>
                <span>名称</span>
                <input v-model="customDraft.name" placeholder="显示名称" />
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
                <span>招式类型（可多选，可空）</span>
                <div class="chip-row">
                  <button
                    v-for="opt in SKILL_TYPE_OPTIONS"
                    :key="opt.id"
                    type="button"
                    class="chip"
                    :class="{ active: customDraft.skillTypes.includes(opt.id) }"
                    @click="toggleCustomSkillType(opt.id)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>
              <p v-else class="empty-hint">异常类不设招式类型和增益锚点，因此不会吃招式限定 Buff。</p>
              <label v-if="!skillNeedsDualAgents(customDraft.damageType)">
                <span>增益锚点（仅本角色）</span>
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
              <label v-if="customDraft.damageType === 'direct'">
                <span>决算倍率%</span>
                <input v-model.number="customDraft.settlementMult" type="number" />
              </label>
              <button type="button" class="mini-btn" @click="saveCustomSkill">保存并加入准备</button>
            </div>
          </div>

          <!-- Col 2: 准备招式（两 tab 共用同一份数据） -->
          <div class="flow-col flow-col--prepared">
            <h3>{{ modalTab === 'prep' ? '准备招式' : '准备招式（加入流程）' }}</h3>
            <p v-if="!currentSlot.prepared.length" class="empty-hint">
              {{
                modalTab === 'prep'
                  ? '从左侧招式库加入。异常类必须选定双代理人才能出伤。'
                  : '先在准备阶段加入招式，才能排进流程。'
              }}
            </p>
            <ul class="skill-list">
              <li v-for="(prepared, preparedIndex) in currentSlot.prepared" :key="prepared.id" class="skill-card">
                <template v-if="preparedSkill(prepared)">
                  <div class="card-head">
                    <strong>{{ preparedSkill(prepared)!.name }}</strong>
                    <span class="meta">{{ damageTypeLabel(preparedSkill(prepared)!.damageType) }}</span>
                  </div>
                  <p v-if="dualAgentHint(prepared, preparedSkill(prepared)!)" class="warn-hint">
                    {{ dualAgentHint(prepared, preparedSkill(prepared)!) }}
                  </p>
                  <div
                    v-if="skillNeedsDualAgents(preparedSkill(prepared)!.damageType)"
                    class="agent-row"
                  >
                    <label>
                      <span>异常强度提供者</span>
                      <select
                        :value="prepared.anomalyPowerAgentId ?? ''"
                        @change="
                          updatePrepared(prepared.id, {
                            anomalyPowerAgentId:
                              ($event.target as HTMLSelectElement).value || null,
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
                  <div class="card-actions">
                    <template v-if="modalTab === 'prep'">
                      <button
                        type="button"
                        class="mini-btn"
                        :disabled="preparedIndex === 0"
                        @click="movePrepared(prepared.id, -1)"
                      >
                        上移
                      </button>
                      <button
                        type="button"
                        class="mini-btn"
                        :disabled="preparedIndex === currentSlot.prepared.length - 1"
                        @click="movePrepared(prepared.id, 1)"
                      >
                        下移
                      </button>
                      <button type="button" class="mini-btn danger" @click="removePrepared(prepared.id)">
                        移除
                      </button>
                    </template>
                    <template v-else>
                      <button type="button" class="mini-btn" @click="addToFlow(prepared)">加入流程</button>
                    </template>
                  </div>
                </template>
                <template v-else>
                  <span class="missing">招式已从库中删除，不参与结算</span>
                  <button type="button" class="mini-btn danger" @click="removePrepared(prepared.id)">
                    移除
                  </button>
                </template>
              </li>
            </ul>
          </div>

          <!-- Col 3: 流程 (仅 流程 tab，右侧先留框架) -->
          <div v-show="modalTab === 'flow'" class="flow-col flow-col--flow">
            <h3>流程</h3>
            <p class="empty-hint">次数、失衡、顺序稍后在这里编排。</p>
            <p v-if="!currentSlot.flow.length" class="empty-hint">还没有流程条目。从左侧把准备招式加进来。</p>
            <ul class="skill-list">
              <li
                v-for="(entry, index) in currentSlot.flow"
                :key="entry.id"
                class="skill-card"
                :class="{ 'skill-card--skip': Boolean(flowSkipReason(entry)) }"
              >
                <div class="card-head">
                  <span class="flow-index">{{ index + 1 }}</span>
                  <strong>{{ flowSkillName(entry) }}</strong>
                </div>
                <p v-if="flowSkipReason(entry)" class="warn-hint">{{ flowSkipReason(entry) }}</p>
                <div class="card-actions">
                  <button type="button" class="mini-btn danger" @click="removeFlow(entry.id)">
                    移除
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.flow-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 0.85rem;
  margin-top: 0.85rem;
}
.flow-col h3 {
  margin: 0 0 0.4rem;
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
.library-list {
  max-height: 28rem;
  overflow: auto;
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
  gap: 0.5rem;
}
.skill-row-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.15rem;
}
.skill-card--skip {
  border-color: #6b3a3a;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.flow-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  border-radius: 999px;
  background: rgba(201, 165, 92, 0.16);
  color: #f0d7a2;
  font-size: 0.72rem;
  font-weight: 700;
}
.meta,
.empty-hint,
.missing {
  color: #9aa3b0;
  font-size: 0.78rem;
}
.warn-hint,
.missing {
  margin: 0;
  color: #c07a7a;
  font-size: 0.76rem;
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
.custom-form label,
.type-checks {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.76rem;
  color: #9aa3b0;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip {
  border: 1px solid #343a44;
  border-radius: 999px;
  background: #12161d;
  color: #d5dae4;
  padding: 0.22rem 0.6rem;
  font-size: 0.74rem;
  cursor: pointer;
}
.chip.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
}
.custom-form {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin: 0.5rem 0 0.75rem;
}
@media (max-width: 1100px) {
  .flow-grid {
    grid-template-columns: 1fr;
  }
  .library-list {
    max-height: 16rem;
  }
}

/* 页面 section 摘要 */
.flow-summary {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-wrap: wrap;
  margin-top: 0.6rem;
}
.flow-summary-counts {
  color: #9aa3b0;
  font-size: 0.85rem;
}
.primary-btn {
  margin-left: auto;
  border: 1px solid #c9a55c;
  background: linear-gradient(180deg, #d8b56a, #b88d3a);
  color: #1a1407;
  font-weight: 600;
  padding: 0.4rem 0.95rem;
  border-radius: 8px;
  cursor: pointer;
}
.primary-btn:hover {
  filter: brightness(1.05);
}

/* 弹窗：覆盖层 + 对话框 */
.skill-flow-overlay {
  position: fixed;
  inset: 0;
  background: rgba(7, 10, 16, 0.62);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}
.skill-flow-modal {
  width: min(1280px, 100%);
  max-height: calc(100vh - 3rem);
  display: flex;
  flex-direction: column;
  background: #14181f;
  border: 1px solid #2a3038;
  border-radius: 12px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}
.skill-flow-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid #2a3038;
  background: #181d27;
}
.skill-flow-modal-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #e8edf5;
}
.close-btn {
  border: none;
  background: transparent;
  color: #9aa3b0;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.4rem;
}
.close-btn:hover {
  color: #e8edf5;
}

/* 角色层：胶囊（与下面阶段 tab 的下划线明显区分） */
.modal-agent-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 0.65rem 1rem 0.35rem;
  background: #14181f;
}
.modal-agent-tab {
  border: 1px solid #2d323a;
  border-radius: 999px;
  background: #0f1217;
  color: #d5dae4;
  padding: 0.35rem 0.95rem;
  font-size: 0.84rem;
  cursor: pointer;
}
.modal-agent-tab.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
  font-weight: 600;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.5rem;
}
.flow-col--library > .mini-btn {
  margin-bottom: 0.5rem;
}

/* 弹窗内的阶段 tab：用下划线（与角色胶囊明显区分） */
.modal-tabs {
  display: flex;
  gap: 0;
  padding: 0 1rem;
  border-bottom: 1px solid #2a3038;
  background: #14181f;
}
.modal-tab {
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: #9aa3b0;
  padding: 0.6rem 1.1rem;
  font-size: 0.92rem;
  cursor: pointer;
  margin-bottom: -1px;
}
.modal-tab:hover {
  color: #dce4f0;
}
.modal-tab.active {
  border-bottom-color: #c9a55c;
  color: #f0d7a2;
}

.modal-empty {
  margin: 1rem;
}

/* 弹窗内的 flow-grid 调整列数：1 + 2 或 2 + 3 */
.skill-flow-modal .flow-grid {
  margin-top: 0;
  padding: 0.85rem 1rem 1rem;
  overflow: auto;
  align-items: stretch;
}
.skill-flow-modal .flow-grid.tab-prep {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
}
.skill-flow-modal .flow-grid.tab-flow {
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
}

/* 卡片外壳统一：库 / 准备 / 流程高度对齐（具体内容风格待定） */
.skill-flow-modal .skill-row,
.skill-flow-modal .skill-card {
  min-height: 4rem;
}
</style>
