<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import NumberStepper from '@/components/common/NumberStepper.vue'
import AdminDamageTypePicker from '@/components/admin/calculator/AdminDamageTypePicker.vue'
import type {
  BuffDamageType,
  BuffEffect,
  BuffSkillTarget,
  BuffSkillTargetId,
  SkillCategoryId,
  SkillSubcategory,
} from '@/types/calculator'
import {
  BUFF_SKILL_TARGET_OPTIONS,
  CONVERT_FROM_OPTIONS,
  CONVERT_PANEL_SOURCE_OPTIONS,
  SKILL_CATEGORY_OPTIONS,
} from '@/types/calculator'
import { AGENT_ELEMENTS, AGENT_ROLES, BUFF_STAT_FIELDS } from '@/utils/calculatorUi'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import {
  createDefaultSkillSubcategoryMults,
} from '@/utils/skillSubcategoryMult'
import {
  formatSkillTargetBracket,
  getEffectSkillTargets,
  normalizeTeamProfessionValues,
  resolveConvertValue,
  setEffectSkillTargets,
} from '@/utils/buffEffect'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import {
  BUFF_STAT_ZONES,
  allowedDamageTypesOf,
  isZoneTypeLocked,
  statRowsForZone,
} from '@/utils/buffStatZones'
import { damageTypeLabel, damageTypesLabel } from '@/utils/buffDamageTypes'
import { canConfirmMerge, type EffectRow } from '@/utils/buffEffectRows'

const props = defineProps<{
  row: EffectRow
  agentId?: string
  lockApplyTarget?: 'self' | 'team' | null
  mergeMode?: boolean
  selected?: boolean
  onAppliesToAnomalyChange?: (effect: BuffEffect, value: boolean) => void
}>()

const emit = defineEmits<{
  'change-zone': [zoneId: string, types: BuffDamageType[]]
  'toggle-type': [type: BuffDamageType, checked: boolean]
  split: []
  remove: []
  'confirm-merge': []
  align: []
  'toggle-select': []
}>()

const calculatorBuffStore = useCalculatorBuffStore()
const { agents, skillSubcategories } = storeToRefs(calculatorBuffStore)

const first = computed(() => props.row.effects[0]!)
const zone = computed(() => props.row.zone)
const locked = computed(() => (zone.value ? isZoneTypeLocked(zone.value) : false))
const allowedTypes = computed(() =>
  zone.value ? allowedDamageTypesOf(zone.value) : undefined,
)
const memberCount = computed(() => props.row.effects.length)
const rowTitle = computed(() => zone.value?.label ?? statLabel(first.value?.stat))
const memberLabels = computed(() =>
  props.row.effects.map((effect) => {
    const type = props.row.damageTypes.find(
      (id) => statRowsForZone(zone.value!, [id])[0]?.stat === effect.stat,
    )
    return type ? damageTypeLabel(type) : statLabel(effect.stat)
  }),
)

function statLabel(stat: string | undefined) {
  if (!stat) return '未知属性'
  return BUFF_STAT_FIELDS.find((field) => field.key === stat)?.label ?? stat
}

/** 组内联动：所有可编辑字段都写到整组 */
function patchAll(mutator: (effect: BuffEffect) => void) {
  for (const effect of props.row.effects) mutator(effect)
}

function patchField<K extends keyof BuffEffect>(key: K, value: BuffEffect[K]) {
  patchAll((effect) => {
    effect[key] = Array.isArray(value) ? ([...value] as BuffEffect[K]) : value
  })
}

const applySituation = computed({
  get: () => first.value?.applySituation ?? 'global',
  set: (value: BuffEffect['applySituation']) => patchField('applySituation', value),
})
const applyTarget = computed({
  get: () => first.value?.applyTarget ?? 'self',
  set: (value: BuffEffect['applyTarget']) => patchField('applyTarget', value),
})
const applyProfession = computed({
  get: () => first.value?.applyProfession ?? '',
  set: (value: string) => patchField('applyProfession', value || null),
})
const teamProfession = computed({
  get: () => first.value?.teamProfession ?? '',
  set: (value: string) => patchField('teamProfession', value || null),
})
const kind = computed({
  get: () => first.value?.kind ?? 'fixed',
  set: (value: BuffEffect['kind']) => {
    patchAll((effect) => {
      effect.kind = value
      if (value === 'convert') ensureConvert(effect)
      else effect.convert = undefined
    })
  },
})
const value = computed({
  get: () => first.value?.value ?? 0,
  set: (next: number) => patchField('value', next),
})
const valuePerStack = computed({
  get: () => first.value?.valuePerStack ?? 0,
  set: (next: number) => patchField('valuePerStack', next),
})
const maxStacks = computed({
  get: () => first.value?.maxStacks ?? 1,
  set: (next: number) => patchField('maxStacks', next),
})
const defaultStacks = computed({
  get: () => first.value?.defaultStacks ?? 1,
  set: (next: number) => patchField('defaultStacks', next),
})
const enabledDefault = computed({
  get: () => first.value?.enabledDefault !== false,
  set: (next: boolean) => patchField('enabledDefault', next),
})
const appliesToAnomaly = computed({
  get: () => first.value?.appliesToAnomaly === true,
  set: (next: boolean) => {
    if (props.onAppliesToAnomalyChange) {
      for (const effect of props.row.effects) {
        props.onAppliesToAnomalyChange(effect, next)
      }
    }
    patchField('appliesToAnomaly', next ? true : undefined)
  },
})

const teamProfessionTier = computed<Array<number | null>>(() => {
  const effect = first.value
  if (!effect?.teamProfession) return [null, null, null]
  return (
    normalizeTeamProfessionValues(
      effect.teamProfessionValues,
      effect.teamProfession,
      effect.teamProfessionMinCount,
      effect.value,
    ) ?? [null, null, null]
  )
})

function setTeamProfession(next: string) {
  patchAll((effect) => {
    const text = next.trim()
    effect.teamProfession = text || null
    effect.teamProfessionMinCount = null
    effect.teamProfessionValues = text ? [null, null, null] : null
  })
}

function setTeamProfessionTierOn(index: number, on: boolean) {
  const tiers = [...teamProfessionTier.value]
  tiers[index] = on ? 0 : null
  patchAll((effect) => {
    effect.teamProfessionValues = [...tiers]
    effect.teamProfessionMinCount = null
  })
}

const isAllElements = computed(
  () => !first.value?.elementFilter || first.value.elementFilter === 'all',
)
function isElementChecked(element: string) {
  const filter = first.value?.elementFilter
  return Array.isArray(filter) && filter.includes(element)
}
function setAllElements() {
  patchField('elementFilter', 'all')
}
function toggleElement(element: string) {
  const current = isAllElements.value
    ? []
    : Array.isArray(first.value?.elementFilter)
      ? [...first.value.elementFilter]
      : []
  const index = current.indexOf(element)
  if (index >= 0) current.splice(index, 1)
  else current.push(element)
  patchField('elementFilter', current.length ? current : 'all')
}

const skillLimited = computed(() => getEffectSkillTargets(first.value).length > 0)
function setSkillLimited(checked: boolean) {
  if (checked) {
    patchAll((effect) => {
      const targets = getEffectSkillTargets(effect)
      if (!targets.length) {
        setEffectSkillTargets(effect, [{ category: 'basic', subcategoryId: null }])
      }
      if (
        !props.row.zone?.statsByType &&
        effect.stat !== 'skillDmgBonus' &&
        effect.stat !== 'skillMultiplierBonus'
      ) {
        effect.stat = 'skillDmgBonus'
      }
    })
    return
  }
  patchAll((effect) => setEffectSkillTargets(effect, []))
}

const draftSkillByEffectId = ref<Record<string, BuffSkillTarget>>({})
function ensureDraftSkill(effect: BuffEffect): BuffSkillTarget {
  const existing = draftSkillByEffectId.value[effect.id]
  if (existing) return existing
  const draft: BuffSkillTarget = {
    category: (effect.skillCategory as BuffSkillTargetId) ?? 'basic',
    subcategoryId: null,
  }
  draftSkillByEffectId.value[effect.id] = draft
  return draft
}
const draftSkill = computed(() => ensureDraftSkill(first.value))
const skillTargetsOf = computed(() => getEffectSkillTargets(first.value))
function skillTargetLabel(target: BuffSkillTarget) {
  return formatSkillTargetBracket(target, skillSubcategories.value)
}
function onDraftCategoryChange(category: BuffSkillTargetId) {
  const draft = ensureDraftSkill(first.value)
  draft.category = category
  draft.subcategoryId = null
}
function subcategoriesForCategory(category: BuffSkillTargetId): SkillSubcategory[] {
  const agentFilter = props.agentId
  return skillSubcategories.value.filter((item) => {
    if (agentFilter && item.agentId && item.agentId !== agentFilter) return false
    return item.categoryId === category || (category === 'follow_up' && item.countsAsFollowUp)
  })
}
function addSkillTarget() {
  const draft = ensureDraftSkill(first.value)
  patchAll((effect) => {
    setEffectSkillTargets(effect, [
      ...getEffectSkillTargets(effect),
      { category: draft.category, subcategoryId: draft.subcategoryId ?? null },
    ])
  })
}
function removeSkillTarget(index: number) {
  patchAll((effect) => {
    const next = getEffectSkillTargets(effect).filter((_, i) => i !== index)
    setEffectSkillTargets(effect, next.length ? next : [])
  })
}

const creatingSubcat = ref(false)
const subcatError = ref('')
const subcatMessage = ref('')
const newSubcat = ref({
  agentId: '',
  name: '',
  categoryId: 'basic' as SkillCategoryId,
  countsAsFollowUp: false,
})
function openCreateSubcat() {
  creatingSubcat.value = true
  subcatError.value = ''
  subcatMessage.value = ''
  newSubcat.value = {
    agentId: props.agentId || '',
    name: '',
    categoryId:
      (first.value.skillCategory as SkillCategoryId) ?? 'basic',
    countsAsFollowUp: false,
  }
}
async function createSubcategory() {
  const name = newSubcat.value.name.trim()
  if (!name) {
    subcatError.value = '小类名称为必填'
    return
  }
  try {
    const saved = await calculatorBuffStore.upsertSkillSubcategoryDoc({
      id: '',
      agentId: props.agentId || newSubcat.value.agentId,
      categoryId: newSubcat.value.categoryId,
      name,
      countsAsFollowUp: newSubcat.value.countsAsFollowUp,
      ...createDefaultSkillSubcategoryMults(),
    })
    patchAll((effect) => {
      setEffectSkillTargets(effect, [
        ...getEffectSkillTargets(effect),
        { category: saved.categoryId, subcategoryId: saved.id },
      ])
    })
    creatingSubcat.value = false
    subcatMessage.value = `已添加小类「${saved.name}」`
  } catch (err) {
    subcatError.value = err instanceof Error ? err.message : '添加失败'
  }
}

function ensureConvert(effect: BuffEffect) {
  if (!effect.convert) {
    effect.convert = {
      from: 'atk',
      panelSource: 'external',
      ratioPercent: 0,
      cap: null,
      defaultBase: null,
      initialBase: 0,
    }
  }
  if (!effect.convert.panelSource) effect.convert.panelSource = 'external'
  if (effect.convert.defaultBase === undefined) effect.convert.defaultBase = null
  if (effect.convert.initialBase == null || !Number.isFinite(effect.convert.initialBase)) {
    effect.convert.initialBase = 0
  }
}
const convert = computed(() => {
  ensureConvert(first.value)
  return first.value.convert!
})
function patchConvert<K extends keyof NonNullable<BuffEffect['convert']>>(
  key: K,
  nextValue: NonNullable<BuffEffect['convert']>[K],
) {
  patchAll((effect) => {
    ensureConvert(effect)
    effect.convert![key] = nextValue
  })
}

function convertPreviewText() {
  const cv = convert.value
  const attrLabel =
    CONVERT_FROM_OPTIONS.find((item) => item.id === cv.from)?.label ?? cv.from
  const statLabelText = statLabel(first.value.stat)
  const initial = cv.initialBase ?? 0
  const initialHint =
    initial > 0 ? `，超出初始值 ${formatCalcDecimal(initial)} 的部分参与折算` : ''
  if (cv.panelSource === 'manual') {
    const base = cv.defaultBase ?? 0
    const amount = resolveConvertValue(first.value, {})
    const uncapped = resolveConvertValue(
      { ...first.value, convert: { ...cv, cap: null } },
      {},
    )
    const baseExpr =
      initial > 0
        ? `max(0, ${formatCalcDecimal(base)} − ${formatCalcDecimal(initial)})`
        : formatCalcDecimal(base)
    return `${attrLabel} ${baseExpr} × ${formatCalcDecimal(cv.ratioPercent ?? 0)}% = ${statLabelText} ${amount < 0 ? '' : '+'}${formatCalcDecimal(amount)}${amount !== uncapped ? '（已达上限）' : ''}${initialHint}`
  }
  const sourceLabel = cv.panelSource === 'final' ? '局内' : '局外'
  return `${sourceLabel}${attrLabel} × ${formatCalcDecimal(cv.ratioPercent ?? 0)}% → ${statLabelText}，超出初始值部分实时折算${initialHint}`
}

function onZoneChange(event: Event) {
  const zoneId = (event.target as HTMLSelectElement).value
  emit('change-zone', zoneId, props.row.damageTypes)
}

function onSplit() {
  emit('split')
}
</script>

<template>
  <article class="effect-row" :class="{ 'effect-row--warn': row.issues.length }">
    <header class="effect-row-head">
      <label v-if="mergeMode" class="merge-check">
        <input type="checkbox" :checked="selected" @change="emit('toggle-select')" />
        <span>选择</span>
      </label>
      <div class="effect-title">
        <strong>{{ rowTitle }}</strong>
        <span v-if="memberCount > 1" class="badge">{{ memberCount }} 条</span>
        <span v-if="row.groupId" class="badge badge-group">组</span>
        <span v-else-if="row.heuristic" class="badge badge-ungrouped">未分组</span>
        <span v-if="row.issues.length" class="badge badge-warn">⚠ 不一致</span>
      </div>
      <div class="effect-actions">
        <button v-if="canConfirmMerge(row)" type="button" class="ghost-btn" @click="emit('confirm-merge')">
          确认合并
        </button>
        <button
          v-if="memberCount > 1 || row.damageTypes.length > 1"
          type="button"
          class="ghost-btn"
          @click="onSplit"
        >
          拆开
        </button>
        <button type="button" class="danger-btn" @click="emit('remove')">删除</button>
      </div>
    </header>

    <p v-if="row.issues.length" class="row-warn">
      <span>⚠ {{ row.issues.map((issue) => issue.label).join(' / ') }}不一致</span>
      <button type="button" class="ghost-btn" @click="emit('align')">一键对齐</button>
    </p>

    <p v-if="memberCount > 1" class="member-line">
      <span class="muted">组内：</span>
      <span v-for="(label, index) in memberLabels" :key="index" class="member-chip">{{ label }}</span>
    </p>

    <div class="grid">
      <label class="field">
        <span>作用情况</span>
        <select v-model="applySituation">
          <option value="global">全局</option>
          <option value="stagger">失衡期</option>
          <option value="non_stagger">非失衡期</option>
        </select>
      </label>

      <label class="field field-span">
        <span>属性（乘区）</span>
        <select :value="zone?.id ?? ''" @change="onZoneChange">
          <option v-for="item in BUFF_STAT_ZONES" :key="item.id" :value="item.id">
            {{ item.label }}
          </option>
        </select>
      </label>

      <div class="field field-span">
        <span>伤害类型 · 当前：{{ damageTypesLabel(row.damageTypes) }}</span>
        <AdminDamageTypePicker
          :model-value="row.damageTypes"
          :allowed-types="allowedTypes"
          :locked="locked"
          @toggle="(type, checked) => emit('toggle-type', type, checked)"
        />
      </div>

      <label v-if="!lockApplyTarget" class="field">
        <span>目标</span>
        <select v-model="applyTarget">
          <option value="self">自身</option>
          <option value="team">全队（含自己）</option>
        </select>
      </label>

      <label class="field">
        <span>职业限制（谁受益）</span>
        <select v-model="applyProfession">
          <option value="">不限</option>
          <option v-for="role in AGENT_ROLES" :key="role" :value="role">{{ role }}</option>
        </select>
      </label>

      <label class="field">
        <span>数值类型</span>
        <select v-model="kind">
          <option value="fixed">固定</option>
          <option value="stacked">叠层</option>
          <option value="convert">转模</option>
        </select>
      </label>

      <div class="field field-span">
        <span>属性限定（可多选）· 当前：{{ isAllElements ? '全部属性' : (first.elementFilter as string[]).join('、') }}</span>
        <div class="chip-row">
          <label class="chip">
            <input type="checkbox" :checked="isAllElements" @change="setAllElements" />
            <span>全部属性</span>
          </label>
          <label v-for="element in AGENT_ELEMENTS" :key="element" class="chip">
            <input
              type="checkbox"
              :checked="isElementChecked(element)"
              @change="toggleElement(element)"
            />
            <span>{{ element }}</span>
          </label>
        </div>
      </div>

      <label class="field checkbox">
        <input type="checkbox" :checked="skillLimited" @change="setSkillLimited(($event.target as HTMLInputElement).checked)" />
        <span>限定招式</span>
      </label>

      <template v-if="skillLimited">
        <div class="field field-span">
          <span>已选招式（可多选，按顺序展示）</span>
          <div class="chip-row">
            <span
              v-for="(target, index) in skillTargetsOf"
              :key="`${target.category}-${target.subcategoryId ?? 'all'}-${index}`"
              class="skill-chip"
            >
              {{ skillTargetLabel(target) }}
              <button type="button" class="chip-remove" aria-label="移除招式" @click="removeSkillTarget(index)">
                ×
              </button>
            </span>
            <span v-if="!skillTargetsOf.length" class="muted">尚未添加招式</span>
          </div>
        </div>
        <label class="field">
          <span>添加·招式大类</span>
          <select
            :value="draftSkill.category"
            @change="onDraftCategoryChange(($event.target as HTMLSelectElement).value as BuffSkillTargetId)"
          >
            <option v-for="opt in BUFF_SKILL_TARGET_OPTIONS" :key="opt.id" :value="opt.id">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>添加·招式小类</span>
          <select v-model="draftSkill.subcategoryId">
            <option :value="null">
              {{ draftSkill.category === 'follow_up' ? '全部追加' : '整大类' }}
            </option>
            <option v-for="sub in subcategoriesForCategory(draftSkill.category)" :key="sub.id" :value="sub.id">
              {{ sub.name }}
            </option>
          </select>
        </label>
        <div class="field subcat-actions">
          <button type="button" class="ghost-btn" @click="addSkillTarget">＋ 添加动作</button>
          <button type="button" class="ghost-btn" @click="openCreateSubcat">＋ 新建招式小类</button>
        </div>
      </template>

      <label class="field checkbox">
        <input v-model="enabledDefault" type="checkbox" />
        <span>默认启用</span>
      </label>

      <label class="field checkbox" title="默认：通用增益参与异常；招式伤害/倍率不参与。勾选后异常结算也会计入。">
        <input v-model="appliesToAnomaly" type="checkbox" />
        <span>异常计算时也生效</span>
      </label>
    </div>

    <div class="field field-span team-prof-condition">
      <label class="field">
        <span>队内职业人数条件（勾选为恰好 N 人时生效）</span>
        <select :value="teamProfession" @change="setTeamProfession(($event.target as HTMLSelectElement).value)">
          <option value="">不限</option>
          <option v-for="role in AGENT_ROLES" :key="`gate-${role}`" :value="role">{{ role }}</option>
        </select>
      </label>
      <div v-if="teamProfession" class="team-prof-tier-row">
        <label v-for="n in 3" :key="`tier-${row.key}-${n}`" class="tier-cell">
          <span class="tier-head">
            <input
              type="checkbox"
              :checked="teamProfessionTier[n - 1] != null"
              @change="setTeamProfessionTierOn(n - 1, ($event.target as HTMLInputElement).checked)"
            />
            <span>恰好{{ n }}人时生效</span>
          </span>
        </label>
      </div>
    </div>

    <div v-if="kind === 'fixed'" class="grid">
      <label class="field">
        <span>数值</span>
        <NumberStepper v-model="value" :min="-999999" :max="999999" :step="0.0001" />
      </label>
    </div>

    <div v-else-if="kind === 'stacked'" class="grid">
      <label class="field">
        <span>每层数值</span>
        <NumberStepper v-model="valuePerStack" :min="-999999" :max="999999" :step="0.0001" />
      </label>
      <label class="field">
        <span>最大层数</span>
        <NumberStepper v-model="maxStacks" :min="1" :max="99" />
      </label>
      <label class="field">
        <span>默认层数</span>
        <NumberStepper v-model="defaultStacks" :min="0" :max="99" />
      </label>
    </div>

    <div v-else-if="kind === 'convert'" class="grid">
      <label class="field">
        <span>面板来源</span>
        <select :value="convert.panelSource" @change="patchConvert('panelSource', ($event.target as HTMLSelectElement).value as 'external' | 'final' | 'manual')">
          <option v-for="opt in CONVERT_PANEL_SOURCE_OPTIONS" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
        </select>
      </label>
      <label class="field">
        <span>来源属性</span>
        <select :value="convert.from" @change="patchConvert('from', ($event.target as HTMLSelectElement).value as typeof convert.from)">
          <option v-for="opt in CONVERT_FROM_OPTIONS" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
        </select>
      </label>
      <label v-if="convert.panelSource === 'manual'" class="field">
        <span>自行设置基础值</span>
        <NumberStepper :model-value="convert.defaultBase ?? 0" :min="0" :max="999999" :step="0.0001" @update:model-value="patchConvert('defaultBase', $event)" />
      </label>
      <label class="field">
        <span>转换比例%</span>
        <NumberStepper :model-value="convert.ratioPercent" :min="-9999" :max="9999" :step="0.0001" @update:model-value="patchConvert('ratioPercent', $event)" />
      </label>
      <label class="field">
        <span>转模初始值</span>
        <NumberStepper :model-value="convert.initialBase ?? 0" :min="0" :max="999999" :step="0.0001" @update:model-value="patchConvert('initialBase', $event)" />
      </label>
      <label class="field">
        <span>上限（0=无上限）</span>
        <NumberStepper :model-value="convert.cap ?? 0" :min="0" :max="999999" :step="0.0001" @update:model-value="patchConvert('cap', $event > 0 ? $event : null)" />
      </label>
      <p class="convert-preview">{{ convertPreviewText() }}</p>
    </div>

    <div v-if="creatingSubcat" class="subcat-create">
      <header class="subcat-create-head">
        <p class="hint">新建招式小类（仅当前行）</p>
        <button type="button" class="close-subcat" aria-label="关闭" @click="creatingSubcat = false">×</button>
      </header>
      <div class="grid">
        <label v-if="!agentId" class="field">
          <span>角色</span>
          <select v-model="newSubcat.agentId">
            <option value="">全部角色</option>
            <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>招式大类</span>
          <select v-model="newSubcat.categoryId">
            <option v-for="opt in SKILL_CATEGORY_OPTIONS" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>小类名称</span>
          <input v-model="newSubcat.name" type="text" placeholder="显示名称" />
        </label>
        <label class="field checkbox">
          <input v-model="newSubcat.countsAsFollowUp" type="checkbox" />
          <span>视为追加攻击</span>
        </label>
      </div>
      <div class="subcat-create-actions">
        <button type="button" class="ghost-btn" @click="createSubcategory">保存小类</button>
        <button type="button" class="ghost-btn" @click="creatingSubcat = false">取消</button>
      </div>
      <p v-if="subcatError" class="err">{{ subcatError }}</p>
      <p v-if="subcatMessage" class="ok">{{ subcatMessage }}</p>
    </div>
  </article>
</template>

<style scoped>
.effect-row {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 0.7rem;
  background: var(--color-background);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.effect-row--warn {
  border-color: rgba(196, 92, 92, 0.55);
}

.effect-row-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.effect-title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.badge {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.05rem 0.45rem;
  font-size: 0.7rem;
  opacity: 0.85;
}

.badge-group {
  border-color: rgba(64, 140, 255, 0.5);
}

.badge-ungrouped {
  border-color: rgba(220, 160, 40, 0.55);
}

.badge-warn {
  color: #c45c5c;
  border-color: rgba(196, 92, 92, 0.55);
}

.effect-actions {
  display: flex;
  gap: 0.35rem;
}

.merge-check {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
}

.row-warn {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #c45c5c;
  font-size: 0.76rem;
}

.member-line {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
}

.member-chip {
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  padding: 0.1rem 0.4rem;
  font-size: 0.72rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

@media (min-width: 900px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.76rem;
  color: var(--color-text);
}

.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  padding-top: 1.1rem;
}

.field-span {
  grid-column: 1 / -1;
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

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.74rem;
  background: var(--color-background);
  cursor: pointer;
}

.skill-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.2rem 0.45rem 0.2rem 0.55rem;
  font-size: 0.74rem;
}

.chip-remove {
  border: none;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.95rem;
  line-height: 1;
  opacity: 0.7;
}

.subcat-actions {
  justify-content: end;
  display: flex;
  gap: 0.4rem;
  padding-top: 1.1rem;
}

.subcat-create {
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  padding: 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.subcat-create-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.subcat-create-actions {
  display: flex;
  gap: 0.45rem;
}

.close-subcat {
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 1.35rem;
  cursor: pointer;
}

.team-prof-condition {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
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
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.45rem 0.55rem;
}

.tier-head {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
}

.convert-preview {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0.35rem 0.5rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-border) 25%, transparent);
  font-size: 0.76rem;
  font-weight: 700;
}

.muted {
  font-size: 0.74rem;
  opacity: 0.6;
}

.hint {
  margin: 0;
  font-size: 0.76rem;
  opacity: 0.72;
}

.err {
  margin: 0;
  color: #c45c5c;
  font-size: 0.78rem;
}

.ok {
  margin: 0;
  color: hsl(160, 100%, 32%);
  font-size: 0.78rem;
}

.ghost-btn,
.danger-btn {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  padding: 0.35rem 0.6rem;
  cursor: pointer;
  font-size: 0.8rem;
}

.danger-btn {
  color: #c45c5c;
  border-color: rgba(196, 92, 92, 0.4);
}
</style>

