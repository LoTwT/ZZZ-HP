<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import AgentFuzzySelect from '@/components/admin/calculator/AgentFuzzySelect.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type { Skill, SkillDamageType, SkillTypeId } from '@/types/calculator'
import { DAMAGE_EVENT_KIND_OPTIONS } from '@/utils/damageEvent'
import { skillNeedsDualAgents } from '@/utils/resolvedHit'
import { SKILL_TYPE_OPTIONS } from '@/utils/skillTypes'

const store = useCalculatorBuffStore()
const { agents, presetSkills, skillSubcategories } = storeToRefs(store)

const message = ref('')
const error = ref('')
const saving = ref(false)
const selectedId = ref('')
const filterAgentId = ref('')

const form = ref({
  id: '',
  agentId: '',
  name: '',
  damageType: 'direct' as SkillDamageType,
  skillTypes: [] as SkillTypeId[],
  buffAnchorId: '' as string,
  baseMult: 0,
  baseMultFactor: 100,
  settlementMult: 0,
})

const sortedList = computed(() =>
  [...presetSkills.value]
    .filter((item) => {
      if (!filterAgentId.value) return true
      if (filterAgentId.value === '__common__') return !item.agentId
      return item.agentId === filterAgentId.value
    })
    .sort(
      (a, b) =>
        a.agentId.localeCompare(b.agentId) ||
        a.damageType.localeCompare(b.damageType) ||
        a.name.localeCompare(b.name),
    ),
)

const anchorOptions = computed(() =>
  skillSubcategories.value.filter(
    (item) => Boolean(item.agentId) && (!form.value.agentId || item.agentId === form.value.agentId),
  ),
)

function agentName(id: string) {
  if (!id) return '公共招式'
  return agents.value.find((item) => item.id === id)?.name ?? id
}

function damageTypeLabel(id: string) {
  return DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === id)?.label ?? id
}

function resetForm() {
  form.value = {
    id: '',
    agentId: filterAgentId.value === '__common__' ? '' : filterAgentId.value,
    name: '',
    damageType: 'direct',
    skillTypes: [],
    buffAnchorId: '',
    baseMult: 0,
    baseMultFactor: 100,
    settlementMult: 0,
  }
  selectedId.value = ''
  message.value = ''
  error.value = ''
}

function selectItem(item: Skill) {
  selectedId.value = item.id
  form.value = {
    id: item.id,
    agentId: item.agentId,
    name: item.name,
    damageType: item.damageType,
    skillTypes: [...item.skillTypes],
    buffAnchorId: item.buffAnchorId ?? '',
    baseMult: item.baseMult,
    baseMultFactor: item.baseMultFactor ?? 100,
    settlementMult: item.settlementMult ?? 0,
  }
}

function toggleSkillType(id: SkillTypeId) {
  const index = form.value.skillTypes.indexOf(id)
  if (index >= 0) form.value.skillTypes.splice(index, 1)
  else form.value.skillTypes.push(id)
}

async function saveItem() {
  message.value = ''
  error.value = ''
  const name = form.value.name.trim()
  if (!name) {
    error.value = '名称为必填项'
    return
  }
  saving.value = true
  try {
    const anomaly = skillNeedsDualAgents(form.value.damageType)
    const saved = await store.upsertPresetSkillDoc({
      id: selectedId.value || '',
      agentId: form.value.agentId,
      name,
      source: 'preset',
      damageType: form.value.damageType,
      skillTypes: anomaly ? [] : [...form.value.skillTypes],
      buffAnchorId: anomaly ? null : form.value.buffAnchorId || null,
      baseMult: Number(form.value.baseMult) || 0,
      baseMultFactor: Number(form.value.baseMultFactor) || 100,
      settlementMult: Number(form.value.settlementMult) || 0,
    })
    selectedId.value = saved.id
    form.value.id = saved.id
    message.value = '已保存招式'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeItem() {
  if (!selectedId.value) return
  if (!window.confirm(`确认删除招式「${form.value.name || selectedId.value}」？`)) return
  try {
    await store.removePresetSkillDoc(selectedId.value)
    resetForm()
    message.value = '已删除'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

defineExpose({ selectedId, saving, saveItem, removeItem })
</script>

<template>
  <div class="editor-panel">
    <header class="panel-header">
      <h1 class="panel-title">招式库</h1>
      <p class="panel-desc">
        预设招式存在数据库。角色留空即为公共招式。异常类请把招式类型留空。增益锚点对应旧招式小类，供 Buff 精确命中。
      </p>
    </header>

    <div class="filter-row">
      <label class="field">
        <span class="field-label">筛选角色</span>
        <AgentFuzzySelect v-model="filterAgentId" :agents="agents" empty-label="全部角色" />
      </label>
    </div>

    <div class="editor-layout">
      <aside class="item-list">
        <button type="button" class="secondary-btn" @click="resetForm">+ 新建招式</button>
        <div class="list-scroll">
          <button
            v-for="item in sortedList"
            :key="item.id"
            type="button"
            class="list-item"
            :class="{ active: selectedId === item.id }"
            @click="selectItem(item)"
          >
            <span class="list-name">{{ item.name }}</span>
            <span class="list-meta">
              {{ agentName(item.agentId) }} · {{ damageTypeLabel(item.damageType) }}
            </span>
          </button>
        </div>
      </aside>

      <form class="editor-form" @submit.prevent="saveItem">
        <section class="mindscape-section">
          <header class="mindscape-header">
            <h3>{{ selectedId ? '编辑招式' : '新建招式' }}</h3>
          </header>
          <div class="field-row">
            <label class="field">
              <span class="field-label">角色</span>
              <AgentFuzzySelect v-model="form.agentId" :agents="agents" empty-label="公共招式" />
            </label>
            <label class="field">
              <span class="field-label">伤害类型 *</span>
              <select v-model="form.damageType" class="field-input">
                <option v-for="opt in DAMAGE_EVENT_KIND_OPTIONS" :key="opt.id" :value="opt.id">
                  {{ opt.label }}
                </option>
              </select>
            </label>
          </div>
          <div class="field-row">
            <label class="field">
              <span class="field-label">招式名称 *</span>
              <input v-model="form.name" class="field-input" placeholder="显示名称" />
            </label>
            <label v-if="form.id" class="field">
              <span class="field-label">ID（自动）</span>
              <input :value="form.id" class="field-input" readonly />
            </label>
          </div>
          <div v-if="!skillNeedsDualAgents(form.damageType)" class="type-checks">
            <span class="field-label">招式类型（可多选，可空）</span>
            <label v-for="opt in SKILL_TYPE_OPTIONS" :key="opt.id" class="check">
              <input
                type="checkbox"
                :checked="form.skillTypes.includes(opt.id)"
                @change="toggleSkillType(opt.id)"
              />
              {{ opt.label }}
            </label>
          </div>
          <label v-if="!skillNeedsDualAgents(form.damageType)" class="field">
            <span class="field-label">增益锚点（仅本角色）</span>
            <select v-model="form.buffAnchorId" class="field-input">
              <option value="">无</option>
              <option v-for="item in anchorOptions" :key="item.id" :value="item.id">
                {{ item.name }}
              </option>
            </select>
          </label>
          <div class="field-row">
            <label class="field">
              <span class="field-label">基础倍率%</span>
              <input v-model.number="form.baseMult" class="field-input" type="number" />
            </label>
            <label class="field">
              <span class="field-label">倍率修正%</span>
              <input v-model.number="form.baseMultFactor" class="field-input" type="number" />
            </label>
            <label v-if="form.damageType === 'direct'" class="field">
              <span class="field-label">决算倍率%</span>
              <input v-model.number="form.settlementMult" class="field-input" type="number" />
            </label>
          </div>
        </section>

        <p v-if="message" class="form-ok">{{ message }}</p>
        <p v-if="error" class="form-error">{{ error }}</p>
        <div class="form-actions">
          <button type="submit" class="primary-btn" :disabled="saving">
            {{ saving ? '保存中...' : '保存招式' }}
          </button>
          <button type="button" class="danger-btn" :disabled="!selectedId" @click="removeItem">
            删除
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped src="./adminCalculatorPanel.css"></style>
<style scoped>
.type-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.8rem;
  margin: 0.5rem 0 0.75rem;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.82rem;
}
</style>
