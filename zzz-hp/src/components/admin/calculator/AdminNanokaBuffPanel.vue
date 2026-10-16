<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import {
  applyNanokaBuffs,
  extractNanokaBuffs,
  fetchNanokaRules,
  isNanokaBuffsAuthError,
  parseNanokaBuffs,
  simplifyNanokaBuffs,
  type NanokaApplyResult,
  type NanokaApplyRow,
  type NanokaBuffItem,
  type NanokaBuffKind,
  type NanokaBuffSentence,
  type NanokaExtractResult,
  type NanokaExtractorMeta,
  type NanokaKeywordAnchors,
  type NanokaKeywordConvert,
  type NanokaKeywordEffect,
  type NanokaKeywordSlots,
  type NanokaLayerCEffect,
  type NanokaParseConflict,
  type NanokaParseResultRow,
  type NanokaRulesTable,
} from '@/api/nanokaBuffs'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import { clearAdminAuthenticated } from '@/utils/adminAuth'
import { AGENT_ELEMENTS, AGENT_ROLES, BUFF_STAT_FIELDS, buffStatFieldLabel } from '@/utils/calculatorUi'
import {
  BUFF_SCOPE_OPTIONS,
  BUFF_SKILL_TARGET_OPTIONS,
  type BuffApplySituation,
  type BuffApplyTarget,
  type BuffEffectKind,
  type BuffScope,
  type BuffSkillTarget,
  type BuffSkillTargetId,
  type ConvertFromKey,
  type ConvertPanelSource,
} from '@/types/calculator'

/**
 * nanoka 增益（关键字 → 增益块）面板 —— **v3**。
 *
 * 规格：`dev-docs/nanoka-buff-extract-spec-v2-2026-10-16.md` 的「v3 变更」一节。
 *
 * 两页三层的落地：
 * ```
 * 阶段一：左=原文（只读）        右=关键字（可编辑，9 槽位不许缺格）
 * 阶段二：左=关键字（同一份数据）  右=实际增益（增益块全字段，可手改）
 * ```
 * - 关键字行**只显示有值的槽位**（`无` 默认隐藏，`[详情]` 才展开 9 格）；
 *   `无法提取` 用 `⚠X 槽位名` + `[补]`；`条件` 是唯一可复数的槽位。
 * - 阶段二 `[解析]` = **智能覆盖**：只回填没手改过的字段；手改值 ≠ 新解析值 → 冲突由人裁决；
 *   关键字新增 → 追加新行；关键字删掉 → 旧增益行保留并标「关键字里已无此条」。
 * - 写入按**槽位下标**落位（`写入：mindscapeBuffs[0] · 块「…」 · 新增`），块名只是展示文字。
 * - 抓 nanoka 一律在浏览器里做（服务端不联网）；`/apply` 只在点 `[确认写入]` 时才写库。
 */

const router = useRouter()
const store = useCalculatorBuffStore()
const { agents, wengines, skillSubcategories } = storeToRefs(store)
/** nanoka 静态站：响应带 `Access-Control-Allow-Origin: *`，浏览器可直接 fetch */
const NANOKA_STATIC = 'https://static.nanoka.cc'
const INDEX_TIMEOUT_MS = 25000
const DETAIL_TIMEOUT_MS = 20000
const NANOKA_NETWORK_HINT =
  '浏览器访问不到 static.nanoka.cc；如果你靠代理上网，请确认代理已开（服务端不抓 nanoka，抓取一律在浏览器里）'

const UNABLE = '无法提取'
const NONE = '无'

type Page = 'stage1' | 'stage2'

/** 一条「关键字 ↔ 增益」行（一对一；两页共用同一份状态） */
interface KeywordRow {
  key: string
  itemKey: string
  itemSlot: string
  itemSlotLabel: string
  source: string
  containerIndex: number | null
  blockHint: string
  title: string
  rawText: string
  origin: string
  sentence: string
  /** 该关键字所属的**句序号**（按句配对用；切句口径 = 阶段1 的 `。；\n`） */
  sentenceIndex: number
  slots: NanokaKeywordSlots
  convert: NanokaKeywordConvert | null
  stackMax: number | null
  durationSeconds: number | null
  anchors: NanokaKeywordAnchors
  /** 招式限定（`[普通攻击]` 这类）：条件，不是来源 / 落点 */
  skillLimits: { name: string; category: string }[]
  /** 指代来源提示（界面用）：`依赖上一句 · 增伤`，没有则 null */
  inherited: { from: string; fields: string[]; label: string } | null
  /** 同义反复被忽略的条件原文（界面标淡色提示，不入库） */
  tautologyDropped: string[]
  /** 槽位取值来源（`default-team` / `default-team-enemy-status` = 目标按规则兜底成全队） */
  sources: Record<string, string>
  recorded: boolean
  dropReason: string
  unableSlots: string[]
  skillDesc: NanokaBuffItem['skillDesc']
  /** 面板状态（不入库） */
  detailOpen: boolean
  /** 阶段二：是否加入（默认加入；取消勾选 → 标灰、不参与写入准备） */
  included: boolean
  patchSlot: string
  keywordDirty: boolean
  /** 阶段二：实际增益（增益块全字段） */
  gain: GainFields | null
  dirty: Record<string, boolean>
  conflicts: NanokaParseConflict[]
  stale: boolean
  blocked: boolean
  blockReason: string
  added: boolean
  writeLabel: string
}

/** 「增益块」全字段（阶段二右栏的控件直接绑这些） */
interface GainFields {
  stat: string
  kind: BuffEffectKind
  value: number
  valuePerStack: number
  maxStacks: number
  defaultStacks: number
  stackable: boolean
  applyTarget: BuffApplyTarget
  applySituation: BuffApplySituation
  applyProfession: string | null
  teamProfession: string | null
  teamProfessionValues: (number | null)[]
  elementFilter: 'all' | string[]
  scope: BuffScope
  skillTargets: BuffSkillTarget[]
  appliesToAnomaly: boolean
  enabledDefault: boolean
  note: string
  convert: {
    from: ConvertFromKey
    panelSource: ConvertPanelSource
    ratioPercent: number
    cap: number | null
    defaultBase: number | null
    initialBase: number
  } | null
}

/** 底部「废原文」区（按来源块 · 整段原文；解析不出的句子只做淡色/下划线标记） */

// ---------------------------------------------------------------- 顶部选择 / 状态

const kind = ref<NanokaBuffKind>('agent')
const selectedId = ref('')
const localQuery = ref('')

const page = ref<Page>('stage1')
const meta = ref<NanokaExtractorMeta | null>(null)
const items = ref<NanokaBuffItem[]>([])
const rows = ref<KeywordRow[]>([])
const localName = ref('')
const nanokaName = ref('')
const nanokaId = ref('')
const buildTag = ref('')

const fetching = ref(false)
const extracting = ref(false)
const simplifying = ref(false)
const parsing = ref(false)
const writing = ref(false)
const busy = computed(() => fetching.value || extracting.value || simplifying.value || parsing.value || writing.value)

const message = ref('')
const messageKind = ref<'ok' | 'err'>('ok')
const statusLine = ref('')
const authDialogVisible = ref(false)

const writePlan = ref<NanokaApplyResult | null>(null)
const writeMessage = ref('')
const confirmVisible = ref(false)

const kindLabel = computed(() => (kind.value === 'agent' ? '角色' : '音擎'))

interface LocalOption {
  id: string
  name: string
  meta: string
}

const localOptions = computed<LocalOption[]>(() => {
  if (kind.value === 'agent') {
    return agents.value.map((agent) => ({
      id: agent.id,
      name: agent.name,
      meta: [agent.element, agent.profession].filter(Boolean).join(' · '),
    }))
  }
  return wengines.value.map((wengine) => ({
    id: wengine.id,
    name: wengine.name,
    meta: [wengine.rarity, wengine.profession].filter(Boolean).join(' · '),
  }))
})

const filteredOptions = computed(() => {
  const query = localQuery.value.trim().toLowerCase()
  if (!query) return localOptions.value
  return localOptions.value.filter(
    (option) => option.name.toLowerCase().includes(query) || option.id.toLowerCase().includes(query),
  )
})

const selectOptions = computed(() => {
  const list = filteredOptions.value
  if (!selectedId.value || list.some((option) => option.id === selectedId.value)) return list
  const current = localOptions.value.find((option) => option.id === selectedId.value)
  return current ? [current, ...list] : list
})

const selectedLocal = computed(
  () => localOptions.value.find((option) => option.id === selectedId.value) ?? null,
)

// ---------------------------------------------------------------- 字典（下拉选项唯一来源在后端）

const FALLBACK_SLOT_OPTIONS: Record<string, string[]> = {
  stat: ['增伤', '招式增伤', '异常增伤', '异常精通', '异常掌控', '暴击率', '暴击伤害', '攻击力（局外）', '攻击力（固定）', '生命值', '防御力', '减防', '抗性穿透', '穿透率', '穿透', '失衡易伤', '失衡易伤（全局）', '能量自动回复', NONE, UNABLE],
  elements: ['物理', '火', '冰', '电', '以太', '风', NONE],
  action: ['提升', '降低', '无视', '转化', UNABLE],
  unit: ['%', '点', NONE],
  target: ['自身', '全队', '指定职业', '指定阵营', NONE, UNABLE],
  conditions: [NONE, '攻击失衡敌人时', '攻击非失衡敌人时', '发动强化特殊技时', '发动连携技或终结技时', UNABLE],
  scope: [NONE, '招式', '异常', '紊乱', '乱流', '异放', '耀变', '异化系数'],
  stacks: [NONE, UNABLE],
  duration: [NONE, UNABLE],
  object: ['当前招式', '装备者', '敌人', NONE, UNABLE],
  convertFrom: ['hp', 'atk', 'def', 'critRate', 'critDmg', 'mastery', 'anomalyControl', 'energyRegen', 'penRate', 'impact', 'pierce', 'level', UNABLE],
  convertPanelSource: ['external', 'final', 'manual'],
}

const SLOT_ORDER = [
  'stat',
  'elements',
  'action',
  'value',
  'unit',
  'target',
  'conditions',
  'scope',
  'stacks',
  'duration',
  'object',
] as const

/** 允许复数的槽位（用户 2026-10-16：复数白名单 = 条件 / 元素） */
const MULTI_SLOT_IDS = ['conditions', 'elements']

const SLOT_LABELS: Record<string, string> = {
  stat: '属性',
  elements: '元素',
  action: '动作',
  value: '数值',
  unit: '单位',
  target: '目标',
  conditions: '条件',
  /** 作用域 = 编辑器里的 `scope`（用户 2026-10-16：字段名就叫「作用域」）；「限定招式」并进这一格 */
  scope: '作用域',
  stacks: '层数',
  duration: '时长',
  object: '对象',
  // 转模文案定稿（用户 2026-10-16；括号里是它对应的 normalizeConvert 字段）
  convertFrom: '读取属性', // convert.from
  convertPanelSource: '取哪一层', // convert.panelSource
  convertRatio: '折算比例', // convert.ratioPercent
  convertBase: '基础值', // convert.defaultBase
  convertCap: '上限', // convert.cap
}

const CONVERT_SLOT_ORDER = [
  'convertFrom',
  'convertPanelSource',
  'convertRatio',
  'convertBase',
  'convertCap',
] as const

/** 转模槽位悬浮提示（后端 meta 优先，下面这份是兜底） */
const FALLBACK_CONVERT_HINTS: Record<string, string> = {
  convertFrom: '读取属性：它的值 × 折算比例 = 本条增益',
  convertPanelSource: '取哪一层：进战外面板 / 最终面板 / 手动值',
  convertRatio: '折算比例：百分数填法（150 = 150%）',
  convertBase: '基础值：只有超出它的部分参与折算',
  convertCap: '上限：折算结果的绝对值上限',
}

const CONVERT_FROM_LABELS: Record<string, string> = {
  hp: '生命值',
  atk: '攻击力',
  def: '防御力',
  critRate: '暴击率',
  critDmg: '暴击伤害',
  mastery: '异常精通',
  anomalyControl: '异常掌控',
  energyRegen: '能量自动回复',
  penRate: '穿透率',
  impact: '冲击力',
  pierce: '穿透值',
  level: '角色等级',
  skillLevelSpecial: '技能等级（特殊技）',
  skillLevelBasic: '技能等级（普通攻击）',
  skillLevelDodge: '技能等级（闪避）',
  skillLevelAssist: '技能等级（支援技）',
  skillLevelChainUltimate: '技能等级（连携技/终结技）',
}

const CONVERT_PANEL_SOURCE_LABELS: Record<string, string> = {
  external: '进战外面板',
  final: '最终面板',
  manual: '手动值',
}

function optionsOf(slotId: string): string[] {
  const fromMeta = meta.value?.slotOptions?.[slotId]
  if (Array.isArray(fromMeta) && fromMeta.length) return fromMeta
  return FALLBACK_SLOT_OPTIONS[slotId] ?? []
}

function slotLabel(slotId: string): string {
  return (
    meta.value?.convertSlotLabels?.[slotId] ??
    meta.value?.slotLabels?.[slotId] ??
    SLOT_LABELS[slotId] ??
    slotId
  )
}

function slotHint(slotId: string): string {
  return meta.value?.convertSlotHints?.[slotId] ?? FALLBACK_CONVERT_HINTS[slotId] ?? ''
}

/** 槽位取值的展示文案（转模的读取属性 / 取哪一层要翻成中文） */
function displaySlotValue(slotId: string, value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  if (slotId === 'convertFrom') {
    return meta.value?.convertFromLabels?.[text] ?? CONVERT_FROM_LABELS[text] ?? text
  }
  if (slotId === 'convertPanelSource') {
    return meta.value?.convertPanelSourceLabels?.[text] ?? CONVERT_PANEL_SOURCE_LABELS[text] ?? text
  }
  return text
}

function statFieldLabel(key: string): string {
  const field = BUFF_STAT_FIELDS.find((item) => item.key === key)
  return field ? buffStatFieldLabel(field) : key
}

/** 该槽位是不是「无值」（`无` / 空）——`无` 默认隐藏（v3.1） */
function isEmptySlotValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (Array.isArray(value)) return value.every((entry) => isEmptySlotValue(entry))
  const text = String(value).trim()
  return !text || text === NONE
}

/** 关键字行要显示的槽位（只显示有值；`无` 进 hidden；`无法提取` 进 unable） */
function slotBuckets(row: KeywordRow) {
  const visible: { id: string; label: string; value: unknown; unable: boolean }[] = []
  const hidden: { id: string; label: string; value: unknown; unable: boolean }[] = []
  const unable: { id: string; label: string; value: unknown; unable: boolean }[] = []
  for (const id of SLOT_ORDER) {
    if (row.slots.action === '转化' && (id === 'value' || id === 'unit')) continue
    const value = row.slots[id]
    const entry = { id, label: slotLabel(id), value, unable: isUnableValue(value) }
    if (entry.unable) unable.push(entry)
    else if (isEmptySlotValue(value)) hidden.push(entry)
    else visible.push(entry)
  }
  if (row.slots.action === '转化') {
    for (const id of CONVERT_SLOT_ORDER) {
      const value = row.convert?.[id as keyof NanokaKeywordConvert] ?? null
      const entry = { id, label: SLOT_LABELS[id] ?? id, value, unable: isUnableValue(value) }
      if (entry.unable) unable.push(entry)
      else if (isEmptySlotValue(value)) hidden.push(entry)
      else visible.push(entry)
    }
  }
  return { visible, hidden, unable }
}

function conditionText(value: unknown): string {
  if (Array.isArray(value)) return value.join(' + ')
  return String(value ?? NONE)
}

/** 槽位值是不是槽位级 `无法提取`（详情里要标 ⚠X，别当普通值） */
function isUnableValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.includes(UNABLE)
  return String(value ?? '').trim() === UNABLE
}

/**
 * `无法提取` 分软硬（用户 2026-10-16）：`属性 / 动作 / 数值` 缺失 → **阻断待补**；
 * 其余槽位缺失 → **按「无」处理**（红字提示 + 淡色「按无处理」，不阻断）。
 */
const HARD_UNABLE_SLOT_IDS = ['stat', 'action', 'value']

function isHardUnable(slotId: string): boolean {
  return HARD_UNABLE_SLOT_IDS.includes(slotId)
}

/** 该条有没有「软」的无法提取（有的话显示「按无处理」提示，但不影响可写） */
function softUnableSlotsOf(row: KeywordRow): string[] {
  return (row.unableSlots ?? []).filter((id) => !isHardUnable(id))
}

/** 详情里某槽位的展示文本（元素 / 条件是复数，逐个列出） */
function slotText(row: KeywordRow, slotId: string): string {
  const value = (row.slots as unknown as Record<string, unknown>)[slotId]
  if (Array.isArray(value)) {
    const list = value.filter((item) => item !== NONE && item !== '')
    return list.length ? list.map((item) => displaySlotValue(slotId, item)).join(' + ') : NONE
  }
  return displaySlotValue(slotId, value)
}

function isElementChecked(row: KeywordRow, element: string): boolean {
  const filter = row.gain?.elementFilter
  return Array.isArray(filter) && filter.includes(element)
}

// ---------------------------------------------------------------- 按句配对（v3.24）

/** 左侧主视图只显示**产出过关键字**的句子（用户 2026-10-16） */
function keywordSentences(item: NanokaBuffItem): NanokaBuffSentence[] {
  return (item.sentences ?? []).filter((sentence) => sentence.hasKeywords)
}

/** 某句（某来源块内）的关键字行 —— 左右按句配对 */
function rowsForSentence(itemKey: string, sentenceIndex: number): KeywordRow[] {
  return rows.value.filter(
    (row) => row.itemKey === itemKey && row.sentenceIndex === sentenceIndex,
  )
}

/** 左侧要显示哪些来源块（整块抽不出关键字 → 不显示，只在废原文区出现） */
const visibleItems = computed(() => items.value.filter((item) => keywordSentences(item).length > 0))

// —— 「整块原文」弹窗（用户 2026-10-16）：弹窗里同样剔除完全解析不出来的句子，并高亮当前句
const originalVisible = ref(false)
const originalItem = ref<NanokaBuffItem | null>(null)
const originalHighlight = ref(0)

/** 「解析规则」弹窗（只读；数据来自后端 `/rules`，界面不手写规则） */
const rulesVisible = ref(false)
const rulesLoading = ref(false)
const rules = ref<NanokaRulesTable | null>(null)
const rulesMessage = ref('')

async function openRules() {
  rulesVisible.value = true
  if (rules.value || rulesLoading.value) return
  rulesLoading.value = true
  try {
    const { result, message: serverMessage } = await fetchNanokaRules()
    rules.value = result
    rulesMessage.value = serverMessage
  } catch (err) {
    rulesMessage.value = describeError(err)
  } finally {
    rulesLoading.value = false
  }
}

function openOriginal(item: NanokaBuffItem, sentenceIndex = -1) {
  originalItem.value = item
  const keywordSentencesOfItem = keywordSentences(item)
  originalHighlight.value =
    sentenceIndex >= 0
      ? sentenceIndex
      : (keywordSentencesOfItem[0]?.sentenceIndex ?? 0)
  originalVisible.value = true
}

function closeOriginal() {
  originalVisible.value = false
  originalItem.value = null
}

/** 弹窗里显示的句子：**同样剔除**完全解析不出来的句子（那些只在底部废原文区） */
const originalSentences = computed<NanokaBuffSentence[]>(() =>
  originalItem.value ? keywordSentences(originalItem.value) : [],
)

// ---------------------------------------------------------------- 废原文（按来源块 · 整段原文）

/**
 * 底部「废原文」区（用户 2026-10-16 改造）：**按来源块展示原封不动的整块原文**，
 * 不删字、不逐句拆条；解析不出的句子只做**淡色 / 下划线**标记，可切「整段 / 仅废句」。
 * 排序与主视图一致（核心被动 → 额外能力 → 招式文本 → 影画 1..6；音擎：基础 → 精炼 1..5）。
 */
const wasteOnlySentences = ref(false) // false = 整段（默认）；true = 只看废句

interface WasteBlockRow {
  itemKey: string
  sourceTag: string
  rawText: string
  wasteSentences: { sentenceIndex: number; text: string; reasons: string[] }[]
  segments: { text: string; waste: boolean }[]
}

const wasteBlocks = computed<WasteBlockRow[]>(() => {
  const blocks: WasteBlockRow[] = []
  for (const item of items.value) {
    // **整块 0 条关键字 → 直接不显示**（既不在主视图、也不在废原文区）：
    // 例「招式文本（支援技）· 快速支援：急救」整块都是机制描述，一条增益都产不出。
    if (!(item.sentences ?? []).some((sentence) => sentence.hasKeywords)) continue
    const wasteSentences = (item.sentences ?? [])
      .filter((sentence) => !sentence.hasKeywords)
      .map((sentence) => ({
        sentenceIndex: sentence.sentenceIndex,
        text: sentence.rawSentence,
        reasons: [...new Set(sentence.waste.map((entry) => entry.reason))],
      }))
    if (!wasteSentences.length) continue
    // 在整块原文里给「废句」打标（顺序扫描，避免重复文本错位）
    const segments: { text: string; waste: boolean }[] = []
    let cursor = 0
    for (const sentence of wasteSentences) {
      const index = item.rawText.indexOf(sentence.text, cursor)
      if (index < 0) continue
      if (index > cursor) segments.push({ text: item.rawText.slice(cursor, index), waste: false })
      segments.push({ text: sentence.text, waste: true })
      cursor = index + sentence.text.length
    }
    if (cursor < item.rawText.length) segments.push({ text: item.rawText.slice(cursor), waste: false })
    blocks.push({
      itemKey: item.slot,
      sourceTag: item.title ? `${item.slotLabel} · ${item.title}` : item.slotLabel,
      rawText: item.rawText,
      wasteSentences,
      segments: segments.length ? segments : [{ text: item.rawText, waste: false }],
    })
  }
  return blocks.sort((left, right) => {
    const a = slotSortKey(left.itemKey)
    const b = slotSortKey(right.itemKey)
    if (a[0] !== b[0]) return a[0] - b[0]
    if (a[1] !== b[1]) return a[1] - b[1]
    return a[2].localeCompare(b[2])
  })
})

// ---------------------------------------------------------------- Row 组装

function defaultGain(effect: NanokaLayerCEffect | null, fallbackNote: string): GainFields {
  const layer = effect ?? ({} as Partial<NanokaLayerCEffect>)
  return {
    stat: String(layer.stat ?? 'dmgBonus'),
    kind: (layer.kind === 'stacked' || layer.kind === 'convert' ? layer.kind : 'fixed') as BuffEffectKind,
    value: Number(layer.value ?? 0),
    valuePerStack: Number(layer.valuePerStack ?? 0),
    maxStacks: Number(layer.maxStacks ?? 1),
    defaultStacks: Number(layer.defaultStacks ?? 1),
    stackable: Boolean(layer.stackable),
    applyTarget: layer.applyTarget === 'team' ? 'team' : 'self',
    applySituation:
      layer.applySituation === 'stagger' || layer.applySituation === 'non_stagger'
        ? layer.applySituation
        : 'global',
    applyProfession: layer.applyProfession ?? null,
    teamProfession: layer.teamProfession ?? null,
    teamProfessionValues: Array.isArray(layer.teamProfessionValues)
      ? [0, 1, 2].map((index) => layer.teamProfessionValues?.[index] ?? null)
      : [null, null, null],
    elementFilter:
      layer.elementFilter === 'all' || layer.elementFilter == null
        ? 'all'
        : Array.isArray(layer.elementFilter)
          ? [...layer.elementFilter]
          : [String(layer.elementFilter)],
    scope: (layer.scope ?? 'general') as BuffScope,
    skillTargets: Array.isArray(layer.skillTargets)
      ? layer.skillTargets.map((target) => ({
          category: target.category as BuffSkillTargetId,
          subcategoryId: target.subcategoryId ?? null,
        }))
      : [],
    appliesToAnomaly: Boolean(layer.appliesToAnomaly),
    enabledDefault: layer.enabledDefault !== false,
    note: String(layer.note ?? fallbackNote ?? ''),
    convert: layer.convert
      ? {
          from: layer.convert.from as ConvertFromKey,
          panelSource: (layer.convert.panelSource ?? 'external') as ConvertPanelSource,
          ratioPercent: Number(layer.convert.ratioPercent ?? 0),
          cap: layer.convert.cap ?? null,
          defaultBase: layer.convert.defaultBase ?? null,
          initialBase: Number(layer.convert.initialBase ?? 0),
        }
      : null,
  }
}

function toRow(effect: NanokaKeywordEffect, item: NanokaBuffItem, index: number): KeywordRow {
  const key = `${item.slot}#${index}`
  return {
    key,
    itemKey: item.slot,
    itemSlot: item.slot,
    itemSlotLabel: item.slotLabel,
    source: item.source,
    containerIndex: item.containerIndex,
    blockHint: item.landing?.blockHint ?? '',
    title: item.title,
    rawText: item.rawText,
    origin: effect.origin,
    sentence: effect.sentence,
    sentenceIndex: Number(effect.unitIndex ?? 0),
    slots: {
      stat: String(effect.slots.stat ?? NONE),
      elements: Array.isArray(effect.slots.elements) ? [...effect.slots.elements] : [NONE],
      action: String(effect.slots.action ?? NONE),
      value: effect.slots.value,
      unit: String(effect.slots.unit ?? NONE),
      target: String(effect.slots.target ?? NONE),
      conditions: Array.isArray(effect.slots.conditions) ? [...effect.slots.conditions] : [NONE],
      scope: String(effect.slots.scope ?? NONE),
      stacks: String(effect.slots.stacks ?? NONE),
      duration: String(effect.slots.duration ?? NONE),
      object: String(effect.slots.object ?? NONE),
    },
    convert: effect.convert ? { ...effect.convert } : null,
    stackMax: effect.stackMax,
    durationSeconds: effect.durationSeconds,
    anchors: effect.anchors,
    skillLimits: Array.isArray(effect.skillLimits) ? effect.skillLimits.map((item) => ({ ...item })) : [],
    inherited: effect.inherited ?? null,
    tautologyDropped: Array.isArray(effect.tautologyDropped) ? [...effect.tautologyDropped] : [],
    sources: { ...effect.sources },
    recorded: effect.recorded,
    dropReason: effect.dropReason,
    unableSlots: [...(effect.unableSlots ?? [])],
    skillDesc: item.skillDesc,
    detailOpen: false,
    // 默认全部加入（可写条目全勾选）；用户可在阶段二把不想加入的去掉
    included: true,
    patchSlot: '',
    keywordDirty: false,
    gain: effect.layerC || effect.recorded ? defaultGain(effect.layerC, effect.sentence) : null,
    dirty: {},
    conflicts: [],
    stale: false,
    blocked: false,
    blockReason: '',
    added: false,
    writeLabel: '',
  }
}

function applyExtractResult(result: NanokaExtractResult) {
  items.value = result.items
  meta.value = result.meta
  localName.value = result.localName
  nanokaName.value = result.name
  nanokaId.value = result.nanokaId
  rows.value = result.items.flatMap((item) =>
    item.effects.map((effect, index) => toRow(effect, item, index)),
  )
  selectedKey.value = rows.value[0]?.key ?? ''
  page.value = 'stage1'
  writePlan.value = null
  writeMessage.value = ''
}

function resetAll() {
  items.value = []
  rows.value = []
  meta.value = null
  localName.value = ''
  nanokaName.value = ''
  nanokaId.value = ''
  writePlan.value = null
  writeMessage.value = ''
  page.value = 'stage1'
  message.value = ''
  statusLine.value = ''
}

// ---------------------------------------------------------------- 错误 / 会话

function handleAuthError() {
  authDialogVisible.value = true
  messageKind.value = 'err'
  message.value = '管理员会话无效或已过期，请重新登录后再抓取 / 写入'
}

function handleError(err: unknown, fallback: string) {
  if (isNanokaBuffsAuthError(err)) {
    handleAuthError()
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

// ---------------------------------------------------------------- 浏览器抓 nanoka

interface IndexEntry {
  code?: string
  zh?: string
  en?: string
}

let indexMap: Record<string, IndexEntry> = {}
let indexKind: NanokaBuffKind | '' = ''

function nanokaUrl(path: string) {
  return `${NANOKA_STATIC}${path}`
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return '请求超时'
    return err.message
  }
  return String(err)
}

async function fetchNanokaJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}（${url}）`)
    const text = await response.text()
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error(`${url} 返回的不是合法 JSON`)
    }
  } finally {
    window.clearTimeout(timer)
  }
}

function readBuildTag(manifest: unknown): string {
  if (!manifest || typeof manifest !== 'object') return ''
  const zzz = (manifest as { zzz?: unknown }).zzz
  if (!zzz || typeof zzz !== 'object') return ''
  const latest = (zzz as { latest?: unknown }).latest
  return typeof latest === 'string' ? latest : ''
}

function normName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[「」\s·:：]/g, '')
    .toLowerCase()
}

function normKey(raw: unknown): string {
  return normName(raw).replace(/[_\-‐-―]/g, '')
}

async function loadIndex(): Promise<string> {
  if (indexKind === kind.value && Object.keys(indexMap).length) return buildTag.value
  const manifest = await fetchNanokaJson(nanokaUrl('/manifest.json'), INDEX_TIMEOUT_MS)
  const tag = readBuildTag(manifest)
  if (!tag) throw new Error('manifest.json 里没有 zzz.latest，拿不到 build tag')
  const file = kind.value === 'agent' ? 'character.json' : 'weapon.json'
  const raw = await fetchNanokaJson(nanokaUrl(`/zzz/${tag}/${file}`), INDEX_TIMEOUT_MS)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file} 不是对象，拿不到索引`)
  }
  indexMap = raw as Record<string, IndexEntry>
  indexKind = kind.value
  buildTag.value = tag
  return tag
}

function resolveNanokaRef(): { nanokaId: string; meta: IndexEntry } {
  const wantId = kind.value === 'agent' ? normName(selectedId.value) : normKey(selectedId.value)
  const wantName = normName(selectedLocal.value?.name ?? '')
  const entries = Object.entries(indexMap)
  const hit =
    kind.value === 'agent'
      ? (entries.find(([, item]) => wantId && normName(item.code) === wantId) ??
        entries.find(([, item]) => wantName && normName(item.zh) === wantName))
      : (entries.find(([, item]) => wantName && normName(item.zh) === wantName) ??
        entries.find(([, item]) => wantId && normKey(item.en) === wantId))
  if (!hit) {
    throw new Error(
      `nanoka 索引里没有这个${kindLabel.value}（${kind.value === 'agent' ? 'code / zh' : 'zh / en'} 都没对上）；先在「nanoka 采集」面板确认本地名与 nanoka 名是否一致`,
    )
  }
  return { nanokaId: hit[0], meta: hit[1] }
}

async function fetchAndExtract() {
  if (busy.value) return
  if (!selectedId.value) {
    messageKind.value = 'err'
    message.value = `请先选一个本地${kindLabel.value}`
    return
  }
  fetching.value = true
  message.value = ''
  statusLine.value = ''
  writePlan.value = null
  try {
    const tag = await loadIndex()
    const resolved = resolveNanokaRef()
    statusLine.value = `build ${tag} · nanoka #${resolved.nanokaId} · 正在抓详情…`
    const detail = await fetchNanokaJson(
      nanokaUrl(`/zzz/${tag}/zh/${kind.value === 'agent' ? 'character' : 'weapon'}/${resolved.nanokaId}.json`),
      DETAIL_TIMEOUT_MS,
    )
    fetching.value = false
    extracting.value = true
    statusLine.value = `build ${tag} · nanoka #${resolved.nanokaId} · 已抓到详情，正在抽取关键字…`
    const { result, message: serverMessage } = await extractNanokaBuffs({
      kind: kind.value,
      nanokaId: resolved.nanokaId,
      meta: resolved.meta,
      detail,
    })
    applyExtractResult(result)
    messageKind.value = 'ok'
    message.value = serverMessage
    statusLine.value = `build ${tag} · nanoka #${resolved.nanokaId}（${result.name}）→ 本地 ${result.localId}`
  } catch (err) {
    if (isNanokaBuffsAuthError(err)) {
      handleAuthError()
      return
    }
    messageKind.value = 'err'
    message.value = `${NANOKA_NETWORK_HINT}（${describeError(err)}）`
    statusLine.value = ''
  } finally {
    fetching.value = false
    extracting.value = false
  }
}

function onKindChange() {
  selectedId.value = ''
  localQuery.value = ''
  indexMap = {}
  indexKind = ''
  buildTag.value = ''
  resetAll()
}

// ---------------------------------------------------------------- [化简]（阶段一）

function mergeSimplified(
  slot: string,
  simplified: {
    effects: NanokaKeywordEffect[]
    sentences: NanokaBuffSentence[]
    waste: { sentenceIndex?: number; text: string; reason: string }[]
  },
) {
  const item = items.value.find((entry) => entry.slot === slot)
  if (!item) return
  item.effects = simplified.effects
  item.waste = simplified.waste
  item.verdict = simplified.effects.some((effect) => effect.recorded) ? 'buff' : 'waste'
  rows.value = rows.value.filter((row) => row.itemKey !== slot)
  simplified.effects.forEach((effect, index) => {
    rows.value.push(toRow(effect, item, index))
  })
  // 阶段二选中的条目可能刚被重算掉 → 挪到第一条，别让右侧空着
  if (!rows.value.some((row) => row.key === selectedKey.value)) {
    selectedKey.value = rows.value[0]?.key ?? ''
  }
  // 按句配对视图跟着刷新（废原文区由 wasteSentences 计算，不必另存）
  item.sentences = simplified.sentences ?? []
  item.waste = simplified.waste ?? []
  item.effects = simplified.effects
}

async function simplifyOne(slot: string) {
  if (busy.value) return
  const item = items.value.find((entry) => entry.slot === slot)
  if (!item) return
  simplifying.value = true
  message.value = ''
  try {
    const { result, message: serverMessage } = await simplifyNanokaBuffs({
      kind: kind.value,
      nanokaId: nanokaId.value,
      items: [
        {
          slot: item.slot,
          slotLabel: item.slotLabel,
          source: item.source,
          containerIndex: item.containerIndex,
          rawText: item.rawText,
          origin: `nanoka:${nanokaId.value}:resimplify:${item.slot}`,
          agentId: kind.value === 'agent' ? selectedId.value : '',
          landing: item.landing,
          skillDesc: item.skillDesc,
        },
      ],
    })
    const simplified = result.items[0]
    if (simplified) {
      mergeSimplified(slot, {
        effects: simplified.effects,
        sentences: simplified.sentences ?? [],
        waste: simplified.waste,
      })
      messageKind.value = 'ok'
      message.value = `${item.slotLabel}：${serverMessage}`
    }
  } catch (err) {
    handleError(err, '化简失败')
  } finally {
    simplifying.value = false
  }
}

async function simplifyAll() {
  if (busy.value || !items.value.length) return
  simplifying.value = true
  message.value = ''
  try {
    const { result, message: serverMessage } = await simplifyNanokaBuffs({
      kind: kind.value,
      nanokaId: nanokaId.value,
      items: items.value.map((item) => ({
        slot: item.slot,
        slotLabel: item.slotLabel,
        source: item.source,
        containerIndex: item.containerIndex,
        rawText: item.rawText,
        origin: `nanoka:${nanokaId.value}:resimplify:${item.slot}`,
        agentId: kind.value === 'agent' ? selectedId.value : '',
        landing: item.landing,
        skillDesc: item.skillDesc,
      })),
    })
    for (const simplified of result.items) {
      mergeSimplified(simplified.slot, {
        effects: simplified.effects,
        sentences: simplified.sentences ?? [],
        waste: simplified.waste,
      })
    }
    messageKind.value = 'ok'
    message.value = `全部化简完成：${serverMessage}`
  } catch (err) {
    handleError(err, '全部化简失败')
  } finally {
    simplifying.value = false
  }
}

// ---------------------------------------------------------------- 关键字编辑

function markKeywordDirty(row: KeywordRow) {
  row.keywordDirty = true
  row.writeLabel = ''
}

function setSlot(row: KeywordRow, slotId: string, value: unknown) {
  if (slotId === 'value' || slotId === 'convertRatio' || slotId === 'convertBase' || slotId === 'convertCap') {
    const num = Number(value)
    const numeric = Number.isFinite(num) ? num : String(value)
    if (slotId === 'value') row.slots.value = numeric
    else if (row.convert) {
      if (slotId === 'convertRatio') row.convert.convertRatio = numeric
      if (slotId === 'convertBase') row.convert.convertBase = Number.isFinite(num) ? num : null
      if (slotId === 'convertCap') row.convert.convertCap = Number.isFinite(num) ? num : null
    }
  } else if (slotId === 'convertFrom' && row.convert) {
    row.convert.convertFrom = String(value)
  } else if (slotId === 'convertPanelSource' && row.convert) {
    row.convert.convertPanelSource = String(value)
  } else if (slotId === 'stat') {
    row.slots.stat = String(value)
  } else if (slotId === 'action') {
    row.slots.action = String(value)
  } else if (slotId === 'unit') {
    row.slots.unit = String(value)
  } else if (slotId === 'target') {
    row.slots.target = String(value)
  } else if (slotId === 'stacks') {
    row.slots.stacks = String(value)
  } else if (slotId === 'duration') {
    row.slots.duration = String(value)
  } else if (slotId === 'object') {
    row.slots.object = String(value)
  }
  row.patchSlot = ''
  row.unableSlots = row.unableSlots.filter((id) => id !== slotId)
  markKeywordDirty(row)
}

function multiValues(row: KeywordRow, slotId: string): string[] {
  if (slotId === 'conditions') return row.slots.conditions
  if (slotId === 'elements') return row.slots.elements
  return []
}

function addMulti(row: KeywordRow, slotId: string) {
  const list = multiValues(row, slotId).filter((item) => item !== NONE && item !== '')
  list.push('')
  if (slotId === 'conditions') row.slots.conditions = list.length ? list : [NONE]
  else row.slots.elements = list.length ? list : [NONE]
  markKeywordDirty(row)
}

function setMulti(row: KeywordRow, slotId: string, index: number, value: string) {
  const list = [...multiValues(row, slotId)]
  list[index] = value
  if (slotId === 'conditions') row.slots.conditions = list
  else row.slots.elements = list
  markKeywordDirty(row)
}

function removeMulti(row: KeywordRow, slotId: string, index: number) {
  const list = multiValues(row, slotId).filter((_, i) => i !== index)
  const next = list.length ? list : [NONE]
  if (slotId === 'conditions') row.slots.conditions = next
  else row.slots.elements = next
  markKeywordDirty(row)
}

function removeRow(row: KeywordRow) {
  rows.value = rows.value.filter((entry) => entry.key !== row.key)
  if (selectedKey.value === row.key) selectedKey.value = rows.value[0]?.key ?? ''
  messageKind.value = 'ok'
  message.value = `已删掉该条关键字；它在阶段二的增益行会保留并标「关键字里已无此条」（点 [解析] 生效）`
}

// ---------------------------------------------------------------- 增益编辑（阶段二）

function markDirty(row: KeywordRow, field: string) {
  row.dirty = { ...row.dirty, [field]: true }
  // 手改后该字段的冲突提示不再有意义（这是人的最终选择）
  row.conflicts = row.conflicts.filter((conflict) => conflict.field !== field)
  row.writeLabel = ''
}

function setElementAll(row: KeywordRow, all: boolean) {
  if (!row.gain) return
  row.gain.elementFilter = all ? 'all' : []
  markDirty(row, 'elementFilter')
}

function toggleElement(row: KeywordRow, element: string) {
  if (!row.gain) return
  const current = Array.isArray(row.gain.elementFilter) ? [...row.gain.elementFilter] : []
  const index = current.indexOf(element)
  if (index >= 0) current.splice(index, 1)
  else current.push(element)
  row.gain.elementFilter = current.length ? current : 'all'
  markDirty(row, 'elementFilter')
}

function addSkillTarget(row: KeywordRow) {
  if (!row.gain) return
  row.gain.skillTargets = [...row.gain.skillTargets, { category: 'basic', subcategoryId: null }]
  markDirty(row, 'skillTargets')
}

function removeSkillTarget(row: KeywordRow, index: number) {
  if (!row.gain) return
  row.gain.skillTargets = row.gain.skillTargets.filter((_, i) => i !== index)
  markDirty(row, 'skillTargets')
}

const subcategoryOptions = computed(() =>
  skillSubcategories.value.filter(
    (item) => !item.agentId || !selectedId.value || String(item.agentId) === String(selectedId.value),
  ),
)

// ---------------------------------------------------------------- [解析]（智能覆盖）

function keywordPayload() {
  return rows.value.map((row) => ({
    key: row.key,
    slots: { ...row.slots, conditions: [...row.slots.conditions] },
    convert: row.convert ? { ...row.convert } : null,
    stackMax: row.stackMax,
    durationSeconds: row.durationSeconds,
    anchors: row.anchors,
    rawText: row.sentence,
    origin: row.origin,
  }))
}

function mergeParseRows(parsed: NanokaParseResultRow[]) {
  const byKey = new Map(parsed.map((row) => [row.key, row]))
  const next: KeywordRow[] = []
  const usedKeys = new Set<string>()
  for (const row of rows.value) {
    const result = byKey.get(row.key)
    if (!result) {
      next.push(row)
      continue
    }
    usedKeys.add(row.key)
    next.push({
      ...row,
      gain:
        result.effect == null
          ? row.gain
          : defaultGain(result.effect as NanokaLayerCEffect, row.gain?.note ?? ''),
      conflicts: result.conflicts ?? [],
      stale: Boolean(result.stale),
      blocked: Boolean(result.blocked),
      blockReason: result.blockReason ?? '',
      added: Boolean(result.added),
      keywordDirty: false,
    })
  }
  // 关键字新增 → 追加新行
  for (const result of parsed) {
    if (usedKeys.has(result.key)) continue
    const keyword = rows.value.find((row) => row.key === result.key)
    if (result.effect == null || !keyword) continue
    next.push({
      ...keyword,
      gain: defaultGain(result.effect as NanokaLayerCEffect, keyword.sentence),
      conflicts: result.conflicts ?? [],
      added: true,
      stale: false,
      blocked: false,
    })
  }
  rows.value = next
}

async function runParse(targetKeys?: string[]) {
  if (busy.value || !rows.value.length) return
  const selectedRows = targetKeys?.length
    ? rows.value.filter((row) => targetKeys.includes(row.key))
    : rows.value
  if (!selectedRows.length) return
  parsing.value = true
  message.value = ''
  try {
    const { result, message: serverMessage } = await parseNanokaBuffs({
      rows: rows.value.map((row) => ({
        key: row.key,
        effect: row.gain ? ({ ...row.gain } as Partial<NanokaLayerCEffect>) : null,
        dirty: { ...row.dirty },
      })),
      keywords: keywordPayload(),
      agentId: kind.value === 'agent' ? selectedId.value : '',
    })
    mergeParseRows(result.rows)
    messageKind.value = 'ok'
    message.value = serverMessage
    if (page.value === 'stage1') page.value = 'stage2'
  } catch (err) {
    handleError(err, '解析失败')
  } finally {
    parsing.value = false
  }
}

function resolveConflict(row: KeywordRow, conflict: NanokaParseConflict, choice: 'mine' | 'theirs') {
  if (!row.gain) return
  if (choice === 'theirs') {
    const field = conflict.field as keyof GainFields
    row.gain = { ...row.gain, [field]: conflict.theirs } as GainFields
    row.dirty = { ...row.dirty, [conflict.field]: false }
  } else {
    row.dirty = { ...row.dirty, [conflict.field]: true }
  }
  row.conflicts = row.conflicts.filter((item) => item.field !== conflict.field)
}

// ---------------------------------------------------------------- 阶段二：左选右看（主从布局）

/** 阶段二当前选中的关键字（右侧**只**显示这一条的实际增益） */
const selectedKey = ref('')

/**
 * **清单排序**（用户 2026-10-16）：`核心被动 → 额外能力 → 招式文本（按类别 / 招式）→ 影画 1..6`；
 * 音擎 = `基础(fixed) → 精炼 1..5`。**影画固定最后**，不许混在中间。下拉选项顺序与清单一致。
 */
const SLOT_SORT_GROUPS: Record<string, number> = { core: 0, extra: 1, fixed: 0 }
const SKILL_CATEGORY_ORDER = ['basic', 'dodge', 'assist', 'special', 'chain', 'ultimate']

function slotSortKey(slot: string): [number, number, string] {
  if (slot in SLOT_SORT_GROUPS) return [SLOT_SORT_GROUPS[slot] ?? 0, 0, slot]
  if (slot.startsWith('skill-')) {
    const category = slot.split('-')[1] ?? ''
    const index = SKILL_CATEGORY_ORDER.indexOf(category)
    return [2, index < 0 ? 99 : index, slot]
  }
  const talent = /^talent-(\d+)$/.exec(slot)
  if (talent) return [3, Number(talent[1]), slot] // 影画 1..6 固定最后
  const refinement = /^refinement-(\d+)$/.exec(slot)
  if (refinement) return [1, Number(refinement[1]), slot] // 音擎：基础 → 精炼 1..5
  return [9, 0, slot]
}

/** 阶段二清单 / 下拉都用这个顺序（影画最后） */
const orderedRows = computed(() =>
  [...rows.value].sort((left, right) => {
    const a = slotSortKey(left.itemSlot)
    const b = slotSortKey(right.itemSlot)
    if (a[0] !== b[0]) return a[0] - b[0]
    if (a[1] !== b[1]) return a[1] - b[1]
    if (a[2] !== b[2]) return a[2].localeCompare(b[2])
    return left.sentenceIndex - right.sentenceIndex || left.key.localeCompare(right.key)
  }),
)

const activeRow = computed<KeywordRow | null>(() => {
  const row = rows.value.find((item) => item.key === selectedKey.value)
  return row ?? orderedRows.value[0] ?? null
})

/** 清单条目的展示结构（用户 2026-10-16：两行结构化，别一大坨换行文本） */
function rowSourceTag(row: KeywordRow): string {
  return `${row.itemSlotLabel} · 第 ${row.sentenceIndex + 1} 句`
}

function rowValueTag(row: KeywordRow): string {
  if (row.slots.action === '转化') return '转模'
  const unit = row.slots.unit === '无' ? '' : row.slots.unit
  return `${row.slots.value}${unit}`
}

function rowMetaTag(row: KeywordRow): string {
  const parts = [row.slots.action]
  if (row.slots.scope && row.slots.scope !== NONE) parts.push(`作用域=${row.slots.scope}`)
  const condition = conditionText(row.slots.conditions)
  if (condition && condition !== NONE) parts.push(`条件=${condition}`)
  return parts.join(' · ')
}

/** 勾选了「加入」的条目（未勾选的不参与写入准备） */
const includedRows = computed(() => rows.value.filter((row) => row.included))

/** 某个条目的下拉标签：来源块 · 第 N 句 · 属性=… */
function rowLabel(row: KeywordRow): string {
  const condition = conditionText(row.slots.conditions)
  return (
    `${row.itemSlotLabel} · 第 ${row.sentenceIndex + 1} 句 · 属性=${displaySlotValue('stat', row.slots.stat)}` +
    ` · 动作=${row.slots.action}` +
    (row.slots.action === '转化'
      ? ' · 转模'
      : ` · 数值=${row.slots.value}${row.slots.unit === '无' ? '' : row.slots.unit}`) +
    (condition && condition !== '无' ? ` · 条件=${condition}` : '') +
    (row.included ? '' : '（不加入）')
  )
}

/** 切换勾选：不加入的条目在左侧标灰、不参与写入 */
function toggleIncluded(row: KeywordRow, value: boolean) {
  row.included = value
}

// ---------------------------------------------------------------- 写入（准备 → 确认写入）

const writableRows = computed(() =>
  rows.value.filter((row) => row.included && row.recorded && !row.blocked && row.gain),
)

function buildApplyRows(): NanokaApplyRow[] {
  return writableRows.value.map((row) => ({
    key: row.key,
    slot: row.itemSlot,
    slotLabel: row.itemSlotLabel,
    source: row.source,
    containerIndex: row.containerIndex,
    blockHint: row.blockHint,
    rawText: row.rawText,
    keywordSlots: { ...row.slots, conditions: [...row.slots.conditions] },
    convert: row.convert ? { ...row.convert } : null,
    effect: { ...(row.gain as GainFields), note: row.gain?.note ?? '' } as Partial<NanokaLayerCEffect>,
    anchors: row.anchors,
    skillDesc: row.skillDesc,
  }))
}

async function runApply(dryRun: boolean) {
  if (busy.value) return
  if (!selectedId.value) {
    messageKind.value = 'err'
    message.value = `请先选一个本地${kindLabel.value}`
    return
  }
  if (!writableRows.value.length) {
    messageKind.value = 'err'
    message.value = '没有可写入的增益行（招式锚点关联不上的条目不录；被阻断的条目先补关键字）'
    return
  }
  writing.value = true
  message.value = ''
  try {
    const { result, message: serverMessage } = await applyNanokaBuffs({
      kind: kind.value,
      id: selectedId.value,
      rows: buildApplyRows(),
      dryRun,
    })
    writePlan.value = result
    const labelByKey = new Map<string, string>()
    for (const detail of result.details) {
      for (const effect of detail.effects) labelByKey.set(String(effect.id), effect.writeLabel)
    }
    for (const row of rows.value) {
      const label = labelByKey.get(row.key)
      if (label) row.writeLabel = label
    }
    messageKind.value = result.writeError ? 'err' : 'ok'
    message.value = serverMessage
    writeMessage.value = serverMessage
    if (dryRun) confirmVisible.value = true
    else confirmVisible.value = false
  } catch (err) {
    handleError(err, '写入失败')
  } finally {
    writing.value = false
  }
}

function closeConfirm() {
  if (writing.value) return
  confirmVisible.value = false
}

const confirmMessage = computed(() => {
  const plan = writePlan.value
  if (!plan) return '还没有写入准备结果。'
  const blocks = plan.details
    .filter((detail) => detail.ok)
    .map(
      (detail) =>
        `${detail.container}[${detail.containerIndex ?? '-'}] · 块「${detail.blockName ?? ''}」：新增 ${detail.added} / 重复跳过 ${detail.duplicates}`,
    )
  const skills = plan.skillDescs.map(
    (item) =>
      `招式「${item.skillName}」描述：${item.appended ? '追加' : item.duplicate ? '已含' : '未改'}${item.reason ? `（${item.reason}）` : ''}`,
  )
  return [`将新增 ${plan.updated} 条增益 / 重复跳过 ${plan.skipped}`, ...blocks, ...skills]
    .filter(Boolean)
    .join('\n')
})

const canWrite = computed(() => writableRows.value.length > 0 && !busy.value)

const wasteOpen = ref(true)
const wasteCount = computed(() =>
  wasteBlocks.value.reduce((total, block) => total + block.wasteSentences.length, 0),
)
</script>

<template>
  <section class="editor-panel nanoka-buff-panel">
    <header class="panel-header">
      <h2 class="panel-title">nanoka 增益（关键字 → 增益块）</h2>
      <p class="panel-desc">
        阶段一：原文（只读）→ 关键字（可编辑，9 槽位）。阶段二：关键字 → 实际增益（增益块全字段）。
        抓取在浏览器里做，写入只在点「确认写入」时发生；`无法提取` 是槽位级标记，废原文整条不入库。
      </p>
    </header>

    <div class="nbf-toolbar">
      <div class="nbf-kind-tabs">
        <button
          type="button"
          class="nbf-tab"
          :class="{ active: kind === 'agent' }"
          @click="kind = 'agent'; onKindChange()"
        >
          角色
        </button>
        <button
          type="button"
          class="nbf-tab"
          :class="{ active: kind === 'wengine' }"
          @click="kind = 'wengine'; onKindChange()"
        >
          音擎
        </button>
      </div>
      <label class="field nbf-field">
        <span class="field-label">搜索本地{{ kindLabel }}</span>
        <input v-model="localQuery" type="text" class="field-input" placeholder="名称 / ID" />
      </label>
      <label class="field nbf-field nbf-field-wide">
        <span class="field-label">本地{{ kindLabel }}</span>
        <select v-model="selectedId" class="field-input">
          <option value="">请选择…</option>
          <option v-for="option in selectOptions" :key="option.id" :value="option.id">
            {{ option.name }}{{ option.meta ? `（${option.meta}）` : '' }}
          </option>
        </select>
      </label>
      <button type="button" class="primary-btn" :disabled="busy || !selectedId" @click="fetchAndExtract">
        {{ fetching ? '抓取中…' : extracting ? '抽取中…' : '抓取增益' }}
      </button>
      <button type="button" class="secondary-btn" @click="openRules">解析规则</button>
    </div>

    <p v-if="statusLine" class="nbf-status">{{ statusLine }}</p>
    <p v-if="message" :class="messageKind === 'ok' ? 'form-success' : 'form-error'">{{ message }}</p>

    <div v-if="items.length" class="nbf-page-tabs">
      <button
        type="button"
        class="nbf-tab"
        :class="{ active: page === 'stage1' }"
        @click="page = 'stage1'"
      >
        阶段一 · 原文 → 关键字
      </button>
      <button
        type="button"
        class="nbf-tab"
        :class="{ active: page === 'stage2' }"
        @click="page = 'stage2'"
      >
        阶段二 · 关键字 → 增益
      </button>
      <span class="nbf-count">
        关键字 {{ rows.length }} 条 · 已勾选 {{ includedRows.length }} 条 · 可写 {{ writableRows.length }} 条 ·
        废句 {{ wasteCount }} 句（{{ wasteBlocks.length }} 个有增益的块）
      </span>
    </div>

    <!-- ============================================================ 阶段一 -->
    <div v-show="page === 'stage1'" class="nbf-stage">
      <header class="nbf-stage-head">
        <h3>阶段一 · 原文 → 关键字</h3>
        <div class="nbf-stage-actions">
          <button
            type="button"
            class="secondary-btn"
            :disabled="busy || !items.length"
            @click="simplifyAll"
          >
            {{ simplifying ? '化简中…' : '全部化简' }}
          </button>
        </div>
      </header>

      <!-- 一句原文 ↔ 该句的关键字：按句配对（v3.24）。抽不出关键字的句子不进这里，只在底部废原文区 -->
      <p v-if="!items.length" class="empty-hint">还没有抽取结果：先选本地记录 → [抓取增益]。</p>
      <p v-else-if="!visibleItems.length" class="empty-hint">
        这次抽取没有任何句子产出关键字（全部进了底部「废原文」）。
      </p>
      <article v-for="item in visibleItems" :key="item.slot" class="nbf-item">
        <header class="nbf-item-head">
          <span class="nbf-chip">{{ item.slotLabel }}</span>
          <span class="nbf-item-title">{{ item.title }}</span>
          <span class="nbf-badge nbf-badge-ok">有增益 {{ keywordSentences(item).length }} 句</span>
          <span v-if="item.landing" class="nbf-sub">写入槽位：{{ item.landing.label }}</span>
          <button type="button" class="nbf-mini-btn" @click="openOriginal(item)">整块原文</button>
          <button type="button" class="nbf-mini-btn" :disabled="busy" @click="simplifyOne(item.slot)">
            化简
          </button>
        </header>
        <p v-if="item.skillDesc" class="nbf-sub">
          技能「描述」落点：{{ item.skillDesc.skillName }}
        </p>

        <!-- 一句一对：左 = 该句原文（约 1/3），右 = 该句的关键字（摘要行 + 展开区）；每对独立成块 -->
        <div
          v-for="sentence in keywordSentences(item)"
          :key="`${item.slot}-${sentence.sentenceIndex}`"
          class="nbf-pair"
        >
          <div class="nbf-pair-raw">
            <div class="nbf-pair-raw-head">
              <span class="nbf-chip">第 {{ sentence.sentenceIndex + 1 }} 句</span>
              <button
                type="button"
                class="nbf-mini-btn"
                @click="openOriginal(item, sentence.sentenceIndex)"
              >
                整块里看
              </button>
            </div>
            <p class="nbf-raw-text">{{ sentence.rawSentence }}</p>
          </div>
          <div class="nbf-pair-kw">
            <div
              v-for="(row, rowIndex) in rowsForSentence(item.slot, sentence.sentenceIndex)"
              :key="row.key"
              class="nbf-kw-row"
              :class="{ 'nbf-kw-row-off': !row.recorded }"
            >
                <header class="nbf-kw-head">
                  <span class="nbf-kw-index">B{{ rowIndex + 1 }}</span>
                  <span class="nbf-kw-summary">
                    属性={{ displaySlotValue('stat', row.slots.stat) }} · 动作={{ row.slots.action }}
                    <template v-if="row.slots.action !== '转化'">
                      · 数值={{ row.slots.value }}{{ row.slots.unit === '无' ? '' : row.slots.unit }}
                    </template>
                    <template v-else>· 转模</template>
                  </span>
                  <span v-if="row.skillLimits.length" class="nbf-badge nbf-badge-anchor">
                    限定招式（锚点）：{{ row.skillLimits.map((item) => item.name).join(' + ') }}
                  </span>
                  <span v-if="row.tautologyDropped.length" class="nbf-badge nbf-badge-muted">
                    同义反复已忽略
                  </span>
                  <span v-if="row.inherited" class="nbf-badge nbf-badge-inherit">
                    {{ row.inherited.label }}
                  </span>
                  <span v-if="!row.recorded" class="nbf-badge nbf-badge-drop">
                    这条不录 · {{ row.dropReason }}
                  </span>
                  <span v-if="row.keywordDirty" class="nbf-badge nbf-badge-warn">关键字已改，点 [解析]</span>
                  <button type="button" class="nbf-mini-btn" @click="row.detailOpen = !row.detailOpen">
                    {{ row.detailOpen ? '收起' : '详情' }}
                  </button>
                  <button type="button" class="nbf-mini-btn nbf-danger" @click="removeRow(row)">删</button>
                </header>

                <p v-if="row.anchors.labels.length" class="nbf-sub">
                  招式锚点：{{ row.anchors.ok ? `已关联（${row.anchors.skillTargets.length} 个目标）` : '关联不上 → 不录' }}
                </p>

                <div class="nbf-slots">
                  <!-- 无法提取：⚠X + [补] -->
                  <div v-for="entry in slotBuckets(row).unable" :key="`u-${entry.id}`" class="nbf-slot nbf-slot-unable">
                    <span class="nbf-slot-label">⚠X {{ entry.label }}</span>
                    <em class="nbf-unable-tag" :class="isHardUnable(entry.id) ? 'is-hard' : 'is-soft'">
                      {{ isHardUnable(entry.id) ? '待补（阻断）' : '按无处理' }}
                    </em>
                    <button
                      v-if="row.patchSlot !== entry.id"
                      type="button"
                      class="nbf-mini-btn nbf-danger"
                      @click="row.patchSlot = entry.id"
                    >
                      补
                    </button>
                    <select
                      v-else-if="entry.id !== 'value'"
                      class="field-input nbf-slot-input"
                      :value="''"
                      @change="setSlot(row, entry.id, ($event.target as HTMLSelectElement).value)"
                    >
                      <option value="">请选择…</option>
                      <option v-for="option in optionsOf(entry.id)" :key="option" :value="option">
                        {{ displaySlotValue(entry.id, option) }}
                      </option>
                    </select>
                    <input
                      v-else
                      type="number"
                      class="field-input nbf-slot-input"
                      @change="setSlot(row, 'value', ($event.target as HTMLInputElement).value)"
                    />
                  </div>

                  <!-- 有值的槽位 -->
                  <div v-for="entry in slotBuckets(row).visible" :key="`v-${entry.id}`" class="nbf-slot">
                    <span class="nbf-slot-label" :title="slotHint(entry.id)">
                      {{ entry.label }}
                      <!-- 敌人削弱族的目标默认值是「全队」（原文没写明给谁）→ 淡色「默认」提示，方便一眼改 -->
                      <em
                        v-if="String(row.sources[entry.id] ?? '').startsWith('default-team')"
                        class="nbf-default-mark"
                        >默认</em
                      >
                    </span>
                    <template v-if="MULTI_SLOT_IDS.includes(entry.id)">
                      <div class="nbf-conditions">
                        <div
                          v-for="(value, valueIndex) in multiValues(row, entry.id)"
                          :key="`m-${valueIndex}`"
                          class="nbf-condition"
                        >
                          <select
                            v-if="optionsOf(entry.id).length"
                            class="field-input nbf-slot-input"
                            :value="value"
                            @change="setMulti(row, entry.id, valueIndex, ($event.target as HTMLSelectElement).value)"
                          >
                            <option v-for="option in optionsOf(entry.id)" :key="option" :value="option">
                              {{ displaySlotValue(entry.id, option) }}
                            </option>
                            <option :value="value">{{ value }}</option>
                          </select>
                          <input
                            v-else
                            class="field-input nbf-slot-input"
                            :value="value"
                            @change="setMulti(row, entry.id, valueIndex, ($event.target as HTMLInputElement).value)"
                          />
                          <button
                            type="button"
                            class="nbf-mini-btn nbf-danger"
                            @click="removeMulti(row, entry.id, valueIndex)"
                          >
                            ×
                          </button>
                        </div>
                        <button type="button" class="nbf-mini-btn" @click="addMulti(row, entry.id)">
                          + {{ entry.label }}
                        </button>
                      </div>
                    </template>
                    <input
                      v-else-if="entry.id === 'value' || entry.id === 'convertRatio' || entry.id === 'convertBase' || entry.id === 'convertCap'"
                      type="number"
                      class="field-input nbf-slot-input"
                      :value="entry.value"
                      @change="setSlot(row, entry.id, ($event.target as HTMLInputElement).value)"
                    />
                    <select
                      v-else
                      class="field-input nbf-slot-input"
                      :value="String(entry.value)"
                      @change="setSlot(row, entry.id, ($event.target as HTMLSelectElement).value)"
                    >
                      <option v-for="option in optionsOf(entry.id)" :key="option" :value="option">
                        {{ displaySlotValue(entry.id, option) }}
                      </option>
                    </select>
                  </div>

                  <!-- 无值的槽位：默认隐藏，[详情] 才铺开 -->
                  <template v-if="row.detailOpen">
                    <div v-for="entry in slotBuckets(row).hidden" :key="`h-${entry.id}`" class="nbf-slot nbf-slot-empty">
                      <span class="nbf-slot-label" :title="slotHint(entry.id)">{{ entry.label }}</span>
                      <select
                        class="field-input nbf-slot-input"
                        :value="String(entry.value ?? '无')"
                        @change="setSlot(row, entry.id, ($event.target as HTMLSelectElement).value)"
                      >
                        <option v-for="option in optionsOf(entry.id)" :key="option" :value="option">
                          {{ displaySlotValue(entry.id, option) }}
                        </option>
                      </select>
                    </div>
                  </template>
                </div>
              </div>
          </div>
        </div>
      </article>

      <section class="nbf-waste">
        <header class="nbf-stage-head">
          <h3>
            废原文（{{ wasteCount }} 句 · 来自 {{ wasteBlocks.length }} 个有增益的来源块 · 不入库）
          </h3>
          <div class="nbf-waste-actions">
            <div class="nbf-toggle">
              <button
                type="button"
                class="nbf-mini-btn"
                :class="{ active: !wasteOnlySentences }"
                @click="wasteOnlySentences = false"
              >
                整段
              </button>
              <button
                type="button"
                class="nbf-mini-btn"
                :class="{ active: wasteOnlySentences }"
                @click="wasteOnlySentences = true"
              >
                只看废句
              </button>
            </div>
            <button type="button" class="nbf-mini-btn" @click="wasteOpen = !wasteOpen">
              {{ wasteOpen ? '收起' : '展开' }}
            </button>
          </div>
        </header>
        <div v-if="wasteOpen" class="nbf-waste-blocks">
          <article v-for="block in wasteBlocks" :key="`wb-${block.itemKey}`" class="nbf-waste-block">
            <header class="nbf-waste-block-head">
              <span class="nbf-chip">{{ block.sourceTag }}</span>
              <span class="nbf-sub">{{ block.wasteSentences.length }} 句解析不出</span>
            </header>
            <!-- 整段：原封不动；解析不出的句子只做淡色 + 下划线标记（不删字、不拆条） -->
            <p v-if="!wasteOnlySentences" class="nbf-waste-raw">
              <template v-for="(segment, index) in block.segments" :key="`seg-${index}`">
                <span :class="{ 'nbf-waste-mark': segment.waste }">{{ segment.text }}</span>
              </template>
            </p>
            <!-- 只看废句：逐句列出（默认折叠原因） -->
            <ul v-else class="nbf-waste-lines">
              <li v-for="sentence in block.wasteSentences" :key="`wl-${sentence.sentenceIndex}`">
                <span class="nbf-chip">第 {{ sentence.sentenceIndex + 1 }} 句</span>
                <span class="nbf-waste-mark">{{ sentence.text }}</span>
              </li>
            </ul>
            <details v-if="block.wasteSentences.some((sentence) => sentence.reasons.length)" class="nbf-waste-reasons">
              <summary>丢弃原因（{{ block.wasteSentences.length }} 句）</summary>
              <ul>
                <li v-for="sentence in block.wasteSentences" :key="`wr-${sentence.sentenceIndex}`">
                  <span class="nbf-sub">第 {{ sentence.sentenceIndex + 1 }} 句</span>
                  <span class="nbf-waste-reason">{{ sentence.reasons.join(' / ') || '没抓到可量的增益' }}</span>
                </li>
              </ul>
            </details>
          </article>
        </div>
        <p v-if="wasteOpen && !wasteBlocks.length" class="empty-hint">没有废原文。</p>
      </section>

      <!-- 「整块原文」弹窗：剔除完全解析不出来的句子，并高亮当前句。
           **Teleport 到 body**：面板外层容器可能有 transform / overflow，会裁掉 position:fixed 的弹窗 -->
      <Teleport to="body">
        <div v-if="originalVisible && originalItem" class="nbf-modal-mask" @click.self="closeOriginal">
          <div class="nbf-modal">
            <header class="nbf-modal-head">
              <h4>{{ originalItem.slotLabel }} · {{ originalItem.title || '（无标题）' }} · 整块原文</h4>
              <button type="button" class="nbf-mini-btn" @click="closeOriginal">关闭</button>
            </header>
            <p class="nbf-sub">
              写入槽位：{{ originalItem.landing?.label ?? '—' }} ·
              这里只列产出过关键字的句子（完全解析不出来的句子属废原文，只在底部废原文区出现）
            </p>
            <ol class="nbf-original-list">
              <li
                v-for="sentence in originalSentences"
                :key="`o-${sentence.sentenceIndex}`"
                :class="{ 'nbf-original-current': sentence.sentenceIndex === originalHighlight }"
              >
                <span class="nbf-chip">第 {{ sentence.sentenceIndex + 1 }} 句</span>
                <span class="nbf-original-text">{{ sentence.rawSentence }}</span>
                <span class="nbf-sub">{{ sentence.keywords.length }} 条关键字</span>
              </li>
            </ol>
          </div>
        </div>

        <!-- 「解析规则」弹窗：数据全部来自后端 `/rules`（抽取器词表自动导出），界面不手写 -->
        <div v-if="rulesVisible" class="nbf-modal-mask" @click.self="rulesVisible = false">
          <div class="nbf-modal nbf-rules-modal">
            <header class="nbf-modal-head">
              <h4>解析规则对照表{{ rules ? ` · v${rules.version}` : '' }}</h4>
              <button type="button" class="nbf-mini-btn" @click="rulesVisible = false">关闭</button>
            </header>
            <p class="nbf-sub">
              {{ rulesLoading ? '读取中…' : rulesMessage }}
              · 由后端从抽取器词表**自动导出**（单一事实来源），界面不手写
            </p>
            <section v-for="group in rules?.groups ?? []" :key="group.id" class="nbf-rules-group">
              <h5>{{ group.title }}（{{ group.items.length }} 条）</h5>
              <ul class="nbf-rules-list">
                <li v-for="(item, index) in group.items.slice(0, 40)" :key="`r-${group.id}-${index}`">
                  <code>{{ item.game }}</code>
                  <span class="nbf-rules-arrow">→</span>
                  <span>{{ item.slot }}</span>
                  <template v-if="item.field">
                    <span class="nbf-rules-arrow">→</span>
                    <code>{{ item.field }}</code>
                  </template>
                  <span v-if="item.note" class="nbf-sub">{{ item.note }}</span>
                </li>
              </ul>
              <p v-if="group.items.length > 40" class="nbf-sub">…还有 {{ group.items.length - 40 }} 条（完整清单见 dev-docs 导出的 md）</p>
            </section>
          </div>
        </div>
      </Teleport>
    </div>

    <!-- ============================================================ 阶段二 -->
    <div v-show="page === 'stage2'" class="nbf-stage">
      <header class="nbf-stage-head">
        <h3>阶段二 · 关键字 → 实际增益</h3>
        <div class="nbf-stage-actions">
          <button type="button" class="secondary-btn" @click="page = 'stage1'">← 退回阶段一</button>
          <button type="button" class="secondary-btn" :disabled="busy || !rows.length" @click="runParse()">
            {{ parsing ? '解析中…' : '全部解析' }}
          </button>
          <button type="button" class="primary-btn" :disabled="!canWrite" @click="runApply(true)">
            {{ writing ? '准备中…' : '写入（准备）' }}
          </button>
        </div>
      </header>

      <!-- 左选右看：左侧窄（下拉选择 + 勾选 + 详情），右侧宽（当前这一条的实际增益） -->
      <div class="nbf-master">
        <section class="nbf-master-left">
          <h4 class="nbf-col-title">选一条关键字</h4>
          <select v-model="selectedKey" class="field-input nbf-master-select">
            <option v-for="row in orderedRows" :key="`opt-${row.key}`" :value="row.key">
              {{ rowLabel(row) }}
            </option>
          </select>

          <template v-if="activeRow">
            <label class="nbf-include">
              <input
                type="checkbox"
                :checked="activeRow.included"
                @change="toggleIncluded(activeRow, ($event.target as HTMLInputElement).checked)"
              />
              <span>加入这条{{ activeRow.included ? '' : '（当前不加入）' }}</span>
            </label>

            <button type="button" class="nbf-mini-btn" @click="activeRow.detailOpen = !activeRow.detailOpen">
              {{ activeRow.detailOpen ? '收起详情' : '详情' }}
            </button>

            <!-- 详情：信息量不少于阶段一（11 槽位 + 转模槽位 + 来源句 + 指代 / 无法提取标记） -->
            <div v-if="activeRow.detailOpen" class="nbf-detail">
              <p class="nbf-detail-sentence">{{ activeRow.sentence }}</p>
              <p v-if="activeRow.inherited" class="nbf-sub">{{ activeRow.inherited.label }}（属性从前文继承）</p>
              <p v-if="activeRow.tautologyDropped.length" class="nbf-sub">
                同义反复已忽略：{{ activeRow.tautologyDropped.join(' / ') }}
              </p>
              <ul class="nbf-detail-slots">
                <li v-for="entry in SLOT_ORDER" :key="`d-${entry}`">
                  <span class="nbf-slot-label">{{ slotLabel(entry) }}</span>
                  <span
                    class="nbf-detail-value"
                    :class="{ 'nbf-detail-unable': isUnableValue(activeRow.slots[entry]) }"
                  >
                    {{ isUnableValue(activeRow.slots[entry]) ? '⚠X ' : '' }}{{ slotText(activeRow, entry) }}
                  </span>
                </li>
                <template v-if="activeRow.slots.action === '转化' && activeRow.convert">
                  <li v-for="id in CONVERT_SLOT_ORDER" :key="`dc-${id}`">
                    <span class="nbf-slot-label">{{ slotLabel(id) }}</span>
                    <span class="nbf-detail-value">{{ displaySlotValue(id, activeRow.convert[id]) }}</span>
                  </li>
                </template>
              </ul>
              <p class="nbf-sub">
                招式锚点：{{ activeRow.anchors.labels.length ? activeRow.anchors.labels.join(' + ') : '无' }} ·
                状态：{{
                  activeRow.recorded
                    ? activeRow.blocked
                      ? '待补（属性 / 动作 / 数值 标了无法提取 → 阻断）'
                      : softUnableSlotsOf(activeRow).length
                        ? `可写（${softUnableSlotsOf(activeRow).map((id) => slotLabel(id)).join(' / ')} 按「无」处理）`
                        : '可写'
                    : '不录'
                }}
              </p>
            </div>
          </template>

          <h5 class="nbf-col-title nbf-include-title">
            全部关键字（点卡片 = 选中 · 勾选框 = 是否加入 · 影画在最后）
          </h5>
          <ul class="nbf-include-list">
            <li
              v-for="row in orderedRows"
              :key="`inc-${row.key}`"
              class="nbf-list-item"
              :class="{
                'is-current': row.key === activeRow?.key,
                'nbf-include-off': !row.included,
              }"
              role="button"
              tabindex="0"
              :aria-pressed="row.key === activeRow?.key"
              @click="selectedKey = row.key"
              @keydown.enter.prevent="selectedKey = row.key"
              @keydown.space.prevent="selectedKey = row.key"
            >
              <!-- 勾选框独立可点：点击它只切换「加入」，不改变选中 -->
              <input
                class="nbf-list-check"
                type="checkbox"
                :checked="row.included"
                :aria-label="`加入：${rowSourceTag(row)}`"
                @click.stop
                @change="toggleIncluded(row, ($event.target as HTMLInputElement).checked)"
              />
              <span class="nbf-list-body">
                <span class="nbf-list-line1">
                  <span class="nbf-list-source">{{ rowSourceTag(row) }}</span>
                  <span v-if="row.key === activeRow?.key" class="nbf-list-current">当前</span>
                  <span v-if="!row.included" class="nbf-list-off-tag">不加入</span>
                </span>
                <span class="nbf-list-line2">
                  <span class="nbf-chip nbf-chip-stat">{{ displaySlotValue('stat', row.slots.stat) }}</span>
                  <span class="nbf-chip nbf-chip-value">{{ rowValueTag(row) }}</span>
                </span>
                <span class="nbf-list-line3" :title="rowMetaTag(row)">{{ rowMetaTag(row) }}</span>
              </span>
            </li>
          </ul>
        </section>

        <section class="nbf-master-right">
          <h4 class="nbf-col-title">实际增益（增益块全字段 · 可手改）</h4>
          <p v-if="!rows.length" class="empty-hint">还没有关键字：回阶段一 [抓取增益] / [化简]。</p>
          <p v-else-if="!activeRow" class="empty-hint">左侧选一条关键字。</p>
          <div v-else-if="!activeRow.included" class="nbf-excluded">
            这条已取消勾选（**不加入**）：它的增益不参与「写入（准备）」。要看/改就重新勾选「加入这条」。
          </div>
          <div v-for="row in activeRow ? [activeRow] : []" :key="`g-${row.key}`" class="nbf-gain">
            <header class="nbf-kw-head">
              <span class="nbf-kw-index">{{ row.itemSlotLabel }} · 第 {{ row.sentenceIndex + 1 }} 句</span>
              <span v-if="row.stale" class="nbf-badge nbf-badge-warn">关键字里已无此条</span>
              <span v-if="row.added" class="nbf-badge nbf-badge-ok">关键字新增</span>
              <span v-if="row.blocked" class="nbf-badge nbf-badge-drop">{{ row.blockReason }}</span>
              <span v-if="!row.included" class="nbf-badge nbf-badge-warn">不加入</span>
              <span v-if="row.writeLabel" class="nbf-write-label">{{ row.writeLabel }}</span>
            </header>

            <div v-if="row.conflicts.length" class="nbf-conflicts">
              <p class="nbf-sub">解析结果与你的手填值不一致（没有静默覆盖，请逐条裁决）：</p>
              <div v-for="conflict in row.conflicts" :key="`cf-${conflict.field}`" class="nbf-conflict">
                <span class="nbf-slot-label">{{ conflict.label }}</span>
                <span class="nbf-mine">我的：{{ conflict.mine ?? '（空）' }}</span>
                <span class="nbf-theirs">新解析：{{ conflict.theirs ?? '（空）' }}</span>
                <button type="button" class="nbf-mini-btn" @click="resolveConflict(row, conflict, 'mine')">
                  保留我的
                </button>
                <button
                  type="button"
                  class="nbf-mini-btn nbf-danger"
                  @click="resolveConflict(row, conflict, 'theirs')"
                >
                  用新解析
                </button>
              </div>
            </div>

            <div v-if="row.gain" class="nbf-fields">
              <label class="field nbf-field">
                <span class="field-label">属性</span>
                <select v-model="row.gain.stat" class="field-input" @change="markDirty(row, 'stat')">
                  <option v-for="field in BUFF_STAT_FIELDS" :key="field.key" :value="field.key">
                    {{ statFieldLabel(field.key) }}
                  </option>
                </select>
              </label>
              <label class="field nbf-field">
                <span class="field-label">类型</span>
                <select v-model="row.gain.kind" class="field-input" @change="markDirty(row, 'kind')">
                  <option value="fixed">固定值</option>
                  <option value="stacked">叠层</option>
                  <option value="convert">转模</option>
                </select>
              </label>

              <template v-if="row.gain.kind !== 'convert'">
                <label class="field nbf-field">
                  <span class="field-label">数值</span>
                  <input
                    v-model.number="row.gain.value"
                    type="number"
                    class="field-input"
                    @change="markDirty(row, 'value')"
                  />
                </label>
                <label v-if="row.gain.kind === 'stacked'" class="field nbf-field">
                  <span class="field-label">每层值</span>
                  <input
                    v-model.number="row.gain.valuePerStack"
                    type="number"
                    class="field-input"
                    @change="markDirty(row, 'valuePerStack')"
                  />
                </label>
                <label v-if="row.gain.kind === 'stacked'" class="field nbf-field">
                  <span class="field-label">层数上限</span>
                  <input
                    v-model.number="row.gain.maxStacks"
                    type="number"
                    class="field-input"
                    @change="markDirty(row, 'maxStacks')"
                  />
                </label>
                <label class="field nbf-field">
                  <span class="field-label">默认层数</span>
                  <input
                    v-model.number="row.gain.defaultStacks"
                    type="number"
                    class="field-input"
                    @change="markDirty(row, 'defaultStacks')"
                  />
                </label>
              </template>

              <template v-else-if="row.gain.convert">
                <label class="field nbf-field">
                  <span class="field-label" :title="slotHint('convertFrom')">读取属性</span>
                  <select
                    v-model="row.gain.convert.from"
                    class="field-input"
                    @change="markDirty(row, 'convert')"
                  >
                    <option v-for="option in optionsOf('convertFrom')" :key="option" :value="option">
                      {{ displaySlotValue('convertFrom', option) }}
                    </option>
                  </select>
                </label>
                <label class="field nbf-field">
                  <span class="field-label" :title="slotHint('convertPanelSource')">取哪一层</span>
                  <select
                    v-model="row.gain.convert.panelSource"
                    class="field-input"
                    @change="markDirty(row, 'convert')"
                  >
                    <option v-for="option in optionsOf('convertPanelSource')" :key="option" :value="option">
                      {{ displaySlotValue('convertPanelSource', option) }}
                    </option>
                  </select>
                </label>
                <label class="field nbf-field">
                  <span class="field-label" :title="slotHint('convertRatio')">折算比例</span>
                  <input
                    v-model.number="row.gain.convert.ratioPercent"
                    type="number"
                    class="field-input"
                    @change="markDirty(row, 'convert')"
                  />
                </label>
                <label class="field nbf-field">
                  <span class="field-label" :title="slotHint('convertBase')">基础值</span>
                  <input
                    v-model.number="row.gain.convert.defaultBase"
                    type="number"
                    class="field-input"
                    @change="markDirty(row, 'convert')"
                  />
                </label>
                <label class="field nbf-field">
                  <span class="field-label">初始基础值</span>
                  <input
                    v-model.number="row.gain.convert.initialBase"
                    type="number"
                    class="field-input"
                    @change="markDirty(row, 'convert')"
                  />
                </label>
                <label class="field nbf-field">
                  <span class="field-label" :title="slotHint('convertCap')">上限</span>
                  <input
                    v-model.number="row.gain.convert.cap"
                    type="number"
                    class="field-input"
                    @change="markDirty(row, 'convert')"
                  />
                </label>
              </template>

              <label class="field nbf-field">
                <span class="field-label">生效目标</span>
                <select
                  v-model="row.gain.applyTarget"
                  class="field-input"
                  @change="markDirty(row, 'applyTarget')"
                >
                  <option value="self">自身</option>
                  <option value="team">全队</option>
                </select>
              </label>
              <label class="field nbf-field">
                <span class="field-label">生效情形</span>
                <select
                  v-model="row.gain.applySituation"
                  class="field-input"
                  @change="markDirty(row, 'applySituation')"
                >
                  <option value="global">全局</option>
                  <option value="stagger">失衡期</option>
                  <option value="non_stagger">非失衡期</option>
                </select>
              </label>
              <label class="field nbf-field">
                <span class="field-label">范围</span>
                <select v-model="row.gain.scope" class="field-input" @change="markDirty(row, 'scope')">
                  <option v-for="option in BUFF_SCOPE_OPTIONS" :key="option.id" :value="option.id">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label class="field nbf-field">
                <span class="field-label">受益职业</span>
                <select
                  v-model="row.gain.applyProfession"
                  class="field-input"
                  @change="markDirty(row, 'applyProfession')"
                >
                  <option :value="null">不限</option>
                  <option v-for="role in AGENT_ROLES" :key="role" :value="role">{{ role }}</option>
                </select>
              </label>

              <div class="field nbf-field nbf-field-wide">
                <span class="field-label">元素过滤</span>
                <div class="checkbox-grid">
                  <label class="checkbox-item">
                    <input
                      type="checkbox"
                      :checked="row.gain.elementFilter === 'all'"
                      @change="setElementAll(row, ($event.target as HTMLInputElement).checked)"
                    />
                    <span>不限</span>
                  </label>
                  <label v-for="element in AGENT_ELEMENTS" :key="element" class="checkbox-item">
                    <input
                      type="checkbox"
                      :checked="isElementChecked(row, element)"
                      @change="toggleElement(row, element)"
                    />
                    <span>{{ element }}</span>
                  </label>
                </div>
              </div>

              <div class="field nbf-field nbf-field-wide">
                <span class="field-label">招式目标（skillTargets · 锚点）</span>
                <div v-for="(target, targetIndex) in row.gain.skillTargets" :key="`st-${targetIndex}`" class="nbf-target">
                  <select
                    v-model="target.category"
                    class="field-input"
                    @change="markDirty(row, 'skillTargets')"
                  >
                    <option v-for="option in BUFF_SKILL_TARGET_OPTIONS" :key="option.id" :value="option.id">
                      {{ option.label }}
                    </option>
                  </select>
                  <select
                    v-model="target.subcategoryId"
                    class="field-input"
                    @change="markDirty(row, 'skillTargets')"
                  >
                    <option :value="null">整大类</option>
                    <option v-for="sub in subcategoryOptions" :key="sub.id" :value="sub.id">
                      {{ sub.name }}
                    </option>
                  </select>
                  <button type="button" class="nbf-mini-btn nbf-danger" @click="removeSkillTarget(row, targetIndex)">
                    ×
                  </button>
                </div>
                <button type="button" class="nbf-mini-btn" @click="addSkillTarget(row)">+ 招式目标</button>
              </div>

              <div class="field nbf-field nbf-field-wide">
                <span class="field-label">队伍职业条件</span>
                <div class="nbf-target">
                  <select
                    v-model="row.gain.teamProfession"
                    class="field-input"
                    @change="markDirty(row, 'teamProfession')"
                  >
                    <option :value="null">不限</option>
                    <option v-for="role in AGENT_ROLES" :key="role" :value="role">{{ role }}</option>
                  </select>
                  <label v-for="(tier, tierIndex) in row.gain.teamProfessionValues" :key="`t-${tierIndex}`" class="checkbox-item">
                    <input
                      type="checkbox"
                      :checked="tier != null"
                      @change="
                        row.gain.teamProfessionValues[tierIndex] = ($event.target as HTMLInputElement).checked
                          ? 0
                          : null;
                        markDirty(row, 'teamProfessionValues')
                      "
                    />
                    <span>恰好 {{ tierIndex + 1 }} 人</span>
                  </label>
                </div>
              </div>

              <label class="field nbf-field">
                <span class="field-label">计入异常</span>
                <input
                  type="checkbox"
                  :checked="row.gain.appliesToAnomaly"
                  @change="
                    row.gain.appliesToAnomaly = ($event.target as HTMLInputElement).checked;
                    markDirty(row, 'appliesToAnomaly')
                  "
                />
              </label>
              <label class="field nbf-field">
                <span class="field-label">默认启用</span>
                <input
                  type="checkbox"
                  :checked="row.gain.enabledDefault"
                  @change="
                    row.gain.enabledDefault = ($event.target as HTMLInputElement).checked;
                    markDirty(row, 'enabledDefault')
                  "
                />
              </label>
              <label class="field nbf-field nbf-field-wide">
                <span class="field-label">备注</span>
                <textarea
                  v-model="row.gain.note"
                  class="field-textarea"
                  rows="2"
                  @change="markDirty(row, 'note')"
                />
              </label>
            </div>
            <p v-else class="empty-hint">这条不录（招式锚点关联不上）或还没解析。</p>
          </div>
        </section>
      </div>

      <section v-if="writePlan" class="nbf-plan">
        <h4 class="nbf-col-title">写入（准备）结果 —— 未写入</h4>
        <ul class="nbf-plan-list">
          <li v-for="(detail, index) in writePlan.details" :key="`d-${index}`">
            <span class="nbf-chip">{{ detail.slotLabel }}</span>
            <span>{{ detail.container }}[{{ detail.containerIndex ?? '-' }}] · 块「{{ detail.blockName }}」</span>
            <span class="nbf-sub">新增 {{ detail.added }} / 重复跳过 {{ detail.duplicates }}</span>
            <span v-if="detail.reason" class="nbf-waste-reason">{{ detail.reason }}</span>
          </li>
          <li v-for="(anchor, index) in writePlan.anchors" :key="`an-${index}`">
            <span class="nbf-chip">招式锚点</span>
            <span>{{ anchor.categoryId }} · {{ anchor.name }}：{{ anchor.action === 'create' ? '新建小类并关联' : anchor.action === 'exists' ? '已有关联' : anchor.action === 'create-pending' ? '将新建（未写入）' : '建失败' }}</span>
            <span v-if="anchor.reason" class="nbf-waste-reason">{{ anchor.reason }}</span>
          </li>
          <li v-for="(anchor, index) in writePlan.unresolvedAnchors" :key="`ua-${index}`">
            <span class="nbf-chip">锚点不录</span>
            <span>{{ anchor.name }}</span>
            <span class="nbf-waste-reason">{{ anchor.reason }}</span>
          </li>
          <li v-for="(skill, index) in writePlan.skillDescs" :key="`sd-${index}`">
            <span class="nbf-chip">技能描述</span>
            <span>{{ skill.skillName }}：{{ skill.appended ? '追加' : skill.duplicate ? '已含' : '未改' }}</span>
            <span v-if="skill.reason" class="nbf-waste-reason">{{ skill.reason }}</span>
          </li>
        </ul>
        <p v-if="writeMessage" class="nbf-status">{{ writeMessage }}</p>
      </section>
    </div>

    <AdminConfirmDialog
      :visible="confirmVisible"
      title="确认写入 nanoka 增益"
      :message="confirmMessage"
      confirm-text="确认写入"
      :danger="true"
      :loading="writing"
      @confirm="runApply(false)"
      @cancel="closeConfirm"
    />
    <AdminConfirmDialog
      :visible="authDialogVisible"
      title="需要重新登录"
      message="当前后台会话无效或已过期，无法抓取 / 写入。请重新登录管理员账号后再试。"
      confirm-text="去登录"
      cancel-text="稍后"
      @confirm="goRelogin"
      @cancel="authDialogVisible = false"
    />
  </section>
</template>

<style scoped src="./adminCalculatorPanel.css"></style>
<style scoped>
.nanoka-buff-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.nbf-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
}

.nbf-field {
  min-width: 12rem;
}

.nbf-field-wide {
  min-width: 100%;
}

.nbf-kind-tabs,
.nbf-page-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.nbf-tab {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  padding: 0.5rem 0.9rem;
  font-size: 0.88rem;
  cursor: pointer;
}

.nbf-tab.active {
  border-color: hsla(160, 100%, 37%, 0.6);
  background: hsla(160, 100%, 37%, 0.12);
  font-weight: 600;
}

.nbf-status {
  margin: 0;
  font-size: 0.82rem;
  color: var(--color-text);
  opacity: 0.8;
}

.nbf-count {
  font-size: 0.82rem;
  opacity: 0.75;
}

.nbf-stage {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.nbf-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.nbf-stage-head h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-heading);
}

.nbf-stage-actions {
  display: flex;
  gap: 0.5rem;
}

.nbf-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
}

@media (max-width: 1200px) {
  .nbf-columns {
    grid-template-columns: minmax(0, 1fr);
  }
}

.nbf-col {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}

.nbf-col-title {
  margin: 0;
  font-size: 0.85rem;
  letter-spacing: 0.04em;
  color: var(--color-heading);
  opacity: 0.85;
}

/* 按句配对：左 = 该句原文（约 1/3），右 = 该句关键字（约 2/3）；**每对独立成块**，行高按较长一侧撑开 */
.nbf-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 0.75rem;
  align-items: stretch;
  margin-top: 0.5rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft, rgba(250, 248, 242, 0.6));
}

.nbf-pair + .nbf-pair {
  margin-top: 0.7rem;
}

@media (max-width: 1100px) {
  .nbf-pair {
    grid-template-columns: minmax(0, 1fr);
  }
}

.nbf-pair-raw {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.nbf-pair-raw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.nbf-pair-kw {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

/* 「整块原文」弹窗 */
.nbf-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(20, 18, 12, 0.42);
}

.nbf-modal {
  width: min(920px, 100%);
  max-height: 78vh;
  overflow: auto;
  padding: 1rem 1.1rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background);
  box-shadow: 0 18px 48px rgba(20, 18, 12, 0.28);
}

.nbf-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-bottom: 0.4rem;
}

.nbf-modal-head h4 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--color-heading);
}

.nbf-original-list {
  margin: 0.6rem 0 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.nbf-original-list li {
  padding: 0.35rem 0.45rem;
  border-radius: 8px;
  line-height: 1.5;
}

.nbf-original-current {
  border: 1px solid var(--color-border-hover);
  background: var(--color-background-mute, rgba(232, 229, 218, 0.7));
  font-weight: 600;
}

.nbf-original-text {
  margin: 0 0.4rem;
}

/* 阶段二：左选右看（左侧窄 = 选择器 + 详情，右侧宽 = 当前这条的实际增益） */
.nbf-master {
  display: grid;
  grid-template-columns: minmax(0, 340px) minmax(0, 1fr);
  gap: 0.9rem;
  align-items: start;
}

@media (max-width: 1100px) {
  .nbf-master {
    grid-template-columns: minmax(0, 1fr);
  }
}

.nbf-master-left {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft, rgba(250, 248, 242, 0.6));
}

.nbf-master-right {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.nbf-master-select {
  width: 100%;
}

.nbf-include {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
}

.nbf-include-title {
  margin-top: 0.5rem;
}

.nbf-include-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-height: 24rem;
  overflow: auto;
  font-size: 0.78rem;
}

/* 条目：统一行高 / 缩进 / 分隔；三种状态各不一样（选中 / hover / 不加入） */
.nbf-list-item {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  padding: 0.35rem 0.45rem 0.35rem 0.5rem;
  border: 1px solid var(--color-border);
  border-left: 3px solid transparent;
  border-radius: 8px;
  background: var(--color-background-soft, #fff);
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
}

.nbf-list-item + .nbf-list-item {
  margin-top: 0.2rem;
}

.nbf-list-item:hover {
  border-color: var(--color-border-hover);
}

.nbf-list-item:focus-visible {
  outline: 2px solid #b8860b;
  outline-offset: 1px;
}

/* 选中态：白底 + 强调色左边框 + 极浅底色（不做大面积金/棕底，避免糊成一片） */
.nbf-list-item.is-current {
  border-color: var(--color-border-hover);
  border-left-color: #b8860b;
  background: #fffdf7;
  box-shadow: inset 0 0 0 1px rgba(184, 134, 11, 0.14);
}

.nbf-list-check {
  margin-top: 0.15rem;
  cursor: pointer;
}

.nbf-list-label {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
}

.nbf-list-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  cursor: pointer;
}

.nbf-list-line1 {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  opacity: 0.8;
}

.nbf-list-item.is-current .nbf-list-line1 {
  opacity: 1;
  font-weight: 700;
}

.nbf-list-current {
  padding: 0 0.25rem;
  border: 1px solid rgba(184, 134, 11, 0.55);
  border-radius: 4px;
  background: #fff;
  color: #8a5a12;
  font-size: 0.66rem;
  font-weight: 700;
}

.nbf-list-off-tag {
  padding: 0 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.66rem;
}

.nbf-list-line2 {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.nbf-chip-stat,
.nbf-chip-value {
  padding: 0.05rem 0.3rem;
  border-radius: 6px;
  font-size: 0.74rem;
  font-weight: 600;
  white-space: nowrap;
}

.nbf-chip-stat {
  background: rgba(60, 90, 150, 0.16);
  color: #2f4c86;
}

.nbf-chip-value {
  background: rgba(30, 120, 80, 0.16);
  color: #1f6b4a;
}

/* 第三行：动作 / 作用域 / 条件，超长省略号 + 悬浮显示全文 */
.nbf-list-line3 {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.7rem;
  opacity: 0.7;
}

/* 不加入：文字标灰划掉（与「选中」并存时仍保留强调色左边框） */
.nbf-include-off .nbf-list-body {
  opacity: 0.5;
  text-decoration: line-through;
}

.nbf-include-off .nbf-chip-stat,
.nbf-include-off .nbf-chip-value {
  filter: grayscale(1);
  opacity: 0.75;
}

.nbf-link-btn {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.nbf-link-btn:hover {
  text-decoration: underline;
}

.nbf-detail {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.5rem 0.55rem;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
}

.nbf-detail-sentence {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
}

.nbf-detail-slots {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.78rem;
}

.nbf-detail-slots li {
  display: flex;
  gap: 0.4rem;
}

.nbf-detail-slots .nbf-slot-label {
  flex: 0 0 4.6rem;
}

.nbf-detail-value {
  min-width: 0;
  overflow-wrap: anywhere;
}

.nbf-detail-unable {
  color: #b23b2e;
  font-weight: 600;
}

.nbf-excluded {
  padding: 0.5rem 0.6rem;
  border: 1px dashed var(--color-border-hover);
  border-radius: 8px;
  font-size: 0.82rem;
  opacity: 0.85;
}

.nbf-badge-inherit {
  border-color: rgba(150, 110, 30, 0.45);
  color: #8a5a12;
}

/* 废原文：按来源块整段展示（解析不出的句子只做淡色 + 下划线标记，不删字不拆条） */
.nbf-waste-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.nbf-toggle {
  display: inline-flex;
  gap: 0.2rem;
}

.nbf-toggle .nbf-mini-btn.active {
  border-color: #b8860b;
  color: #8a5a12;
  font-weight: 700;
}

.nbf-waste-blocks {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 0.4rem;
}

.nbf-waste-block {
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft, rgba(250, 248, 242, 0.6));
}

.nbf-waste-block-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.3rem;
}

.nbf-waste-raw {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.nbf-waste-mark {
  color: var(--color-text);
  opacity: 0.55;
  text-decoration: underline dotted;
}

.nbf-waste-lines {
  margin: 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.8rem;
}

.nbf-waste-reasons {
  margin-top: 0.35rem;
  font-size: 0.76rem;
}

.nbf-waste-reasons summary {
  cursor: pointer;
  opacity: 0.8;
}

.nbf-waste-reasons ul {
  margin: 0.25rem 0 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

/* 无法提取的两种状态：软（按无处理）vs 硬（待补 · 阻断） */
.nbf-unable-tag {
  padding: 0 0.25rem;
  border-radius: 4px;
  font-size: 0.66rem;
  font-style: normal;
}

.nbf-unable-tag.is-soft {
  background: rgba(120, 120, 100, 0.16);
  color: var(--color-text);
  opacity: 0.85;
}

.nbf-unable-tag.is-hard {
  background: rgba(178, 59, 46, 0.16);
  color: #b23b2e;
  font-weight: 700;
}

/* 淡色「默认」标记：目标值是按规则兜底的（敌人削弱族 → 全队），一眼能改 */
.nbf-default-mark {
  margin-left: 0.3rem;
  padding: 0 0.25rem;
  font-size: 0.68rem;
  font-style: normal;
  border-radius: 4px;
  background: rgba(120, 120, 100, 0.16);
  color: var(--color-text);
  opacity: 0.75;
}

.nbf-badge-muted {
  border-color: rgba(120, 120, 100, 0.35);
  color: var(--color-text);
  opacity: 0.8;
}

/* 「解析规则」弹窗 */
.nbf-rules-modal {
  width: min(1080px, 100%);
}

.nbf-rules-group {
  margin-top: 0.7rem;
}

.nbf-rules-group h5 {
  margin: 0 0 0.3rem;
  font-size: 0.85rem;
  color: var(--color-heading);
}

.nbf-rules-list {
  margin: 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.8rem;
}

.nbf-rules-list code {
  padding: 0 0.2rem;
  border-radius: 4px;
  background: var(--color-background-mute, rgba(232, 229, 218, 0.7));
}

.nbf-rules-arrow {
  margin: 0 0.3rem;
  opacity: 0.6;
}

.nbf-item,
.nbf-kw-row,
.nbf-gain,
.nbf-plan {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
  padding: 0.6rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.nbf-item-head,
.nbf-kw-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.nbf-item-title {
  font-size: 0.85rem;
  color: var(--color-heading);
}

.nbf-chip {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
  font-size: 0.72rem;
  opacity: 0.85;
}

.nbf-badge {
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
  font-size: 0.72rem;
}

.nbf-badge-ok {
  background: hsla(160, 100%, 37%, 0.16);
}

.nbf-badge-waste,
.nbf-badge-warn {
  background: hsla(45, 90%, 50%, 0.18);
}

.nbf-badge-drop {
  background: hsla(0, 70%, 50%, 0.2);
}

.nbf-badge-anchor {
  background: hsla(210, 80%, 55%, 0.18);
}

.nbf-sub {
  font-size: 0.75rem;
  opacity: 0.7;
}

.nbf-raw-text {
  margin: 0;
  white-space: pre-wrap;
  font-size: 0.82rem;
  line-height: 1.55;
}

.nbf-kw-group-head {
  margin: 0.5rem 0 0.25rem;
  font-size: 0.8rem;
  color: var(--color-heading);
}

.nbf-kw-row-off {
  opacity: 0.55;
}

.nbf-kw-index {
  font-size: 0.72rem;
  opacity: 0.7;
}

.nbf-kw-summary {
  font-size: 0.8rem;
}

.nbf-kw-sentence {
  margin: 0;
  font-size: 0.75rem;
  opacity: 0.7;
}

.nbf-slots {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.nbf-slot {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.2rem 0.4rem;
  background: var(--color-background);
}

.nbf-slot-label {
  font-size: 0.72rem;
  opacity: 0.8;
  white-space: nowrap;
}

.nbf-slot-input {
  min-width: 7rem;
  padding: 0.15rem 0.35rem;
  font-size: 0.78rem;
}

.nbf-slot-unable {
  border-color: hsla(0, 70%, 50%, 0.5);
}

.nbf-slot-empty {
  opacity: 0.6;
}

.nbf-conditions {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.nbf-condition {
  display: flex;
  gap: 0.2rem;
}

.nbf-mini-btn {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.72rem;
  padding: 0.1rem 0.4rem;
  cursor: pointer;
}

.nbf-mini-btn.nbf-danger {
  color: #c45c5c;
}

.nbf-waste {
  border: 1px dashed var(--color-border);
  border-radius: 10px;
  padding: 0.6rem 0.75rem;
}

.nbf-waste-list {
  margin: 0.4rem 0 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
}

.nbf-waste-text {
  margin-right: 0.4rem;
}

.nbf-waste-reason {
  color: #c98a3a;
  font-size: 0.74rem;
}

.nbf-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.nbf-fields .nbf-field {
  min-width: 9rem;
  flex: 1 1 9rem;
}

.nbf-target {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}

.nbf-conflicts {
  border: 1px solid hsla(45, 90%, 50%, 0.5);
  border-radius: 8px;
  padding: 0.4rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.nbf-conflict {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
}

.nbf-mine {
  color: hsl(160, 100%, 40%);
}

.nbf-theirs {
  color: #c98a3a;
}

.nbf-write-label {
  font-size: 0.75rem;
  color: hsl(160, 100%, 42%);
}

.nbf-plan-list {
  margin: 0.4rem 0 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
}
</style>

