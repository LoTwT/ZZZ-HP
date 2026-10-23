<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  BuffApplySituation,
  BuffScope,
  BuffSkillTargetId,
  BuffStatKey,
  SkillCategoryId,
} from '@/types/calculator'
import {
  BUFF_SCOPE_OPTIONS,
  BUFF_SKILL_TARGET_OPTIONS,
} from '@/types/calculator'
import { BUFF_STAT_FIELDS, AGENT_ROLES, buffStatFieldLabel } from '@/utils/calculatorUi'
import { createEmptyBuffEffect, formatTeamProfessionGateLabel } from '@/utils/buffEffect'
import {
  createExtraBuffGain,
  extraGainApplySlotLabel,
  resolveExtraGainApplySlot,
  scopeLabel,
  type ExtraBuffApplySlot,
  type ExtraBuffGain,
} from '@/utils/extraBuffCalc'
import { hasBuffScope, normalizeBuffScopes } from '@/utils/buffScope'
import { teamSlotDisplayLabel } from '@/utils/teamSlotLabel'
import type { AgentBuffDoc } from '@/types/calculator'

const props = defineProps<{
  skillSubcategories?: Array<{
    id: string
    agentId: string
    categoryId: SkillCategoryId
    name: string
  }>
  teamSlots?: Array<{ agentId?: string | null }>
  agents?: AgentBuffDoc[]
}>()

const gains = defineModel<ExtraBuffGain[]>({ required: true })

const draftName = ref('自定义增益')
const draftStat = ref<BuffStatKey>('dmgBonus')
const draftValue = ref(0)
const draftSituation = ref<BuffApplySituation>('global')
const draftScope = ref<BuffScope>('general')
const draftApplySlot = ref<ExtraBuffApplySlot>(0)
const draftApplyProfession = ref('')
const draftTeamProfession = ref('')
const draftTeamProfessionValues = ref<Array<number | null>>([null, null, null])
const draftSkillCategory = ref<BuffSkillTargetId>('basic')
const draftSkillSubcategoryId = ref<string>('')
const draftAppliesToAnomaly = ref(false)

const SITUATION_LABELS: Record<BuffApplySituation, string> = {
  global: '全局',
  stagger: '失衡期',
  non_stagger: '非失衡期',
}

const slotOptions = computed(() => {
  const slots = props.teamSlots ?? [{ agentId: '' }, { agentId: '' }, { agentId: '' }]
  const agents = props.agents ?? []
  return [0, 1, 2].map((index) => ({
    value: index,
    label: teamSlotDisplayLabel(slots[index] ?? { agentId: '' }, index, agents),
  }))
})

const draftSubcategories = computed(() =>
  (props.skillSubcategories ?? []).filter(
    (item) => item.categoryId === draftSkillCategory.value,
  ),
)

function onDraftTeamProfessionChange() {
  if (!draftTeamProfession.value) {
    draftTeamProfessionValues.value = [null, null, null]
  }
}

function isDraftTierOn(index: number) {
  return draftTeamProfessionValues.value[index] != null
}

function setDraftTierOn(index: number, on: boolean) {
  const next = [...draftTeamProfessionValues.value]
  next[index] = on ? 0 : null
  draftTeamProfessionValues.value = next
}

function addGain() {
  const name = draftName.value.trim() || '自定义增益'
  // 界面过渡期：草稿表单 → 一张卡片 + 一条底层效果（P5 换成一维卡片 + 共享效果行）
  const effect = createEmptyBuffEffect({
    stat: draftStat.value,
    kind: 'fixed',
    value: Number.isFinite(draftValue.value) ? draftValue.value : 0,
    applyTarget: draftApplySlot.value === 'team' ? 'team' : 'self',
    applySituation: draftSituation.value,
    // scope 数组口径（编辑器仍是单选，写出去统一数组）
    scope: normalizeBuffScopes(draftScope.value),
    applyProfession: draftApplyProfession.value.trim() || null,
    teamProfession: draftTeamProfession.value.trim() || null,
    teamProfessionValues: draftTeamProfession.value.trim()
      ? [...draftTeamProfessionValues.value]
      : null,
    skillTargets:
      draftScope.value === 'skill'
        ? [
            {
              category: draftSkillCategory.value,
              subcategoryId: draftSkillSubcategoryId.value || null,
            },
          ]
        : undefined,
    appliesToAnomaly:
      draftScope.value === 'skill' && draftAppliesToAnomaly.value ? true : undefined,
    enabledDefault: true,
  })
  const gain = createExtraBuffGain({
    name,
    applySlot: draftApplySlot.value,
    effects: [effect],
  })
  gains.value = [...gains.value, gain]
  draftValue.value = 0
  draftSituation.value = 'global'
  draftScope.value = 'general'
  draftApplySlot.value = 0
  draftApplyProfession.value = ''
  draftTeamProfession.value = ''
  draftTeamProfessionValues.value = [null, null, null]
  draftSkillSubcategoryId.value = ''
  draftAppliesToAnomaly.value = false
}

function removeGain(id: string) {
  gains.value = gains.value.filter((item) => item.id !== id)
}

function parseApplySlot(value: string): ExtraBuffApplySlot {
  return value === 'team' ? 'team' : (Number(value) as ExtraBuffApplySlot)
}

function setGainApplySlot(id: string, value: string) {
  const applySlot = parseApplySlot(value)
  gains.value = gains.value.map((item) =>
    item.id === id
      ? {
          ...item,
          applySlot,
          effects: item.effects.map((effect) => ({
            ...effect,
            applyTarget: applySlot === 'team' ? ('team' as const) : ('self' as const),
          })),
        }
      : item,
  )
}

function situationLabel(value?: BuffApplySituation) {
  return SITUATION_LABELS[value ?? 'global']
}

/** 列表摘要只看第一条底层效果（过渡期：一张卡片一条效果） */
function primaryEffect(item: ExtraBuffGain) {
  return item.effects[0]!
}

function skillTargetSummary(item: ExtraBuffGain): string {
  const effect = primaryEffect(item)
  if (!hasBuffScope(effect.scope, 'skill')) return ''
  const category = effect.skillTargets?.[0]?.category ?? effect.skillCategory
  const subcategoryId = effect.skillTargets?.[0]?.subcategoryId ?? effect.skillSubcategoryId
  const cat =
    BUFF_SKILL_TARGET_OPTIONS.find((opt) => opt.id === category)?.label ?? category ?? '招式'
  if (!subcategoryId) return cat
  const sub = props.skillSubcategories?.find((s) => s.id === subcategoryId)
  return sub ? `${cat} · ${sub.name}` : cat
}

function gainMeta(item: ExtraBuffGain): string {
  const effect = primaryEffect(item)
  const parts = [
    scopeLabel(effect.scope),
    extraGainApplySlotLabel(item, props.teamSlots ?? [], props.agents ?? []),
  ]
  if (effect.applyProfession?.trim()) {
    parts.push(`职业·${effect.applyProfession.trim()}`)
  }
  const gate = formatTeamProfessionGateLabel(effect)
  if (gate) parts.push(gate)
  parts.push(situationLabel(effect.applySituation))
  const skill = skillTargetSummary(item)
  if (skill) parts.push(skill)
  if (effect.appliesToAnomaly) parts.push('异常也生效')
  return parts.join(' · ')
}
</script>

<template>
  <div class="extra-buff-editor">
    <p class="extra-buff-hint">
      额外 Buff 添加后立即参与计算。目标按槽位固定（全队或角色1/2/3），切换编辑中角色不会改作用对象。队内职业人数条件只限制何时生效，不改变数值本身。
    </p>
    <div class="extra-buff-form">
      <label class="field">
        <span>名称</span>
        <input v-model="draftName" type="text" placeholder="自定义增益" />
      </label>
      <label class="field">
        <span>增益类型</span>
        <select v-model="draftStat">
          <option v-for="field in BUFF_STAT_FIELDS" :key="field.key" :value="field.key">
            {{ buffStatFieldLabel(field) }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>作用域</span>
        <select v-model="draftScope">
          <option v-for="opt in BUFF_SCOPE_OPTIONS" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>作用对象</span>
        <select
          :value="draftApplySlot"
          @change="draftApplySlot = parseApplySlot(($event.target as HTMLSelectElement).value)"
        >
          <option value="team">全队</option>
          <option v-for="opt in slotOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>职业</span>
        <select v-model="draftApplyProfession">
          <option value="">不限</option>
          <option v-for="role in AGENT_ROLES" :key="role" :value="role">
            {{ role }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>队内职业人数条件</span>
        <select v-model="draftTeamProfession" @change="onDraftTeamProfessionChange">
          <option value="">不限</option>
          <option v-for="role in AGENT_ROLES" :key="`gate-${role}`" :value="role">
            {{ role }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>作用情况</span>
        <select v-model="draftSituation">
          <option value="global">全局</option>
          <option value="stagger">失衡期</option>
          <option value="non_stagger">非失衡期</option>
        </select>
      </label>
      <label class="field">
        <span>数值</span>
        <input v-model.number="draftValue" type="number" step="any" />
      </label>
      <template v-if="draftScope === 'skill'">
        <label class="field">
          <span>招式大类</span>
          <select v-model="draftSkillCategory" @change="draftSkillSubcategoryId = ''">
            <option v-for="opt in BUFF_SKILL_TARGET_OPTIONS" :key="opt.id" :value="opt.id">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>招式小类</span>
          <select v-model="draftSkillSubcategoryId">
            <option value="">整大类</option>
            <option v-for="sub in draftSubcategories" :key="sub.id" :value="sub.id">
              {{ sub.name }}
            </option>
          </select>
        </label>
        <label class="field field-check">
          <input v-model="draftAppliesToAnomaly" type="checkbox" />
          <span>异常结算时也生效</span>
        </label>
      </template>
      <button type="button" class="add-btn" @click="addGain">添加增益</button>
    </div>

    <div v-if="draftTeamProfession" class="team-prof-tiers">
      <span class="tiers-label">何时生效（勾选人数）</span>
      <div class="team-prof-tier-row">
        <label v-for="n in 3" :key="`draft-tier-${n}`" class="tier-cell">
          <span class="tier-head">
            <input
              type="checkbox"
              :checked="isDraftTierOn(n - 1)"
              @change="setDraftTierOn(n - 1, ($event.target as HTMLInputElement).checked)"
            />
            <span>恰好{{ n }}人时生效</span>
          </span>
        </label>
      </div>
    </div>

    <ul v-if="gains.length" class="extra-buff-list">
      <li v-for="item in gains" :key="item.id" class="extra-buff-item">
        <div class="extra-buff-copy">
          <strong>{{ item.name }}</strong>
          <span>
            {{
              buffStatFieldLabel(
                BUFF_STAT_FIELDS.find((field) => field.key === primaryEffect(item).stat) ?? {
                  key: primaryEffect(item).stat,
                  label: primaryEffect(item).stat,
                  unit: 'flat',
                  hint: '',
                },
              )
            }}
            +{{ primaryEffect(item).value }} · {{ gainMeta(item) }}
          </span>
        </div>
        <select
          class="item-slot-select"
          :value="String(resolveExtraGainApplySlot(item))"
          @change="setGainApplySlot(item.id, ($event.target as HTMLSelectElement).value)"
        >
          <option value="team">全队</option>
          <option v-for="opt in slotOptions" :key="`item-${item.id}-${opt.value}`" :value="String(opt.value)">
            {{ opt.label }}
          </option>
        </select>
        <button type="button" class="remove-btn" @click="removeGain(item.id)">移除</button>
      </li>
    </ul>
    <p v-else class="extra-buff-empty">尚未添加额外 Buff 增益</p>
  </div>
</template>

<style scoped>
.extra-buff-editor {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.extra-buff-hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--calc-muted, #9aa3b5);
  line-height: 1.45;
}

.extra-buff-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
  gap: 0.55rem;
  align-items: end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  font-size: 0.78rem;
  color: var(--calc-muted, #c9d0dc);
}

.field-check {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  padding-bottom: 0.35rem;
}

.field input,
.field select {
  border: 1px solid var(--calc-border, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  background: var(--calc-panel, #151922);
  color: var(--calc-text, #edf1f7);
  padding: 0.42rem 0.55rem;
  font-size: 0.82rem;
}

.team-prof-tiers {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.tiers-label {
  font-size: 0.78rem;
  color: var(--calc-muted, #c9d0dc);
}

.team-prof-tier-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
}

.tier-cell {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  border: 1px solid var(--calc-border, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  padding: 0.45rem 0.55rem;
  background: var(--calc-panel, #151922);
}

.tier-head {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: var(--calc-text, #edf1f7);
}

.add-btn,
.remove-btn {
  border: 1px solid var(--calc-border, rgba(255, 255, 255, 0.14));
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--calc-text, #edf1f7);
  padding: 0.45rem 0.7rem;
  cursor: pointer;
  font-size: 0.8rem;
}

.extra-buff-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.extra-buff-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid var(--calc-border, rgba(255, 255, 255, 0.1));
  border-radius: 10px;
  padding: 0.55rem 0.7rem;
}

.item-slot-select {
  flex-shrink: 0;
  max-width: 8.5rem;
  border: 1px solid var(--calc-border, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  background: var(--calc-panel, #151922);
  color: var(--calc-text, #edf1f7);
  padding: 0.32rem 0.45rem;
  font-size: 0.78rem;
}

.extra-buff-copy {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.extra-buff-copy strong {
  font-size: 0.88rem;
}

.extra-buff-copy span {
  font-size: 0.75rem;
  color: var(--calc-muted, #9aa3b5);
  word-break: break-word;
}

.extra-buff-empty {
  margin: 0;
  font-size: 0.78rem;
  color: var(--calc-muted, #9aa3b5);
}

@media (max-width: 900px) {
  .extra-buff-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .team-prof-tier-row {
    grid-template-columns: 1fr;
  }
}
</style>
