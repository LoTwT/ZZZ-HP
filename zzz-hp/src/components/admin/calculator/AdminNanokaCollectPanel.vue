<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  applyNanokaCandidates,
  isNanokaBasicsAuthError,
  previewNanokaCandidates,
  type NanokaApplyEntry,
  type NanokaApplySummary,
  type NanokaCandidateKind,
  type NanokaEntryAction,
  type NanokaFieldStatus,
  type NanokaPreviewEntry,
  type NanokaPreviewField,
  type NanokaPreviewResult,
} from '@/api/nanokaBasics'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import { clearAdminAuthenticated } from '@/utils/adminAuth'
import '@/components/admin/calculator/adminCalculatorPanel.css'

/**
 * nanoka 采集（基础数据）面板。
 *
 * 只做两件事：把本地采集工具产出的候选文档发给后端**预览**（逐字段状态，不写库），
 * 再把人工勾选的条目 / 字段**录入**（写数据库）。不做删除、不联网抓取、不在界面上跑命令。
 */

const router = useRouter()

const STATUS_ORDER: readonly NanokaFieldStatus[] = [
  'insert',
  'fill',
  'conflict',
  'equal',
  'exists',
  'stale',
]

const STATUS_LABELS: Record<NanokaFieldStatus, string> = {
  insert: '可新增',
  fill: '可补写',
  conflict: '需覆盖',
  equal: '已一致',
  exists: '已存在',
  stale: '库值已变',
}

/** 状态人话解释（界面上直接展示，避免只有 status 名看不出该不该勾） */
const STATUS_HINTS: Record<NanokaFieldStatus, string> = {
  insert: '库里没有这个 id，可整条新增',
  fill: '库里该字段为空（0 / 缺失），可补写，不会覆盖已有数值',
  conflict: '库里该字段非空且与 nanoka 不同：默认不勾选，勾选即用 nanoka 值覆盖',
  equal: '与库现值一致，无需动作（不可勾选）',
  exists: '同 id 记录已存在，后端会跳过新增（不可勾选）',
  stale: '库里这个值已经变了（与候选文档里的旧值不符），后端会拒写这一项（不可勾选）',
}

/** 可勾选的状态：equal / exists / stale 都是「不该写或写不进去」 */
const CHECKABLE_STATUSES: readonly NanokaFieldStatus[] = ['insert', 'fill', 'conflict']

/** 默认勾选：覆盖非空值必须人工点，所以 conflict 不在里面 */
const DEFAULT_CHECKED_STATUSES: readonly NanokaFieldStatus[] = ['insert', 'fill']

const ACTION_GROUPS: { action: NanokaEntryAction; title: string; hint: string }[] = [
  {
    action: 'insert',
    title: '新增',
    hint: '库里没有该 id。新增是整条写入（后端按预览里的 payload 建记录），字段勾选用于逐项复核；同 id 已存在的条目后端会跳过。',
  },
  {
    action: 'fill',
    title: '可补空缺',
    hint: '库里该字段为空（0 / 缺失），补写不会覆盖已有数值，默认勾选。',
  },
  {
    action: 'overwrite',
    title: '需覆盖',
    hint: '库里已有非空值且与 nanoka 不同。默认不勾选；勾选即把库现值覆盖成 nanoka 值，请逐条确认后再录。',
  },
]

const KIND_LABELS: Record<NanokaCandidateKind, string> = {
  agent: '角色',
  wengine: '音擎',
}

const ACTION_LABELS: Record<string, string> = {
  insert: '新增',
  fill: '补空缺',
  overwrite: '覆盖',
}

interface FieldRow {
  field: NanokaPreviewField
  /** 勾选键：`条目下标:字段下标`，每次重新解析都会重建 */
  key: string
  checkable: boolean
}

interface EntryRow {
  entry: NanokaPreviewEntry
  index: number
  fields: FieldRow[]
  writableKeys: string[]
}

const fileInputRef = ref<HTMLInputElement | null>(null)
/** 上传区文本框里的原始 JSON（选文件后会回填，便于核对） */
const docText = ref('')
/** 当前预览对应的候选文档来源说明 */
const docLabel = ref('')
/** 当前预览对应的候选文档本身，录入后重新解析用 */
const parsedDoc = ref<unknown>(null)
const preview = ref<NanokaPreviewResult | null>(null)
/** 已勾选的字段键 */
const checkedKeys = ref<string[]>([])

const previewing = ref(false)
const applying = ref(false)
const message = ref('')
const messageKind = ref<'ok' | 'err'>('ok')
const applySummary = ref<NanokaApplySummary | null>(null)
const applyMessage = ref('')

const confirmVisible = ref(false)
const authDialogVisible = ref(false)

const busy = computed(() => previewing.value || applying.value)

function canCheck(field: NanokaPreviewField) {
  return CHECKABLE_STATUSES.includes(field.status)
}

const allEntryRows = computed<EntryRow[]>(() => {
  const data = preview.value
  if (!data) return []
  return data.entries.map((entry, index) => {
    const fields: FieldRow[] = entry.fields.map((field, fieldIndex) => ({
      field,
      key: `${index}:${fieldIndex}`,
      checkable: canCheck(field),
    }))
    return {
      entry,
      index,
      fields,
      writableKeys: fields.filter((item) => item.checkable).map((item) => item.key),
    }
  })
})

const groupedEntries = computed(() =>
  ACTION_GROUPS.map((group) => ({
    ...group,
    rows: allEntryRows.value.filter((row) => row.entry.action === group.action),
  })),
)

const statRows = computed(() => {
  const counts = preview.value?.counts
  if (!counts) return []
  return STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    value: counts[status],
    hint: STATUS_HINTS[status],
  }))
})

const selectedFieldKeys = computed(() => {
  const checkable = new Set(allEntryRows.value.flatMap((row) => row.writableKeys))
  return checkedKeys.value.filter((key) => checkable.has(key))
})

const selectedFieldCount = computed(() => selectedFieldKeys.value.length)

const selectedEntryCount = computed(() =>
  allEntryRows.value.filter((row) => row.writableKeys.some((key) => selectedFieldKeys.value.includes(key)))
    .length,
)

const pendingEntries = computed<NanokaApplyEntry[]>(() => {
  const picked = new Set(selectedFieldKeys.value)
  const entries: NanokaApplyEntry[] = []
  for (const row of allEntryRows.value) {
    const fields = row.fields
      .filter((item) => item.checkable && picked.has(item.key))
      .map((item) => ({
        key: item.field.key,
        nanoka: item.field.nanoka,
        // 乐观锁：库里若已不是预览时的现值，后端会跳过这一项
        expect: item.field.current,
      }))
    if (!fields.length) continue
    entries.push({
      kind: row.entry.kind,
      id: row.entry.id,
      action: row.entry.action,
      // insert 条目必须带 payload：后端按它整条建记录
      ...(row.entry.action === 'insert' ? { payload: row.entry.payload ?? {} } : {}),
      fields,
    })
  }
  return entries
})

const pendingInsertCount = computed(
  () => pendingEntries.value.filter((entry) => entry.action === 'insert').length,
)

const pendingFieldCount = computed(() =>
  pendingEntries.value
    .filter((entry) => entry.action !== 'insert')
    .reduce((sum, entry) => sum + entry.fields.length, 0),
)

const pendingConflictCount = computed(() => {
  const picked = new Set(selectedFieldKeys.value)
  return allEntryRows.value.reduce(
    (sum, row) =>
      sum +
      row.fields.filter((item) => item.checkable && item.field.status === 'conflict' && picked.has(item.key))
        .length,
    0,
  )
})

const confirmMessage = computed(() => {
  const fieldPart = pendingFieldCount.value
    ? `，补写 / 覆盖 ${pendingFieldCount.value} 项字段（其中覆盖非空值 ${pendingConflictCount.value} 项）`
    : ''
  return `将写入数据库：新增 ${pendingInsertCount.value} 条记录${fieldPart}。\n覆盖会改掉库里已有的数值，建议先在「导入 / 导出」面板导出备份。`
})

function fieldTotal(data: NanokaPreviewResult) {
  return data.entries.reduce((sum, entry) => sum + entry.fields.length, 0)
}

function isChecked(key: string) {
  return checkedKeys.value.includes(key)
}

function toggleField(key: string) {
  checkedKeys.value = isChecked(key)
    ? checkedKeys.value.filter((item) => item !== key)
    : [...checkedKeys.value, key]
}

function isEntryChecked(row: EntryRow) {
  return row.writableKeys.length > 0 && row.writableKeys.every((key) => isChecked(key))
}

function toggleEntry(row: EntryRow) {
  if (!row.writableKeys.length) return
  const rest = checkedKeys.value.filter((key) => !row.writableKeys.includes(key))
  checkedKeys.value = isEntryChecked(row) ? rest : [...rest, ...row.writableKeys]
}

/** 勾选默认项：insert + fill（conflict 一律留空，必须人工点） */
function selectDefaultChecks() {
  checkedKeys.value = allEntryRows.value.flatMap((row) =>
    row.fields
      .filter((item) => DEFAULT_CHECKED_STATUSES.includes(item.field.status))
      .map((item) => item.key),
  )
}

function clearChecks() {
  checkedKeys.value = []
}

function kindLabel(kind: NanokaCandidateKind) {
  return KIND_LABELS[kind]
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '空'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function openFilePicker() {
  fileInputRef.value?.click()
}

function parseDocText(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('候选文档是空的：请先选文件或粘贴 JSON')
  let doc: unknown
  try {
    doc = JSON.parse(trimmed.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('不是合法的 JSON，请检查候选文档内容')
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('候选文档必须是 JSON 对象')
  }
  return doc
}

async function runPreview(doc: unknown, label: string, options: { silent?: boolean } = {}) {
  previewing.value = true
  if (!options.silent) {
    message.value = ''
    applySummary.value = null
    applyMessage.value = ''
  }
  try {
    const data = await previewNanokaCandidates(doc)
    preview.value = data
    parsedDoc.value = doc
    docLabel.value = label
    selectDefaultChecks()
    // 静默刷新（录入后）不动 message：那行留给录入结果
    if (!options.silent) {
      messageKind.value = 'ok'
      message.value = `已解析 ${label}（未写库）：${data.entries.length} 条候选，${fieldTotal(data)} 项字段。`
    }
  } catch (err) {
    handleError(err, '解析候选文档失败')
  } finally {
    previewing.value = false
  }
}

async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    docText.value = text
    await runPreview(parseDocText(text), file.name)
  } catch (err) {
    messageKind.value = 'err'
    message.value = err instanceof Error ? err.message : '读取文件失败'
  }
}

async function onParsePasted() {
  try {
    await runPreview(parseDocText(docText.value), '粘贴的 JSON')
  } catch (err) {
    messageKind.value = 'err'
    message.value = err instanceof Error ? err.message : '解析失败'
  }
}

function clearAll() {
  docText.value = ''
  docLabel.value = ''
  parsedDoc.value = null
  preview.value = null
  checkedKeys.value = []
  applySummary.value = null
  applyMessage.value = ''
  message.value = ''
}

function handleError(err: unknown, fallback: string) {
  if (isNanokaBasicsAuthError(err)) {
    authDialogVisible.value = true
    messageKind.value = 'err'
    message.value = '管理员会话无效或已过期，请重新登录后再录入'
    return
  }
  messageKind.value = 'err'
  message.value = err instanceof Error ? err.message : fallback
}

function goRelogin() {
  authDialogVisible.value = false
  clearAdminAuthenticated()
  void router.push({
    path: '/admin/login',
    query: { redirect: router.currentRoute.value.fullPath },
  })
}

function askApply() {
  if (!pendingEntries.value.length) {
    messageKind.value = 'err'
    message.value = '请先勾选要录入的条目 / 字段'
    return
  }
  confirmVisible.value = true
}

function closeConfirm() {
  if (applying.value) return
  confirmVisible.value = false
}

async function confirmApply() {
  const entries = pendingEntries.value
  if (!entries.length) {
    confirmVisible.value = false
    return
  }
  applying.value = true
  try {
    const { summary, message: resultMessage } = await applyNanokaCandidates({ entries })
    applySummary.value = summary
    applyMessage.value = resultMessage
    confirmVisible.value = false
    messageKind.value = summary.failed ? 'err' : 'ok'
    message.value = resultMessage
    // 写库后状态已变（新增 → 已存在）：重新解析一次，让界面回到真实状态
    if (parsedDoc.value !== null) {
      await runPreview(parsedDoc.value, docLabel.value, { silent: true })
    }
  } catch (err) {
    confirmVisible.value = false
    handleError(err, '录入失败')
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <section class="editor-panel nanoka-panel">
    <header class="panel-header">
      <h2 class="panel-title">nanoka 采集（基础数据）</h2>
      <p class="panel-desc">
        把本地采集工具产出的候选文档与库现状比对，逐字段复核后把勾选项写入数据库。
        预览不写库；新增、补空缺、覆盖分别处理，覆盖非空值必须逐条勾选。
      </p>
      <p class="panel-warn">
        录入写的是数据库；仓库 JSON 快照需另行导出同步（<code>npm run export:calculator-buffs</code>，属开发侧操作，界面不执行命令）。
      </p>
    </header>

    <section class="io-card">
      <h3>候选文档</h3>
      <p class="io-hint">
        该文件由本地采集工具（<code>tools/nanoka-scan.mjs</code> + <code>tools/nanoka-candidates.mjs</code>）产出；
        服务端不联网抓取，预览只是拿这份文档和库现状比对。选文件或粘贴 JSON 二选一即可。
      </p>
      <input
        ref="fileInputRef"
        class="hidden-input"
        type="file"
        accept="application/json,.json"
        @change="onFileChosen"
      />
      <div class="io-actions">
        <button type="button" class="secondary-btn" :disabled="busy" @click="openFilePicker">
          选择 JSON 文件
        </button>
        <button
          type="button"
          class="primary-btn"
          :disabled="busy || !docText.trim()"
          @click="onParsePasted"
        >
          {{ previewing ? '解析中...' : '解析粘贴的 JSON' }}
        </button>
        <button
          type="button"
          class="secondary-btn"
          :disabled="busy || (!docText && !preview)"
          @click="clearAll"
        >
          清空
        </button>
      </div>
      <textarea
        v-model="docText"
        class="doc-textarea"
        spellcheck="false"
        placeholder="也可以把候选文档 JSON 直接粘贴到这里，再点「解析粘贴的 JSON」"
      ></textarea>
      <p v-if="docLabel" class="io-hint">当前预览的文档：{{ docLabel }}</p>
      <p v-if="previewing" class="hint-line">正在解析候选文档…（不写库）</p>
    </section>

    <p v-if="message" class="io-message" :class="messageKind">{{ message }}</p>

    <section v-if="preview" class="io-card">
      <h3>预览</h3>
      <p class="io-hint">
        build {{ preview.buildTag || '未知' }} · 生成于 {{ preview.generatedAt || '未知' }} ·
        共 {{ preview.entries.length }} 条候选。字段行显示「库现值 → nanoka 值」。
      </p>

      <div class="stat-grid">
        <div v-for="row in statRows" :key="row.status" class="stat-card">
          <p class="stat-label">{{ row.label }}</p>
          <p class="stat-value">{{ row.value }}</p>
        </div>
      </div>

      <ul class="legend">
        <li v-for="row in statRows" :key="`legend-${row.status}`">
          <strong>{{ row.label }}</strong>：{{ row.hint }}
        </li>
      </ul>

      <div class="picker-toolbar">
        <button type="button" class="secondary-btn compact" :disabled="busy" @click="selectDefaultChecks">
          全选新增 / 补空缺
        </button>
        <button type="button" class="secondary-btn compact" :disabled="busy" @click="clearChecks">
          清空勾选
        </button>
        <span class="current-note">
          已勾选 {{ selectedEntryCount }} 条 / {{ selectedFieldCount }} 项字段；覆盖项默认不勾，需人工点选。
        </span>
      </div>

      <div v-for="group in groupedEntries" :key="group.action" class="entry-group">
        <div class="group-header">
          <h4>
            {{ group.title }}
            <span class="group-count">{{ group.rows.length }}</span>
          </h4>
          <p class="group-hint">{{ group.hint }}</p>
        </div>
        <p v-if="!group.rows.length" class="empty-hint">没有这一类的条目</p>

        <div v-for="row in group.rows" :key="`${row.entry.kind}-${row.index}-${row.entry.id}`" class="entry-row">
          <label class="entry-head">
            <input
              type="checkbox"
              :checked="isEntryChecked(row)"
              :disabled="busy || !row.writableKeys.length"
              @change="toggleEntry(row)"
            />
            <span class="entry-title">{{ row.entry.name || '（无名字）' }}({{ row.entry.id }})</span>
            <span class="entry-tag">{{ kindLabel(row.entry.kind) }}</span>
            <span v-if="row.entry.nanokaId" class="entry-tag">nanoka #{{ row.entry.nanokaId }}</span>
            <span v-if="row.entry.element || row.entry.profession" class="entry-tag">
              {{ [row.entry.element, row.entry.profession].filter(Boolean).join(' · ') }}
            </span>
            <span v-if="row.entry.action === 'insert' && row.entry.exists" class="entry-warn">
             同 id 已存在，后端会跳过新增
            </span>
            <span v-else-if="!row.writableKeys.length" class="entry-warn">没有可写入的字段</span>
          </label>

          <ul class="field-list">
            <li
              v-for="item in row.fields"
              :key="item.key"
              class="field-row"
              :class="`status-${item.field.status}`"
            >
              <input
                type="checkbox"
                :checked="isChecked(item.key)"
                :disabled="busy || !item.checkable"
                :aria-label="`${item.field.label}（${item.field.key}）`"
                @change="toggleField(item.key)"
              />
              <span class="field-label">
                {{ item.field.label }}
                <span class="field-code">{{ item.field.key }}</span>
              </span>
              <span class="field-values">
                <span class="value-current">{{ formatValue(item.field.current) }}</span>
                →
                <span class="value-nanoka">{{ formatValue(item.field.nanoka) }}</span>
              </span>
              <span class="field-status" :class="`status-${item.field.status}`">
                {{ STATUS_LABELS[item.field.status] }}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div class="io-actions">
        <button
          type="button"
          class="primary-btn"
          :disabled="busy || !selectedFieldCount"
          @click="askApply"
        >
          {{ applying ? '录入中...' : `录入勾选内容（${selectedEntryCount} 条）` }}
        </button>
        <span class="io-hint">录入会写数据库；覆盖项只在勾选后写入，库值已变的项后端会跳过并说明。</span>
      </div>
    </section>

    <section v-else class="io-card">
      <p class="empty-hint">
        还没有候选文档：选一个 JSON 文件，或把候选文档粘贴到上面的文本框，再点「解析粘贴的 JSON」。
      </p>
    </section>

    <section v-if="applySummary" class="io-card">
      <h3>录入结果</h3>
      <p class="apply-message" :class="applySummary.failed ? 'err' : 'ok'">{{ applyMessage }}</p>
      <p class="summary-row">
        <span>新增 {{ applySummary.created }}</span>
        <span>更新 {{ applySummary.updated }}</span>
        <span>跳过 {{ applySummary.skipped }}</span>
        <span>失败 {{ applySummary.failed }}</span>
      </p>
      <ul v-if="applySummary.details.length" class="detail-list">
        <li
          v-for="(item, idx) in applySummary.details"
          :key="`${item.kind}-${item.id}-${item.action}-${idx}`"
          class="detail-item"
          :class="item.ok ? 'ok' : 'bad'"
        >
          <span class="detail-head">
            {{ item.name || item.id }}（{{ item.id }} · {{ kindLabel(item.kind) }} ·
            {{ actionLabel(item.action) }}）
          </span>
          <span class="detail-tag">{{ item.ok ? '已写入' : '跳过 / 失败' }}</span>
          <span v-if="item.reason" class="detail-reason">{{ item.reason }}</span>
          <ul v-if="item.applied?.length" class="applied-list">
            <li v-for="applied in item.applied" :key="applied.key">
              {{ applied.key }}：{{
                applied.ok
                  ? `${formatValue(applied.from)} → ${formatValue(applied.to)}`
                  : applied.reason
              }}
            </li>
          </ul>
        </li>
      </ul>
      <p v-else class="empty-hint">后端没有返回逐条明细</p>
    </section>

    <AdminConfirmDialog
      :visible="confirmVisible"
      title="确认录入 nanoka 候选"
      :message="confirmMessage"
      confirm-text="录入"
      :danger="true"
      :loading="applying"
      @confirm="confirmApply"
      @cancel="closeConfirm"
    />
    <AdminConfirmDialog
      :visible="authDialogVisible"
      title="需要重新登录"
      message="当前后台会话无效或已过期，无法预览 / 录入。请重新登录管理员账号后再试。"
      confirm-text="去登录"
      cancel-text="稍后"
      @confirm="goRelogin"
      @cancel="authDialogVisible = false"
    />
  </section>
</template>

<style scoped>
.nanoka-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.panel-warn {
  margin: 0.5rem 0 0;
  font-size: 0.78rem;
  line-height: 1.6;
  color: #e8a838;
}

.panel-warn code,
.io-hint code {
  font-size: 0.92em;
  opacity: 0.95;
}

.doc-textarea {
  width: 100%;
  min-height: 7rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-family: inherit;
  font-size: 0.82rem;
  line-height: 1.45;
  resize: vertical;
  outline: none;
}

.doc-textarea:focus {
  border-color: #e8a838;
}

.hint-line,
.current-note {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text);
  opacity: 0.78;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.stat-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background);
  padding: 0.5rem 0.65rem;
}

.stat-label,
.stat-value {
  margin: 0;
}

.stat-label {
  font-size: 0.76rem;
  color: var(--color-text);
  opacity: 0.75;
}

.stat-value {
  margin-top: 0.15rem;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-heading);
}

.legend {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.78rem;
  line-height: 1.65;
  color: var(--color-text);
  opacity: 0.88;
}

.entry-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.group-header h4 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.95rem;
  color: var(--color-heading);
}

.group-count {
  padding: 0 0.4rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 400;
  color: var(--color-text);
  opacity: 0.85;
}

.group-hint {
  margin: 0.15rem 0 0;
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--color-text);
  opacity: 0.72;
}

.entry-row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
}

.entry-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  cursor: pointer;
}

.entry-title {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-heading);
}

.entry-tag {
  padding: 0.08rem 0.4rem;
  border-radius: 999px;
  background: var(--color-background-mute);
  font-size: 0.72rem;
  color: var(--color-text);
}

.entry-warn {
  font-size: 0.75rem;
  color: #e85d4c;
}

.field-list {
  margin: 0.35rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.field-row {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr) auto auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.25rem 0.45rem;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--color-background);
}

.field-row.status-conflict {
  border-color: color-mix(in srgb, #e8a838 40%, var(--color-border));
}

.field-row.status-stale,
.field-row.status-exists {
  border-color: color-mix(in srgb, #e85d4c 32%, var(--color-border));
}

.field-label {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 0;
  font-size: 0.84rem;
  color: var(--color-heading);
}

.field-code {
  font-size: 0.72rem;
  opacity: 0.55;
}

.field-values {
  font-size: 0.8rem;
  color: var(--color-text);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.value-nanoka {
  font-weight: 600;
  color: var(--color-heading);
}

.field-status {
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.72rem;
  white-space: nowrap;
}

.field-status.status-insert {
  color: hsl(160, 100%, 32%);
  border-color: hsla(160, 100%, 37%, 0.5);
}

.field-status.status-fill {
  color: #3f8fd0;
  border-color: rgba(63, 143, 208, 0.5);
}

.field-status.status-conflict {
  color: #e8a838;
  border-color: rgba(232, 168, 56, 0.5);
}

.field-status.status-equal {
  opacity: 0.6;
}

.field-status.status-stale,
.field-status.status-exists {
  color: #e85d4c;
  border-color: rgba(232, 93, 76, 0.5);
}

.apply-message {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--color-heading);
}

.apply-message.err {
  color: #c94a3c;
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
  margin: 0;
  font-size: 0.82rem;
  color: var(--color-text);
}

.detail-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.detail-item {
  padding: 0.25rem 0 0.25rem 0.55rem;
  border-left: 3px solid var(--color-border);
  font-size: 0.82rem;
  line-height: 1.55;
  color: var(--color-text);
}

.detail-item.ok {
  border-left-color: hsla(160, 100%, 37%, 0.7);
}

.detail-item.bad {
  border-left-color: rgba(232, 93, 76, 0.7);
}

.detail-head {
  color: var(--color-heading);
}

.detail-tag {
  margin-left: 0.4rem;
  font-size: 0.74rem;
  opacity: 0.75;
}

.detail-reason {
  display: block;
  color: #e85d4c;
}

.applied-list {
  margin: 0.2rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.78rem;
}

@media (max-width: 900px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .field-row {
    grid-template-columns: 1.5rem minmax(0, 1fr);
    row-gap: 0.15rem;
  }
}
</style>
