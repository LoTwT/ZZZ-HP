<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AdminBuffEffectEditor from '@/components/admin/calculator/AdminBuffEffectEditor.vue'
import AdminBuffOwnerSwitcher from '@/components/admin/calculator/AdminBuffOwnerSwitcher.vue'
import AdminCalculatorAvatarField from '@/components/admin/calculator/AdminCalculatorAvatarField.vue'
import AdminNumericStatFieldGrid from '@/components/admin/calculator/AdminNumericStatFieldGrid.vue'
import { isStaleWriteError } from '@/api/calculatorBuffs'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type { AgentBasePanel, AgentBuffDoc, AgentMindscapeRankBuffs, SupportStatNeed } from '@/types/calculator'
import type { AgentBuffEditSectionId } from '@/constants/agentBuffEditNav'
import { packFromBlocks, packFromEffects } from '@/utils/buffEffect'
import {
  AGENT_BASE_PANEL_FIELDS,
  AGENT_ELEMENTS,
  AGENT_MINDSCAPE_RANKS,
  AGENT_ROLES,
  createEmptyAgentBasePanel,
  createEmptyMindscapeBuffs,
  createEmptyMindscapeNotes,
  createEmptySelfTeamBuffs,
  defaultAnomalyMultByElement,
  defaultDisorderStats,
  defaultTurbulenceStats,
  normalizeMindscapeNotes,
  SUPPORT_STAT_OPTIONS,
} from '@/utils/calculatorUi'

const store = useCalculatorBuffStore()
const { agents } = storeToRefs(store)

const selectedId = ref(agents.value[0]?.id ?? '')
const message = ref('')
const error = ref('')
const saving = ref(false)
const refreshing = ref(false)
/** 本次保存被并发保护拦下（库里这行已变）：提示刷新，而不是假装保存成功 */
const staleConflict = ref(false)
/** 加载表单时该行库里的 updated_at：保存时作为乐观锁基准发给后端 */
const formUpdatedAt = ref<string | undefined>(undefined)
const activeMindscapeRank = ref(0)
const avatarFieldRef = ref<InstanceType<typeof AdminCalculatorAvatarField> | null>(null)

const form = ref({
  id: '',
  name: '',
  profession: '',
  element: '',
  note: '',
  basePanel: createEmptyAgentBasePanel(),
  supportNeeds: [] as SupportStatNeed[],
  mindscapeForm: createEmptyMindscapeBuffs(),
  mindscapeNotes: createEmptyMindscapeNotes(),
})

/** 工具条「当前编辑 ▾」下拉里的角色条目（搜索/职业筛选在 AdminBuffOwnerSwitcher 里） */
const ownerItems = computed(() =>
  agents.value.map((agent) => ({
    id: agent.id,
    name: agent.name,
    meta: [agent.profession, agent.element].filter(Boolean).join(' · ') || undefined,
    profession: agent.profession,
  })),
)

const activeMindscapeForm = computed(() => form.value.mindscapeForm[activeMindscapeRank.value]!)
const activeMindscapeNote = computed({
  get: () => form.value.mindscapeNotes[activeMindscapeRank.value] ?? '',
  set: (value: string) => {
    form.value.mindscapeNotes[activeMindscapeRank.value] = value
  },
})

function loadMindscapeForm(mindscapeBuffs: AgentBuffDoc['mindscapeBuffs']) {
  return AGENT_MINDSCAPE_RANKS.map((_, index) => {
    const rank = mindscapeBuffs[index] ?? createEmptySelfTeamBuffs()
    if (rank.effectBlocks?.length) {
      return packFromBlocks(
        rank.effectBlocks.map((block) => ({
          ...block,
          effects: block.effects.map((effect) => ({
            ...effect,
            convert: effect.convert ? { ...effect.convert } : undefined,
            elementFilter: Array.isArray(effect.elementFilter)
              ? [...effect.elementFilter]
              : effect.elementFilter,
          })),
        })),
      )
    }
    return packFromEffects(
      (rank.effects ?? []).map((effect) => ({
        ...effect,
        convert: effect.convert ? { ...effect.convert } : undefined,
        elementFilter: Array.isArray(effect.elementFilter)
          ? [...effect.elementFilter]
          : effect.elementFilter,
      })),
    )
  })
}

function loadForm(agent: AgentBuffDoc) {
  form.value = {
    id: agent.id,
    name: agent.name,
    profession: agent.profession,
    element: agent.element,
    note: agent.note ?? '',
    basePanel: { ...agent.basePanel },
    supportNeeds: [...agent.supportNeeds],
    mindscapeForm: loadMindscapeForm(agent.mindscapeBuffs),
    mindscapeNotes: normalizeMindscapeNotes(agent.mindscapeNotes),
  }
  // 记住这份副本是「哪一版」：保存时据此判断库里有没有被别的东西改过
  formUpdatedAt.value = agent.updatedAt
  activeMindscapeRank.value = 0
  void nextTick(() => {
    avatarFieldRef.value?.setAvatarImage(agent.avatar_image)
    // 切人 = 载入已保存的数据，工具条回到「无改动」
    effectEditorRef.value?.markSaved?.()
  })
}

function resetForm() {
  form.value = {
    id: '',
    name: '',
    profession: '',
    element: '',
    note: '',
    basePanel: createEmptyAgentBasePanel(),
    supportNeeds: [],
    mindscapeForm: createEmptyMindscapeBuffs(),
    mindscapeNotes: createEmptyMindscapeNotes(),
  }
  formUpdatedAt.value = undefined
  activeMindscapeRank.value = 0
  selectedId.value = ''
  avatarFieldRef.value?.clearAvatarImage()
  void nextTick(() => {
    effectEditorRef.value?.markSaved?.()
  })
}

function selectAgent(id: string) {
  selectedId.value = id
  const agent = agents.value.find((item) => item.id === id)
  if (agent) loadForm(agent)
}

/** 工具条下拉里选中：切人并收起下拉 */
function switchOwner(id: string, close?: () => void) {
  selectAgent(id)
  close?.()
}

function createOwner(close?: () => void) {
  createNew()
  close?.()
}

function createNew() {
  resetForm()
}

function toggleSupportNeed(stat: SupportStatNeed) {
  const index = form.value.supportNeeds.indexOf(stat)
  if (index >= 0) {
    form.value.supportNeeds.splice(index, 1)
    return
  }
  form.value.supportNeeds.push(stat)
}

function onElementChange() {
  form.value.basePanel.anomalyMult = defaultAnomalyMultByElement(form.value.element)
  const agentKey = `${form.value.id} ${form.value.name}`
  const disorder = defaultDisorderStats(form.value.element, agentKey)
  const turbulence = defaultTurbulenceStats(form.value.element, agentKey)
  form.value.basePanel.disorderBaseMult = disorder.disorderBaseMult
  form.value.basePanel.anomalyDuration = disorder.anomalyDuration
  form.value.basePanel.disorderCompMult = disorder.disorderCompMult
  form.value.basePanel.turbulenceBaseMult = turbulence.turbulenceBaseMult
  form.value.basePanel.turbulenceCompMult = turbulence.turbulenceCompMult
}

function buildMindscapeBuffs(): AgentMindscapeRankBuffs[] {
  return form.value.mindscapeForm.map((rank) =>
    packFromBlocks(rank.effectBlocks ?? []),
  )
}

async function saveAgent() {
  message.value = ''
  error.value = ''
  staleConflict.value = false

  const id = form.value.id.trim()
  const name = form.value.name.trim()
  if (!id || !name) {
    error.value = 'ID 与名称为必填项'
    return
  }

  const isEditing = Boolean(selectedId.value)
  if (!isEditing && agents.value.some((item) => item.id === id)) {
    error.value = '该 ID 已存在'
    return
  }
  if (isEditing && selectedId.value !== id && agents.value.some((item) => item.id === id)) {
    error.value = '新 ID 已被其他角色占用'
    return
  }

  saving.value = true
  try {
    const previousAvatar =
      agents.value.find((item) => item.id === selectedId.value)?.avatar_image ?? null
    const avatar_image =
      (await avatarFieldRef.value?.resolveAvatarImageOnSave(id, previousAvatar)) ?? null
    const doc: AgentBuffDoc & { clearAvatar?: boolean } = {
      id,
      name,
      profession: form.value.profession.trim(),
      element: form.value.element.trim(),
      supportNeeds: [...form.value.supportNeeds],
      avatar_image,
      clearAvatar: Boolean(avatarFieldRef.value?.clearedByUser),
      note: form.value.note.trim(),
      basePanel: { ...form.value.basePanel } as AgentBasePanel,
      mindscapeNotes: form.value.mindscapeNotes.map((item) => item.trim()),
      mindscapeBuffs: buildMindscapeBuffs(),
      // 乐观锁基准：这份表单是从哪一版加载的（新建时为空，后端不校验）
      ...(formUpdatedAt.value ? { updatedAt: formUpdatedAt.value } : {}),
    }

    const saved = await store.upsertAgent(doc)
    // 改 ID 的场景：**保存成功之后**才删旧行。顺序不能反 —— 反了会被 409 拦下时
    // 已经把旧行删掉，整条角色数据就没了。
    if (isEditing && selectedId.value !== id && selectedId.value) {
      await store.deleteAgent(selectedId.value)
    }
    selectedId.value = id
    formUpdatedAt.value = saved.updatedAt
    effectEditorRef.value?.markSaved?.()
    message.value = isEditing ? `已保存角色「${name}」` : `已新增角色「${name}」`
  } catch (err) {
    if (isStaleWriteError(err)) {
      // 并发保护命中：库里的行已经被别的东西改过，本次整份覆盖被拒绝。
      // 千万不要提示「保存成功」，也不要假装本地已是最新。
      error.value = '这条数据已被其它操作更新，本次保存已取消。请刷新后重试。'
      staleConflict.value = true
      message.value = ''
      return
    }
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

/**
 * 强制重新拉取（loadAll(true) 绕开缓存）→ 用最新数据重填表单。
 * 这是「刷新」入口的唯一实现：面板顶部按钮和并发提示里的按钮都走这里。
 */
async function refreshFromServer() {
  refreshing.value = true
  try {
    await store.loadAll(true)
    const targetId = selectedId.value || form.value.id
    const latest = targetId ? agents.value.find((item) => item.id === targetId) : agents.value[0]
    error.value = ''
    staleConflict.value = false
    if (latest) {
      selectedId.value = latest.id
      loadForm(latest)
      message.value = `已刷新角色「${latest.name}」的最新数据`
      return
    }
    if (targetId) {
      // 这行已经在库里被删掉了，表单里留着也没有可写回的目标
      resetForm()
      message.value = ''
      error.value = '这条数据已在库里被删除，无法继续编辑。'
      return
    }
    message.value = '已刷新'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '刷新失败'
  } finally {
    refreshing.value = false
  }
}

async function removeAgent() {
  if (!selectedId.value) return
  const current = agents.value.find((item) => item.id === selectedId.value)
  if (!current) return
  if (!window.confirm(`确定删除角色「${current.name}」吗？`)) return

  try {
    await store.deleteAgent(selectedId.value)
    message.value = `已删除角色「${current.name}」`
    const next = agents.value[0]
    if (next) {
      selectAgent(next.id)
    } else {
      resetForm()
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

watch(
  agents,
  (list) => {
    if (!list.length) {
      resetForm()
      return
    }
    if (!selectedId.value || !list.some((item) => item.id === selectedId.value)) {
      selectAgent(list[0]!.id)
    }
  },
  { immediate: true },
)

const panelRootRef = ref<HTMLElement | null>(null)
const effectEditorRef = ref<{ markSaved?: () => void } | null>(null)

async function scrollToSection(sectionId: AgentBuffEditSectionId) {
  await nextTick()
  const target = panelRootRef.value?.querySelector<HTMLElement>(`#${sectionId}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

defineExpose({ scrollToSection, saveAgent, removeAgent, selectedId, saving })
</script>

<template>
  <div ref="panelRootRef" class="editor-panel editor-panel--wide">
    <header class="panel-header">
      <h1 class="panel-title">编辑角色增益</h1>
      <p class="panel-desc">影画增益使用固定数值条目，主副定位在伤害计算时选择。</p>
      <div class="panel-refresh">
        <button
          type="button"
          class="secondary-btn"
          :disabled="refreshing || saving"
          title="从数据库强制重新拉取（丢弃表单里未保存的改动）"
          @click="refreshFromServer"
        >
          {{ refreshing ? '刷新中...' : '刷新数据' }}
        </button>
      </div>
    </header>

    <form class="editor-form editor-form--solo" @submit.prevent="saveAgent">
      <!-- 顶部工具条 + 三列工作区（切人只在「当前编辑 ▾」下拉里） -->
      <section id="admin-agent-picker" class="workspace editor-anchor">
        <AdminBuffEffectEditor
          :key="`agent-mindscape-${activeMindscapeRank}`"
          ref="effectEditorRef"
          v-model="activeMindscapeForm.effectBlocks"
          :agent-id="form.id || undefined"
          owner-kind="agent"
          :owner-label="form.name || '新角色'"
          :owner-id="form.id || undefined"
          :owners="ownerItems"
          :save-state="saving ? 'saving' : undefined"
          @switch-owner="selectAgent"
        >
          <template #toolbar-extra>
            <div class="mindscape-tabs toolbar-tabs">
              <button
                v-for="rank in AGENT_MINDSCAPE_RANKS"
                :key="rank"
                type="button"
                class="mindscape-tab"
                :class="{ active: activeMindscapeRank === rank }"
                @click="activeMindscapeRank = rank"
              >
                {{ rank }}影
              </button>
            </div>
          </template>
          <template #owner-switcher="{ close }">
            <AdminBuffOwnerSwitcher
              :items="ownerItems"
              :selected-id="selectedId"
              :role-options="AGENT_ROLES"
              placeholder="搜索角色（名称 / 职业 / 属性）"
              create-label="＋ 新增角色"
              @select="(id) => switchOwner(id, close)"
              @create="createOwner(close)"
            />
          </template>
        </AdminBuffEffectEditor>
      </section>

      <!-- 当前影画的注释（仍按影画阶切换） -->
      <section id="admin-agent-mindscape" class="mindscape-section editor-anchor">
        <header class="mindscape-header">
          <h3>{{ activeMindscapeRank }} 影 · 注释</h3>
          <p>该影画阶的机制说明、触发条件等；效果块在顶部工作区里编辑。</p>
        </header>
        <label class="field note-field">
          <span class="field-label">{{ activeMindscapeRank }} 影注释</span>
          <textarea
            v-model="activeMindscapeNote"
            class="field-textarea"
            rows="3"
            placeholder="该影画阶的机制说明、触发条件等"
          />
        </label>
      </section>

      <!-- 角色资料（低频字段，收在工作区下面） -->
      <section class="doc-card">
        <header class="mindscape-header">
          <h3>角色资料</h3>
          <p>ID / 名称 / 职业 / 属性 / 辅助需求 / 注释 / 头像 / 基础面板。</p>
        </header>
        <div id="admin-agent-basic" class="editor-anchor">
        <div class="field-row">
          <label class="field">
            <span class="field-label">ID *</span>
            <input v-model="form.id" type="text" class="field-input" placeholder="如 anby" />
          </label>
          <label class="field">
            <span class="field-label">名称 *</span>
            <input v-model="form.name" type="text" class="field-input" placeholder="角色名称" />
          </label>
        </div>

        <div class="field-row">
          <label class="field">
            <span class="field-label">职业</span>
            <select v-model="form.profession" class="field-input">
              <option value="">请选择职业</option>
              <option v-for="profession in AGENT_ROLES" :key="profession" :value="profession">
                {{ profession }}
              </option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">属性</span>
            <select v-model="form.element" class="field-input" @change="onElementChange">
              <option value="">请选择属性</option>
              <option v-for="element in AGENT_ELEMENTS" :key="element" :value="element">
                {{ element }}
              </option>
            </select>
          </label>
        </div>
        </div>

        <div id="admin-agent-support" class="editor-anchor support-needs">
          <p class="field-label">辅助需求属性</p>
          <p class="support-hint">记录该角色作为辅助入队时需要堆叠的属性，与它是不是当前计算槽位无关。</p>
          <div class="checkbox-grid">
            <label
              v-for="option in SUPPORT_STAT_OPTIONS"
              :key="option.id"
              class="checkbox-item"
            >
              <input
                type="checkbox"
                :checked="form.supportNeeds.includes(option.id)"
                @change="toggleSupportNeed(option.id)"
              />
              <span>{{ option.label }}</span>
            </label>
          </div>
        </div>

        <label id="admin-agent-note" class="field note-field editor-anchor">
          <span class="field-label">角色注释</span>
          <textarea
            v-model="form.note"
            class="field-textarea"
            rows="3"
            placeholder="角色通用说明，将在队伍槽位与查阅页显示"
          />
        </label>

        <div id="admin-agent-avatar" class="editor-anchor">
          <AdminCalculatorAvatarField ref="avatarFieldRef" kind="agent" />
        </div>

        <section id="admin-agent-base-panel" class="mindscape-section editor-anchor">
          <header class="mindscape-header">
            <h3>基础面板</h3>
            <p>角色局外基础属性，暂不纳入当前伤害计算，供后续新模式使用。</p>
          </header>
          <AdminNumericStatFieldGrid v-model="form.basePanel" :fields="AGENT_BASE_PANEL_FIELDS" />
        </section>
      </section>

        <p v-if="error" class="form-error">
          {{ error }}
          <button
            v-if="staleConflict"
            type="button"
            class="secondary-btn inline-refresh-btn"
            :disabled="refreshing"
            @click="refreshFromServer"
          >
            {{ refreshing ? '刷新中...' : '刷新' }}
          </button>
        </p>
        <p v-if="message" class="form-success">{{ message }}</p>

        <div class="actions">
          <button type="submit" class="submit-btn" :disabled="saving">
            {{ saving ? '保存中...' : '保存' }}
          </button>
          <button v-if="selectedId" type="button" class="danger-btn" @click="removeAgent">
            删除
          </button>
        </div>
      </form>
  </div>
</template>

<style scoped src="./adminCalculatorPanel.css"></style>
<style scoped>
.editor-anchor {
  scroll-margin-top: 1rem;
}

/* 页面 = 顶部工具条 + 三列工作区（左侧不再有搜索/列表）；宽屏铺满 */
.editor-panel--wide {
  max-width: none;
}

.editor-form--solo {
  border: none;
  background: transparent;
  padding: 0;
  gap: 0.7rem;
}

.workspace {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.toolbar-tabs {
  flex: 0 0 auto;
}

.toolbar-tabs .mindscape-tab {
  padding: 0.16rem 0.55rem;
  font-size: 0.74rem;
}

.doc-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 0.85rem;
}

/* 乐观锁：顶部「刷新数据」与 stale 提示里的「刷新」 */
.panel-refresh {
  display: flex;
  justify-content: center;
  margin-top: 0.6rem;
}

.inline-refresh-btn {
  margin-left: 0.5rem;
  padding: 0.2rem 0.6rem;
  font-size: 0.78rem;
}
</style>
