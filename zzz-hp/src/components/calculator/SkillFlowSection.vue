<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, Skill, SkillDamageType, SkillTypeId } from '@/types/calculator'
import type { FlowEntry, PreparedSkill, SchemeSlot } from '@/types/damageCalcHistory'
import SkillFlowCard from '@/components/calculator/SkillFlowCard.vue'
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
  hitDamages?: Record<string, number>
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
const detail = ref<
  | { kind: 'library'; skillId: string }
  | { kind: 'prepared'; preparedId: string }
  | { kind: 'flow'; entryId: string }
  | null
>(null)

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

function skillStypeLabels(skill: Skill) {
  return skill.skillTypes
    .map((id) => SKILL_TYPE_OPTIONS.find((item) => item.id === id)?.label ?? id)
    .filter(Boolean)
}

function skillMultText(skill: Skill) {
  const value = Number(skill.baseMult)
  return Number.isFinite(value) && value !== 0 ? String(value) : ''
}

function agentShortName(agentId: string | null | undefined) {
  if (!agentId) return ''
  return props.agents.find((item) => item.id === agentId)?.name?.slice(0, 1) || ''
}

function agentFullName(agentId: string | null | undefined) {
  if (!agentId) return ''
  return props.agents.find((item) => item.id === agentId)?.name ?? ''
}

/** 异常类才有胶囊；未选为空；异放等预设了触发者则显示「→安」 */
function agentPairText(prepared: PreparedSkill, skill: Skill) {
  if (!skillNeedsDualAgents(skill.damageType)) return ''
  const left = agentShortName(prepared.anomalyPowerAgentId)
  const right = agentShortName(prepared.triggerAgentId)
  if (!left && !right) return ''
  if (left && right) return `${left}→${right}`
  if (right) return `→${right}`
  return `${left}→`
}

function agentPairTitle(prepared: PreparedSkill, skill: Skill) {
  if (!skillNeedsDualAgents(skill.damageType)) return ''
  const left = agentFullName(prepared.anomalyPowerAgentId)
  const right = agentFullName(prepared.triggerAgentId)
  if (!left && !right) return ''
  return `${left || '未选'} → ${right || '未选'}`
}

function formatDamage(value: number | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return ''
  return Math.round(value).toLocaleString('en-US')
}

function damageForFlow(entryId: string) {
  return formatDamage(props.hitDamages?.[entryId])
}

function damageForPrepared(preparedId: string) {
  const entry = currentSlot.value.flow.find((item) => item.preparedId === preparedId)
  return entry ? damageForFlow(entry.id) : ''
}

function damageForLibrary(skillId: string) {
  const prepared = currentSlot.value.prepared.find((item) => item.skillId === skillId)
  return prepared ? damageForPrepared(prepared.id) : ''
}

function dtypeKind(type: SkillDamageType) {
  return skillNeedsDualAgents(type) ? 'anomaly' : 'direct'
}

function clearPrepared() {
  if (!currentSlot.value.prepared.length) return
  const ok = window.confirm('清空当前角色的全部准备招式？流程里对应条目也会去掉。')
  if (!ok) return
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  slot.prepared = []
  slot.flow = []
  slots.value = next
  detail.value = null
}

function closeDetail() {
  detail.value = null
}

const detailSkill = computed((): Skill | null => {
  const current = detail.value
  if (!current) return null
  if (current.kind === 'library') return buffStore.findSkill(current.skillId)
  if (current.kind === 'prepared') {
    const prepared = currentSlot.value.prepared.find((item) => item.id === current.preparedId)
    return prepared ? preparedSkill(prepared) : null
  }
  const entry = currentSlot.value.flow.find((item) => item.id === current.entryId)
  if (!entry) return null
  const prepared = currentSlot.value.prepared.find((item) => item.id === entry.preparedId)
  return prepared ? preparedSkill(prepared) : null
})

const detailPrepared = computed((): PreparedSkill | null => {
  const current = detail.value
  if (!current) return null
  if (current.kind === 'prepared') {
    return currentSlot.value.prepared.find((item) => item.id === current.preparedId) ?? null
  }
  if (current.kind === 'flow') {
    const entry = currentSlot.value.flow.find((item) => item.id === current.entryId)
    if (!entry) return null
    return currentSlot.value.prepared.find((item) => item.id === entry.preparedId) ?? null
  }
  return null
})

const detailTitle = computed(() => detailSkill.value?.name || '招式详情')

const detailSkipReason = computed(() => {
  const current = detail.value
  if (current?.kind !== 'flow') return null
  const entry = currentSlot.value.flow.find((item) => item.id === current.entryId)
  return entry ? flowSkipReason(entry) : null
})

function setDetailAgent(field: 'anomalyPowerAgentId' | 'triggerAgentId', raw: string) {
  const prepared = detailPrepared.value
  if (!prepared) return
  updatePrepared(prepared.id, { [field]: raw || null })
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

function flowPrepared(entry: FlowEntry): PreparedSkill | null {
  return currentSlot.value.prepared.find((item) => item.id === entry.preparedId) ?? null
}

function flowSkill(entry: FlowEntry): Skill | null {
  const prepared = flowPrepared(entry)
  return prepared ? preparedSkill(prepared) : null
}

function flowSkillName(entry: FlowEntry): string {
  return flowSkill(entry)?.name ?? (flowPrepared(entry) ? '招式已删除' : '未知招式')
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

watch(modalOpen, (open) => {
  if (!open) detail.value = null
})

function onModalKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !modalOpen.value) return
  if (detail.value) {
    closeDetail()
    return
  }
  modalOpen.value = false
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
          <h2>招式流程 · {{ currentTeamSlotLabel }}</h2>
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

        <div class="modal-body">
          <p v-if="!currentAgentId" class="empty-hint modal-empty">请先在编队里选择角色。</p>

          <div v-else class="flow-grid" :class="`tab-${modalTab}`">
            <div v-show="modalTab === 'prep'" class="flow-col">
              <div class="col-head">
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
                  将筛选结果全部加入准备（{{ unpreparedFilteredCount }}）
                </button>
              </div>
              <ul class="sf-list">
                <SkillFlowCard
                  v-for="skill in librarySkills"
                  :key="skill.id"
                  :name="skill.name"
                  :mult="skillMultText(skill)"
                  :dtype="damageTypeLabel(skill.damageType)"
                  :dtype-kind="dtypeKind(skill.damageType)"
                  :stypes="skillStypeLabels(skill)"
                  :source="skill.source === 'preset' ? '预设' : '自定义'"
                  :damage="damageForLibrary(skill.id)"
                >
                  <template #actions>
                    <button type="button" class="mini-btn" @click="detail = { kind: 'library', skillId: skill.id }">
                      详情
                    </button>
                    <button type="button" class="mini-btn" @click="addPrepared(skill)">
                      {{ preparedSkillIds.has(skill.id) ? '再加一条' : '加入' }}
                    </button>
                    <button
                      v-if="skill.source === 'custom'"
                      type="button"
                      class="mini-btn danger"
                      @click="deleteCustomSkill(skill)"
                    >
                      删除
                    </button>
                  </template>
                </SkillFlowCard>
                <li v-if="!librarySkills.length" class="list-empty">
                  该角色还没有招式。可先新建自定义，或到管理端录入预设。
                </li>
              </ul>
              <div class="col-foot">
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
            </div>

            <div class="flow-col">
              <div class="col-head">
                <h3>{{ modalTab === 'prep' ? '准备招式' : '准备招式（加入流程）' }}</h3>
                <button
                  v-if="modalTab === 'prep'"
                  type="button"
                  class="mini-btn danger"
                  :disabled="!currentSlot.prepared.length"
                  @click="clearPrepared"
                >
                  清空全部
                </button>
                <div v-else class="col-head-spacer" />
                <p class="col-desc">
                  {{
                    modalTab === 'prep'
                      ? '绑定招式库。异常类在详情里选双代理人。'
                      : '只有准备招式才能加入流程。'
                  }}
                </p>
                <div class="col-head-spacer" />
              </div>
              <ul class="sf-list">
                <template v-for="(prepared, preparedIndex) in currentSlot.prepared" :key="prepared.id">
                  <SkillFlowCard
                    v-if="preparedSkill(prepared)"
                    :name="preparedSkill(prepared)!.name"
                    :mult="skillMultText(preparedSkill(prepared)!)"
                    :dtype="damageTypeLabel(preparedSkill(prepared)!.damageType)"
                    :dtype-kind="dtypeKind(preparedSkill(prepared)!.damageType)"
                    :stypes="skillStypeLabels(preparedSkill(prepared)!)"
                    :agent-pair="agentPairText(prepared, preparedSkill(prepared)!)"
                    :agent-title="agentPairTitle(prepared, preparedSkill(prepared)!)"
                    :damage="damageForPrepared(prepared.id)"
                    :skip="Boolean(dualAgentHint(prepared, preparedSkill(prepared)!))"
                  >
                    <template #actions>
                      <button
                        type="button"
                        class="mini-btn"
                        @click="detail = { kind: 'prepared', preparedId: prepared.id }"
                      >
                        详情
                      </button>
                      <template v-if="modalTab === 'prep'">
                        <button
                          type="button"
                          class="mini-btn"
                          :disabled="preparedIndex === 0"
                          @click="movePrepared(prepared.id, -1)"
                        >
                          上
                        </button>
                        <button
                          type="button"
                          class="mini-btn"
                          :disabled="preparedIndex === currentSlot.prepared.length - 1"
                          @click="movePrepared(prepared.id, 1)"
                        >
                          下
                        </button>
                        <button type="button" class="mini-btn danger" @click="removePrepared(prepared.id)">
                          移除
                        </button>
                      </template>
                      <button v-else type="button" class="mini-btn" @click="addToFlow(prepared)">
                        加入流程
                      </button>
                    </template>
                  </SkillFlowCard>
                  <SkillFlowCard v-else name="招式已删除" skip>
                    <template #actions>
                      <button type="button" class="mini-btn danger" @click="removePrepared(prepared.id)">
                        移除
                      </button>
                    </template>
                  </SkillFlowCard>
                </template>
                <li v-if="!currentSlot.prepared.length" class="list-empty">
                  {{
                    modalTab === 'prep'
                      ? '还没有准备招式。'
                      : '先在准备阶段加入招式，才能排进流程。'
                  }}
                </li>
              </ul>
            </div>

            <div v-show="modalTab === 'flow'" class="flow-col">
              <div class="col-head">
                <h3>流程</h3>
                <div class="col-head-spacer" />
                <p class="col-desc">次数、失衡稍后编排。先从左侧加入。</p>
                <div class="col-head-spacer" />
              </div>
              <ul class="sf-list">
                <SkillFlowCard
                  v-for="(entry, index) in currentSlot.flow"
                  :key="entry.id"
                  :index="index + 1"
                  :name="flowSkillName(entry)"
                  :mult="flowSkill(entry) ? skillMultText(flowSkill(entry)!) : ''"
                  :dtype="flowSkill(entry) ? damageTypeLabel(flowSkill(entry)!.damageType) : ''"
                  :dtype-kind="flowSkill(entry) ? dtypeKind(flowSkill(entry)!.damageType) : 'direct'"
                  :stypes="flowSkill(entry) ? skillStypeLabels(flowSkill(entry)!) : []"
                  :agent-pair="
                    flowSkill(entry) && flowPrepared(entry)
                      ? agentPairText(flowPrepared(entry)!, flowSkill(entry)!)
                      : ''
                  "
                  :damage="damageForFlow(entry.id)"
                  :skip="Boolean(flowSkipReason(entry))"
                >
                  <template #actions>
                    <button type="button" class="mini-btn" @click="detail = { kind: 'flow', entryId: entry.id }">
                      详情
                    </button>
                    <button type="button" class="mini-btn danger" @click="removeFlow(entry.id)">
                      移除
                    </button>
                  </template>
                </SkillFlowCard>
                <li v-if="!currentSlot.flow.length" class="list-empty">
                  还没有流程条目。从左侧把准备招式加进来。
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div v-if="detail" class="skill-detail-overlay" @click.self="closeDetail">
          <div class="skill-detail-panel" role="dialog" aria-modal="true" :aria-label="detailTitle">
            <header class="skill-detail-head">
              <h3>招式详情 · {{ detailTitle }}</h3>
              <button type="button" class="close-btn" aria-label="关闭详情" @click="closeDetail">×</button>
            </header>
            <div v-if="detailSkill" class="skill-detail-body">
              <div class="detail-facts">
                <span class="sf-dtype" :class="dtypeKind(detailSkill.damageType) === 'direct' ? 'is-direct' : 'is-anomaly'">
                  {{ damageTypeLabel(detailSkill.damageType) }}
                </span>
                <span v-for="item in skillStypeLabels(detailSkill)" :key="item" class="sf-stype">{{ item }}</span>
                <span class="sf-source">{{ detailSkill.source === 'preset' ? '预设' : '自定义' }}</span>
              </div>
              <p class="detail-mult">
                基础倍率 {{ skillMultText(detailSkill) || '未设' }}
                <template v-if="detailSkill.damageType === 'direct' && detailSkill.settlementMult">
                  · 决算倍率 {{ detailSkill.settlementMult }}
                </template>
              </p>
              <p v-if="detailSkipReason" class="warn-hint">{{ detailSkipReason }}</p>
              <template v-if="detailPrepared && skillNeedsDualAgents(detailSkill.damageType)">
                <p class="detail-section-title">双代理人</p>
                <div class="agent-row">
                  <label>
                    <span>异常强度提供者</span>
                    <select
                      :value="detailPrepared.anomalyPowerAgentId ?? ''"
                      @change="
                        setDetailAgent(
                          'anomalyPowerAgentId',
                          ($event.target as HTMLSelectElement).value,
                        )
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
                      :value="detailPrepared.triggerAgentId ?? ''"
                      @change="
                        setDetailAgent(
                          'triggerAgentId',
                          ($event.target as HTMLSelectElement).value,
                        )
                      "
                    >
                      <option value="">未选</option>
                      <option v-for="agent in teamAgentOptions" :key="agent.id" :value="agent.id">
                        {{ agent.name }}
                      </option>
                    </select>
                  </label>
                </div>
                <p v-if="dualAgentHint(detailPrepared, detailSkill)" class="warn-hint">
                  {{ dualAgentHint(detailPrepared, detailSkill) }}
                </p>
              </template>
              <p v-else-if="detail.kind === 'library'" class="empty-hint">
                招式定义在库里。加入准备后，异常类可在详情里选双代理人。
              </p>
            </div>
            <p v-else class="empty-hint">招式已从库中删除。</p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
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

.skill-flow-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(7, 10, 16, 0.62);
}
.skill-flow-modal {
  position: relative;
  box-sizing: border-box;
  width: min(96vw, 1680px);
  height: min(94vh, 980px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #14181f;
  border: 1px solid #2a3038;
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
}

.skill-flow-modal-header,
.modal-agent-row,
.modal-tabs {
  flex: 0 0 auto;
}

.skill-flow-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid #2a3038;
  background: #181d27;
}
.skill-flow-modal-header h2 {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.05rem;
  color: #e8edf5;
}
.close-btn {
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #d5dae4;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
}
.close-btn:hover {
  border-color: #c9a55c;
  color: #e8edf5;
}

.modal-agent-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 0.65rem 1rem 0.4rem;
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

.modal-body {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 0.75rem 1rem 1rem;
}
.modal-empty {
  margin: auto;
  text-align: center;
}

.flow-grid {
  flex: 1 1 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.85rem;
  align-items: stretch;
}
.flow-col {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.col-head,
.col-foot {
  flex: 0 0 auto;
}
.col-head {
  display: grid;
  grid-template-rows: 1.6rem 2rem 2rem 2.1rem;
  gap: 0.35rem;
  align-items: center;
  margin-bottom: 0.45rem;
}
.col-head h3 {
  margin: 0;
  font-size: 0.92rem;
  color: #e8edf5;
  line-height: 1.6rem;
}
.col-head-spacer {
  min-height: 0;
}
.col-desc,
.empty-hint,
.list-empty {
  margin: 0;
  color: #9aa3b0;
  font-size: 0.78rem;
}
.col-desc {
  min-height: 0;
  line-height: 1.2rem;
}
.search-input,
.custom-form input,
.custom-form select,
.agent-row select {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #e8edf5;
  padding: 0.3rem 0.45rem;
}
.search-input {
  box-sizing: border-box;
  width: 100%;
  height: 2rem;
  margin: 0;
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  min-height: 2rem;
}
.col-head > .mini-btn {
  width: 100%;
  height: 2rem;
  margin: 0;
}

.sf-list {
  list-style: none;
  margin: 0;
  padding: 0 0.2rem 0 0;
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  overflow: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  align-content: start;
}
.list-empty {
  padding: 0.85rem 0.4rem;
}

.col-foot {
  margin-top: 0.5rem;
}
.custom-form {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: 0.45rem;
  max-height: 14rem;
  overflow: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}
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
.chip.highlight {
  border-color: #4a90d9 !important;
  border-style: dashed !important;
}

.mini-btn {
  border: 1px solid #3a4150;
  border-radius: 8px;
  background: #1a2030;
  color: #dce4f0;
  padding: 0.2rem 0.55rem;
  cursor: pointer;
  font-size: 0.78rem;
  white-space: nowrap;
}
.mini-btn.danger {
  border-color: #6b3a3a;
  color: #f0c0c0;
}
.mini-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.agent-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.45rem;
}
.agent-row label {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
  font-size: 0.7rem;
  color: #9aa3b0;
}
.agent-row select {
  min-width: 0;
  width: 100%;
}

.warn-hint {
  margin: 0;
  color: #c07a7a;
  font-size: 0.76rem;
}

.skill-detail-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(7, 10, 16, 0.55);
}
.skill-detail-panel {
  width: min(640px, 100%);
  max-height: 100%;
  overflow: auto;
  scrollbar-gutter: stable;
  background: #181d27;
  border: 1px solid #2a3038;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
}
.skill-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.9rem;
  border-bottom: 1px solid #2a3038;
}
.skill-detail-head h3 {
  margin: 0;
  font-size: 0.95rem;
  color: #e8edf5;
}
.skill-detail-body {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 0.85rem 0.9rem 1rem;
}
.detail-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.detail-facts .sf-dtype,
.detail-facts .sf-stype,
.detail-facts .sf-source,
.sf-dtype,
.sf-stype,
.sf-source {
  display: inline-flex;
  align-items: center;
  padding: 0.08rem 0.42rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  white-space: nowrap;
}
.sf-dtype.is-anomaly {
  background: #1a2a38;
  border: 1px solid #3a6a88;
  color: #8ec8e8;
}
.sf-dtype.is-direct {
  background: rgba(201, 165, 92, 0.14);
  border: 1px solid #8a6a1f;
  color: #f0d7a2;
}
.sf-stype {
  background: #15241f;
  border: 1px solid #2f5c52;
  color: #8fd4c4;
}
.sf-source {
  background: #1a1d24;
  border: 1px solid #3a4150;
  color: #9aa3b0;
  font-weight: 600;
}
.detail-mult,
.detail-section-title {
  margin: 0;
  font-size: 0.82rem;
  color: #dce4f0;
}
.detail-section-title {
  font-weight: 700;
}

@media (max-width: 800px) {
  .skill-flow-modal {
    height: min(96vh, 980px);
  }
  .flow-grid {
    grid-template-columns: minmax(0, 1fr);
    overflow: auto;
    scrollbar-gutter: stable;
  }
  .flow-col {
    min-height: 18rem;
  }
}
</style>
