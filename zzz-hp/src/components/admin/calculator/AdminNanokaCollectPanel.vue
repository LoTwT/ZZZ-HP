<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  applyNanokaCandidates,
  applyNanokaSkills,
  collectNanokaBasics,
  collectNanokaSkills,
  isNanokaBasicsAuthError,
  listNanokaSkillGaps,
  previewNanokaCandidates,
  scanNanokaBasics,
  type NanokaApplyEntry,
  type NanokaApplySummary,
  type NanokaCandidateKind,
  type NanokaCollectUnsupported,
  type NanokaEntryAction,
  type NanokaFieldStatus,
  type NanokaPreviewEntry,
  type NanokaPreviewField,
  type NanokaPreviewResult,
  type NanokaScanMissingAgent,
  type NanokaScanMissingWengine,
  type NanokaScanResult,
} from '@/api/nanokaBasics'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import { clearAdminAuthenticated } from '@/utils/adminAuth'
import '@/components/admin/calculator/adminCalculatorPanel.css'

/**
 * nanoka 采集（基础数据）面板。
 *
 * 首选路径：**浏览器直采**——由浏览器的 `fetch` 去 `static.nanoka.cc` 抓索引与详情
 * （浏览器走用户系统代理，服务端抓不可靠，所以后端只负责映射与 diff），
 * 再把结果送进「预览 → 勾选 → 录入」这条既有链路。
 * 备用路径：本地工具产出的候选 JSON，选文件或粘贴（服务器 / 浏览器都抓不到网时用）。
 *
 * 采集只读：抓取与映射都不写库，写库只发生在点「录入勾选内容」之后。
 */

const router = useRouter()

/** nanoka 静态站：响应带 `Access-Control-Allow-Origin: *`，所以浏览器可以直接 fetch */
const NANOKA_STATIC = 'https://static.nanoka.cc'
const INDEX_TIMEOUT_MS = 25000
const DETAIL_TIMEOUT_MS = 20000
/** 抓取失败的统一提示（浏览器 vs 服务端的责任边界要说清楚） */
const NANOKA_NETWORK_HINT =
  '浏览器访问不到 static.nanoka.cc；如果你靠代理上网，请确认代理已开；也可改用下方上传候选 JSON'

/** 单条采集状态：pending 待采 / fetching 抓取中 / done 成功 / failed 失败 / cancelled 已取消 */
type CollectStatus = 'pending' | 'fetching' | 'done' | 'failed' | 'cancelled'

/** 扫描结果里的一行（角色或音擎），带勾选框与采集状态 */
interface ScanPickRow {
  key: string
  kind: NanokaCandidateKind
  nanokaId: string
  label: string
  meta: string
  source: NanokaScanMissingAgent | NanokaScanMissingWengine
  checked: boolean
  status: CollectStatus
  error: string
  entry: Record<string, unknown> | null
  unsupported: NanokaCollectUnsupported[]
}

/**
 * 「③ 招式」列表里的一行：一个还没有 nanoka 招式的**本地**角色。
 *
 * `nanokaId` 不在后端返回里（`/agent-skill-gaps` 是纯本地查询，后端不联网），
 * 由浏览器抓 `character.json` 后按 `code` / 中文名归一化匹配填上。
 */
interface SkillGapRow {
  key: string
  agentId: string
  name: string
  element: string
  profession: string
  skillCount: number
  nanokaSkillCount: number
  nanokaId: string
  meta: Record<string, unknown> | null
  checked: boolean
  status: CollectStatus
  error: string
  /** 结果行（例：「新建 18 / 覆盖 0 / 跳过 0」） */
  result: string
  created: number
  updated: number
  skipped: number
}

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

// ---- 浏览器直采：扫描 / 采集状态 ----
const scanning = ref(false)
const collecting = ref(false)
const collectCancelled = ref(false)
/** 扫描用的 build tag（从 manifest.json 的 zzz.latest 拿，拼 URL 时按原样，不要 encode） */
const scanTag = ref('')
const scanElapsed = ref(0)
const scanResult = ref<NanokaScanResult | null>(null)
const scanRows = ref<ScanPickRow[]>([])
/** 采集进度 / 结束语（例：「已采 3/8：克拉蕾 ✓」） */
const collectNote = ref('')
/** 扫描失败的原因（网络 / 超时），就在采集区里显示，不跑到下面去 */
const scanError = ref('')
/** 被后端丢弃、写不进库的项（如 basePanel 没有的 impact） */
const unsupportedNotes = ref<string[]>([])
/** 正在进行的详情请求，取消时 abort（不参与渲染，所以用普通变量） */
let collectController: AbortController | null = null

// ---- ③ 招式（技能倍率）一键录入 ----
const listingSkillGaps = ref(false)
const collectingSkills = ref(false)
const skillCancelled = ref(false)
const skillGapsLoaded = ref(false)
const skillRows = ref<SkillGapRow[]>([])
/** 招式的 nanoka 索引（character.json）：本地角色 id → nanokaId 靠它匹配 */
const skillIndexTag = ref('')
const skillIndexReady = ref(false)
/** 进度 / 结束语（例：「已处理 2/5：正在抓 赛维里安…」） */
const skillNote = ref('')
/** ③ 段自己的错误行（不跟 ①② 共用 message，免得互相冲掉） */
const skillError = ref('')
const skillSummary = ref('')
/** 「先预览（不写入）」：默认**不勾** = 直接录入（招式名与倍率是确定值） */
const skillPreviewOnly = ref(false)
/** character.json 原文（只留在内存里，用于把本地角色对上 nanokaId） */
let skillIndex: Record<string, { code?: string; zh?: string }> | null = null
/** 正在进行的招式采集，取消时 abort */
let skillController: AbortController | null = null

const busy = computed(
  () =>
    previewing.value ||
    applying.value ||
    scanning.value ||
    collecting.value ||
    listingSkillGaps.value ||
    collectingSkills.value,
)

const checkedSkillRows = computed(() => skillRows.value.filter((row) => row.checked))
const checkedSkillCount = computed(() => checkedSkillRows.value.length)
const skillDoneCount = computed(
  () => checkedSkillRows.value.filter((row) => row.status === 'done').length,
)
const skillFailedCount = computed(
  () => checkedSkillRows.value.filter((row) => row.status === 'failed').length,
)

const checkedScanRows = computed(() => scanRows.value.filter((row) => row.checked))
const checkedScanCount = computed(() => checkedScanRows.value.length)
const collectTotal = computed(() => checkedScanRows.value.length)
const collectDoneCount = computed(
  () => checkedScanRows.value.filter((row) => row.status === 'done').length,
)
const collectFailedCount = computed(
  () => checkedScanRows.value.filter((row) => row.status === 'failed').length,
)
const scanLocalExtra = computed(() => {
  const result = scanResult.value
  if (!result) return []
  return [
    ...result.extraLocalAgents.map((item) => ({ ...item, kindLabel: '角色' })),
    ...result.extraLocalWengines.map((item) => ({ ...item, kindLabel: '音擎' })),
  ]
})

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

// ---------------------------------------------------------------- 浏览器直采

/** buildTag 里的 `+` 必须**按原样**拼进 URL，所以这里只做字符串拼接，不做 encodeURIComponent */
function nanokaUrl(path: string) {
  return `${NANOKA_STATIC}${path}`
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return '请求超时或被取消'
    return err.message
  }
  return String(err)
}

/**
 * 浏览器直连 nanoka 抓文本。
 * `external` 是采集任务的取消信号；超时用内部 controller 叠加（避免依赖 AbortSignal.any）。
 */
async function fetchNanokaText(
  url: string,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<string> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const onExternalAbort = () => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    window.clearTimeout(timer)
    external?.removeEventListener('abort', onExternalAbort)
  }
}

async function fetchNanokaJson(
  url: string,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<unknown> {
  const text = await fetchNanokaText(url, timeoutMs, external)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${url} 返回的不是合法 JSON`)
  }
}

/** manifest.json → zzz.latest */
function readBuildTag(manifest: unknown): string {
  if (!manifest || typeof manifest !== 'object') return ''
  const zzz = (manifest as { zzz?: unknown }).zzz
  if (!zzz || typeof zzz !== 'object') return ''
  const latest = (zzz as { latest?: unknown }).latest
  return typeof latest === 'string' ? latest : ''
}

function buildScanRows(result: NanokaScanResult): ScanPickRow[] {
  const rows: ScanPickRow[] = []
  for (const item of result.missingAgents) {
    const traits = [item.element, item.profession].filter(Boolean).join(' / ')
    rows.push({
      key: `agent:${item.nanokaId}`,
      kind: 'agent',
      nanokaId: item.nanokaId,
      label: item.zh || item.code || item.nanokaId,
      meta: `${item.code || '（索引缺 code）'} · ${traits || '职业待定'}${
        item.rarity ? ` · ${item.rarity}★` : ''
      }`,
      source: item,
      checked: true,
      status: 'pending',
      error: '',
      entry: null,
      unsupported: [],
    })
  }
  for (const item of result.missingWengines) {
    rows.push({
      key: `wengine:${item.nanokaId}`,
      kind: 'wengine',
      nanokaId: item.nanokaId,
      label: item.zh || item.en || item.nanokaId,
      meta: `${item.en || '（索引缺 en）'} · ${item.rank ? `${item.rank}★` : '稀有度待定'} · 副属性 ${
        item.sub || '未知'
      }`,
      source: item,
      checked: true,
      status: 'pending',
      error: '',
      entry: null,
      unsupported: [],
    })
  }
  return rows
}

function toggleScanRow(row: ScanPickRow) {
  row.checked = !row.checked
}

function setAllScanChecked(checked: boolean) {
  for (const row of scanRows.value) row.checked = checked
}

function clearScanRows() {
  scanResult.value = null
  scanRows.value = []
  collectNote.value = ''
  scanError.value = ''
  unsupportedNotes.value = []
}

/** ① 扫描缺失：浏览器抓索引 → 后端比对（不写库） */
async function runScan() {
  if (scanning.value || collecting.value) return
  scanning.value = true
  scanResult.value = null
  scanRows.value = []
  collectNote.value = ''
  scanError.value = ''
  unsupportedNotes.value = []
  const startedAt = Date.now()
  try {
    const manifest = await fetchNanokaJson(nanokaUrl('/manifest.json'), INDEX_TIMEOUT_MS)
    const tag = readBuildTag(manifest)
    if (!tag) throw new Error('manifest.json 里没有 zzz.latest，拿不到 build tag')
    scanTag.value = tag
    const [charIndex, weaponIndex] = await Promise.all([
      fetchNanokaJson(nanokaUrl(`/zzz/${tag}/character.json`), INDEX_TIMEOUT_MS),
      fetchNanokaJson(nanokaUrl(`/zzz/${tag}/weapon.json`), INDEX_TIMEOUT_MS),
    ])
    const result = await scanNanokaBasics({ buildTag: tag, charIndex, weaponIndex })
    scanElapsed.value = Date.now() - startedAt
    scanResult.value = result
    scanRows.value = buildScanRows(result)
    messageKind.value = 'ok'
    message.value = `扫描完成（build ${tag}）：缺失角色 ${result.counts.missingAgents}、缺失音擎 ${result.counts.missingWengines}；本地多出角色 ${result.counts.extraLocalAgents}、音擎 ${result.counts.extraLocalWengines}。`
  } catch (err) {
    if (isNanokaBasicsAuthError(err)) {
      handleError(err, '扫描失败')
      return
    }
    scanError.value = `${NANOKA_NETWORK_HINT}（${describeError(err)}）`
  } finally {
    scanning.value = false
  }
}

/** 采完（或取消 / 部分失败）后：把 entry 拼成候选文档，直接进既有预览流程 */
async function pushCollectedToPreview() {
  const agents: Record<string, unknown>[] = []
  const wengines: Record<string, unknown>[] = []
  for (const row of scanRows.value) {
    if (row.status !== 'done' || !row.entry) continue
    if (row.kind === 'agent') agents.push(row.entry)
    else wengines.push(row.entry)
  }
  if (!agents.length && !wengines.length) {
    messageKind.value = 'err'
    message.value = collectFailedCount.value
      ? `没有采到任何条目（失败 ${collectFailedCount.value} 个，可点行内「重试」）`
      : '没有采到任何条目'
    return
  }
  const doc = {
    buildTag: scanTag.value,
    generatedAt: new Date().toISOString(),
    source: '浏览器直采 static.nanoka.cc',
    newAgents: agents,
    newWengines: wengines,
  }
  await runPreview(
    doc,
    `浏览器采集 build ${scanTag.value}（角色 ${agents.length} / 音擎 ${wengines.length}）`,
  )
  if (collectFailedCount.value) {
    messageKind.value = 'err'
    message.value = `采集完成但有 ${collectFailedCount.value} 个失败（可点行内「重试」）；已把采到的 ${agents.length + wengines.length} 条送进预览。`
  }
}

function updateCollectNote(current: ScanPickRow | null) {
  const head = `已采 ${collectDoneCount.value}/${collectTotal.value}`
  if (current && current.status === 'fetching') {
    collectNote.value = `${head}：正在抓 ${current.label}…`
    return
  }
  if (current) {
    collectNote.value = `${head}：${current.label} ${current.status === 'done' ? '✓' : '✗'}`
    return
  }
  collectNote.value = head
}

/** 抓单条详情 → 交给后端映射（不写库）。串行调用，别打爆对方站点。 */
async function collectRow(row: ScanPickRow, signal: AbortSignal) {
  row.status = 'fetching'
  row.error = ''
  updateCollectNote(row)
  const kindPath = row.kind === 'agent' ? 'character' : 'weapon'
  const url = nanokaUrl(`/zzz/${scanTag.value}/zh/${kindPath}/${row.nanokaId}.json`)
  try {
    const detail = await fetchNanokaJson(url, DETAIL_TIMEOUT_MS, signal)
    const { entry, unsupported } = await collectNanokaBasics({
      kind: row.kind,
      nanokaId: row.nanokaId,
      meta: row.source,
      detail,
    })
    row.entry = entry
    row.unsupported = unsupported
    row.status = 'done'
    const notes = unsupported.map(
      (item) =>
        `${row.label}（${row.kind === 'agent' ? '角色' : '音擎'}）：${item.name} —— ${item.reason}`,
    )
    if (notes.length) unsupportedNotes.value = [...unsupportedNotes.value, ...notes]
  } catch (err) {
    if (isNanokaBasicsAuthError(err)) {
      row.status = 'failed'
      row.error = '管理员会话失效'
      collectCancelled.value = true
      handleError(err, '采集失败')
    } else if (collectCancelled.value) {
      row.status = 'cancelled'
      row.error = '已取消'
    } else {
      // 单条失败不中断整轮：留着这一行给「重试」
      row.status = 'failed'
      row.error = `${describeError(err)}（${url}）`
    }
  }
  updateCollectNote(row)
}

/** ② 采集所选：串行抓详情，中途可取消（已采到的部分照样能预览） */
async function startCollect() {
  if (scanning.value || collecting.value) return
  const targets = checkedScanRows.value
  if (!targets.length) {
    messageKind.value = 'err'
    message.value = '请先勾选要采集的条目'
    return
  }
  for (const row of targets) {
    row.status = 'pending'
    row.error = ''
    row.entry = null
    row.unsupported = []
  }
  collecting.value = true
  collectCancelled.value = false
  unsupportedNotes.value = []
  updateCollectNote(null)
  const controller = new AbortController()
  collectController = controller
  try {
    for (const row of targets) {
      if (collectCancelled.value || controller.signal.aborted) {
        for (const rest of targets) if (rest.status === 'pending') rest.status = 'cancelled'
        break
      }
      await collectRow(row, controller.signal)
    }
  } finally {
    collecting.value = false
    collectController = null
  }
  await pushCollectedToPreview()
}

function cancelCollect() {
  if (!collecting.value) return
  collectCancelled.value = true
  collectController?.abort()
  collectNote.value = '正在停止…（已采到的条目仍会进预览）'
}

/** 单条重试（不重跑整轮） */
async function retryRow(row: ScanPickRow) {
  if (scanning.value || collecting.value) return
  collecting.value = true
  collectCancelled.value = false
  const controller = new AbortController()
  collectController = controller
  try {
    await collectRow(row, controller.signal)
  } finally {
    collecting.value = false
    collectController = null
  }
  await pushCollectedToPreview()
}

// ---------------------------------------------------------------- ③ 招式（技能倍率）

/**
 * 与后端 `nanokaBasicsMapper.normalizeName` 同口径：去「」/空白/`·`/`:`/`：` 并转小写。
 * 本地角色 id ↔ nanoka 索引 `code` / `zh` 就靠它对齐（`Soldier 11` → `soldier11`）。
 */
function normName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[「」\s·:：]/g, '')
    .toLowerCase()
}

/** 拉 nanoka 角色索引（manifest.json → character.json）；已拉过就直接复用 */
async function ensureSkillIndex() {
  if (skillIndexReady.value && skillIndex) return
  const manifest = await fetchNanokaJson(nanokaUrl('/manifest.json'), INDEX_TIMEOUT_MS)
  const tag = readBuildTag(manifest)
  if (!tag) throw new Error('manifest.json 里没有 zzz.latest，拿不到 build tag')
  const index = await fetchNanokaJson(nanokaUrl(`/zzz/${tag}/character.json`), INDEX_TIMEOUT_MS)
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    throw new Error('character.json 不是对象，拿不到角色索引')
  }
  skillIndex = index as Record<string, { code?: string; zh?: string }>
  skillIndexTag.value = tag
  skillIndexReady.value = true
}

/** 本地角色 → nanoka 索引项（先对 `code`，再对中文名；对不上返回 null，不猜） */
function resolveSkillNanokaId(row: SkillGapRow) {
  const index = skillIndex
  if (!index) return null
  const wantId = normName(row.agentId)
  const wantName = normName(row.name)
  const entries = Object.entries(index)
  for (const [nanokaId, meta] of entries) {
    const code = normName(meta?.code)
    if (wantId && code && code === wantId) return { nanokaId, meta }
  }
  for (const [nanokaId, meta] of entries) {
    const zh = normName(meta?.zh)
    if (wantName && zh && zh === wantName) return { nanokaId, meta }
  }
  return null
}

function toggleSkillRow(row: SkillGapRow) {
  row.checked = !row.checked
}

function setAllSkillChecked(checked: boolean) {
  for (const row of skillRows.value) row.checked = checked
}

function skillStatusText(row: SkillGapRow) {
  if (row.status === 'fetching') return '抓取中…'
  if (row.status === 'done') return skillPreviewOnly.value ? '已预览 ✓' : '已录入 ✓'
  if (row.status === 'cancelled') return '已取消'
  if (row.status === 'failed') return '失败'
  return '待采'
}

function updateSkillNote(current: SkillGapRow | null) {
  const head = `已处理 ${skillDoneCount.value}/${checkedSkillCount.value}`
  if (current && current.status === 'fetching') {
    skillNote.value = `${head}：正在抓 ${current.name}…`
    return
  }
  if (current) {
    skillNote.value = `${head}：${current.name} ${current.status === 'done' ? '✓' : '✗'}`
    return
  }
  skillNote.value = head
}

/**
 * ③-1 列出缺招式的角色：**纯本地**查询（很快），再顺手抓一次 nanoka 索引把 nanokaId 对上
 * （抓不到不影响列表，点「采集并录入」时还会再试）。
 */
async function runListSkillGaps() {
  if (busy.value) return
  listingSkillGaps.value = true
  skillRows.value = []
  skillNote.value = ''
  skillError.value = ''
  skillSummary.value = ''
  skillGapsLoaded.value = false
  try {
    const gaps = await listNanokaSkillGaps()
    skillRows.value = gaps.map((gap) => ({
      key: `skill:${gap.id}`,
      agentId: gap.id,
      name: gap.name,
      element: gap.element,
      profession: gap.profession,
      skillCount: gap.skillCount,
      nanokaSkillCount: gap.nanokaSkillCount,
      nanokaId: '',
      meta: null,
      // 默认勾选「一条 nanoka 招式都没有」的；条数偏少的由人工判断后再勾
      checked: gap.nanokaSkillCount === 0,
      status: 'pending',
      error: '',
      result: '',
      created: 0,
      updated: 0,
      skipped: 0,
    }))
    skillGapsLoaded.value = true
    messageKind.value = 'ok'
    message.value = `本地共 ${gaps.length} 个角色没有 nanoka 招式（已默认勾选 nanoka 招式 = 0 条的）。`
    if (!gaps.length) return
    try {
      await ensureSkillIndex()
      let resolved = 0
      for (const row of skillRows.value) {
        const hit = resolveSkillNanokaId(row)
        if (!hit) continue
        row.nanokaId = hit.nanokaId
        row.meta = hit.meta as Record<string, unknown>
        resolved += 1
      }
      skillNote.value = `已对上 nanoka 索引（build ${skillIndexTag.value}）：${resolved}/${skillRows.value.length} 个角色拿到 nanokaId`
    } catch (err) {
      if (isNanokaBasicsAuthError(err)) {
        handleError(err, '招式采集失败')
        return
      }
      skillError.value = `${NANOKA_NETWORK_HINT}（${describeError(err)}）—— 列表已列出，点「采集并录入」时会再试一次抓索引`
    }
  } catch (err) {
    if (isNanokaBasicsAuthError(err)) {
      handleError(err, '列出缺招式角色失败')
      return
    }
    skillError.value = describeError(err)
  } finally {
    listingSkillGaps.value = false
  }
}

/** 抓一个角色的详情 → 直接录入（或按开关只预览）。**串行**调用，别打爆对方站点。 */
async function collectSkillRow(row: SkillGapRow, signal: AbortSignal) {
  row.status = 'fetching'
  row.error = ''
  row.result = ''
  row.created = 0
  row.updated = 0
  row.skipped = 0
  updateSkillNote(row)
  try {
    if (!skillIndexReady.value) await ensureSkillIndex()
    if (!row.nanokaId) {
      const hit = resolveSkillNanokaId(row)
      if (hit) {
        row.nanokaId = hit.nanokaId
        row.meta = hit.meta as Record<string, unknown>
      }
    }
    if (!row.nanokaId) throw new Error('nanoka 索引里没有这个角色（code / 中文名都没对上）')
    const url = nanokaUrl(`/zzz/${skillIndexTag.value}/zh/character/${row.nanokaId}.json`)
    const detail = await fetchNanokaJson(url, DETAIL_TIMEOUT_MS, signal)
    const payload = { nanokaId: row.nanokaId, meta: row.meta, detail }
    if (skillPreviewOnly.value) {
      const { result } = await collectNanokaSkills(payload)
      row.result = `将新建 ${result.plan.create.length} / 覆盖倍率 ${result.plan.overwrite.length} / 已一致 ${result.plan.skipSame.length}（未写入）`
      row.status = 'done'
    } else {
      const { result } = await applyNanokaSkills(payload)
      row.created = result.created
      row.updated = result.updated
      row.skipped = result.skipped
      row.result = `新建 ${result.created} / 覆盖 ${result.updated} / 跳过 ${result.skipped}`
      // 部分失败时留住失败原因，并让这一行可以单独重试
      const bad = result.details.filter((item) => !item.ok)
      row.status = bad.length ? 'failed' : 'done'
      if (bad.length) {
        row.error = bad
          .map((item) => `${item.name}：${item.reason ?? '写入失败'}`)
          .join('；')
      }
    }
  } catch (err) {
    if (isNanokaBasicsAuthError(err)) {
      row.status = 'failed'
      row.error = '管理员会话失效'
      skillCancelled.value = true
      handleError(err, '招式采集失败')
    } else if (skillCancelled.value) {
      row.status = 'cancelled'
      row.error = '已取消'
    } else {
      row.status = 'failed'
      row.error = describeError(err)
    }
  }
  updateSkillNote(row)
}

function finishSkillSummary() {
  const handled = checkedSkillRows.value.filter((row) => row.status === 'done' || row.result)
  const created = handled.reduce((sum, row) => sum + row.created, 0)
  const updated = handled.reduce((sum, row) => sum + row.updated, 0)
  const skipped = handled.reduce((sum, row) => sum + row.skipped, 0)
  const failed = skillFailedCount.value
  if (skillPreviewOnly.value) {
    skillSummary.value = `预览完成（未写入）：${handled.length} 个角色`
  } else if (created || updated || skipped || failed) {
    skillSummary.value = `合计：新建 ${created} / 覆盖 ${updated} / 跳过 ${skipped}${failed ? ` · 失败 ${failed} 个角色` : ''}`
  } else {
    skillSummary.value = ''
  }
  if (skillCancelled.value) {
    skillNote.value = `${skillNote.value}（已取消，已完成的结果保留）`
  }
}

/** ③-2 采集并录入（或按开关只预览）：串行抓详情，中途可取消（已完成的保留结果） */
async function startSkillCollect() {
  if (busy.value) return
  const targets = checkedSkillRows.value
  if (!targets.length) {
    messageKind.value = 'err'
    message.value = '请先勾选要录入招式的角色'
    return
  }
  for (const row of targets) {
    row.status = 'pending'
    row.error = ''
    row.result = ''
    row.created = 0
    row.updated = 0
    row.skipped = 0
  }
  collectingSkills.value = true
  skillCancelled.value = false
  skillSummary.value = ''
  skillError.value = ''
  updateSkillNote(null)
  const controller = new AbortController()
  skillController = controller
  try {
    for (const row of targets) {
      if (skillCancelled.value || controller.signal.aborted) {
        for (const rest of targets) if (rest.status === 'pending') rest.status = 'cancelled'
        break
      }
      await collectSkillRow(row, controller.signal)
    }
  } finally {
    collectingSkills.value = false
    skillController = null
  }
  finishSkillSummary()
}

function cancelSkillCollect() {
  if (!collectingSkills.value) return
  skillCancelled.value = true
  skillController?.abort()
  skillNote.value = '正在停止…（已完成的角色仍保留结果）'
}

/** 单行重试（不重跑整轮） */
async function retrySkillRow(row: SkillGapRow) {
  if (busy.value) return
  collectingSkills.value = true
  skillCancelled.value = false
  const controller = new AbortController()
  skillController = controller
  try {
    await collectSkillRow(row, controller.signal)
  } finally {
    collectingSkills.value = false
    skillController = null
  }
  finishSkillSummary()
}
</script>

<template>
  <section class="editor-panel nanoka-panel">
    <header class="panel-header">
      <h2 class="panel-title">nanoka 采集（基础数据）</h2>
      <p class="panel-desc">
        首选「浏览器直采」：由你的浏览器去 static.nanoka.cc 抓索引与详情，后端只做映射与与库比对，
        再逐字段复核后把勾选项写入数据库。预览不写库；新增、补空缺、覆盖分别处理，覆盖非空值必须逐条勾选。
      </p>
      <p class="panel-warn">
        录入写的是数据库；仓库 JSON 快照需另行导出同步（<code>npm run export:calculator-buffs</code>，属开发侧操作，界面不执行命令）。
      </p>
    </header>

    <section class="io-card collect-card">
      <h3>从 nanoka 采集</h3>
      <p class="io-hint">
        这一步是<strong>你的浏览器</strong>在访问 <code>static.nanoka.cc</code>（走你系统的网络 / 代理），
        <strong>服务端不联网</strong>：后端只负责「算映射 + 与库 diff + 按勾选写入」。
        采集只读，不会写库；写库只在你点「录入勾选内容」后发生。
      </p>

      <div class="io-actions">
        <button type="button" class="primary-btn" :disabled="busy" @click="runScan">
          {{ scanning ? '扫描中...' : '① 扫描缺失' }}
        </button>
        <button
          type="button"
          class="secondary-btn"
          :disabled="busy || !checkedScanCount"
          @click="startCollect"
        >
          {{ collecting ? '采集中...' : `② 采集所选（${checkedScanCount}）` }}
        </button>
        <button type="button" class="secondary-btn" :disabled="!collecting" @click="cancelCollect">
          取消采集
        </button>
        <button
          type="button"
          class="secondary-btn"
          :disabled="busy || !scanRows.length"
          @click="setAllScanChecked(true)"
        >
          全选
        </button>
        <button
          type="button"
          class="secondary-btn"
          :disabled="busy || !scanRows.length"
          @click="setAllScanChecked(false)"
        >
          全不选
        </button>
        <button
          type="button"
          class="secondary-btn"
          :disabled="busy || !scanRows.length"
          @click="clearScanRows"
        >
          清空扫描结果
        </button>
      </div>

      <p v-if="scanError" class="io-message err">{{ scanError }}</p>
      <p v-if="scanResult" class="io-hint">
        build {{ scanTag || '未知' }} · 抓取用时 {{ scanElapsed }} ms · 缺失角色
        {{ scanResult.counts.missingAgents }} / 缺失音擎 {{ scanResult.counts.missingWengines }} · 本地多出角色
        {{ scanResult.counts.extraLocalAgents }} / 音擎 {{ scanResult.counts.extraLocalWengines }}（只提示）
      </p>
      <p v-if="collectNote" class="hint-line">{{ collectNote }}</p>
      <p v-if="collecting" class="hint-line">
        串行抓取中（一次只抓一条，避免打爆对方站点）；点「取消采集」后已采到的部分仍会进预览。
      </p>
      <p v-if="scanning" class="hint-line">
        正在抓 nanoka 索引（manifest.json → character.json / weapon.json）…
      </p>

      <ul v-if="scanRows.length" class="collect-list">
        <li
          v-for="row in scanRows"
          :key="row.key"
          class="collect-row"
          :class="`collect-${row.status}`"
        >
          <label class="collect-head">
            <input
              type="checkbox"
              :checked="row.checked"
              :disabled="busy"
              :aria-label="row.label"
              @change="toggleScanRow(row)"
            />
            <span class="collect-title">{{ row.label }}</span>
            <span class="entry-tag">{{ kindLabel(row.kind) }}</span>
            <span class="entry-tag">nanoka #{{ row.nanokaId }}</span>
            <span class="collect-meta">{{ row.meta }}</span>
          </label>
          <span class="collect-status" :class="`collect-${row.status}`">
            {{
              row.status === 'pending'
                ? '待采'
                : row.status === 'fetching'
                  ? '抓取中…'
                  : row.status === 'done'
                    ? '已采 ✓'
                    : row.status === 'cancelled'
                      ? '已取消'
                      : '失败'
            }}
          </span>
          <button
            v-if="row.status === 'failed'"
            type="button"
            class="secondary-btn compact"
            :disabled="busy"
            @click="retryRow(row)"
          >
            重试
          </button>
          <span v-if="row.error" class="collect-error">{{ row.error }}</span>
        </li>
      </ul>
      <p v-else-if="scanResult" class="empty-hint">
        本地主数据没有缺口：nanoka 索引里的角色 / 音擎都已收录。
      </p>

      <div v-if="scanLocalExtra.length" class="collect-extra">
        <p class="io-hint">本地有、nanoka 索引里没有（只提示，不自动处理）：</p>
        <ul class="legend">
          <li v-for="item in scanLocalExtra" :key="`${item.kindLabel}-${item.id}`">
            {{ item.name }}（{{ item.id }} · {{ item.kindLabel }}）
          </li>
        </ul>
      </div>

      <div v-if="unsupportedNotes.length" class="collect-unsupported">
        <p class="io-hint">以下项仓库没有对应字段，已被丢弃（未写库）：</p>
        <ul class="legend">
          <li v-for="note in unsupportedNotes" :key="note">{{ note }}</li>
        </ul>
      </div>

      <div class="skill-block">
        <h4 class="skill-title">③ 招式（技能倍率）</h4>
        <p class="io-hint">
          招式的<strong>名称与倍率是确定值</strong>（照搬 nanoka 的「伤害倍率」段，按技能 12
          级换算），所以这一段<strong>不需要逐字段复核</strong>：勾上角色直接录入即可。
          「采集并录入」= 浏览器抓 <code>zh/character/&lt;nanokaId&gt;.json</code> → 后端算计划 →
          <strong>直接写库</strong>；<strong>覆盖只改倍率字段</strong>（<code>multSource /
          damagePercentage / damagePercentageGrowth / baseMult</code>），不会动元素 / 技能类型 /
          伤害锚点 / 备注 / 结算倍率。招式小类仍由人工按需建，这里不新建。
        </p>
        <div class="io-actions">
          <button type="button" class="primary-btn" :disabled="busy" @click="runListSkillGaps">
            {{ listingSkillGaps ? '查询中...' : '③ 列出缺招式的角色' }}
          </button>
          <button
            type="button"
            class="primary-btn"
            :disabled="busy || !checkedSkillCount"
            @click="startSkillCollect"
          >
            {{
              collectingSkills
                ? '采集中...'
                : `${skillPreviewOnly ? '采集并预览' : '采集并录入'}（${checkedSkillCount}）`
            }}
          </button>
          <button
            type="button"
            class="secondary-btn"
            :disabled="!collectingSkills"
            @click="cancelSkillCollect"
          >
            取消
          </button>
          <label class="skill-toggle">
            <input v-model="skillPreviewOnly" type="checkbox" :disabled="busy" />
            先预览（不写入）
          </label>
          <button
            type="button"
            class="secondary-btn"
            :disabled="busy || !skillRows.length"
            @click="setAllSkillChecked(true)"
          >
            全选
          </button>
          <button
            type="button"
            class="secondary-btn"
            :disabled="busy || !skillRows.length"
            @click="setAllSkillChecked(false)"
          >
            全不选
          </button>
        </div>

        <p v-if="skillError" class="io-message err">{{ skillError }}</p>
        <p v-if="skillNote" class="hint-line">{{ skillNote }}</p>
        <p v-if="collectingSkills" class="hint-line">
          串行抓取中（一次只抓一个角色，避免打爆对方站点）；点「取消」后已完成的角色仍保留结果。
        </p>
        <p v-if="skillSummary" class="skill-summary">{{ skillSummary }}</p>

        <ul v-if="skillRows.length" class="collect-list">
          <li
            v-for="row in skillRows"
            :key="row.key"
            class="collect-row"
            :class="`collect-${row.status}`"
          >
            <label class="collect-head">
              <input
                type="checkbox"
                :checked="row.checked"
                :disabled="busy"
                :aria-label="row.name"
                @change="toggleSkillRow(row)"
              />
              <span class="collect-title">{{ row.name }}（{{ row.agentId }}）</span>
              <span v-if="row.nanokaId" class="entry-tag">nanoka #{{ row.nanokaId }}</span>
              <span v-if="row.element || row.profession" class="entry-tag">
                {{ [row.element, row.profession].filter(Boolean).join(' · ') }}
              </span>
              <span class="collect-meta">
                现有招式 {{ row.skillCount }} 条 · nanoka 招式 {{ row.nanokaSkillCount }} 条
              </span>
            </label>
            <span class="collect-status" :class="`collect-${row.status}`">
              {{ skillStatusText(row) }}
            </span>
            <button
              v-if="row.status === 'failed'"
              type="button"
              class="secondary-btn compact"
              :disabled="busy"
              @click="retrySkillRow(row)"
            >
              重试
            </button>
            <span v-if="row.result" class="skill-result">{{ row.name }}：{{ row.result }}</span>
            <span v-if="row.error" class="collect-error">{{ row.error }}</span>
          </li>
        </ul>
        <p v-else-if="skillGapsLoaded" class="empty-hint">
          本地所有角色都已有 nanoka 招式，没有缺口。
        </p>
      </div>
    </section>

    <section class="io-card">
      <h3>候选文档（备用：服务器 / 浏览器都抓不到网时用）</h3>
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
        还没有候选文档：可以先点上面的「① 扫描缺失」→「② 采集所选」，让浏览器直接把 nanoka 的数据抓下来；
        也可以选一个 JSON 文件，或把候选文档粘贴到上面的文本框，再点「解析粘贴的 JSON」。
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

/* ---- 浏览器直采 ---- */

.collect-card {
  border-color: color-mix(in srgb, #e8a838 34%, var(--color-border));
}

.collect-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.collect-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
}

.collect-row.collect-done {
  border-color: hsla(160, 100%, 37%, 0.5);
}

.collect-row.collect-failed {
  border-color: rgba(232, 93, 76, 0.5);
}

.collect-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  cursor: pointer;
}

.collect-title {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--color-heading);
}

.collect-meta {
  font-size: 0.75rem;
  color: var(--color-text);
  opacity: 0.78;
}

.collect-status {
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.72rem;
  white-space: nowrap;
  color: var(--color-text);
}

.collect-status.collect-done {
  color: hsl(160, 100%, 32%);
  border-color: hsla(160, 100%, 37%, 0.5);
}

.collect-status.collect-failed {
  color: #e85d4c;
  border-color: rgba(232, 93, 76, 0.5);
}

.collect-status.collect-fetching {
  color: #3f8fd0;
  border-color: rgba(63, 143, 208, 0.5);
}

.collect-error {
  grid-column: 1 / -1;
  font-size: 0.75rem;
  line-height: 1.5;
  color: #c94a3c;
  word-break: break-all;
}

.collect-extra,
.collect-unsupported {
  padding: 0.45rem 0.6rem;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
}

.collect-unsupported {
  border-color: color-mix(in srgb, #e8a838 45%, var(--color-border));
}

.collect-extra .legend,
.collect-unsupported .legend {
  margin-top: 0.25rem;
}

/* ---- ③ 招式（技能倍率） ---- */

.skill-block {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid color-mix(in srgb, #3f8fd0 34%, var(--color-border));
  border-radius: 10px;
}

.skill-title {
  margin: 0;
  font-size: 0.95rem;
  color: var(--color-heading);
}

.skill-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: var(--color-text);
  cursor: pointer;
  user-select: none;
}

.skill-result {
  grid-column: 1 / -1;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-heading);
}

.skill-summary {
  margin: 0;
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--color-heading);
}

@media (max-width: 900px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .field-row {
    grid-template-columns: 1.5rem minmax(0, 1fr);
    row-gap: 0.15rem;
  }

  .collect-row {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 0.2rem;
  }
}
</style>
