<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, Skill, SkillDamageType, SkillTypeId } from '@/types/calculator'
import type { FlowEntry, PreparedSkill, SchemeSlot } from '@/types/damageCalcHistory'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import { listAllDamageCalcHistory } from '@/utils/damageCalcHistory'
import {
  DAMAGE_EVENT_CRIT_MODE_OPTIONS,
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
const currentAgent = computed(
  () => props.agents.find((item) => item.id === currentAgentId.value) ?? null,
)

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
  const list = buffStore.skillsForAgent(currentAgentId.value)
  const q = libraryQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((skill) => skill.name.toLowerCase().includes(q))
})

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
</script>

<template>
  <section id="skill-flow" class="calc-mode-section damage-anchor">
    <header class="calc-mode-header">
      <h2>招式流程</h2>
      <p class="calc-mode-desc">
        从招式库加入当前角色的准备阶段，再排进流程。异常类必须选定双代理人才能出伤；换掉队伍角色后不会自动改成新人。
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

    <p v-if="!currentAgentId" class="empty-hint">请先在编队里选择角色。</p>

    <div v-else class="flow-grid">
      <div class="flow-col">
        <h3>招式库</h3>
        <input v-model="libraryQuery" class="search-input" placeholder="搜索招式名" />
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
        <p v-if="!librarySkills.length" class="empty-hint">该角色还没有招式。可先新建自定义，或到管理端录入预设。</p>
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

      <div class="flow-col">
        <h3>准备阶段</h3>
        <p v-if="!currentSlot.prepared.length" class="empty-hint">从左侧招式库加入，再填结算参数。</p>
        <ul class="skill-list">
          <li v-for="prepared in currentSlot.prepared" :key="prepared.id" class="skill-card">
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
                    @change="
                      setExtraNumber(prepared, 'baseMult', ($event.target as HTMLInputElement).value)
                    "
                  />
                </label>
                <label v-if="preparedSkill(prepared)!.damageType === 'direct'">
                  <span>决算加算</span>
                  <input
                    :value="extraNumber(prepared, 'settlementMult')"
                    @change="
                      setExtraNumber(
                        prepared,
                        'settlementMult',
                        ($event.target as HTMLInputElement).value,
                      )
                    "
                  />
                </label>
                <label>
                  <span>增伤加算</span>
                  <input
                    :value="extraNumber(prepared, 'dmgBonus')"
                    @change="
                      setExtraNumber(prepared, 'dmgBonus', ($event.target as HTMLInputElement).value)
                    "
                  />
                </label>
                <label>
                  <span>暴击加算</span>
                  <input
                    :value="extraNumber(prepared, 'critRate')"
                    @change="
                      setExtraNumber(prepared, 'critRate', ($event.target as HTMLInputElement).value)
                    "
                  />
                </label>
                <label>
                  <span>爆伤加算</span>
                  <input
                    :value="extraNumber(prepared, 'critDmg')"
                    @change="
                      setExtraNumber(prepared, 'critDmg', ($event.target as HTMLInputElement).value)
                    "
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
              <span class="missing">招式已从库中删除，不参与结算</span>
              <button type="button" class="mini-btn danger" @click="removePrepared(prepared.id)">
                移除
              </button>
            </template>
          </li>
        </ul>
      </div>

      <div class="flow-col">
        <h3>{{ currentAgent?.name }} 的流程</h3>
        <p v-if="!currentSlot.flow.length" class="empty-hint">从准备阶段把招式加进来编排次数与失衡。</p>
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
                      staggerPhase: ($event.target as HTMLSelectElement)
                        .value as FlowEntry['staggerPhase'],
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
                  <option
                    v-for="opt in DAMAGE_EVENT_CRIT_MODE_OPTIONS"
                    :key="opt.id"
                    :value="opt.id"
                  >
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
</style>
