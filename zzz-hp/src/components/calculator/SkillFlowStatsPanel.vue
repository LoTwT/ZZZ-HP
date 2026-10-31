<script setup lang="ts">
import InfoTip from '@/components/common/InfoTip.vue'
import { computed, nextTick, ref, watch } from 'vue'
import FlowDamageModule from '@/components/calculator/FlowDamageModule.vue'
import SkillFlowDamageRecordComparison from '@/components/calculator/SkillFlowDamageRecordComparison.vue'
import { captureSkillFlowDamageSnapshot } from '@/utils/skillFlowDamageRecordComparison'
import { buildSkillFlowDamageAnalysisFromSnapshot } from '@/utils/skillFlowDamageRecordAnalysis'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc } from '@/types/calculator'
import type { SchemeSlot } from '@/types/damageCalcHistory'
import type { ResolvedHit } from '@/utils/resolvedHit'
import type { SkillFlowCalculationDetail } from '@/utils/skillFlowCalculation'
import { buildSkillFlowDamageAnalysis } from '@/utils/skillFlowDamageAnalysis'
import {
  exportSkillFlowDamageRecords,
  loadSkillFlowDamageRecords,
  appendSkillFlowDamageRecords,
  parseSkillFlowDamageRecordExport,
  normalizeSkillFlowDamageRecordName,
  saveSkillFlowDamageRecords,
  skillFlowDamageRecordLabel,
  type SkillFlowDamageRecord,
  type SkillFlowDamageRecordSlotMeta,
} from '@/utils/skillFlowDamageRecords'

const props = defineProps<{
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  slots?: SchemeSlot[]
  hits?: ResolvedHit[]
  hitDamages?: Record<string, number>
  activeSlotIndex: number
  resolveCalculationDetail?: (hitId: string) => SkillFlowCalculationDetail | null
  /** 当前加载的方案名；未归档为空 */
  schemeName?: string
  /** 每槽位的配置摘要（影画/音擎/驱动盘），记录时一并存入 */
  slotMeta?: SkillFlowDamageRecordSlotMeta[]
}>()

const UNSAVED_SCHEME_LABEL = '未保存'
/** 记录列表里的「记录 0」：当前流程，不可改名/删除/拖动 */
const CURRENT_RECORD_ID = '__current__'

const records = ref<SkillFlowDamageRecord[]>(loadSkillFlowDamageRecords())
const recordSaveError = ref(false)
/** 正在改名的记录 id；与记录列表同源，改名后由 watch(records) 自动落库 */
const renamingRecordId = ref('')
const renamingRecordValue = ref('')

watch(
  records,
  (list) => {
    recordSaveError.value = !saveSkillFlowDamageRecords(list)
  },
  { deep: true },
)

function formatNum(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return Math.round(value).toLocaleString('en-US')
}

function formatPct(part: number, whole: number) {
  if (!(whole > 0) || !(part > 0)) return '0%'
  return `${((part / whole) * 100).toFixed(2)}%`
}

function agentName(agentId: string | undefined) {
  if (!agentId) return '未选'
  return props.agents.find((item) => item.id === agentId)?.name || '未知'
}

const analysis = computed(() =>
  buildSkillFlowDamageAnalysis({
    slotCount: props.teamSlots.length,
    slots: props.slots,
    hits: props.hits,
    hitDamages: props.hitDamages,
  }),
)
const teamTotal = computed(() => analysis.value.total)
const currentTotal = computed(() => analysis.value.slots[props.activeSlotIndex]?.total ?? 0)

/** 当前流程也作为一条对比用记录参与记录结构对比（不落库、不占列表序号） */
const currentRecordForComparison = computed<SkillFlowDamageRecord>(() => ({
  id: CURRENT_RECORD_ID,
  savedAt: Date.now(),
  current: currentTotal.value,
  team: teamTotal.value,
  agentName: agentName(props.teamSlots[props.activeSlotIndex]?.agentId),
  schemeName: '当前流程',
  agentNames: props.teamSlots.map((slot) => agentName(slot.agentId)),
  slotMeta: props.slotMeta ? [...props.slotMeta] : undefined,
  snapshot: captureSkillFlowDamageSnapshot(
    analysis.value,
    props.teamSlots.map((slot) => slot.agentId),
  ),
}))

function currentSchemeLabel() {
  const name = props.schemeName?.trim()
  return name || UNSAVED_SCHEME_LABEL
}

function formatRecordTime(savedAt: number) {
  const date = new Date(savedAt)
  if (!Number.isFinite(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function recordLabel(rec: SkillFlowDamageRecord) {
  return skillFlowDamageRecordLabel(rec)
}

/** 记录柱状图：每个角色一个固定颜色（按 agentId 首次出现顺序分配），旧记录用中性灰 */
const AGENT_RECORD_COLORS = ['#5b8def', '#4caf8a', '#e08a3c', '#9b7ed9', '#d46a6a']
const LEGACY_RECORD_COLOR = '#6b7280'

/** 柱状图要一起比长短的对象：记录 0（当前流程）+ 已保存记录 */
const barRecords = computed<SkillFlowDamageRecord[]>(() => [
  currentRecordForComparison.value,
  ...records.value,
])

const recordAgentColorMap = computed(() => {
  const positive = new Set<string>()
  for (const rec of barRecords.value) {
    if (!rec.snapshot) continue
    for (const line of rec.snapshot.lines) {
      if (!(line.total > 0)) continue
      positive.add(rec.snapshot.agentIds[line.slotIndex] || `slot-${line.slotIndex + 1}`)
    }
  }
  const map = new Map<string, string>()
  for (const rec of barRecords.value) {
    rec.snapshot?.agentIds.forEach((id, slot) => {
      const key = id || `slot-${slot + 1}`
      if (!positive.has(key) || map.has(key)) return
      map.set(key, AGENT_RECORD_COLORS[map.size % AGENT_RECORD_COLORS.length]!)
    })
  }
  return map
})

const recordLegend = computed(() => {
  const seen = new Map<string, { key: string; name: string; color: string }>()
  for (const rec of barRecords.value) {
    rec.snapshot?.agentIds.forEach((id, slot) => {
      const key = id || `slot-${slot + 1}`
      const color = recordAgentColorMap.value.get(key)
      if (!color || seen.has(key)) return
      seen.set(key, {
        key,
        name: rec.agentNames[slot]?.trim() || `角色${slot + 1}`,
        color,
      })
    })
  }
  return [...seen.values()]
})

const hasLegacyRecord = computed(() => records.value.some((rec) => !rec.snapshot))

/** 柱状图角色筛选：空 = 全队；勾选后未选中的分段置灰（数值与长度不变） */
const barAgentFilter = ref<string[]>([])
const barAgentFilterActive = computed(() => barAgentFilter.value.length > 0)

const barAgentOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const rec of barRecords.value) {
    rec.snapshot?.agentIds.forEach((id, slot) => {
      if (!id || seen.has(id)) return
      seen.set(id, rec.agentNames[slot]?.trim() || `角色${slot + 1}`)
    })
  }
  return [...seen.entries()].map(([id, name]) => ({ id, name }))
})

// 记录被删或换队后，剔除已经不存在的角色
watch(barAgentOptions, (options) => {
  const ids = new Set(options.map((option) => option.id))
  const next = barAgentFilter.value.filter((id) => ids.has(id))
  if (next.length !== barAgentFilter.value.length) barAgentFilter.value = next
})

function toggleBarAgent(id: string) {
  barAgentFilter.value = barAgentFilter.value.includes(id)
    ? barAgentFilter.value.filter((item) => item !== id)
    : [...barAgentFilter.value, id]
}

function clearBarAgentFilter() {
  barAgentFilter.value = []
}

function barSegmentMuted(key: string) {
  return barAgentFilterActive.value && !barAgentFilter.value.includes(key)
}
const recordBarMax = computed(() => Math.max(0, ...barRecords.value.map((rec) => rec.team)) || 1)

interface RecordMetaBlock {
  label: string
  value: string
  /** 顶栏槽位卡的配色：音擎金色、驱动盘蓝色 */
  kind: 'wengine' | 'disc'
}

interface RecordBarSegment {
  key: string
  name: string
  total: number
  /** 角色筛选未命中：置灰但保留长度 */
  muted: boolean
  /** 该槽位影画，跟在角色名后展示 */
  rankLabel: string
  color: string
  widthPercent: string
  /** 记录时该槽位的影画/音擎/驱动盘（像顶栏一样分块） */
  metaBlocks: RecordMetaBlock[]
}

/** 槽位配置 → 顶栏槽位卡同款分块（标签 + 值） */
function slotMetaBlocks(meta?: SkillFlowDamageRecordSlotMeta): RecordMetaBlock[] {
  if (!meta) return []
  if (meta.text) return [{ label: '', value: meta.text, kind: 'disc' }]
  const blocks: RecordMetaBlock[] = []
  // 影画跟在角色名后面（见 segmentTip.rankLabel），这里不再单独开块
  // 音擎 / 驱动盘按顶栏槽位卡的「标签 + 名字」小卡展示
  if (meta.wengine) {
    blocks.push({
      label: '音擎',
      value: `${meta.wengine}${meta.wengineRefine ? ` · 精${meta.wengineRefine}` : ''}`,
      kind: 'wengine',
    })
  }
  if (meta.disc4) blocks.push({ label: '4件套', value: meta.disc4, kind: 'disc' })
  if (meta.disc2) blocks.push({ label: '2件套', value: meta.disc2, kind: 'disc' })
  // 旧记录只存了「4件套 X / 2件套 Y / 未选」整串
  if (meta.disc) blocks.push({ label: '驱动盘', value: meta.disc, kind: 'disc' })
  return blocks
}

/** 影画跟在角色名后（顶栏同一口径：N影） */
function rankLabelOf(meta?: SkillFlowDamageRecordSlotMeta) {
  return meta?.rank != null ? `${meta.rank}影` : ''
}

/** 一条记录 → 横向堆叠条的各段（按角色/槽位），宽度相对所有记录的最大总伤 */
function recordSegments(rec: SkillFlowDamageRecord): RecordBarSegment[] {
  const max = recordBarMax.value
  const toWidth = (total: number) => `${Math.max(0, Math.min(100, (total / max) * 100))}%`
  if (!rec.snapshot) {
    return [
      {
        key: `${rec.id}-legacy`,
        name: '仅总伤',
        total: rec.team,
        color: LEGACY_RECORD_COLOR,
        widthPercent: toWidth(rec.team),
        muted: false,
        rankLabel: '',
        metaBlocks: [],
      },
    ]
  }
  const bySlot = new Map<number, number>()
  for (const line of rec.snapshot.lines) {
    bySlot.set(line.slotIndex, (bySlot.get(line.slotIndex) ?? 0) + line.total)
  }
  const segments = [...bySlot.entries()]
    .filter(([, total]) => total > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([slot, total]) => {
      const key = rec.snapshot!.agentIds[slot] || `slot-${slot + 1}`
      return {
        key: `${rec.id}-${key}`,
        name: rec.agentNames[slot]?.trim() || `角色${slot + 1}`,
        total,
        color: recordAgentColorMap.value.get(key) ?? LEGACY_RECORD_COLOR,
        widthPercent: toWidth(total),
        muted: barSegmentMuted(key),
        rankLabel: rankLabelOf(rec.slotMeta?.[slot]),
        metaBlocks: slotMetaBlocks(rec.slotMeta?.[slot]),
      }
    })
  if (segments.length) return segments
  return [
    {
      key: `${rec.id}-empty`,
      name: '无明细',
      total: rec.team,
      color: LEGACY_RECORD_COLOR,
      widthPercent: toWidth(rec.team),
      muted: false,
      rankLabel: '',
      metaBlocks: [],
    },
  ]
}

function recordBarTitle(rec: SkillFlowDamageRecord) {
  const parts = recordSegments(rec).map(
    (seg) => `${seg.name} ${formatNum(seg.total)}（${formatPct(seg.total, rec.team)}）`,
  )
  return [`全队 ${formatNum(rec.team)}`, ...parts].join('\n')
}

/** 对比参考记录：'__prev__' = 上一条（默认），否则为选中的记录 id */
const recordRefId = ref<string>('__prev__')
const RECORD_REF_PREV = '__prev__'

/** 该行要比对的参考记录；选了自己或找不到参考时返回 undefined（显示 '—'） */
/**
 * 当前角色筛选下的合计：选了角色就只算这些角色，没选就是记录全队。
 * 旧记录没有分角色明细，无法拆，仍按总伤算。
 */
function recordFilteredTeam(rec: SkillFlowDamageRecord): number {
  if (!barAgentFilterActive.value) return rec.team
  const snapshot = rec.snapshot
  if (!snapshot) return rec.team
  const pick = new Set(barAgentFilter.value)
  return snapshot.lines.reduce((total, line) => {
    const agentId = snapshot.agentIds[line.slotIndex] ?? ''
    return pick.has(agentId) ? total + line.total : total
  }, 0)
}

function teamDeltaBase(index: number): SkillFlowDamageRecord | undefined {
  const rec = records.value[index]
  if (!rec) return undefined
  if (recordRefId.value === RECORD_REF_PREV) return records.value[index - 1]
  if (recordRefId.value === rec.id) return undefined
  return records.value.find((item) => item.id === recordRefId.value)
}

/** 全队较参考记录的方向（用于颜色），'—' 表示没有可比的参考 */
function teamDeltaKind(index: number): 'up' | 'down' | 'flat' {
  const base = teamDeltaBase(index)
  const rec = records.value[index]
  if (!base || !rec) return 'flat'
  const before = recordFilteredTeam(base)
  const next = recordFilteredTeam(rec)
  if (!(before > 0)) return 'flat'
  if (next > before) return 'up'
  if (next < before) return 'down'
  return 'flat'
}

/** 段落悬停提示：角色（金色）· 记录名 · 伤害占比 · 槽位配置分块 */
interface RecordSegmentTip {
  name: string
  /** 影画，如「3影」；没有就为空 */
  rankLabel: string
  recordLabel: string
  lines: string[]
  /** 装备行：音擎独占一行，4 件套 + 2 件套同一行 */
  wengineBlocks: RecordMetaBlock[]
  discBlocks: RecordMetaBlock[]
  x: string
  y: string
  transform: string
}

const segmentTip = ref<RecordSegmentTip | null>(null)
/** 分段边缘移动时会连续 enter/leave：延迟隐藏，避免弹窗频闪 */
let segmentTipHideTimer: ReturnType<typeof setTimeout> | null = null

function cancelSegmentTipHide() {
  if (segmentTipHideTimer == null) return
  clearTimeout(segmentTipHideTimer)
  segmentTipHideTimer = null
}

function showSegmentTip(
  rec: SkillFlowDamageRecord,
  seg: RecordBarSegment,
  event: Event,
) {
  cancelSegmentTipHide()
  const el = event.currentTarget as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  const tipWidth = 340
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - tipWidth / 2),
    window.innerWidth - tipWidth - 8,
  )
  const below = rect.top < 120
  segmentTip.value = {
    name: seg.name,
    rankLabel: seg.rankLabel,
    recordLabel: recordLabel(rec),
    lines: barAgentFilterActive.value
      ? [
          `伤害 ${formatNum(seg.total)}`,
          `占该记录全队 ${formatPct(seg.total, rec.team)}`,
          `占所选合计 ${formatPct(seg.total, recordFilteredTeam(rec))}`,
        ]
      : [
          `伤害 ${formatNum(seg.total)}`,
          `占该记录全队 ${formatPct(seg.total, rec.team)}`,
        ],
    wengineBlocks: seg.metaBlocks.filter((block) => block.kind === 'wengine'),
    discBlocks: seg.metaBlocks.filter((block) => block.kind === 'disc'),
    x: `${left}px`,
    y: below ? `${rect.bottom + 8}px` : `${rect.top - 8}px`,
    transform: below ? 'none' : 'translateY(-100%)',
  }
}

function scheduleHideSegmentTip() {
  cancelSegmentTipHide()
  segmentTipHideTimer = setTimeout(() => {
    segmentTip.value = null
    segmentTipHideTimer = null
  }, 160)
}

/** 记录名后的影画标签：1蕾 = 1影·蕾米埃尔（取名字首字） */
function firstNameChar(name: string | undefined) {
  const trimmed = (name ?? '').trim()
  if (!trimmed || trimmed === '未选' || trimmed === '未知') return ''
  return Array.from(trimmed)[0] ?? ''
}

function recordRankTags(rec: SkillFlowDamageRecord) {
  const tags: { key: string; text: string; title: string }[] = []
  rec.slotMeta?.forEach((meta, slot) => {
    if (meta.rank == null) return
    const name = rec.agentNames[slot]?.trim()
    if (!name) return
    const char = firstNameChar(name)
    if (!char) return
    tags.push({
      key: `${slot}-${name}`,
      text: `${meta.rank}${char}`,
      title: `${name} · ${meta.rank}影`,
    })
  })
  return tags
}

function recordTip(rec: SkillFlowDamageRecord) {
  const team = (rec.agentNames.length ? rec.agentNames : [rec.agentName]).join(' / ')
  const title = rec.name ? `${rec.name}（方案：${rec.schemeName}）` : rec.schemeName
  return `${title}\n队伍：${team}\n当前角色：${rec.agentName}`
}

function startRenameRecord(rec: SkillFlowDamageRecord) {
  // 切到另一行时先把正在编辑的输入落库，避免切换即静默丢失
  if (renamingRecordId.value && renamingRecordId.value !== rec.id) commitRenameRecord()
  renamingRecordId.value = rec.id
  renamingRecordValue.value = rec.name || rec.schemeName
  nextTick(() => {
    const el = document.querySelector<HTMLInputElement>('.sf-rec-rename-input')
    el?.focus()
    el?.select()
  })
}

/** 提交改名：清空即恢复默认（回落到方案名） */
function commitRenameRecord() {
  const id = renamingRecordId.value
  if (!id) return
  const value = normalizeSkillFlowDamageRecordName(renamingRecordValue.value)
  renamingRecordId.value = ''
  renamingRecordValue.value = ''
  const record = records.value.find((item) => item.id === id)
  if (!record) return
  if ((record.name ?? undefined) === value) return
  record.name = value
}

function cancelRenameRecord() {
  renamingRecordId.value = ''
  renamingRecordValue.value = ''
}

function recordNow() {
  const now = Date.now()
  const agentNames = props.teamSlots.map((slot) => agentName(slot.agentId))
  records.value.push({
    id: `rec-${now}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: now,
    current: currentTotal.value,
    team: teamTotal.value,
    agentName: agentName(props.teamSlots[props.activeSlotIndex]?.agentId),
    schemeName: currentSchemeLabel(),
    agentNames,
    slotMeta: props.slotMeta ? [...props.slotMeta] : undefined,
    snapshot: captureSkillFlowDamageSnapshot(
      analysis.value,
      props.teamSlots.map((slot) => slot.agentId),
    ),
  })
}

function recordDelta(prev: number | undefined, cur: number | undefined) {
  if (!(prev != null && prev > 0)) return '—'
  const next = cur ?? 0
  const pct = ((next - prev) / prev) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

function teamDelta(index: number) {
  const base = teamDeltaBase(index)
  const rec = records.value[index]
  if (!base || !rec) return '—'
  return recordDelta(recordFilteredTeam(base), recordFilteredTeam(rec))
}

function removeRecord(id: string) {
  records.value = records.value.filter((item) => item.id !== id)
  // 参考记录被删掉时回到「上一条」，避免下拉框悬空
  if (recordRefId.value !== RECORD_REF_PREV && !records.value.some((item) => item.id === recordRefId.value)) {
    recordRefId.value = RECORD_REF_PREV
  }
}

function clearRecords() {
  records.value = []
  recordRefId.value = RECORD_REF_PREV
}

// ============ 导出 / 导入 ============
const recordImportInput = ref<HTMLInputElement | null>(null)
const recordIoNotice = ref<{ kind: 'ok' | 'error'; text: string } | null>(null)

function downloadTextFile(filename: string, text: string) {
  if (typeof document === 'undefined') return
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function recordExportStamp(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function exportRecords() {
  if (!records.value.length) return
  recordIoNotice.value = null
  downloadTextFile(
    `zzz-hp-damage-stats-${recordExportStamp(new Date())}.json`,
    exportSkillFlowDamageRecords(records.value),
  )
}

function triggerRecordImport() {
  recordImportInput.value?.click()
}

async function onRecordImportChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!input || !file) return
  const text = await file.text()
  input.value = ''
  const parsed = parseSkillFlowDamageRecordExport(text)
  if (!parsed) {
    recordIoNotice.value = { kind: 'error', text: '导入失败：不是本页导出的伤害统计文件。' }
    return
  }
  records.value = appendSkillFlowDamageRecords(records.value, parsed.records)
  const parts = [`导入 ${parsed.records.length} 条，现共 ${records.value.length} 条`]
  if (parsed.dropped) parts.push(`损坏丢弃 ${parsed.dropped} 条`)
  recordIoNotice.value = { kind: 'ok', text: parts.join('，') }
}

// ============ 拖动排序 ============
const draggingRecordId = ref('')
/** 落点缝隙下标（0..记录数），与招式流程的插入线同一套语义 */
const recordDropIndex = ref<number | null>(null)
const recordListEl = ref<HTMLElement | null>(null)

/** 停在自己原来那条缝上不画线（拖了等于没动） */
const recordInsertIndex = computed(() => {
  const drop = recordDropIndex.value
  const draggingId = draggingRecordId.value
  if (drop == null || !draggingId) return null
  const from = records.value.findIndex((item) => item.id === draggingId)
  if (from < 0) return drop
  if (drop === from || drop === from + 1) return null
  return drop
})

/** 按行的中线取最近缝隙：光标在哪一行上半 → 插到它前面 */
/** 只按已保存记录的缝算落点：记录 0（当前流程）固定在顶部，不能被插入 */
function nearestRecordSeamIndex(clientY: number): number | null {
  const list = recordListEl.value
  if (!list) return null
  const rows = [...list.querySelectorAll<HTMLElement>('.sf-rec-row[data-saved="true"]')]
  if (!rows.length) return null
  for (let index = 0; index < rows.length; index += 1) {
    const box = rows[index]!.getBoundingClientRect()
    if (clientY < box.top + box.height / 2) return index
  }
  return rows.length
}

function onRecordDragStart(rec: SkillFlowDamageRecord, event: DragEvent) {
  const target = event.target as HTMLElement | null
  // 输入框 / 按钮 / 下拉上按下时不启动拖动，避免误触
  if (target?.closest('input, button, select, textarea, label')) {
    event.preventDefault()
    return
  }
  draggingRecordId.value = rec.id
  recordDropIndex.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', rec.id)
  }
}

function onRecordDragOver(event: DragEvent) {
  if (!draggingRecordId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const index = nearestRecordSeamIndex(event.clientY)
  if (index != null) recordDropIndex.value = index
}

function onRecordDrop(event: DragEvent) {
  event.preventDefault()
  const fromId = draggingRecordId.value || event.dataTransfer?.getData('text/plain') || ''
  const index = nearestRecordSeamIndex(event.clientY) ?? recordDropIndex.value
  draggingRecordId.value = ''
  recordDropIndex.value = null
  if (!fromId || index == null) return
  const list = [...records.value]
  const from = list.findIndex((item) => item.id === fromId)
  if (from < 0) return
  const [item] = list.splice(from, 1)
  if (!item) return
  // 缝隙下标按拖动前的顺序算：从前面抽走一格后，后面的缝位要前移一位
  list.splice(index > from ? index - 1 : index, 0, item)
  records.value = list
}

function onRecordDragEnd() {
  draggingRecordId.value = ''
  recordDropIndex.value = null
}

// ============ 记录视图（记录 0 = 当前流程）============
type RecordView = 'flow' | 'compare'
const recordView = ref<RecordView>('flow')

/** 列表渲染顺序：当前流程固定在最前，其后是已保存记录 */
const displayRecords = computed<
  Array<{ record: SkillFlowDamageRecord; savedIndex: number }>
>(() => [
  { record: currentRecordForComparison.value, savedIndex: -1 },
  ...records.value.map((record, savedIndex) => ({ record, savedIndex })),
])

/** 当前选中的记录 id；默认就是记录 0 */
const selectedRecordId = ref(CURRENT_RECORD_ID)
const selectedSavedRecord = computed<SkillFlowDamageRecord | null>(
  () => records.value.find((item) => item.id === selectedRecordId.value) ?? null,
)
const selectedIsCurrent = computed(() => selectedSavedRecord.value == null)
/** 记录快照还原出的流程伤害（与当前流程共用同一套渲染） */
const selectedRecordAnalysis = computed(() =>
  buildSkillFlowDamageAnalysisFromSnapshot(selectedSavedRecord.value?.snapshot),
)
const selectedRecordSlots = computed<Array<Pick<TeamSlot, 'agentId'>>>(
  () => selectedSavedRecord.value?.snapshot?.agentIds.map((agentId) => ({ agentId })) ?? [],
)
const selectedRecordAgents = computed<Array<Pick<AgentBuffDoc, 'id' | 'name'>>>(() =>
  (selectedSavedRecord.value?.snapshot?.agentIds ?? []).map((id, index) => ({
    id,
    name: selectedSavedRecord.value?.agentNames[index]?.trim() || `角色${index + 1}`,
  })),
)
const selectedRecordUncomputed = computed(
  () => selectedSavedRecord.value?.snapshot?.uncomputedCount ?? 0,
)
const selectedRecordHasSnapshot = computed(() => Boolean(selectedSavedRecord.value?.snapshot))
const selectedRecordTitle = computed(() =>
  selectedSavedRecord.value
    ? `记录流程伤害 · ${recordLabel(selectedSavedRecord.value)}`
    : '当前流程',
)
const selectedRecordMeta = computed(() => {
  const rec = selectedSavedRecord.value
  if (!rec) return '未保存，随编辑实时更新；点「记录」可把此刻留存为一条历史记录。'
  const detail = rec.snapshot ? '只存数值，不含逐段乘区计算过程' : '只保存了总伤（旧格式）'
  return `${formatRecordTime(rec.savedAt)} · 全队 ${formatNum(rec.team)} · ${detail}`
})

/** 点行选中：看这条的流程伤害；行内的改名/删除/拖动按钮不触发选中 */
function selectRecordRow(id: string, event: Event) {
  const target = event.target as HTMLElement | null
  if (target?.closest('button, input, select, textarea, label')) return
  selectedRecordId.value = id
  recordView.value = 'flow'
}

watch(records, (list) => {
  if (
    selectedRecordId.value !== CURRENT_RECORD_ID &&
    !list.some((item) => item.id === selectedRecordId.value)
  ) {
    selectedRecordId.value = CURRENT_RECORD_ID
  }
})
</script>

<template>
  <section id="flow-records" class="sf-stats" aria-label="伤害记录">
    <header class="sf-stats-head">
      <div class="sf-rec-head-row">
        <h3>伤害统计列表</h3>
        <div class="sf-stats-lift-actions">
          <button
            type="button"
            class="mini-btn"
            @click="recordNow"
          >
            记录
          </button>
          <button
            type="button"
            class="mini-btn"
            :disabled="!records.length"
            @click="exportRecords"
          >
            导出
          </button>
          <button type="button" class="mini-btn" @click="triggerRecordImport">导入</button>
          <button
            type="button"
            class="mini-btn danger"
            :disabled="!records.length"
            @click="clearRecords"
          >
            清空
          </button>
          <input
            ref="recordImportInput"
            class="sf-rec-import-input"
            type="file"
            accept="application/json,.json"
            aria-label="导入伤害统计文件"
            @change="onRecordImportChange"
          />
        </div>
      </div>
      <p>
        第 0 条固定是「当前流程」，随编辑实时更新，不能改名、删除或排序；点「记录」把它此刻的完整流程伤害另存为第 1 条起的历史记录，条数不限，只存在本浏览器、不写进方案库。点任意一行，可在下方切换「流程伤害」与「记录对比」查看该条当时的全队构成、类型分布与招式明细。换浏览器或清缓存前，可用「导出」存成 JSON 文件，「导入」会整份追加到现有记录后面。
      </p>
    </header>

    <div class="sf-stats-lift">
      <p
        v-if="recordIoNotice"
        class="sf-analysis-notice"
        :class="{ 'is-error': recordIoNotice.kind === 'error' }"
        role="status"
      >
        {{ recordIoNotice.text }}
      </p>
      <p v-if="recordSaveError" class="sf-analysis-notice" role="alert">
        浏览器未能保存伤害记录，当前页仍可查看；刷新前请检查浏览器存储空间或隐私设置。
      </p>
      <div class="sf-rec-scroll" tabindex="0" aria-label="伤害记录列表，可横向滚动">
        <div class="sf-rec-chart-wrap">
          <div class="sf-rec-legend-row">
            <div
              v-if="recordLegend.length || hasLegacyRecord"
              class="sf-rec-legend"
              aria-label="角色颜色图例"
            >
              <span
                v-for="item in recordLegend"
                :key="item.key"
                class="sf-rec-legend-item"
                :class="{ 'is-muted': barSegmentMuted(item.key) }"
              >
                <i class="sf-rec-dot" :style="{ background: item.color }" />
                {{ item.name }}
              </span>
              <span v-if="hasLegacyRecord" class="sf-rec-legend-item">
                <i class="sf-rec-dot" :style="{ background: LEGACY_RECORD_COLOR }" />
                仅总伤
              </span>
            </div>
            <label v-if="records.length > 1" class="sf-rec-ref">
              参考
              <select v-model="recordRefId" class="sf-rec-ref-select" aria-label="伤害记录对比参考">
                <option value="__prev__">上一条</option>
                <option v-for="(rec, i) in records" :key="rec.id" :value="rec.id">
                  #{{ i + 1 }} {{ recordLabel(rec) }}
                </option>
              </select>
            </label>
          </div>
          <div
            v-if="barAgentOptions.length"
            class="sf-rec-agent-filter"
            role="group"
            aria-label="柱状图角色筛选"
          >
            <button
              type="button"
              class="sf-rec-agent-chip"
              :class="{ 'is-active': !barAgentFilterActive }"
              :aria-pressed="!barAgentFilterActive"
              @click="clearBarAgentFilter"
            >
              全队
            </button>
            <button
              v-for="agent in barAgentOptions"
              :key="agent.id"
              type="button"
              class="sf-rec-agent-chip"
              :class="{ 'is-active': barAgentFilter.includes(agent.id) }"
              :aria-pressed="barAgentFilter.includes(agent.id)"
              @click="toggleBarAgent(agent.id)"
            >
              {{ agent.name }}
            </button>
          </div>
          <div
            ref="recordListEl"
            class="sf-rec-chart"
            role="list"
            aria-label="伤害记录（横向柱状图）"
            @dragover="onRecordDragOver"
            @drop="onRecordDrop"
          >
            <template v-for="row in displayRecords" :key="row.record.id">
              <div
                v-if="row.savedIndex >= 0"
                class="sf-rec-insert-slot"
                :class="{ 'is-active': recordInsertIndex === row.savedIndex }"
                aria-hidden="true"
              />
              <div
                class="sf-rec-row"
                :class="{
                  'is-ref': recordRefId === row.record.id,
                  'is-dragging': draggingRecordId === row.record.id,
                  'is-selected': selectedRecordId === row.record.id,
                  'is-current': row.savedIndex < 0,
                }"
                :data-saved="row.savedIndex >= 0 ? 'true' : 'false'"
                role="listitem"
                :draggable="row.savedIndex >= 0"
                @dragstart="row.savedIndex >= 0 && onRecordDragStart(row.record, $event)"
                @dragend="onRecordDragEnd"
                @click="selectRecordRow(row.record.id, $event)"
              >
                <div class="sf-rec-row-head">
                  <span
                    class="sf-rec-drag"
                    :class="{ 'is-hidden': row.savedIndex < 0 }"
                    title="拖动排序"
                    aria-hidden="true"
                    >⋮⋮</span
                  >
                  <span class="sf-rec-num">{{ row.savedIndex < 0 ? 0 : row.savedIndex + 1 }}</span>
                  <span class="sf-rec-name-cell">
                    <span v-if="recordRefId === row.record.id" class="sf-rec-ref-badge">参考</span>
                    <input
                      v-if="renamingRecordId === row.record.id"
                      v-model="renamingRecordValue"
                      class="sf-rec-rename-input"
                      type="text"
                      maxlength="40"
                      aria-label="伤害记录名称"
                      @keydown.enter.prevent="commitRenameRecord"
                      @keydown.esc.prevent="cancelRenameRecord"
                      @blur="commitRenameRecord"
                    />
                    <template v-else>
                      <span class="sf-rec-clip" :title="recordTip(row.record)">
                        {{ recordLabel(row.record) }}
                      </span>
                      <small v-if="row.savedIndex >= 0" class="sf-record-detail-status">
                        {{ row.record.snapshot ? '含结构明细' : '仅总伤' }}
                      </small>
                      <span v-else class="sf-rec-current-badge">当前</span>
                    </template>
                    <span
                      v-for="tag in recordRankTags(row.record)"
                      :key="tag.key"
                      class="sf-rec-rank-tag"
                      :title="tag.title"
                    >
                      {{ tag.text }}
                    </span>
                  </span>
                  <span class="sf-rec-time">{{
                    row.savedIndex < 0 ? '实时' : formatRecordTime(row.record.savedAt)
                  }}</span>
                  <span
                    class="sf-rec-total"
                    :class="{ 'is-filtered': barAgentFilterActive }"
                    :title="
                      barAgentFilterActive
                        ? `所选角色 ${formatNum(recordFilteredTeam(row.record))}（记录全队 ${formatNum(row.record.team)}）`
                        : `全队 ${formatNum(row.record.team)}`
                    "
                  >
                    {{ formatNum(recordFilteredTeam(row.record)) }}
                    <em v-if="barAgentFilterActive" class="sf-rec-total-scope">所选</em>
                  </span>
                  <span
                    v-if="row.savedIndex >= 0"
                    class="sf-rec-delta"
                    :class="{
                      'is-up': teamDeltaKind(row.savedIndex) === 'up',
                      'is-down': teamDeltaKind(row.savedIndex) === 'down',
                    }"
                    :title="
                      barAgentFilterActive ? '所选角色较参考记录' : '全队较参考记录'
                    "
                  >
                    {{ teamDelta(row.savedIndex) }}
                  </span>
                  <span v-else class="sf-rec-delta" title="当前流程不参与较参考">—</span>
                  <span class="sf-rec-actions">
                    <template v-if="row.savedIndex >= 0">
                      <button
                        type="button"
                        class="mini-btn"
                        :aria-label="`重命名第${row.savedIndex + 1}条伤害记录`"
                        @click="startRenameRecord(row.record)"
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        class="mini-btn danger"
                        :aria-label="`删除第${row.savedIndex + 1}条伤害记录`"
                        @click="removeRecord(row.record.id)"
                      >
                        删除
                      </button>
                    </template>
                    <span v-else class="sf-rec-locked">固定</span>
                  </span>
                </div>
                <div
                  class="sf-rec-bar"
                  role="img"
                  :aria-label="recordBarTitle(row.record).replace(/\n/g, '；')"
                >
                  <span
                    v-for="seg in recordSegments(row.record)"
                    :key="seg.key"
                    class="sf-rec-seg"
                    :class="{ 'is-muted': seg.muted }"
                    :style="{ width: seg.widthPercent, background: seg.color }"
                    @mouseenter="showSegmentTip(row.record, seg, $event)"
                    @mouseleave="scheduleHideSegmentTip"
                  />
                </div>
              </div>
            </template>
            <div
              class="sf-rec-insert-slot"
              :class="{ 'is-active': recordInsertIndex === records.length }"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="sf-rec-view-switch" role="tablist" aria-label="伤害记录视图">
      <button
        type="button"
        role="tab"
        :aria-selected="recordView === 'flow'"
        :class="{ 'is-active': recordView === 'flow' }"
        @click="recordView = 'flow'"
      >
        流程伤害
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="recordView === 'compare'"
        :class="{ 'is-active': recordView === 'compare' }"
        @click="recordView = 'compare'"
      >
        记录对比
      </button>
    </div>

    <section
      v-show="recordView === 'flow'"
      id="flow-damage"
      class="sf-rec-panel"
      aria-label="流程伤害"
    >
      <div class="sf-rec-block-head">
        <h4>
          {{ selectedRecordTitle }}
          <span class="sf-rec-current-badge" :class="{ 'is-frozen': !selectedIsCurrent }">{{
            selectedIsCurrent ? '当前' : '记录'
          }}</span>
          <InfoTip
            v-if="selectedIsCurrent"
            label="当前流程说明"
            text="按流程归属统计期望伤害，口径与词条计算总伤相同；角色占比不代表辅助增益贡献。"
          />
        </h4>
        <div class="sf-rec-block-actions">
          <span class="sf-stats-hint">{{ selectedRecordMeta }}</span>
          <button
            v-if="!selectedIsCurrent"
            type="button"
            class="mini-btn"
            @click="selectedRecordId = CURRENT_RECORD_ID"
          >
            回到当前
          </button>
        </div>
      </div>
      <FlowDamageModule
        v-if="selectedIsCurrent"
        :analysis="analysis"
        :team-slots="teamSlots"
        :agents="agents"
        :active-slot-index="activeSlotIndex"
        :resolve-calculation-detail="resolveCalculationDetail"
      />
      <p v-else-if="!selectedRecordHasSnapshot" class="sf-rec-empty">
        这条记录只保存了总伤（旧格式），没有逐段明细，无法还原当时的流程伤害。
      </p>
      <FlowDamageModule
        v-else
        frozen
        :analysis="selectedRecordAnalysis"
        :team-slots="selectedRecordSlots"
        :agents="selectedRecordAgents"
        :active-slot-index="-1"
        :team-uncomputed-count="selectedRecordUncomputed"
      />
    </section>

    <section v-show="recordView === 'compare'" class="sf-rec-panel" aria-label="记录对比">
      <SkillFlowDamageRecordComparison
        :records="records"
        :current-record="currentRecordForComparison"
        :preferred-comparison-id="selectedSavedRecord?.id"
      />
    </section>

    <Teleport to="body">
        <div
          v-if="segmentTip"
          class="stat-value-tip sf-rec-tip"
          :style="{
            left: segmentTip.x,
            top: segmentTip.y,
            transform: segmentTip.transform,
            pointerEvents: 'none',
          }"
        >
          <p class="tip-title">
            <strong class="sf-rec-tip-name">{{ segmentTip.name }}</strong>
            <span v-if="segmentTip.rankLabel" class="sf-rec-tip-rank">{{
              segmentTip.rankLabel
            }}</span>
            <span class="sf-rec-tip-record"> · {{ segmentTip.recordLabel }}</span>
          </p>
          <div
            v-if="segmentTip.wengineBlocks.length || segmentTip.discBlocks.length"
            class="sf-rec-tip-equip"
          >
            <div v-if="segmentTip.wengineBlocks.length" class="sf-rec-tip-equip-row">
              <span
                v-for="block in segmentTip.wengineBlocks"
                :key="`w-${block.value}`"
                class="sf-rec-meta-block is-wengine"
              >
                <em class="sf-rec-meta-tag">{{ block.label }}</em>
                <span class="sf-rec-meta-text">{{ block.value }}</span>
              </span>
            </div>
            <div v-if="segmentTip.discBlocks.length" class="sf-rec-tip-equip-row">
              <span
                v-for="block in segmentTip.discBlocks"
                :key="`d-${block.label}-${block.value}`"
                class="sf-rec-meta-block is-disc"
              >
                <em v-if="block.label" class="sf-rec-meta-tag">{{ block.label }}</em>
                <span class="sf-rec-meta-text">{{ block.value }}</span>
              </span>
            </div>
          </div>
          <ul class="tip-items">
            <li v-for="line in segmentTip.lines" :key="line">{{ line }}</li>
          </ul>
        </div>
      </Teleport>
  </section>
</template>

<style scoped>
.sf-stats {
  --sf-analysis-text: var(--calc-text, #e8edf5);
  --sf-analysis-muted: var(--calc-text-muted, #9aa3b0);
  --sf-analysis-border: var(--calc-border, #2a3038);
  --sf-analysis-surface: var(--calc-surface-2, #161a20);
  --sf-analysis-track: var(--calc-surface-3, #252c36);
  --sf-analysis-accent: var(--calc-accent, #c9a55c);
  --sf-analysis-selected: var(--calc-accent-bg, rgba(201, 165, 92, 0.14));
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-top: 0.85rem;
  padding: 0.9rem 1rem 1.05rem;
  border-top: 1px solid #2a3038;
  background: #12161c;
}
.sf-stats-hint {
  margin: 0.2rem 0 0;
  font-size: 0.72rem;
  color: #8b93a0;
}
.sf-rec-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.sf-stats-head h3 {
  margin: 0;
  font-size: 0.95rem;
}
.sf-stats-head p {
  margin: 0.35rem 0 0;
  font-size: 0.76rem;
  line-height: 1.65;
  color: #8b93a0;
}
/* 当前流程 / 记录流程伤害两个块头 */
.sf-rec-block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
  padding: 0.1rem 0 0.35rem;
}
.sf-rec-block-head h4 {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.88rem;
  color: var(--sf-analysis-text);
}
.sf-rec-block-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
/* 流程伤害 / 记录对比 两个视图 */
.sf-rec-view-switch {
  display: flex;
  gap: 0.35rem;
  padding: 0.2rem;
  border: 1px solid #2a3038;
  border-radius: 10px;
  background: #10141a;
  align-self: flex-start;
}
.sf-rec-view-switch button {
  padding: 0.28rem 0.9rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #9aa3b0;
  font-size: 0.78rem;
  cursor: pointer;
}
.sf-rec-view-switch button:hover {
  color: #d5dae4;
}
.sf-rec-view-switch button.is-active {
  border-color: rgba(201, 165, 92, 0.55);
  background: rgba(201, 165, 92, 0.14);
  color: #d4b06a;
}
.sf-rec-panel {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.sf-rec-empty {
  margin: 0;
  padding: 0.9rem 0.8rem;
  border: 1px dashed #2a3038;
  border-radius: 8px;
  color: #9aa3b0;
  font-size: 0.76rem;
}
/* 导入用的文件选择器：不占位，由「导入」按钮触发 */
.sf-rec-import-input {
  display: none;
}
.sf-analysis-notice.is-error {
  color: #f0b0b0;
  border-color: #7a4a4a;
  background: rgba(160, 60, 60, 0.16);
}
.sf-rec-locked {
  font-size: 0.7rem;
  color: #6a7382;
  padding: 0 0.2rem;
}
.sf-rec-drag.is-hidden {
  visibility: hidden;
}
.sf-rec-row.is-current {
  border-color: #3a4650;
  background: #14181f;
}
/* 正在查看的那条：金色左侧竖条（不是整圈金边，免得和「参考」混） */
.sf-rec-row.is-selected {
  border-color: #3c444f;
  background: #171d25;
  box-shadow: inset 3px 0 0 #c9a55c;
}
.sf-rec-current-badge {
  padding: 0.02rem 0.4rem;
  border-radius: 999px;
  border: 1px solid rgba(201, 165, 92, 0.5);
  color: #d4b06a;
  font-size: 0.68rem;
  font-weight: 400;
}
.sf-rec-current-badge.is-frozen {
  border-color: #3f4a3a;
  color: #9aa3b0;
}
.mini-btn.is-active {
  border-color: #c9a55c;
  color: #d4b06a;
}
.sf-stats-lift-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.sf-stats-lift-actions {
  display: flex;
  gap: 0.35rem;
}
.mini-btn {
  border: 1px solid #3a4a31;
  border-radius: 6px;
  background: #161a20;
  color: #d8e8c8;
  padding: 0.22rem 0.55rem;
  font-size: 0.72rem;
  cursor: pointer;
}
.mini-btn:hover:not(:disabled) {
  border-color: #c9a55c;
}
.mini-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.mini-btn.danger {
  color: #e8b4b4;
  border-color: #5a3a3a;
}
.sf-rec-scroll {
  max-width: 100%;
  overflow-x: auto;
}
.sf-rec-chart-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.45rem;
}
.sf-rec-legend-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.35rem 0.9rem;
}
.sf-rec-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.9rem;
  font-size: 0.72rem;
  color: #9aa3b0;
}
.sf-rec-ref {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  color: #9aa3b0;
}
.sf-rec-ref-select {
  border: 1px solid #2d323a;
  border-radius: 6px;
  background: #0f1217;
  color: #e8edf5;
  padding: 0.18rem 0.35rem;
  font: inherit;
  font-size: 0.72rem;
}
.sf-rec-ref-select:focus {
  outline: none;
  border-color: #c9a55c;
}
.sf-rec-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.sf-rec-dot {
  display: inline-block;
  width: 0.62rem;
  height: 0.62rem;
  border-radius: 2px;
}
.sf-rec-chart {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.sf-rec-row {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 560px;
  padding: 0.45rem 0.55rem;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: #12161c;
  font-size: 0.75rem;
  color: #d5dae4;
}
.sf-rec-row-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.sf-record-detail-status {
  display: block;
  color: var(--sf-analysis-muted);
  font-size: 0.67rem;
}
.sf-rec-num {
  flex: 0 0 1.5rem;
  color: #9aa3b0;
  font-variant-numeric: tabular-nums;
}
.sf-rec-name-cell {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}
.sf-rec-clip {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}
.sf-rec-rename-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.1rem 0.3rem;
  border: 1px solid #3a4a31;
  border-radius: 5px;
  background: #10141a;
  color: #e8edf5;
  font: inherit;
  font-size: 0.75rem;
}
.sf-rec-rename-input:focus {
  outline: none;
  border-color: #c9a55c;
}
.sf-rec-time {
  flex: 0 0 auto;
  color: #8b93a0;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.sf-rec-total-scope {
  margin-left: 0.22rem;
  padding: 0 0.18rem;
  border: 1px solid rgba(201, 165, 92, 0.5);
  border-radius: 4px;
  color: #d4b06a;
  font-size: 0.6rem;
  font-style: normal;
  line-height: 1.4;
  vertical-align: 0.08em;
}
.sf-rec-total {
  flex: 0 0 auto;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.sf-rec-delta {
  flex: 0 0 4.8rem;
  text-align: right;
  color: #9aa3b0;
  font-size: 0.8rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.sf-rec-delta.is-up {
  color: #7fd3a4;
}
.sf-rec-delta.is-down {
  color: #f09a9a;
}
/* 对比参考的那条：蓝色，与「正在查看」的金色区分开 */
.sf-rec-row.is-ref {
  border-color: #5b8def;
}
.sf-rec-ref-badge {
  flex: 0 0 auto;
  padding: 0.02rem 0.32rem;
  border-radius: 4px;
  background: #5b8def;
  color: #0b1220;
  font-size: 0.66rem;
  font-weight: 700;
  line-height: 1.5;
}
.sf-rec-bar {
  display: flex;
  height: 1rem;
  border-radius: 999px;
  overflow: visible;
  background: #1d232c;
}
.sf-rec-bar:hover .sf-rec-seg:not(:hover) {
  opacity: 0.45;
}
.sf-rec-seg {
  height: 100%;
  min-width: 2px;
  cursor: help;
  transition:
    transform 0.12s ease,
    filter 0.12s ease,
    opacity 0.12s ease;
  transform-origin: 50% 50%;
}
.sf-rec-seg:first-child {
  border-radius: 999px 0 0 999px;
}
.sf-rec-seg:last-child {
  border-radius: 0 999px 999px 0;
}
.sf-rec-seg:only-child {
  border-radius: 999px;
}
.sf-rec-seg:hover {
  position: relative;
  z-index: 1;
  transform: scaleY(1.5);
  filter: brightness(1.15);
  border-radius: 4px;
  box-shadow:
    0 0 0 1.5px rgba(232, 237, 245, 0.45),
    0 2px 10px rgba(0, 0, 0, 0.35);
}
.sf-rec-actions {
  flex: 0 0 auto;
  text-align: right;
  white-space: nowrap;
}
.sf-rec-actions .mini-btn + .mini-btn {
  margin-left: 0.3rem;
}
/* 悬停提示里的槽位配置：像顶栏槽位卡一样分块（标签 + 值） */
/* 浮层整体收紧：标题、装备、数字三块挨得更近 */
.sf-rec-tip {
  gap: 0.3rem;
  min-width: 300px;
  padding: 0.6rem 0.7rem;
}
.sf-rec-tip .tip-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  font-size: 0.86rem;
}
/* 伤害与占比的字号放大一档 */
.sf-rec-tip .tip-items {
  margin: 0;
}
.sf-rec-tip .tip-items li {
  font-size: 0.84rem;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
/* 装备行：音擎独占一行，4 件套 + 2 件套同一行（与顶栏槽位卡同款小卡） */
.sf-rec-tip-equip {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin: 0;
}
.sf-rec-tip-equip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.26rem;
}
.sf-rec-meta-block {
  display: inline-flex;
  align-items: baseline;
  gap: 0.34rem;
  min-width: 0;
  padding: 0.16rem 0.42rem 0.16rem 0.3rem;
  border: 1px solid #3a414c;
  border-radius: 7px;
  background: #1f252e;
}
/* 顶栏同款配色：音擎金色、驱动盘蓝色 */
.sf-rec-meta-block.is-wengine {
  border-color: rgba(214, 178, 104, 0.62);
  background: rgba(201, 165, 92, 0.18);
}
.sf-rec-meta-block.is-wengine .sf-rec-meta-tag {
  background: rgba(214, 178, 104, 0.34);
  color: #ffe9bd;
}
.sf-rec-meta-block.is-wengine .sf-rec-meta-text {
  color: #faeed2;
}
.sf-rec-meta-block.is-disc {
  border-color: rgba(150, 182, 232, 0.5);
  background: rgba(140, 170, 220, 0.16);
}
.sf-rec-meta-block.is-disc .sf-rec-meta-tag {
  background: rgba(150, 182, 232, 0.28);
  color: #d3e2f8;
}
.sf-rec-meta-block.is-disc .sf-rec-meta-text {
  color: #e2ebfa;
}
.sf-rec-meta-tag {
  flex: 0 0 auto;
  padding: 0 0.26rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
  color: #dbe4f2;
  font-size: 0.66rem;
  font-style: normal;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.sf-rec-meta-text {
  color: #d5dae4;
  font-size: 0.72rem;
  line-height: 1.4;
  white-space: nowrap;
}
/* 悬停提示里的角色名：金色 */
.sf-rec-tip-name {
  color: #d4b06a;
  font-weight: 700;
}
/* 影画跟在角色名后 */
.sf-rec-tip-rank {
  margin-left: 0.28rem;
  color: #d4b06a;
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
}
.sf-rec-tip-record {
  color: #9aa3b0;
}
/* 角色筛选：未选中的分段与图例置灰，长度与数值不变 */
.sf-rec-seg.is-muted {
  filter: grayscale(1);
  opacity: 0.32;
}
.sf-rec-legend-item.is-muted {
  opacity: 0.45;
}
.sf-rec-agent-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.4rem;
}
.sf-rec-agent-chip {
  padding: 0.12rem 0.58rem;
  border: 1px solid #2a3038;
  border-radius: 999px;
  background: transparent;
  color: #9aa3b0;
  font-size: 0.72rem;
  cursor: pointer;
}
.sf-rec-agent-chip:hover {
  border-color: #c9a55c;
  color: #d5dae4;
}
.sf-rec-agent-chip.is-active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #d4b06a;
}
/* 记录名后的影画标签：1蕾 = 1影 · 蕾米埃尔 */
.sf-rec-rank-tag {
  flex: 0 0 auto;
  padding: 0 0.25rem;
  border: 1px solid rgba(201, 165, 92, 0.5);
  border-radius: 4px;
  color: #d4b06a;
  font-size: 0.64rem;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
/* 拖动排序 */
.sf-rec-drag {
  flex: 0 0 auto;
  color: #6a7382;
  letter-spacing: -0.12rem;
  cursor: grab;
  user-select: none;
}
.sf-rec-row.is-dragging {
  opacity: 0.45;
}
/* 插入线占的正是原来的行间距，拖起来和招式流程一致 */
.sf-rec-insert-slot {
  position: relative;
  flex: 0 0 auto;
  height: 0.5rem;
}
.sf-rec-insert-slot:first-child,
.sf-rec-insert-slot:last-child {
  height: 0;
}
.sf-rec-insert-slot.is-active::after {
  content: '';
  position: absolute;
  left: 0.12rem;
  right: 0.12rem;
  top: 50%;
  height: 2px;
  background: #c9a55c;
  border-radius: 1px;
  transform: translateY(-50%);
  box-shadow: 0 0 5px rgba(201, 165, 92, 0.85);
  pointer-events: none;
}
@container (max-width: 600px) {
  .sf-analysis-bar-row {
    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: 0.25rem;
  }
  .sf-analysis-track {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .sf-analysis-axis {
    margin-left: 0;
    margin-right: 0;
  }
  .sf-analysis-bar-total small {
    display: inline;
    margin-left: 0.4rem;
  }
  .sf-pie-row {
    gap: 0.55rem;
  }
  .sf-pie {
    flex-basis: 4.5rem;
    width: 4.5rem;
    height: 4.5rem;
  }
}
</style>
