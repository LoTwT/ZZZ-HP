<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import DamageEventEditor from '@/components/calculator/DamageEventEditor.vue'
import type {
  DamageEvent,
  DamageEventMode,
  DamageEventModeType,
  SkillSubcategory,
} from '@/types/calculator'
import { TRIGGER_AGENT_AT_CALC } from '@/types/calculator'
import {
  createEmptyDamageEvent,
  DAMAGE_EVENT_KIND_OPTIONS,
  formatDamageEventDisplayName,
} from '@/utils/damageEvent'
import {
  createCustomModeId,
  loadCustomModes,
  removeCustomMode,
  upsertCustomMode,
} from '@/utils/customDamageEventModes'
import { buildDamageModeTeamKey, resolveEventOwnerAgentId } from '@/utils/damageEventOwner'

const props = withDefaults(
  defineProps<{
    agentId?: string
    agentName?: string
    presetModes?: DamageEventMode[]
    skillSubcategories: SkillSubcategory[]
    modeType?: DamageEventModeType
    triggerAgentOptions?: { id: string; name: string }[]
    mainAgentId?: string
    ownerAgentOptions?: { id: string; name: string; element?: string }[]
    teamHasRemiel?: boolean
    resolveMultDefaults?: (
      event: DamageEvent,
    ) => Partial<Record<keyof import('@/types/calculator').DamageEventMultOverrides, number>>
    turbulenceCalculable?: boolean
    mainAgentElement?: string | null
    hasActiveScheme?: boolean
    activeSchemeName?: string
  }>(),
  { modeType: 'direct', hasActiveScheme: false, activeSchemeName: '' },
)

const emit = defineEmits<{
  'save-to-scheme': []
  'request-create-scheme': [hint: string]
}>()

const open = defineModel<boolean>('open', { default: false })
const events = defineModel<DamageEvent[]>('events', { default: () => [] })
const modeId = defineModel<string | null>('modeId', { default: null })
const modeName = defineModel<string>('modeName', { default: '' })

const draftName = ref('')
const message = ref('')
const customModes = ref<DamageEventMode[]>(loadCustomModes())
const modeSearchQuery = ref('')
const schemeEditActive = ref(false)
/** 无当前方案时：「跟随方案」先弹出去向选择 */
const saveDestChoiceOpen = ref(false)

const isPresetMode = computed(() => {
  if (!modeId.value) return false
  if (modeId.value.startsWith('custom-') || modeId.value === 'custom') return false
  return (props.presetModes ?? []).some((item) => item.id === modeId.value)
})

const isCustomMode = computed(() => !isPresetMode.value && Boolean(modeId.value))

const canEditEvents = computed(
  () => Boolean(modeId.value) || schemeEditActive.value || events.value.length > 0,
)

const summaryLabel = computed(() => {
  if (modeName.value.trim()) return modeName.value.trim()
  if (events.value.length > 0) return '方案事件'
  return ''
})

const agentPresets = computed(() =>
  (props.presetModes ?? []).filter((item) => {
    const typeOk = (item.modeType ?? 'direct') === props.modeType
    const agentOk = !item.agentId || !props.agentId || item.agentId === props.agentId
    return typeOk && agentOk
  }),
)

const mainAgentIdRef = computed(() => props.mainAgentId ?? props.agentId ?? '')

const agentCustoms = computed(() =>
  customModes.value.filter((item) => {
    if (item.modeType !== props.modeType) return false
    return !item.agentId || !props.agentId || item.agentId === props.agentId
  }),
)

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function stripAgentLabelNoise(name: string): string {
  return name
    .replace(/（未上阵）/g, '')
    .replace(/（其他角色）/g, '')
    .trim()
}

function agentLabel(agentId: string | null | undefined): string {
  if (!agentId || agentId === TRIGGER_AGENT_AT_CALC) {
    return agentId === TRIGGER_AGENT_AT_CALC ? '计算时选择' : ''
  }
  const raw =
    props.triggerAgentOptions?.find((item) => item.id === agentId)?.name ??
    props.ownerAgentOptions?.find((item) => item.id === agentId)?.name ??
    agentId
  const cleaned = stripAgentLabelNoise(raw)
  const base = cleaned.includes('·') ? cleaned.split('·')[0]!.trim() : cleaned
  return base || cleaned
}

function modeSearchBlob(mode: DamageEventMode): string {
  const mainId = mainAgentIdRef.value
  const parts: string[] = [mode.name, mode.modeType === 'anomaly' ? '异常' : '直伤']
  for (const event of mode.events ?? []) {
    const ownerId = resolveEventOwnerAgentId(event, mainId)
    const ownerName = agentLabel(ownerId)
    const triggerName = agentLabel(event.triggerAgentId)
    const kind =
      DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === event.kind)?.label ?? event.kind
    const display = formatDamageEventDisplayName(
      event,
      (id) =>
        id ? props.skillSubcategories.find((item) => item.id === id) ?? null : null,
      ownerName || undefined,
    )
    parts.push(kind, display, ownerName, triggerName)
  }
  return normalizeSearchText(parts.filter(Boolean).join(' '))
}

function modeMatchesQuery(mode: DamageEventMode, query: string): boolean {
  if (!query) return true
  return modeSearchBlob(mode).includes(query)
}

const filteredAgentPresets = computed(() => {
  const query = normalizeSearchText(modeSearchQuery.value)
  return agentPresets.value.filter((mode) => modeMatchesQuery(mode, query))
})

const filteredAgentCustoms = computed(() => {
  const query = normalizeSearchText(modeSearchQuery.value)
  return agentCustoms.value.filter((mode) => modeMatchesQuery(mode, query))
})

/** 当前页上的方案事件（未绑全局 modeId） */
const isSchemeEventsActive = computed(
  () => !modeId.value && (schemeEditActive.value || events.value.length > 0),
)

const schemeEventsLabel = computed(() => {
  const named = modeName.value.trim() || draftName.value.trim()
  if (named) return named
  if (props.activeSchemeName) return `${props.activeSchemeName} · 方案事件`
  return props.modeType === 'anomaly' ? '方案异常事件' : '方案直伤事件'
})

const showSchemeEventsItem = computed(() => {
  if (!isSchemeEventsActive.value) return false
  const query = normalizeSearchText(modeSearchQuery.value)
  if (!query) return true
  const hay = normalizeSearchText(
    [schemeEventsLabel.value, props.activeSchemeName || '', '方案'].join(' '),
  )
  return hay.includes(query)
})

const hasModeSearchHits = computed(
  () =>
    filteredAgentPresets.value.length > 0 ||
    filteredAgentCustoms.value.length > 0 ||
    showSchemeEventsItem.value,
)

watch(open, (isOpen) => {
  if (isOpen) {
    draftName.value = modeName.value || ''
    message.value = ''
    modeSearchQuery.value = ''
    saveDestChoiceOpen.value = false
    customModes.value = loadCustomModes()
    if (!modeId.value && events.value.length > 0) schemeEditActive.value = true
    if (isPresetMode.value && modeId.value) {
      const preset = (props.presetModes ?? []).find((item) => item.id === modeId.value)
      if (preset) {
        events.value = cloneEventsForCalc(preset.events)
        modeName.value = preset.name
        draftName.value = preset.name
      }
    }
  } else {
    saveDestChoiceOpen.value = false
  }
})

watch(modeId, (id) => {
  if (!id) return
  schemeEditActive.value = false
})

watch(
  () => props.hasActiveScheme,
  (has, had) => {
    if (has && saveDestChoiceOpen.value) saveDestChoiceOpen.value = false
    if (open.value && has && !had) {
      message.value = props.activeSchemeName
        ? `已绑定方案「${props.activeSchemeName}」；事件已写入，可继续编辑或再点「存为方案事件模式」`
        : '已绑定当前方案；事件已写入'
      schemeEditActive.value = true
      modeId.value = null
    }
  },
)

function close() {
  saveDestChoiceOpen.value = false
  open.value = false
}

function cloneEventsForCalc(source: DamageEvent[]): DamageEvent[] {
  return source.map((event, index) => ({
    ...event,
    multOverrides: event.multOverrides ? { ...event.multOverrides } : null,
    triggerAgentId:
      event.triggerAgentId === TRIGGER_AGENT_AT_CALC ? null : (event.triggerAgentId ?? null),
    id: `evt-copy-${Date.now().toString(36)}-${index}`,
  }))
}

function selectPreset(mode: DamageEventMode) {
  modeId.value = mode.id
  modeName.value = mode.name
  draftName.value = mode.name
  schemeEditActive.value = false
  events.value = cloneEventsForCalc(mode.events)
  message.value = `已载入预设「${mode.name}」（可编辑；不另存则下次打开重置）`
}

function cloneEventsFromCustom(source: DamageEvent[]): DamageEvent[] {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  return source.map((event, index) => ({
    ...event,
    ownerAgentId: event.ownerAgentId ?? null,
    multOverrides: event.multOverrides ? { ...event.multOverrides } : null,
    triggerAgentId:
      event.triggerAgentId === TRIGGER_AGENT_AT_CALC ? null : (event.triggerAgentId ?? null),
    id: `evt-copy-${stamp}-${index}`,
  }))
}

function cloneEventsForStorage(source: DamageEvent[]): DamageEvent[] {
  return source.map((event) => ({
    ...event,
    ownerAgentId: event.ownerAgentId ?? null,
    triggerAgentId: event.triggerAgentId ?? null,
    multOverrides: event.multOverrides ? { ...event.multOverrides } : null,
  }))
}

function selectCustom(mode: DamageEventMode) {
  modeId.value = mode.id
  modeName.value = mode.name
  draftName.value = mode.name
  schemeEditActive.value = false
  events.value = cloneEventsFromCustom(mode.events)
  message.value = `已载入全局自定义「${mode.name}」（编辑后需点「更新到全局」才会写回模板）`
}

function startSchemeEvents() {
  const name =
    draftName.value.trim() ||
    modeName.value.trim() ||
    (props.modeType === 'anomaly' ? '方案异常事件' : '方案直伤事件')
  modeId.value = null
  modeName.value = name
  draftName.value = name
  schemeEditActive.value = true
  if (events.value.length === 0) {
    const defaultKind = props.modeType === 'anomaly' ? 'anomaly' : 'direct'
    events.value = [createEmptyDamageEvent(0, defaultKind)]
  }
  message.value = '正在编辑事件：可「存为方案事件模式」或「存为全局自定义」'
}

/** 侧栏点选「方案事件」条目 */
function focusSchemeEvents() {
  modeId.value = null
  schemeEditActive.value = true
  if (!modeName.value.trim()) {
    modeName.value = schemeEventsLabel.value
  }
  draftName.value = modeName.value || draftName.value
  message.value = props.hasActiveScheme
    ? `当前为方案「${props.activeSchemeName || '未命名'}」内事件（侧栏「方案」条目）`
    : '当前为方案事件（尚未绑定已加载方案；保存时可新建方案或改存全局）'
}

function persistCurrentCustom(): boolean {
  const name = (draftName.value.trim() || modeName.value.trim() || '自定义模式').slice(0, 80)
  if (!events.value.length) {
    message.value = '请先添加至少 1 条事件'
    return false
  }
  const id =
    modeId.value && isCustomMode.value && modeId.value !== 'custom'
      ? modeId.value
      : createCustomModeId()
  modeId.value = id
  modeName.value = name
  draftName.value = name
  schemeEditActive.value = false
  const mainId = mainAgentIdRef.value
  const mode: DamageEventMode = {
    id,
    agentId: props.agentId ?? mainId,
    teamKey: buildDamageModeTeamKey(events.value, mainId),
    name,
    modeType: props.modeType,
    events: cloneEventsForStorage(events.value),
  }
  customModes.value = upsertCustomMode(mode)
  return true
}

function saveAsGlobalCustom() {
  if (!persistCurrentCustom()) return
  message.value = `已存为全局自定义「${modeName.value}」（侧栏可见，不会自动写入各方案）`
}

/** 更新当前模式事件：全局 → 写全局库；方案 → 写当前方案（无方案则引导新建） */
function updateModeEvents() {
  if (isCustomMode.value) {
    if (!persistCurrentCustom()) return
    message.value = `已更新全局自定义「${modeName.value}」`
    return
  }
  if (isSchemeEventsActive.value || schemeEditActive.value) {
    saveFollowScheme()
    return
  }
  message.value = '请先选择全局自定义，或点「编辑事件」'
}

const canUpdateModeEvents = computed(
  () => isCustomMode.value || isSchemeEventsActive.value || schemeEditActive.value,
)

const updateModeEventsLabel = computed(() =>
  isCustomMode.value ? '更新到全局' : '存为方案事件模式',
)

function saveFollowScheme() {
  if (!events.value.length) {
    message.value = '请先添加至少 1 条事件'
    return
  }
  const name = draftName.value.trim() || modeName.value.trim()
  if (name) modeName.value = name

  if (props.hasActiveScheme) {
    modeId.value = null
    schemeEditActive.value = true
    emit('save-to-scheme')
    message.value = props.activeSchemeName
      ? `已存为方案「${props.activeSchemeName}」的事件模式`
      : '已存为当前方案的事件模式'
    return
  }

  // 无当前方案：弹出「新建方案 / 改存全局」选择，避免直接被事件弹窗挡住
  saveDestChoiceOpen.value = true
}

function chooseCreateScheme() {
  saveDestChoiceOpen.value = false
  modeId.value = null
  schemeEditActive.value = true
  const hint =
    '请新建方案（保存当前配置）或加载已有方案；保存/加载后当前事件会写入该方案。可关闭方案库后继续编辑。'
  message.value = hint
  emit('request-create-scheme', hint)
}

function chooseSaveAsGlobal() {
  saveDestChoiceOpen.value = false
  saveAsGlobalCustom()
}

function cancelSaveDestChoice() {
  saveDestChoiceOpen.value = false
}

function saveAsCustomCopy() {
  if (!events.value.length) {
    message.value = '请先添加至少 1 条事件'
    return
  }
  const id = createCustomModeId()
  const name = `${(draftName.value.trim() || modeName.value || '模式').replace(/（副本）$/, '')}（副本）`
  modeId.value = id
  modeName.value = name
  draftName.value = name
  schemeEditActive.value = false
  events.value = events.value.map((event, index) => ({
    ...event,
    multOverrides: event.multOverrides ? { ...event.multOverrides } : null,
    id: `evt-copy-${Date.now().toString(36)}-${index}`,
  }))
  persistCurrentCustom()
  message.value = `已另存为全局自定义「${name}」`
}

function deleteCurrentCustom() {
  if (!modeId.value || isPresetMode.value) return
  customModes.value = removeCustomMode(modeId.value)
  modeId.value = null
  modeName.value = ''
  draftName.value = ''
  schemeEditActive.value = false
  events.value = []
  message.value = '已删除全局自定义模式'
}

function applyModeName() {
  const name = draftName.value.trim()
  if (!name) return
  modeName.value = name
}
</script>

<template>
  <button type="button" class="mode-summary-bar" @click="open = true">
    <span v-if="summaryLabel || events.length" class="mode-summary-main">
      {{ summaryLabel || '方案事件' }}
      <span class="mode-summary-meta">· {{ events.length }} 条事件</span>
    </span>
    <span v-else class="mode-summary-placeholder">未选择模式 / 未编辑方案事件</span>
    <span class="mode-summary-hint" aria-hidden="true">点击此处选择或编辑</span>
  </button>

  <Teleport to="body">
    <div v-if="open" class="mode-overlay" role="presentation" @click.self="close">
      <div class="mode-modal" role="dialog" aria-modal="true" aria-label="伤害事件模式">
        <header class="mode-header">
          <div>
            <h3>{{ modeType === 'anomaly' ? '异常伤害事件' : '直伤伤害事件' }}</h3>
            <p>
              {{ agentName ? `当前主 C：${agentName}` : '请先选择主 C' }}
              · 原有全局自定义仍保留；新事件可选「存全局」或「跟方案」
            </p>
          </div>
          <button type="button" class="close-btn" aria-label="关闭" @click="close">×</button>
        </header>

        <div class="mode-body">
          <aside class="mode-aside">
            <div class="mode-aside-toolbar">
              <label class="mode-search">
                <span class="sr-only">搜索模式</span>
                <input
                  v-model="modeSearchQuery"
                  type="search"
                  placeholder="搜索模式 / 事件 / 产生者 / 触发者"
                  autocomplete="off"
                />
              </label>
            </div>

            <div class="mode-aside-scroll">
              <h4>管理员预设</h4>
              <button
                v-for="mode in filteredAgentPresets"
                :key="mode.id"
                type="button"
                class="mode-item"
                :class="{ active: modeId === mode.id }"
                @click="selectPreset(mode)"
              >
                <strong>{{ mode.name }}</strong>
                <span>{{ mode.events.length }} 条 · 预设</span>
              </button>
              <p v-if="!agentPresets.length" class="aside-empty">暂无该角色的管理端预设</p>
              <p v-else-if="!filteredAgentPresets.length" class="aside-empty">无匹配预设</p>

              <h4 class="aside-section">方案 / 全局自定义</h4>
              <button type="button" class="mode-item mode-item--add" @click="startSchemeEvents">
                + 编辑事件
              </button>
              <button
                v-if="showSchemeEventsItem"
                type="button"
                class="mode-item"
                :class="{
                  active: isSchemeEventsActive,
                  'mode-item--scheme': hasActiveScheme,
                }"
                @click="focusSchemeEvents"
              >
                <strong>{{ schemeEventsLabel }}</strong>
                <span>
                  {{ events.length }} 条
                  <template v-if="hasActiveScheme">
                    · 方案
                    <template v-if="activeSchemeName"> · {{ activeSchemeName }}</template>
                  </template>
                </span>
              </button>
              <button
                v-for="mode in filteredAgentCustoms"
                :key="mode.id"
                type="button"
                class="mode-item"
                :class="{ active: modeId === mode.id }"
                @click="selectCustom(mode)"
              >
                <strong>{{ mode.name }}</strong>
                <span>{{ mode.events.length }} 条 · 全局</span>
              </button>
              <p
                v-if="modeSearchQuery.trim() && !hasModeSearchHits"
                class="aside-empty"
              >
                无匹配模式
              </p>
            </div>
          </aside>

          <div class="mode-main">
            <div class="name-row">
              <label>
                <span>名称</span>
                <input
                  v-model="draftName"
                  type="text"
                  placeholder="方案事件或自定义模式名称"
                  :disabled="isPresetMode"
                  @change="applyModeName"
                  @blur="applyModeName"
                />
              </label>
              <div class="name-actions">
                <button
                  v-if="modeId || canEditEvents"
                  type="button"
                  class="action-btn"
                  @click="saveAsCustomCopy"
                >
                  另存全局副本
                </button>
                <button
                  v-if="isCustomMode"
                  type="button"
                  class="action-btn action-btn--danger"
                  @click="deleteCurrentCustom"
                >
                  删除全局
                </button>
              </div>
              <p v-if="message" class="mode-message">{{ message }}</p>
            </div>

            <div v-if="canEditEvents && !isPresetMode" class="save-dest-row">
              <button type="button" class="action-btn action-btn--primary" @click="saveAsGlobalCustom">
                存为全局自定义
              </button>
              <button
                v-if="canUpdateModeEvents"
                type="button"
                class="action-btn"
                :class="isCustomMode ? '' : 'action-btn--scheme'"
                @click="updateModeEvents"
              >
                {{ updateModeEventsLabel }}
              </button>
            </div>

            <p v-if="isPresetMode" class="readonly-hint">
              当前为管理员预设，可临时修改；不「存为全局自定义」则下次打开会恢复默认。
            </p>
            <p v-else-if="canEditEvents" class="readonly-hint">
              「更新到全局 / 存为方案事件模式」按当前编辑目标写入；未保存前侧栏不标注方案或全局。
              <template v-if="hasActiveScheme && activeSchemeName">
                当前方案：{{ activeSchemeName }}
              </template>
            </p>

            <DamageEventEditor
              v-if="canEditEvents"
              v-model="events"
              :skill-subcategories="skillSubcategories"
              :agent-id="agentId"
              :main-agent-id="mainAgentId ?? agentId"
              :owner-agent-options="ownerAgentOptions"
              :team-has-remiel="teamHasRemiel"
              :mode-type="modeType"
              :trigger-agent-options="triggerAgentOptions"
              :allow-calc-time-trigger="false"
              :resolve-mult-defaults="resolveMultDefaults"
              :turbulence-calculable="turbulenceCalculable"
              :main-agent-element="mainAgentElement"
              embedded
            />
            <p v-else class="pick-hint">请选择预设 / 全局自定义，或「编辑事件」</p>
          </div>
        </div>

        <footer class="mode-footer">
          <button type="button" class="done-btn" @click="close">完成</button>
        </footer>
      </div>

      <div
        v-if="saveDestChoiceOpen"
        class="save-dest-choice-overlay"
        role="presentation"
        @click.self="cancelSaveDestChoice"
      >
        <div
          class="save-dest-choice"
          role="dialog"
          aria-modal="true"
          aria-label="选择事件保存方式"
        >
          <div class="save-dest-choice-title">当前没有已加载的方案</div>
          <p class="save-dest-choice-msg">这些事件要如何保存？可新建或加载方案后再写入，也可改为存入全局自定义。</p>
          <div class="save-dest-choice-btns">
            <button type="button" class="save-dest-choice-cancel" @click="cancelSaveDestChoice">
              取消
            </button>
            <button type="button" class="save-dest-choice-secondary" @click="chooseSaveAsGlobal">
              存为全局自定义
            </button>
            <button type="button" class="save-dest-choice-ok" @click="chooseCreateScheme">
              新建或加载方案
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mode-summary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border-radius: 10px;
  background: #0f1217;
  border: 1px solid #2d323a;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.mode-summary-bar:hover {
  border-color: #c9a55c;
  background: #141820;
}

.mode-summary-main {
  color: #e4e8ef;
  font-weight: 600;
  font-size: 0.88rem;
}

.mode-summary-meta {
  color: #9aa3b0;
  font-weight: 500;
}

.mode-summary-placeholder {
  font-size: 0.84rem;
  color: #9aa3b0;
}

.mode-summary-hint {
  flex-shrink: 0;
  border: 1px solid #343a44;
  border-radius: 8px;
  background: #12161d;
  color: #d5dae4;
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
  pointer-events: none;
  white-space: nowrap;
}

.mode-summary-bar:hover .mode-summary-hint {
  border-color: #c9a55c;
  color: #f0d7a2;
}

.mode-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  padding: 1rem;
}

.mode-modal {
  width: min(960px, 100%);
  max-height: min(88vh, 820px);
  overflow: auto;
  border: 1px solid #2d323a;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.mode-header,
.mode-footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.mode-header h3 {
  margin: 0;
  color: #f0f2f6;
  font-size: 1rem;
}

.mode-header p {
  margin: 0.25rem 0 0;
  color: #9aa3b0;
  font-size: 0.78rem;
}

.close-btn {
  border: none;
  background: transparent;
  color: #9aa3b0;
  font-size: 1.4rem;
  cursor: pointer;
}

.mode-body {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 0.85rem;
  min-height: 320px;
}

.mode-aside {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 220px;
  max-height: min(62vh, 560px);
  min-height: 0;
  border-right: 1px solid #2a2f36;
  padding-right: 0.75rem;
}

.mode-aside-toolbar {
  flex-shrink: 0;
}

.mode-search input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #ebedf0;
  padding: 0.4rem 0.55rem;
  font-size: 0.78rem;
}

.mode-search input::placeholder {
  color: #7f8794;
}

.mode-aside-scroll {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 0;
  flex: 1 1 auto;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 0.1rem;
  overscroll-behavior: contain;
}

.mode-aside h4 {
  margin: 0.35rem 0 0.25rem;
  font-size: 0.78rem;
  color: #9aa3b0;
  font-weight: 600;
}

.aside-section {
  margin-top: 0.85rem !important;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.mode-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #d5dae4;
  padding: 0.45rem 0.55rem;
  font-size: 0.76rem;
  text-align: left;
  cursor: pointer;
  flex-shrink: 0;
}

.mode-item strong {
  font-size: 0.82rem;
  color: #e8edf3;
}

.mode-item span {
  color: #8f96a3;
}

.mode-item.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.12);
}

.mode-item--add {
  border-style: dashed;
  color: #c9a55c;
}

.mode-item--scheme {
  border-color: rgba(96, 165, 250, 0.4);
}

.mode-item--scheme span {
  color: #93c5fd;
}

.aside-empty,
.pick-hint,
.readonly-hint {
  margin: 0;
  font-size: 0.78rem;
  color: #8f96a3;
}

.readonly-hint {
  margin-bottom: 0.55rem;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  border: 1px solid rgba(201, 165, 92, 0.35);
  background: rgba(201, 165, 92, 0.08);
  color: #e0c48a;
}

.name-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: end;
  margin-bottom: 0.65rem;
}

.name-row label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-width: 12rem;
}

.name-row label span {
  font-size: 0.76rem;
  color: #9aa3b0;
}

.name-row input {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #ebedf0;
  padding: 0.4rem 0.55rem;
  font-size: 0.84rem;
}

.name-row input:disabled {
  opacity: 0.65;
}

.name-actions {
  display: flex;
  gap: 0.4rem;
}

.action-btn {
  border: 1px solid #3a424f;
  border-radius: 8px;
  background: #141820;
  color: #d5dae4;
  padding: 0.4rem 0.65rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.action-btn--danger {
  border-color: #5a3434;
  color: #e8a8a8;
}

.mode-message {
  margin: 0;
  width: 100%;
  font-size: 0.76rem;
  color: #9ad0b8;
}

.done-btn {
  margin-left: auto;
  border: 1px solid #c9a55c;
  border-radius: 8px;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
  padding: 0.45rem 1rem;
  font-size: 0.84rem;
  cursor: pointer;
}

@media (max-width: 768px) {
  .mode-body {
    grid-template-columns: 1fr;
  }

  .mode-aside {
    border-right: none;
    border-bottom: 1px solid #2a2f36;
    padding-right: 0;
    padding-bottom: 0.75rem;
    max-height: 280px;
  }
}

.save-dest-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin: 0 0 0.65rem;
}

.action-btn--primary {
  border-color: #c9a55c;
  color: #f0d7a2;
  background: rgba(201, 165, 92, 0.12);
}

.action-btn--scheme {
  border-color: rgba(96, 165, 250, 0.55);
  color: #93c5fd;
  background: rgba(96, 165, 250, 0.1);
}

.save-dest-choice-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}

.save-dest-choice {
  width: min(420px, 100%);
  border: 1px solid #2d323a;
  border-radius: 12px;
  background: linear-gradient(180deg, #1b1f25 0%, #13161b 100%);
  padding: 1rem;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}

.save-dest-choice-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #f0f2f6;
  margin-bottom: 0.5rem;
}

.save-dest-choice-msg {
  margin: 0 0 1rem;
  font-size: 0.84rem;
  line-height: 1.55;
  color: #d5dae4;
}

.save-dest-choice-btns {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.save-dest-choice-cancel,
.save-dest-choice-secondary,
.save-dest-choice-ok {
  border-radius: 8px;
  padding: 0.45rem 0.85rem;
  font-size: 0.84rem;
  cursor: pointer;
}

.save-dest-choice-cancel {
  border: 1px solid #2d323a;
  background: #161a20;
  color: #d5dae4;
}

.save-dest-choice-cancel:hover {
  border-color: #c9a55c;
}

.save-dest-choice-secondary {
  border: 1px solid #3a424f;
  background: #141820;
  color: #d5dae4;
}

.save-dest-choice-secondary:hover {
  border-color: #c9a55c;
}

.save-dest-choice-ok {
  border: 1px solid #3a4a31;
  background: #1a2218;
  color: #d8e8c8;
}

.save-dest-choice-ok:hover {
  border-color: #c9a55c;
  background: #222818;
}
</style>
