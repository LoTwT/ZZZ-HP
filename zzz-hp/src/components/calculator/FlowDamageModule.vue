<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import FlowCalculationDetail from '@/components/calculator/FlowCalculationDetail.vue'
import InfoTip from '@/components/common/InfoTip.vue'
import SkillFlowDamageCrossAnalysis from '@/components/calculator/SkillFlowDamageCrossAnalysis.vue'
import type { AgentBuffDoc, BuffDamageType, StaggerPhase } from '@/types/calculator'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import { damageTypeLabel } from '@/utils/buffDamageTypes'
import { flowBuffOverrideExceptionCount } from '@/utils/flowBuffTable'
import type { SkillFlowCalculationDetail } from '@/utils/skillFlowCalculation'
import {
  filterSkillFlowDamageLines,
  skillFlowDamageCrossRows,
  skillFlowDamageSlices,
  skillFlowSkillContributions,
  type SkillFlowDamageAnalysis,
  type SkillFlowDamageFilter,
  type SkillFlowDamageLine,
  type SkillFlowDamageSlice,
  type SkillFlowSkillContribution,
} from '@/utils/skillFlowDamageAnalysis'

/**
 * 流程伤害模块。数据源由调用方注入（实时流程 / 伤害记录快照），
 * 两份都走同一套统计与渲染，避免出现"记录的样式和当前不一样"。
 */
const props = defineProps<{
  analysis: SkillFlowDamageAnalysis
  teamSlots: Array<Pick<TeamSlot, 'agentId'>>
  agents: Array<Pick<AgentBuffDoc, 'id' | 'name'>>
  /** 编辑中角色的槽位；记录冻结态传 -1，此时不显示「编辑中角色」指标 */
  activeSlotIndex: number
  resolveCalculationDetail?: (hitId: string) => SkillFlowCalculationDetail | null
  /** 记录只存数值，没有逐段乘区计算过程 */
  frozen?: boolean
  /** 记录里的未结算段是整队合计，只在「全队」范围显示 */
  teamUncomputedCount?: number
}>()

/** 只读视图：把 props 包成与原有实现相同的 analysis.value 形状 */
const analysis = computed(() => props.analysis)

const analysisSlotIndex = ref<number | null>(null)
const typeDimension = ref<'type' | 'category'>('type')
const comparisonMode = ref<'damage' | 'percentage'>('damage')
const expandedContributionIds = ref<Set<string>>(new Set())
const selectedCalculationHitId = ref<string | null>(null)
const damageFilter = ref<SkillFlowDamageFilter>({})

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
const teamTotal = computed(() => analysis.value.total)
const currentTotal = computed(() => analysis.value.slots[props.activeSlotIndex]?.total ?? 0)

const slotRows = computed(() =>
  props.teamSlots.map((slot, index) => {
    const stats = analysis.value.slots[index]!
    const total = stats.total
    return {
      index,
      name: agentName(slot.agentId),
      total,
      pct: formatPct(total, teamTotal.value),
      active: index === props.activeSlotIndex,
      slices: skillFlowDamageSlices(stats.lines, 'type'),
    }
  }),
)

const analysisName = computed(() =>
  analysisSlotIndex.value == null
    ? '全队'
    : agentName(props.teamSlots[analysisSlotIndex.value]?.agentId),
)
const scopedLines = computed(() =>
  analysisSlotIndex.value == null
    ? analysis.value.lines
    : (analysis.value.slots[analysisSlotIndex.value]?.lines ?? []),
)
const scopedTotal = computed(() => scopedLines.value.reduce((sum, line) => sum + line.total, 0))
const uncomputedCount = computed(() => {
  if (props.frozen) {
    // 记录里的未结算段是整队合计，分不到单个角色；只在「全队」范围显示
    return analysisSlotIndex.value == null ? (props.teamUncomputedCount ?? 0) : 0
  }
  return analysis.value.slots
    .filter((slot) => analysisSlotIndex.value == null || slot.slotIndex === analysisSlotIndex.value)
    .reduce((sum, slot) => sum + slot.uncomputedCount, 0)
})
const typeSlices = computed(() => skillFlowDamageSlices(scopedLines.value, typeDimension.value))
const staggerSlices = computed(() => skillFlowDamageSlices(scopedLines.value, 'stagger'))
const crossRows = computed(() => skillFlowDamageCrossRows(scopedLines.value))
const filteredLines = computed(() =>
  filterSkillFlowDamageLines(scopedLines.value, damageFilter.value),
)
const filteredTotal = computed(() => filteredLines.value.reduce((sum, line) => sum + line.total, 0))
const filterChips = computed(() => {
  const filter = damageFilter.value
  const chips: Array<{ key: keyof SkillFlowDamageFilter; label: string }> = []
  if (filter.damageType)
    chips.push({ key: 'damageType', label: damageTypeLabel(filter.damageType) })
  if (filter.damageKind)
    chips.push({ key: 'damageKind', label: filter.damageKind === 'direct' ? '直伤类' : '异常类' })
  if (filter.staggerPhase)
    chips.push({
      key: 'staggerPhase',
      label: filter.staggerPhase === 'stagger' ? '失衡期' : '非失衡',
    })
  return chips
})
const comparisonLegend = computed(() => skillFlowDamageSlices(analysis.value.lines, 'type'))
const largestSlotTotal = computed(() => Math.max(0, ...slotRows.value.map((row) => row.total)))
const contributions = computed(() =>
  skillFlowSkillContributions(analysis.value, analysisSlotIndex.value, damageFilter.value),
)
const selectedCalculation = computed(() =>
  selectedCalculationHitId.value
    ? (props.resolveCalculationDetail?.(selectedCalculationHitId.value) ?? null)
    : null,
)

function clearExpandedDetails() {
  expandedContributionIds.value = new Set()
  selectedCalculationHitId.value = null
}

watch(analysisSlotIndex, clearExpandedDetails)
watch(damageFilter, clearExpandedDetails)
watch(
  () => props.teamSlots.map((slot) => slot.agentId).join('\0'),
  () => {
    analysisSlotIndex.value = null
    damageFilter.value = {}
    clearExpandedDetails()
  },
)
watch(
  () =>
    contributions.value
      .map((item) => `${item.id}:${item.lines.map((line) => line.hit.id).join(',')}`)
      .sort()
      .join('|'),
  clearExpandedDetails,
)

function toggleContribution(item: SkillFlowSkillContribution) {
  const next = new Set(expandedContributionIds.value)
  if (next.has(item.id)) {
    next.delete(item.id)
    if (item.lines.some((line) => line.hit.id === selectedCalculationHitId.value)) {
      selectedCalculationHitId.value = null
    }
  } else next.add(item.id)
  expandedContributionIds.value = next
}

function toggleCalculation(hitId: string) {
  selectedCalculationHitId.value = selectedCalculationHitId.value === hitId ? null : hitId
}

function selectDamageType(type: BuffDamageType) {
  damageFilter.value = {
    ...damageFilter.value,
    damageKind: null,
    damageType: damageFilter.value.damageType === type ? null : type,
  }
}

/** 大类分组 id → 伤害种类：分组 id 是 `direct` / `anomalyClass`，种类语义值仍是 direct / anomaly */
const GROUP_DAMAGE_KIND: Record<string, 'direct' | 'anomaly'> = {
  direct: 'direct',
  anomalyClass: 'anomaly',
}

function selectTypeSlice(id: string) {
  if (typeDimension.value === 'category') {
    const kind = GROUP_DAMAGE_KIND[id]
    if (!kind) return
    damageFilter.value = {
      ...damageFilter.value,
      damageType: null,
      damageKind: damageFilter.value.damageKind === kind ? null : kind,
    }
  } else selectDamageType(id as BuffDamageType)
}

function selectStaggerPhase(phase: StaggerPhase) {
  damageFilter.value = {
    ...damageFilter.value,
    staggerPhase: damageFilter.value.staggerPhase === phase ? null : phase,
  }
}

function selectCrossCell(type: BuffDamageType, phase: StaggerPhase) {
  const clear = damageFilter.value.damageType === type && damageFilter.value.staggerPhase === phase
  damageFilter.value = { damageType: clear ? null : type, staggerPhase: clear ? null : phase }
}

function selectRoleSegment(slotIndex: number, type: string) {
  analysisSlotIndex.value = slotIndex
  damageFilter.value = {
    ...damageFilter.value,
    damageKind: null,
    damageType: type as BuffDamageType,
  }
}

/** 饼图用 SVG 逐扇区绘制：选中/悬停时该扇区沿自身中线弹出 */
const PIE_RADIUS = 47
const PIE_CENTER = 50
const PIE_POP = 6

interface PieSliceView {
  id: string
  name: string
  color: string
  total: number
  ratio: number
  /** SVG path */
  path: string
  /** 沿中线向外的位移，供 CSS transform 使用 */
  pop: string
}

function pieSlicePath(startRatio: number, ratio: number) {
  const radius = PIE_RADIUS
  const cx = PIE_CENTER
  const cy = PIE_CENTER
  const start = startRatio * Math.PI * 2 - Math.PI / 2
  const end = (startRatio + ratio) * Math.PI * 2 - Math.PI / 2
  const x0 = cx + radius * Math.cos(start)
  const y0 = cy + radius * Math.sin(start)
  const x1 = cx + radius * Math.cos(end)
  const y1 = cy + radius * Math.sin(end)
  // 接近整圆时一段弧画不出来，改用两段大弧
  if (ratio >= 0.9995) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius} Z`
  }
  const largeArc = ratio > 0.5 ? 1 : 0
  return `M ${cx} ${cy} L ${x0} ${y0} A ${radius} ${radius} 0 ${largeArc} 1 ${x1} ${y1} Z`
}

function pieSliceViews(slices: SkillFlowDamageSlice[]): PieSliceView[] {
  let cursor = 0
  return slices.map((slice) => {
    const ratio = Math.max(0, Math.min(1, slice.ratio))
    const mid = (cursor + ratio / 2) * Math.PI * 2 - Math.PI / 2
    const view: PieSliceView = {
      id: slice.id,
      name: slice.name,
      color: slice.color,
      total: slice.total,
      ratio,
      path: pieSlicePath(cursor, ratio),
      pop: `translate(${(Math.cos(mid) * PIE_POP).toFixed(2)}px, ${(Math.sin(mid) * PIE_POP).toFixed(2)}px)`,
    }
    cursor += ratio
    return view
  })
}

const typePieSlices = computed(() => pieSliceViews(typeSlices.value))
const staggerPieSlices = computed(() => pieSliceViews(staggerSlices.value))

/** 该伤害类型（或大类）是否被当前筛选选中：用于柱体常驻上浮 */
const DIRECT_DAMAGE_TYPES = new Set(['normal', 'pierce', 'sharpen'])
const typeFilterActive = computed(
  () => Boolean(damageFilter.value.damageType || damageFilter.value.damageKind),
)

function sliceMatchesFilter(typeId: string) {
  const filter = damageFilter.value
  if (filter.damageType) return filter.damageType === typeId
  if (filter.damageKind) {
    return (filter.damageKind === 'direct') === DIRECT_DAMAGE_TYPES.has(typeId)
  }
  return false
}

function typeSliceSelected(id: string) {
  if (typeDimension.value === 'type') return damageFilter.value.damageType === id
  const kind = GROUP_DAMAGE_KIND[id]
  return Boolean(kind) && damageFilter.value.damageKind === kind
}

function removeFilter(key: keyof SkillFlowDamageFilter) {
  damageFilter.value = { ...damageFilter.value, [key]: null }
}

function comparisonWidth(total: number) {
  const denominator = comparisonMode.value === 'percentage' ? total : largestSlotTotal.value
  return `${denominator > 0 ? (total / denominator) * 100 : 0}%`
}

function sliceDescription(slices: SkillFlowDamageSlice[]) {
  return slices
    .map((slice) => `${slice.name} ${formatNum(slice.total)}，${formatPct(slice.ratio, 1)}`)
    .join('；')
}

function participants(line: SkillFlowDamageLine) {
  if (line.hit.damageKind !== 'anomaly') return ''
  return `异常强度：${agentName(line.hit.anomalyPowerAgentId ?? undefined)} · 触发者：${agentName(line.hit.triggerAgentId ?? undefined)}`
}

</script>

<template>
  <div class="sf-flow-module">
    <div class="sf-stats-current">
      <div class="sf-stats-metric">
        <span class="sf-stats-label">全队</span>
        <strong class="sf-stats-num team">{{ formatNum(teamTotal) }}</strong>
      </div>
      <div v-if="activeSlotIndex >= 0" class="sf-stats-metric">
        <span class="sf-stats-label">编辑中角色</span>
        <strong class="sf-stats-num current">{{ formatNum(currentTotal) }}</strong>
        <span class="sf-stats-pct">{{ formatPct(currentTotal, teamTotal) }}</span>
      </div>
    </div>

    <div class="sf-stats-team">
      <div
        v-for="row in slotRows"
        :key="row.index"
        class="sf-stats-agent"
        :class="{ active: row.active }"
      >
        <span class="sf-stats-label">{{ row.index + 1 }} · {{ row.name }}</span>
        <strong class="sf-stats-num">{{ formatNum(row.total) }}</strong>
        <span class="sf-stats-pct">{{ row.pct }}</span>
      </div>
    </div>

    <section class="sf-analysis-comparison" aria-label="全队角色伤害构成">
      <div class="sf-analysis-section-head">
        <div>
          <h4>
            全队角色构成
            <InfoTip
              label="全队角色构成说明"
              text="每条按伤害类型分段，颜色与下方构成分析一致。"
            />
          </h4>

        </div>
        <div class="sf-analysis-switch" role="group" aria-label="角色构成显示方式">
          <button
            type="button"
            :aria-pressed="comparisonMode === 'damage'"
            @click="comparisonMode = 'damage'"
          >
            实际伤害
          </button>
          <button
            type="button"
            :aria-pressed="comparisonMode === 'percentage'"
            @click="comparisonMode = 'percentage'"
          >
            个人构成
          </button>
        </div>
      </div>
      <div class="sf-analysis-axis" aria-hidden="true">
        <span>0</span>
        <span>{{
          comparisonMode === 'percentage' ? '100%' : `${formatNum(largestSlotTotal)} 期望伤害`
        }}</span>
      </div>
      <div v-for="row in slotRows" :key="row.index" class="sf-analysis-bar-row">
        <span class="sf-analysis-bar-label">{{ row.index + 1 }} · {{ row.name }}</span>
        <div class="sf-analysis-track" role="group" :aria-label="`${row.name}伤害构成，可筛选招式`">
          <div class="sf-analysis-bar" :style="{ width: comparisonWidth(row.total) }">
            <button
              v-for="slice in row.slices"
              :key="slice.id"
              type="button"
              :style="{ width: `${slice.ratio * 100}%`, background: slice.color }"
              :title="`${row.name} · ${slice.name}：${formatNum(slice.total)}，占个人 ${formatPct(slice.ratio, 1)}`"
              :aria-label="`筛选${row.name} · ${slice.name}`"
              :aria-pressed="sliceMatchesFilter(slice.id)"
              @click="selectRoleSegment(row.index, slice.id)"
            />
          </div>
        </div>
        <span class="sf-analysis-bar-total"
          >{{ formatNum(row.total) }} <small>占全队 {{ row.pct }}</small></span
        >
      </div>
      <ul class="sf-analysis-inline-legend" aria-label="伤害类型颜色">
        <li v-for="slice in comparisonLegend" :key="slice.id">
          <i :style="{ background: slice.color }" />{{ slice.name }}
        </li>
      </ul>
    </section>

    <div class="sf-analysis-section-head sf-analysis-scope-head">
      <div>
        <h4>
          伤害构成分析
          <InfoTip
            label="伤害构成分析说明"
            text="查看范围独立于编辑角色；下方图表与招式排行同步切换。"
          />
        </h4>

      </div>
      <div class="sf-analysis-switch sf-analysis-scope" role="group" aria-label="伤害分析范围">
        <button
          type="button"
          :aria-pressed="analysisSlotIndex === null"
          @click="analysisSlotIndex = null"
        >
          全队
        </button>
        <button
          v-for="row in slotRows"
          :key="row.index"
          type="button"
          :aria-pressed="analysisSlotIndex === row.index"
          @click="analysisSlotIndex = row.index"
        >
          {{ row.index + 1 }} · {{ row.name }}
        </button>
      </div>
    </div>
    <p v-if="uncomputedCount" class="sf-analysis-notice">
      此范围有 {{ uncomputedCount }} 段流程未计入伤害，请检查面板与参与角色配置。
    </p>

    <div class="sf-stats-pies">
      <div class="sf-pie-block">
        <div class="sf-analysis-section-head">
          <h4>{{ analysisName }} · 伤害类型</h4>
          <div class="sf-analysis-switch" role="group" aria-label="伤害类型层级">
            <button
              type="button"
              :aria-pressed="typeDimension === 'type'"
              @click="typeDimension = 'type'"
            >
              细分
            </button>
            <button
              type="button"
              :aria-pressed="typeDimension === 'category'"
              @click="typeDimension = 'category'"
            >
              大类
            </button>
          </div>
        </div>
        <div class="sf-pie-row">
          <div
            class="sf-pie"
            :class="{ 'is-selected': typeFilterActive, 'is-empty': !typeSlices.length }"
          >
            <svg
              viewBox="0 0 100 100"
              role="img"
              :aria-label="`${analysisName}伤害类型：${sliceDescription(typeSlices) || '暂无伤害'}`"
            >
              <path
                v-for="slice in typePieSlices"
                :key="slice.id"
                class="sf-pie-slice"
                :class="{ 'is-active': typeSliceSelected(slice.id) }"
                :d="slice.path"
                :fill="slice.color"
                :style="{ '--pie-pop': slice.pop }"
                :aria-label="`${slice.name}，占 ${formatPct(slice.ratio, 1)}`"
                @click="selectTypeSlice(slice.id)"
              />
            </svg>
          </div>
          <ul class="sf-pie-legend">
            <li v-for="slice in typeSlices" :key="slice.id">
              <button
                type="button"
                class="sf-pie-choice"
                :aria-pressed="typeSliceSelected(slice.id)"
                :aria-label="`筛选伤害类型：${slice.name}`"
                @click="selectTypeSlice(slice.id)"
              >
                <i :style="{ background: slice.color }" />
                <span>{{ slice.name }}</span>
                <b>{{ formatNum(slice.total) }}</b>
                <em>{{ formatPct(slice.ratio, 1) }}</em>
              </button>
            </li>
            <li v-if="!typeSlices.length" class="muted">{{ analysisName }}流程暂无可统计伤害</li>
          </ul>
        </div>
        <p class="sf-stats-hint">
          占{{ analysisName }}总伤 {{ formatNum(scopedTotal) }} 的比例；点击扇区或图例筛选招式。
        </p>
      </div>
      <div class="sf-pie-block">
        <h4>{{ analysisName }} · 失衡状态</h4>
        <div class="sf-pie-row">
          <div
            class="sf-pie"
            :class="{
              'is-selected': Boolean(damageFilter.staggerPhase),
              'is-empty': !staggerSlices.length,
            }"
          >
            <svg
              viewBox="0 0 100 100"
              role="img"
              :aria-label="`${analysisName}失衡状态：${sliceDescription(staggerSlices) || '暂无伤害'}`"
            >
              <path
                v-for="slice in staggerPieSlices"
                :key="slice.id"
                class="sf-pie-slice"
                :class="{ 'is-active': damageFilter.staggerPhase === slice.id }"
                :d="slice.path"
                :fill="slice.color"
                :style="{ '--pie-pop': slice.pop }"
                :aria-label="`${slice.name}，占 ${formatPct(slice.ratio, 1)}`"
                @click="selectStaggerPhase(slice.id as StaggerPhase)"
              />
            </svg>
          </div>
          <ul class="sf-pie-legend">
            <li v-for="slice in staggerSlices" :key="slice.id">
              <button
                type="button"
                class="sf-pie-choice"
                :aria-pressed="damageFilter.staggerPhase === slice.id"
                :aria-label="`筛选失衡状态：${slice.name}`"
                @click="selectStaggerPhase(slice.id as StaggerPhase)"
              >
                <i :style="{ background: slice.color }" />
                <span>{{ slice.name }}</span>
                <b>{{ formatNum(slice.total) }}</b>
                <em>{{ formatPct(slice.ratio, 1) }}</em>
              </button>
            </li>
            <li v-if="!staggerSlices.length" class="muted">{{ analysisName }}流程暂无可统计伤害</li>
          </ul>
        </div>
        <p class="sf-stats-hint">占{{ analysisName }}总伤 {{ formatNum(scopedTotal) }} 的比例。</p>
      </div>
    </div>

    <SkillFlowDamageCrossAnalysis
      :name="analysisName"
      :rows="crossRows"
      :filter="damageFilter"
      @select-type="selectDamageType"
      @select-cell="selectCrossCell"
    />

    <section class="sf-analysis-ranking" aria-label="招式贡献排行">
      <h4>{{ analysisName }} · 招式贡献排行</h4>
      <p class="sf-stats-hint">
        按总伤降序；同一角色的同一招式合并，展开可查看各段状态与计算过程。
      </p>
      <div v-if="filterChips.length" class="sf-analysis-filter-bar" aria-label="当前招式筛选">
        <span>筛选：</span>
        <button
          v-for="chip in filterChips"
          :key="chip.key"
          type="button"
          class="sf-analysis-detail-button"
          :aria-label="`移除筛选：${chip.label}`"
          @click="removeFilter(chip.key)"
        >
          {{ chip.label }} ×
        </button>
        <button type="button" class="sf-analysis-detail-button" @click="damageFilter = {}">
          清除全部筛选
        </button>
        <span
          >命中 {{ filteredLines.length }} 段 · {{ formatNum(filteredTotal) }} · 占当前范围
          {{ formatPct(filteredTotal, scopedTotal) }}</span
        >
      </div>
      <p v-if="filterChips.length" class="sf-stats-hint">
        上方图表保留完整范围；排行占个人／全队仍以各自完整总伤为分母。
      </p>
      <div
        v-if="contributions.length"
        class="sf-analysis-table-scroll"
        tabindex="0"
        aria-label="招式排行，可横向滚动"
      >
        <table class="sf-analysis-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">角色</th>
              <th scope="col">招式</th>
              <th scope="col">累计次数</th>
              <th scope="col">期望总伤</th>
              <th scope="col">占个人</th>
              <th scope="col">占全队</th>
              <th scope="col">流程明细</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(item, index) in contributions" :key="item.id">
              <tr>
                <td>{{ index + 1 }}</td>
                <td>{{ agentName(teamSlots[item.slotIndex]?.agentId) }}</td>
                <td class="sf-analysis-skill-name">{{ item.name }}</td>
                <td>{{ item.count.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }}</td>
                <td class="sf-analysis-damage">{{ formatNum(item.total) }}</td>
                <td>{{ formatPct(item.personalRatio, 1) }}</td>
                <td>{{ formatPct(item.teamRatio, 1) }}</td>
                <td>
                  <button
                    type="button"
                    class="sf-analysis-detail-button"
                    :aria-expanded="expandedContributionIds.has(item.id)"
                    :aria-label="`${expandedContributionIds.has(item.id) ? '收起' : '展开'}${agentName(teamSlots[item.slotIndex]?.agentId)}的${item.name}流程明细`"
                    @click="toggleContribution(item)"
                  >
                    {{ expandedContributionIds.has(item.id) ? '收起' : '展开' }}
                    {{ item.lines.length }} 段
                  </button>
                </td>
              </tr>
              <tr v-if="expandedContributionIds.has(item.id)" class="sf-analysis-expanded-row">
                <td colspan="8">
                  <div v-for="line in item.lines" :key="line.hit.id" class="sf-analysis-flow-line">
                    <div class="sf-analysis-line-summary">
                      <strong>流程第 {{ line.flowEntryIndex + 1 }} 项</strong>
                      <span>{{ line.hit.staggerPhase === 'stagger' ? '失衡期' : '非失衡' }}</span>
                      <span>单次 {{ formatNum(line.perHit) }} × {{ line.hit.count }} 次</span>
                      <span>合计 {{ formatNum(line.total) }}</span>
                      <span>{{
                        flowBuffOverrideExceptionCount(line.hit.buffOverride)
                          ? `增益例外 ${flowBuffOverrideExceptionCount(line.hit.buffOverride)} 项`
                          : '增益继承全局'
                      }}</span>
                      <button
                        v-if="resolveCalculationDetail && !frozen"
                        type="button"
                        class="sf-analysis-detail-button"
                        :aria-expanded="selectedCalculationHitId === line.hit.id"
                        :aria-label="`流程第${line.flowEntryIndex + 1}项${item.name}计算过程`"
                        @click="toggleCalculation(line.hit.id)"
                      >
                        {{
                          selectedCalculationHitId === line.hit.id ? '收起计算过程' : '查看计算过程'
                        }}
                      </button>
                    </div>
                    <p v-if="participants(line)" class="sf-stats-hint">{{ participants(line) }}</p>
                    <template v-if="selectedCalculationHitId === line.hit.id">
                      <FlowCalculationDetail
                        v-if="selectedCalculation"
                        :calculation="selectedCalculation"
                      />
                      <p v-else class="sf-stats-hint">本段计算过程暂不可用，请检查当前面板来源。</p>
                    </template>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-else class="sf-stats-hint">
        {{
          filterChips.length
            ? '没有符合当前筛选的招式，可移除筛选条件。'
            : `${analysisName}流程暂无可统计招式。`
        }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.sf-flow-module {
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
}
.sf-pie-block h4,
.sf-analysis-section-head h4,
.sf-analysis-ranking h4 {
  margin: 0;
  font-size: 0.88rem;
  color: var(--sf-analysis-text);
}
.sf-stats-hint {
  margin: 0.2rem 0 0;
  font-size: 0.72rem;
  color: #8b93a0;
}
.sf-stats-current {
  display: flex;
  align-items: baseline;
  gap: 1.4rem;
  flex-wrap: wrap;
}
.sf-stats-metric {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  flex-wrap: wrap;
}
.sf-stats-label {
  font-size: 0.72rem;
  color: #9aa3b0;
}
.sf-stats-num {
  font-size: 1.15rem;
  font-weight: 700;
  color: #d7e4ff;
  font-variant-numeric: tabular-nums;
}
.sf-stats-num.team,
.sf-stats-num.current {
  font-size: 1.55rem;
}
.sf-stats-num.team {
  color: #e8edf5;
}
.sf-stats-num.current {
  color: #c4b4f0;
}
.sf-stats-pct {
  font-size: 0.85rem;
  color: #8ec8ff;
  font-variant-numeric: tabular-nums;
}
.sf-stats-team {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
}
.sf-stats-agent {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: #161a20;
}
.sf-stats-agent.active {
  border-color: #c9a55c;
}
.sf-stats-pies {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.85rem;
}
.sf-analysis-comparison,
.sf-analysis-ranking {
  min-width: 0;
}
.sf-analysis-comparison {
  padding: 0.2rem 0 0.8rem;
  border-bottom: 1px solid var(--sf-analysis-border);
}
.sf-analysis-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem 1rem;
  flex-wrap: wrap;
}
.sf-analysis-scope-head {
  align-items: flex-start;
}
.sf-analysis-switch {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}
.sf-analysis-switch button,
.sf-analysis-detail-button {
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--sf-analysis-border);
  border-radius: 6px;
  background: var(--sf-analysis-surface);
  color: var(--sf-analysis-text);
  font: inherit;
  font-size: 0.76rem;
  line-height: 1.4;
  cursor: pointer;
}
.sf-analysis-switch button[aria-pressed='true'] {
  border-color: var(--sf-analysis-accent);
  background: var(--sf-analysis-selected);
  font-weight: 700;
}
.sf-analysis-switch button:hover,
.sf-analysis-detail-button:hover {
  border-color: var(--sf-analysis-accent);
}
.sf-analysis-switch button:focus-visible,
.sf-analysis-detail-button:focus-visible,
.sf-analysis-table-scroll:focus-visible {
  outline: 2px solid var(--sf-analysis-accent);
  outline-offset: 3px;
}
.sf-analysis-axis {
  display: flex;
  justify-content: space-between;
  margin: 0.65rem 11rem 0.3rem 8.5rem;
  color: var(--sf-analysis-muted);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
}
.sf-analysis-bar-row {
  display: grid;
  grid-template-columns: 8rem minmax(0, 1fr) 10.5rem;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.45rem;
  color: var(--sf-analysis-text);
  font-size: 0.8rem;
}
.sf-analysis-bar-label {
  overflow-wrap: anywhere;
}
.sf-analysis-track {
  height: 1.15rem;
  /* 不裁剪：分段悬停/选中要能浮出轨道（与伤害记录柱体同一手感） */
  border-radius: 3px;
  background: var(--sf-analysis-track);
}
.sf-analysis-bar {
  display: flex;
  height: 100%;
}
.sf-analysis-bar > button {
  flex-shrink: 0;
  height: 100%;
  padding: 0;
  border: 0;
  cursor: pointer;
  transform-origin: center;
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease,
    filter 0.12s ease;
}
/* 悬停与选中的分段都上浮，手感与伤害记录柱体一致 */
.sf-analysis-bar > button:hover,
.sf-analysis-bar > button:focus-visible {
  position: relative;
  z-index: 1;
  transform: scaleY(1.7);
  filter: brightness(1.15);
  border-radius: 3px;
  box-shadow: 0 0 0 1.5px rgba(232, 237, 245, 0.45);
}
.sf-analysis-bar > button[aria-pressed='true'] {
  position: relative;
  z-index: 1;
  transform: scaleY(1.45);
  border-radius: 3px;
  box-shadow: 0 0 0 1.5px rgba(232, 237, 245, 0.7);
}
.sf-analysis-bar > button:focus-visible {
  outline: 2px solid var(--sf-analysis-text);
  outline-offset: -2px;
}
/* 去掉轨道裁剪后，首末段自己补圆角 */
.sf-analysis-bar > button:first-child {
  border-radius: 3px 0 0 3px;
}
.sf-analysis-bar > button:last-child {
  border-radius: 0 3px 3px 0;
}
.sf-analysis-bar > button:only-child {
  border-radius: 3px;
}
.sf-analysis-filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.6rem;
  color: var(--sf-analysis-text);
  font-size: 0.76rem;
}
.sf-analysis-bar-total {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.sf-analysis-bar-total small {
  display: block;
  font-size: 0.7rem;
  color: var(--sf-analysis-muted);
}
.sf-analysis-inline-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  margin: 0.65rem 0 0;
  padding: 0;
  list-style: none;
  color: var(--sf-analysis-muted);
  font-size: 0.74rem;
}
.sf-analysis-inline-legend li {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.sf-analysis-inline-legend i {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 2px;
}
.sf-analysis-notice {
  margin: 0;
  color: var(--sf-analysis-muted);
  font-size: 0.78rem;
}
.sf-analysis-table-scroll {
  max-width: 100%;
  overflow-x: auto;
  margin-top: 0.5rem;
}
.sf-analysis-table {
  width: 100%;
  min-width: 730px;
  border-collapse: collapse;
  color: var(--sf-analysis-text);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
.sf-analysis-table th,
.sf-analysis-table td {
  padding: 0.5rem;
  border-bottom: 1px solid var(--sf-analysis-border);
  text-align: right;
  vertical-align: top;
}
.sf-analysis-table th {
  color: var(--sf-analysis-muted);
  font-size: 0.74rem;
  font-weight: 500;
  white-space: nowrap;
}
.sf-analysis-table th:nth-child(2),
.sf-analysis-table td:nth-child(2),
.sf-analysis-table th:nth-child(3),
.sf-analysis-table td:nth-child(3) {
  text-align: left;
}
.sf-analysis-skill-name {
  min-width: 9rem;
  max-width: 24rem;
  overflow-wrap: anywhere;
}
.sf-analysis-damage {
  font-weight: 700;
}
.sf-analysis-expanded-row > td {
  padding: 0.35rem 0.65rem;
  text-align: left;
  background: var(--sf-analysis-surface);
}
.sf-analysis-flow-line {
  padding: 0.65rem 0;
}
.sf-analysis-flow-line + .sf-analysis-flow-line {
  border-top: 1px solid var(--sf-analysis-border);
}
.sf-analysis-line-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
}
.sf-pie-row {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  margin-top: 0.45rem;
}
.sf-pie {
  flex: 0 0 5.6rem;
  width: 5.6rem;
  height: 5.6rem;
  border-radius: 50%;
  background: transparent;
}
/* 只有完全没有数据时才显示底圆，避免扇区弹出后露出黑底 */
.sf-pie.is-empty {
  background: var(--sf-analysis-track);
}
.sf-pie svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
/* 单个扇区：选中或悬停时沿自身中线弹出去 */
.sf-pie-slice {
  cursor: pointer;
  transform-box: fill-box;
  transition:
    transform 0.14s ease,
    filter 0.14s ease;
}
.sf-pie-slice:hover,
.sf-pie-slice.is-active {
  transform: var(--pie-pop);
  filter: brightness(1.12);
}
.sf-pie-choice {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 0.6rem minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.3rem;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.sf-pie-choice {
  transition:
    transform 0.12s ease,
    border-color 0.12s ease,
    background 0.12s ease;
}
/* 选中的图例项保持上浮，与柱图分段一致 */
.sf-pie-choice:hover,
.sf-pie-choice[aria-pressed='true'] {
  border-color: var(--sf-analysis-accent);
  background: var(--sf-analysis-selected);
  transform: translateY(-1px);
}
.sf-pie-choice:focus-visible {
  outline: 2px solid var(--sf-analysis-accent);
  outline-offset: 2px;
}
.sf-pie-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  min-width: 0;
}
.sf-pie-legend li {
  display: grid;
  grid-template-columns: 0.6rem minmax(0, 1fr) auto auto;
  gap: 0.4rem;
  align-items: center;
  font-size: 0.72rem;
  color: #c5ccd6;
}
.sf-pie-legend i {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
}
.sf-pie-legend .muted {
  display: block;
  color: #8b93a0;
}
.sf-pie-legend b,
.sf-pie-legend em {
  font-style: normal;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 800px) {
  .sf-stats-team,
  .sf-stats-pies {
    grid-template-columns: minmax(0, 1fr);
  }
}
@container (max-width: 800px) {
  .sf-stats-team,
  .sf-stats-pies {
    grid-template-columns: minmax(0, 1fr);
  }
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
