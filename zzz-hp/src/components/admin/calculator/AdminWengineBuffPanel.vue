<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AdminBuffEffectEditor from '@/components/admin/calculator/AdminBuffEffectEditor.vue'
import AdminBuffOwnerSwitcher from '@/components/admin/calculator/AdminBuffOwnerSwitcher.vue'
import AdminCalculatorAvatarField from '@/components/admin/calculator/AdminCalculatorAvatarField.vue'
import AdminRememberedNumberField from '@/components/admin/calculator/AdminRememberedNumberField.vue'
import AdminWengineAdvancedStatsGrid from '@/components/admin/calculator/AdminWengineAdvancedStatsGrid.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type { AgentMindscapeRankBuffs, WengineBuffDoc } from '@/types/calculator'
import type { WengineBuffEditSectionId } from '@/constants/wengineBuffEditNav'
import { packFromBlocks, packFromEffects } from '@/utils/buffEffect'
import {
  ensureRefinementFirstBlockName,
  syncAppliesToAnomalyAcrossRefinementBlocks,
} from '@/utils/buffEffectBlockHelpers'
import {
  rememberWengineStatValue,
  WENGINE_BASE_ATK_FIELD_KEY,
  WENGINE_BASE_DEF_FIELD_KEY,
  wengineAdvancedStatFieldKey,
} from '@/utils/wengineStatSuggestions'
import {
  AGENT_ROLES,
  createEmptySelfTeamBuffs,
  createEmptyWengineAdvancedStats,
  createEmptyWengineRefinementBuffs,
  normalizeWengineAdvancedStats,
  REFINEMENT_RANKS,
  WENGINE_ADVANCED_STAT_FIELDS,
  WENGINE_RARITIES,
} from '@/utils/calculatorUi'

const store = useCalculatorBuffStore()
const { wengines } = storeToRefs(store)

const selectedId = ref(wengines.value[0]?.id ?? '')
const message = ref('')
const error = ref('')
const saving = ref(false)
const suggestionRefreshToken = ref(0)
const activeRefinementRank = ref(1)
/** 工作区视图：固定增益，或精炼 1..5 */
const activeBuffView = ref<'fixed' | number>('fixed')
const avatarFieldRef = ref<InstanceType<typeof AdminCalculatorAvatarField> | null>(null)

function selectBuffView(view: 'fixed' | number) {
  if (view === 'fixed') {
    activeBuffView.value = 'fixed'
    return
  }
  activeRefinementRank.value = Number(view)
  activeBuffView.value = Number(view)
}

const form = ref({
  id: '',
  name: '',
  profession: '',
  rarity: 'A' as WengineBuffDoc['rarity'],
  note: '',
  baseAtk: 0,
  baseDef: 0,
  advancedStats: createEmptyWengineAdvancedStats(),
  fixedBuffs: createEmptySelfTeamBuffs(),
  refinementForm: createEmptyWengineRefinementBuffs(),
})

/** 工具条「当前编辑 ▾」下拉里的音擎条目（搜索/职业筛选在 AdminBuffOwnerSwitcher 里） */
const ownerItems = computed(() =>
  wengines.value.map((item) => ({
    id: item.id,
    name: item.name,
    meta: [item.rarity ? `${item.rarity} 级` : '', item.profession || '未分类']
      .filter(Boolean)
      .join(' · '),
    profession: item.profession,
  })),
)

const activeRefinementForm = computed(
  () => form.value.refinementForm[activeRefinementRank.value - 1]!,
)

function cloneSelfTeamBuffs(buffs: AgentMindscapeRankBuffs): AgentMindscapeRankBuffs {
  if (buffs.effectBlocks?.length) {
    return packFromBlocks(
      buffs.effectBlocks.map((block) => ({
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
    (buffs.effects ?? []).map((effect) => ({
      ...effect,
      convert: effect.convert ? { ...effect.convert } : undefined,
      elementFilter: Array.isArray(effect.elementFilter)
        ? [...effect.elementFilter]
        : effect.elementFilter,
    })),
  )
}

function loadRefinementForm(refinementBuffs: WengineBuffDoc['refinementBuffs']) {
  return REFINEMENT_RANKS.map((_, index) => {
    const packed = cloneSelfTeamBuffs(refinementBuffs[index] ?? createEmptySelfTeamBuffs())
    packed.effectBlocks = ensureRefinementFirstBlockName(packed.effectBlocks ?? [], index + 1)
    return packed
  })
}

function loadForm(doc: WengineBuffDoc) {
  form.value = {
    id: doc.id,
    name: doc.name,
    profession: doc.profession ?? '',
    rarity: doc.rarity,
    note: doc.note ?? '',
    baseAtk: doc.baseAtk,
    baseDef: doc.baseDef ?? 0,
    advancedStats: normalizeWengineAdvancedStats(doc.advancedStats),
    fixedBuffs: cloneSelfTeamBuffs(doc.fixedBuffs),
    refinementForm: loadRefinementForm(doc.refinementBuffs),
  }
  activeRefinementRank.value = 1
  void nextTick(() => {
    avatarFieldRef.value?.setAvatarImage(doc.avatar_image)
    // 切音擎 = 载入已保存的数据，工具条回到「无改动」
    fixedEditorRef.value?.markSaved?.()
    refinementEditorRef.value?.markSaved?.()
  })
}

function resetForm() {
  form.value = {
    id: '',
    name: '',
    profession: '',
    rarity: 'A',
    note: '',
    baseAtk: 0,
    baseDef: 0,
    advancedStats: createEmptyWengineAdvancedStats(),
    fixedBuffs: createEmptySelfTeamBuffs(),
    refinementForm: createEmptyWengineRefinementBuffs(),
  }
  activeRefinementRank.value = 1
  selectedId.value = ''
  avatarFieldRef.value?.clearAvatarImage()
  void nextTick(() => {
    fixedEditorRef.value?.markSaved?.()
    refinementEditorRef.value?.markSaved?.()
  })
}

function selectItem(id: string) {
  selectedId.value = id
  const doc = wengines.value.find((item) => item.id === id)
  if (doc) loadForm(doc)
}

/** 工具条下拉里选中：切音擎并收起下拉 */
function switchOwner(id: string, close?: () => void) {
  selectItem(id)
  close?.()
}

function createOwner(close?: () => void) {
  createNew()
  close?.()
}

function createNew() {
  resetForm()
}

function buildRefinementBuffs() {
  return form.value.refinementForm.map((rank, index) =>
    packFromBlocks(
      ensureRefinementFirstBlockName(rank.effectBlocks ?? [], index + 1),
    ),
  )
}

function copyRefinementFrom(sourceRank: number) {
  const source = form.value.refinementForm[sourceRank - 1]
  const target = form.value.refinementForm[activeRefinementRank.value - 1]
  if (!source || !target) return
  // 深拷贝，避免精2~精5与精1共享同一批 effect 对象
  target.effectBlocks = cloneSelfTeamBuffs(source).effectBlocks
  message.value = `已把精${sourceRank}的配置复制到精${activeRefinementRank.value}，请修改数值`
  error.value = ''
}

function syncRefinementAppliesToAnomaly(effect: import('@/types/calculator').BuffEffect, value: boolean) {
  syncAppliesToAnomalyAcrossRefinementBlocks(
    form.value.refinementForm.map((rank) => rank.effectBlocks ?? []),
    effect,
    value,
  )
}

function rememberWenginePanelStats() {
  rememberWengineStatValue(WENGINE_BASE_ATK_FIELD_KEY, form.value.baseAtk)
  rememberWengineStatValue(WENGINE_BASE_DEF_FIELD_KEY, form.value.baseDef)
  for (const field of WENGINE_ADVANCED_STAT_FIELDS) {
    rememberWengineStatValue(
      wengineAdvancedStatFieldKey(field.key),
      form.value.advancedStats[field.key],
    )
  }
}

async function saveItem() {
  message.value = ''
  error.value = ''

  const id = form.value.id.trim()
  const name = form.value.name.trim()
  if (!id || !name) {
    error.value = 'ID 与名称为必填项'
    return
  }

  const isEditing = Boolean(selectedId.value)
  if (!isEditing && wengines.value.some((item) => item.id === id)) {
    error.value = '该 ID 已存在'
    return
  }
  if (isEditing && selectedId.value !== id && wengines.value.some((item) => item.id === id)) {
    error.value = '新 ID 已被其他音擎占用'
    return
  }

  saving.value = true
  try {
    const previousAvatar =
      wengines.value.find((item) => item.id === selectedId.value)?.avatar_image ?? null
    const avatar_image =
      (await avatarFieldRef.value?.resolveAvatarImageOnSave(id, previousAvatar)) ?? null
    const doc: WengineBuffDoc & { clearAvatar?: boolean } = {
      id,
      name,
      profession: form.value.profession,
      rarity: form.value.rarity,
      note: form.value.note.trim(),
      avatar_image,
      clearAvatar: Boolean(avatarFieldRef.value?.clearedByUser),
      baseAtk: Number(form.value.baseAtk) || 0,
      baseDef: Number(form.value.baseDef) || 0,
      advancedStats: normalizeWengineAdvancedStats(form.value.advancedStats),
      fixedBuffs: packFromBlocks(form.value.fixedBuffs.effectBlocks ?? []),
      refinementBuffs: buildRefinementBuffs(),
    }

    if (isEditing && selectedId.value !== id) {
      await store.deleteWengine(selectedId.value)
    }

    await store.upsertWengine(doc)
    selectedId.value = id
    fixedEditorRef.value?.markSaved?.()
    refinementEditorRef.value?.markSaved?.()
    rememberWenginePanelStats()
    suggestionRefreshToken.value += 1
    message.value = isEditing ? `已保存音擎「${name}」` : `已新增音擎「${name}」`
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeItem() {
  if (!selectedId.value) return
  const current = wengines.value.find((item) => item.id === selectedId.value)
  if (!current) return
  if (!window.confirm(`确定删除音擎「${current.name}」吗？`)) return

  try {
    await store.deleteWengine(selectedId.value)
    message.value = `已删除音擎「${current.name}」`
    const next = wengines.value[0]
    if (next) {
      selectItem(next.id)
    } else {
      resetForm()
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

watch(
  wengines,
  (list) => {
    if (!list.length) {
      resetForm()
      return
    }
    if (!selectedId.value || !list.some((item) => item.id === selectedId.value)) {
      selectItem(list[0]!.id)
    }
  },
  { immediate: true },
)

const panelRootRef = ref<HTMLElement | null>(null)
const fixedEditorRef = ref<{ markSaved?: () => void } | null>(null)
const refinementEditorRef = ref<{ markSaved?: () => void } | null>(null)

async function scrollToSection(sectionId: WengineBuffEditSectionId) {
  await nextTick()
  // 固定 / 精炼已合并到同一工作区：侧栏跳转时顺带切视图
  if (sectionId === 'admin-wengine-fixed') {
    selectBuffView('fixed')
  } else if (sectionId === 'admin-wengine-refinement' && activeBuffView.value === 'fixed') {
    selectBuffView(1)
  }
  await nextTick()
  const target = panelRootRef.value?.querySelector<HTMLElement>(`#${sectionId}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

defineExpose({ scrollToSection, saveItem, removeItem, selectedId, saving })
</script>

<template>
  <div ref="panelRootRef" class="editor-panel editor-panel--wide">
    <header class="panel-header">
      <h1 class="panel-title">编辑音擎增益</h1>
      <p class="panel-desc">固定增益与精1至精5精炼增益，均使用固定数值条目。</p>
    </header>

    <form class="editor-form editor-form--solo" @submit.prevent="saveItem">
      <!-- 顶部工具条 + 三列工作区：固定 / 精1..精5 在工具条里切换 -->
      <section id="admin-wengine-picker" class="workspace editor-anchor">
        <span id="admin-wengine-fixed" class="anchor-jump" />
        <span id="admin-wengine-refinement" class="anchor-jump" />

        <AdminBuffEffectEditor
          v-show="activeBuffView === 'fixed'"
          ref="fixedEditorRef"
          v-model="form.fixedBuffs.effectBlocks"
          owner-kind="wengine"
          :owner-label="form.name || '新音擎'"
          :owner-id="form.id || undefined"
          :owners="ownerItems"
          :save-state="saving ? 'saving' : undefined"
          @switch-owner="selectItem"
        >
          <template #toolbar-extra>
            <div class="mindscape-tabs toolbar-tabs">
              <button
                type="button"
                class="mindscape-tab"
                :class="{ active: activeBuffView === 'fixed' }"
                @click="selectBuffView('fixed')"
              >
                固定
              </button>
              <button
                v-for="rank in REFINEMENT_RANKS"
                :key="rank"
                type="button"
                class="mindscape-tab"
                :class="{ active: activeBuffView === rank }"
                @click="selectBuffView(rank)"
              >
                精{{ rank }}
              </button>
            </div>
          </template>
          <template #toolbar-actions>
            <button type="submit" class="submit-btn submit-btn--toolbar" :disabled="saving">
              {{ saving ? '保存中...' : '保存' }}
            </button>
            <button
              v-if="selectedId"
              type="button"
              class="danger-btn danger-btn--toolbar"
              @click="removeItem"
            >
              删除
            </button>
          </template>
          <template #owner-switcher="{ close }">
            <AdminBuffOwnerSwitcher
              :items="ownerItems"
              :selected-id="selectedId"
              :role-options="AGENT_ROLES"
              placeholder="搜索音擎（名称 / 稀有度）"
              create-label="＋ 新增音擎"
              @select="(id) => switchOwner(id, close)"
              @create="createOwner(close)"
            />
          </template>
        </AdminBuffEffectEditor>

        <AdminBuffEffectEditor
          v-show="activeBuffView !== 'fixed'"
          :key="`wengine-refinement-${activeRefinementRank}`"
          ref="refinementEditorRef"
          v-model="activeRefinementForm.effectBlocks"
          :default-first-block-name="`精${activeRefinementRank}`"
          owner-kind="wengine"
          :owner-label="form.name || '新音擎'"
          :owner-id="form.id || undefined"
          :owners="ownerItems"
          :save-state="saving ? 'saving' : undefined"
          :on-applies-to-anomaly-change="syncRefinementAppliesToAnomaly"
          @switch-owner="selectItem"
        >
          <template #toolbar-extra>
            <div class="mindscape-tabs toolbar-tabs">
              <button
                type="button"
                class="mindscape-tab"
                :class="{ active: activeBuffView === 'fixed' }"
                @click="selectBuffView('fixed')"
              >
                固定
              </button>
              <button
                v-for="rank in REFINEMENT_RANKS"
                :key="rank"
                type="button"
                class="mindscape-tab"
                :class="{ active: activeBuffView === rank }"
                @click="selectBuffView(rank)"
              >
                精{{ rank }}
              </button>
            </div>
          </template>
          <template #toolbar-actions>
            <button type="submit" class="submit-btn submit-btn--toolbar" :disabled="saving">
              {{ saving ? '保存中...' : '保存' }}
            </button>
            <button
              v-if="selectedId"
              type="button"
              class="danger-btn danger-btn--toolbar"
              @click="removeItem"
            >
              删除
            </button>
          </template>
          <template #owner-switcher="{ close }">
            <AdminBuffOwnerSwitcher
              :items="ownerItems"
              :selected-id="selectedId"
              :role-options="AGENT_ROLES"
              placeholder="搜索音擎（名称 / 稀有度）"
              create-label="＋ 新增音擎"
              @select="(id) => switchOwner(id, close)"
              @create="createOwner(close)"
            />
          </template>
        </AdminBuffEffectEditor>

        <div v-if="activeBuffView !== 'fixed' && activeRefinementRank > 1" class="refinement-copy-row">
          <button type="button" class="secondary-btn" @click="copyRefinementFrom(1)">
            从精1复制
          </button>
          <span class="hint">精2~精5通常只有数值差别，复制后再改数值即可。</span>
        </div>
      </section>

      <!-- 音擎资料（低频字段，收在工作区下面） -->
      <section class="doc-card">
        <header class="mindscape-header">
          <h3>音擎资料</h3>
          <p>ID / 名称 / 职业 / 稀有度 / 注释 / 头像 / 基础属性。</p>
        </header>
        <div id="admin-wengine-basic" class="editor-anchor">
        <div class="field-row">
          <label class="field">
            <span class="field-label">ID *</span>
            <input v-model="form.id" type="text" class="field-input" placeholder="如 s-resonance" />
          </label>
          <label class="field">
            <span class="field-label">名称 *</span>
            <input v-model="form.name" type="text" class="field-input" placeholder="音擎名称" />
          </label>
        </div>

        <div class="field-row">
          <label class="field">
            <span class="field-label">职业</span>
            <select v-model="form.profession" class="field-input">
              <option value="">未分类</option>
              <option v-for="role in AGENT_ROLES" :key="role" :value="role">
                {{ role }}
              </option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">稀有度</span>
            <select v-model="form.rarity" class="field-input">
              <option v-for="rarity in WENGINE_RARITIES" :key="rarity" :value="rarity">
                {{ rarity }}
              </option>
            </select>
          </label>
        </div>
        </div>

        <div id="admin-wengine-note" class="editor-anchor">
          <label class="field note-field">
            <span class="field-label">音擎注释</span>
            <textarea
              v-model="form.note"
              class="field-textarea"
              rows="3"
              placeholder="佩戴该音擎时在伤害计算页显示此注释"
            />
          </label>
        </div>

        <div id="admin-wengine-avatar" class="editor-anchor">
          <AdminCalculatorAvatarField ref="avatarFieldRef" kind="wengine" />
        </div>

        <section id="admin-wengine-base-stats" class="mindscape-section editor-anchor">
          <header class="mindscape-header">
            <h3>基础属性</h3>
            <p>音擎局外基础攻击与高级属性，暂不纳入当前伤害计算；保存后数值会记入本机历史，可从下拉快速选用。</p>
          </header>
          <AdminRememberedNumberField
            v-model="form.baseAtk"
            :field-key="WENGINE_BASE_ATK_FIELD_KEY"
            label="基础攻击力"
            :refresh-token="suggestionRefreshToken"
          />
          <AdminRememberedNumberField
            v-model="form.baseDef"
            :field-key="WENGINE_BASE_DEF_FIELD_KEY"
            label="基础防御力"
            :refresh-token="suggestionRefreshToken"
          />
          <p class="hint">锋御音擎的基础属性为防御力，填在此处；其余职业填基础攻击力。</p>
          <p class="mods-section-title">高级属性</p>
          <AdminWengineAdvancedStatsGrid
            v-model="form.advancedStats"
            :fields="WENGINE_ADVANCED_STAT_FIELDS"
            :refresh-token="suggestionRefreshToken"
          />
        </section>
      </section>

        <p v-if="error" class="form-error">{{ error }}</p>
        <p v-if="message" class="form-success">{{ message }}</p>
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

/* 侧栏「固定增益 / 精炼增益」的跳转锚点：跳转时顺便切视图 */
.anchor-jump {
  display: block;
  height: 0;
  scroll-margin-top: 1rem;
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

.refinement-copy-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

/* 保存 / 删除：跟「✓ 无改动 / ● 未保存」并排放在工具条右侧 */
.submit-btn--toolbar {
  padding: 0.18rem 0.7rem;
  font-size: 0.76rem;
}

.danger-btn--toolbar {
  padding: 0.18rem 0.55rem;
  font-size: 0.76rem;
}
</style>
