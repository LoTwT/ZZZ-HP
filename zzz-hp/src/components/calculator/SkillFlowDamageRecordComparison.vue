<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SkillFlowDamageRecord } from '@/utils/skillFlowDamageRecords'
import { skillFlowDamageRecordLabel } from '@/utils/skillFlowDamageRecords'
import { flowBuffOverrideExceptionCount } from '@/utils/flowBuffTable'
import {
  compareSkillFlowDamageRecords,
  type SkillFlowDamageMetricComparison,
  type SkillFlowDamageComparisonRow,
} from '@/utils/skillFlowDamageRecordComparison'
import {
  skillFlowDamageSegmentHasChanges,
  type SkillFlowDamageSegmentComparison,
  type SkillFlowDamageSegmentSide,
} from '@/utils/skillFlowDamageRecordSegments'

const props = defineProps<{ records: SkillFlowDamageRecord[] }>()
const baselineId = ref('')
const comparisonId = ref('')
const dimension = ref<'agent' | 'type' | 'skill'>('agent')
const skillView = ref<'single' | 'count' | 'total'>('single')
const onlyChanges = ref(true)

watch(
  () => props.records.map((record) => record.id),
  (ids, before) => {
    if (ids.length < 2) {
      baselineId.value = ''
      comparisonId.value = ''
      return
    }
    if (!before || ids.length > before.length) {
      baselineId.value = ids[ids.length - 2]!
      comparisonId.value = ids[ids.length - 1]!
      return
    }
    if (!ids.includes(comparisonId.value)) comparisonId.value = ids[ids.length - 1]!
    if (!ids.includes(baselineId.value))
      baselineId.value = [...ids].reverse().find((id) => id !== comparisonId.value)!
  },
  { immediate: true },
)

const baseline = computed(() => props.records.find((record) => record.id === baselineId.value))
const comparison = computed(() => props.records.find((record) => record.id === comparisonId.value))
const result = computed(() =>
  baseline.value && comparison.value
    ? compareSkillFlowDamageRecords(baseline.value, comparison.value)
    : null,
)
const countView = computed(() => dimension.value === 'skill' && skillView.value === 'count')
const rows = computed(() =>
  (result.value?.[dimension.value] ?? []).filter(
    (row) =>
      !onlyChanges.value ||
      row.state === 'added' ||
      row.state === 'removed' ||
      (countView.value
        ? row.skill?.count.delta !== 0
        : row.delta !== 0 || Math.abs(row.shareDelta) > 1e-10),
  ),
)
const singleSkills = computed(() =>
  (result.value?.skill ?? [])
    .map((row) => ({
      row,
      segments: (row.skill?.segments ?? []).filter(
        (segment) => !onlyChanges.value || skillFlowDamageSegmentHasChanges(segment),
      ),
    }))
    .filter(
      (item) =>
        !onlyChanges.value ||
        item.segments.length > 0 ||
        (item.row.skill?.averageDamage.delta != null && item.row.skill.averageDamage.delta !== 0),
    ),
)
const unmatchedCount = computed(() =>
  (result.value?.skill ?? []).reduce(
    (sum, row) =>
      sum +
      (row.skill?.segments.filter((segment) => !segment.baseline || !segment.comparison).length ??
        0),
    0,
  ),
)
const missingNames = computed(() =>
  [baseline.value, comparison.value]
    .filter((record) => record && !record.snapshot)
    .map((record) => record!.schemeName)
    .join('、'),
)

function number(value: number, maximumFractionDigits = 0) {
  return value.toLocaleString('zh-CN', { maximumFractionDigits })
}
function signed(value: number, maximumFractionDigits = 0) {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value), maximumFractionDigits)}`
}
function averageDamage(value: number | null) {
  return value == null ? '—' : number(value, 2)
}
function change(row: Pick<SkillFlowDamageMetricComparison, 'changeRatio'>) {
  if (row.changeRatio == null) return '从 0 增加'
  return `${row.changeRatio > 0 ? '+' : ''}${(row.changeRatio * 100).toFixed(2)}%`
}
function metric(row: SkillFlowDamageComparisonRow) {
  return countView.value && row.skill ? row.skill.count : row
}
function segmentLocation(segment: SkillFlowDamageSegmentComparison) {
  const before = segment.baseline?.line.context?.flowEntryIndex
  const after = segment.comparison?.line.context?.flowEntryIndex
  if (before != null && after != null && before !== after)
    return `流程第 ${before + 1} → ${after + 1} 项`
  const index = after ?? before
  return index == null
    ? `未定位段 ${(segment.baseline?.index ?? segment.comparison?.index ?? 0) + 1}`
    : `流程第 ${index + 1} 项`
}
function segmentPhase(segment: SkillFlowDamageSegmentComparison) {
  const phase = (side: SkillFlowDamageSegmentSide | null) =>
    side ? (side.line.staggerPhase === 'stagger' ? '失衡期' : '非失衡') : ''
  const before = phase(segment.baseline)
  const after = phase(segment.comparison)
  return before && after && before !== after ? `${before} → ${after}` : after || before
}
function segmentConditions(
  side: SkillFlowDamageSegmentSide | null,
  record: SkillFlowDamageRecord | undefined,
) {
  const context = side?.line.context
  if (!context) return side ? '旧记录未保存增益上下文' : ''
  const count = flowBuffOverrideExceptionCount(context.buffOverride)
  const labels = [count ? `增益例外 ${count} 项` : '增益继承全局']
  if (context.critMode !== 'expected')
    labels.push(context.critMode === 'fullCrit' ? '暴击' : '不暴击')
  const agentName = (id: string) => {
    const index = record?.snapshot?.agentIds.indexOf(id) ?? -1
    return record?.agentNames[index] || '记录外角色'
  }
  if (context.anomalyPowerAgentId)
    labels.push(`强度提供：${agentName(context.anomalyPowerAgentId)}`)
  if (context.triggerAgentId) labels.push(`触发：${agentName(context.triggerAgentId)}`)
  return labels.join(' · ')
}
function optionLabel(record: SkillFlowDamageRecord, index: number) {
  const scheme = record.name ? `（${record.schemeName}）` : ''
  return `#${index + 1} ${skillFlowDamageRecordLabel(record)}${scheme} · ${new Date(record.savedAt).toLocaleTimeString('zh-CN', { hour12: false })}${record.snapshot ? '' : '（仅总伤）'}`
}
</script>

<template>
  <section class="sf-record-compare" aria-label="伤害记录结构对比">
    <h4>记录结构对比</h4>
    <p v-if="records.length < 2" class="sf-record-hint">
      记录两次伤害后，可比较角色、伤害类型与招式的变化。
    </p>
    <template v-else>
      <div class="sf-record-selectors">
        <label
          >基准记录<select v-model="baselineId" aria-label="基准伤害记录">
            <option
              v-for="(record, index) in records"
              :key="record.id"
              :value="record.id"
            >
              {{ optionLabel(record, index) }}
            </option>
          </select></label
        >
        <span aria-hidden="true">→</span>
        <label
          >对照记录<select v-model="comparisonId" aria-label="对照伤害记录">
            <option
              v-for="(record, index) in records"
              :key="record.id"
              :value="record.id"
            >
              {{ optionLabel(record, index) }}
            </option>
          </select></label
        >
      </div>
      <template v-if="result">
        <p class="sf-record-total">
          全队 <strong>{{ number(result.total.baseline) }}</strong> →
          <strong>{{ number(result.total.comparison) }}</strong
          ><span
            :class="{
              'sf-record-up': result.total.delta > 0,
              'sf-record-down': result.total.delta < 0,
            }"
            >{{ signed(result.total.delta) }}（{{ change(result.total) }}）</span
          >
        </p>
        <p class="sf-record-hint">
          比较记录时的完整伤害快照；队伍、流程或配置变化均会影响差值。角色按身份对齐，换槽不会被视为换人。
        </p>
        <p v-if="!result.hasDetails" class="sf-record-hint sf-record-legacy">
          {{ missingNames }} 仅保存总伤，无法还原结构；重新记录后可比较角色、类型和招式。
        </p>
        <template v-else>
          <p
            v-if="baseline?.snapshot?.uncomputedCount || comparison?.snapshot?.uncomputedCount"
            class="sf-record-hint"
          >
            未计入伤害的段数：基准 {{ baseline?.snapshot?.uncomputedCount ?? 0 }}，对照
            {{ comparison?.snapshot?.uncomputedCount ?? 0 }}。
          </p>
          <div class="sf-record-toolbar">
            <div role="group" aria-label="记录对比维度">
              <button
                v-for="option in [
                  { id: 'agent', label: '角色' },
                  { id: 'type', label: '伤害类型' },
                  { id: 'skill', label: '招式' },
                ] as const"
                :key="option.id"
                type="button"
                :aria-pressed="dimension === option.id"
                @click="dimension = option.id"
              >
                {{ option.label }}
              </button>
            </div>
            <label><input v-model="onlyChanges" type="checkbox" />只看变化</label>
          </div>
          <div
            v-if="dimension === 'skill'"
            class="sf-record-view-tabs"
            role="group"
            aria-label="招式对比内容"
          >
            <button
              v-for="view in [
                { id: 'single', label: '单次伤害' },
                { id: 'count', label: '使用次数' },
                { id: 'total', label: '累计贡献' },
              ] as const"
              :key="view.id"
              type="button"
              :aria-pressed="skillView === view.id"
              @click="skillView = view.id"
            >
              {{ view.label }}
            </button>
          </div>
          <dl
            v-if="countView && result.skillSummary"
            class="sf-record-count-summary"
            aria-label="招式数量差异"
          >
            <div>
              <dt>招式种类</dt>
              <dd>
                <strong>{{ number(result.skillSummary.kinds.baseline) }}</strong> →
                <strong>{{ number(result.skillSummary.kinds.comparison) }}</strong>
                <span>{{ signed(result.skillSummary.kinds.delta) }} 种</span>
                <small
                  >新增 {{ result.skillSummary.added }} 种 · 移除
                  {{ result.skillSummary.removed }} 种</small
                >
              </dd>
            </div>
            <div>
              <dt>累计使用次数</dt>
              <dd>
                <strong>{{ number(result.skillSummary.uses.baseline, 6) }}</strong> →
                <strong>{{ number(result.skillSummary.uses.comparison, 6) }}</strong>
                <span>{{ signed(result.skillSummary.uses.delta, 6) }} 次</span>
              </dd>
            </div>
          </dl>
          <p v-if="countView" class="sf-record-hint">
            数量按已计入伤害的招式统计；同角色的同一招式合并为一种，技能组按展开的子招式累计次数。
          </p>
          <template v-if="dimension === 'skill' && skillView === 'single'">
            <p class="sf-record-hint">
              平均单次按次数加权；以下直接列出各流程段的单次变化。平均值不变时，段内涨跌仍会显示。无有效次数时显示「—」。
            </p>
            <p v-if="unmatchedCount" class="sf-record-hint sf-record-unmatched-hint">
              有
              {{ unmatchedCount }}
              段未匹配，可能来自新增、移除或记录缺少流程定位。保留两侧原始单次，不推算逐段涨跌；新记录可保存流程定位。
            </p>
            <section
              v-for="item in singleSkills"
              :key="item.row.id"
              class="sf-record-single-skill"
              :aria-label="item.row.name + '单次伤害对比'"
            >
              <div class="sf-record-single-heading">
                <h5>{{ item.row.name }}</h5>
                <span
                  >{{ item.segments.length }} 段{{ onlyChanges ? '变化或未匹配' : '明细' }}</span
                >
              </div>
              <div v-if="item.row.skill" class="sf-record-single-average" aria-label="平均单次伤害">
                <span>加权平均单次</span>
                <strong
                  >{{ averageDamage(item.row.skill.averageDamage.baseline) }} →
                  {{ averageDamage(item.row.skill.averageDamage.comparison) }}</strong
                >
                <span
                  v-if="item.row.skill.averageDamage.delta != null"
                  :class="{
                    'sf-record-up': item.row.skill.averageDamage.delta > 0,
                    'sf-record-down': item.row.skill.averageDamage.delta < 0,
                  }"
                  >{{ signed(item.row.skill.averageDamage.delta, 2) }}（{{
                    change(item.row.skill.averageDamage)
                  }}）</span
                >
                <span v-else>单次变化无法比较</span>
              </div>
              <div
                v-if="item.segments.length"
                class="sf-record-diff-scroll"
                tabindex="0"
                :aria-label="item.row.name + '逐段单次变化，可横向滚动'"
              >
                <table class="sf-record-segment-table">
                  <thead>
                    <tr>
                      <th scope="col">流程段／状态</th>
                      <th scope="col">基准单次</th>
                      <th scope="col">对照单次</th>
                      <th scope="col">变化</th>
                      <th scope="col">变化率</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="segment in item.segments" :key="segment.id">
                      <th scope="row" class="sf-record-segment-context">
                        {{ segmentLocation(segment) }} · {{ segmentPhase(segment) }}
                        <small
                          v-if="!segment.baseline || !segment.comparison"
                          class="sf-record-unmatched"
                          >{{ segment.baseline ? '基准未匹配' : '对照未匹配' }}</small
                        >
                        <small v-else-if="segment.conditionsChanged">条件有变化</small>
                        <small v-if="segment.baseline">{{
                          segmentConditions(segment.baseline, baseline)
                        }}</small>
                        <small
                          v-if="
                            segment.comparison &&
                            (!segment.baseline ||
                              segmentConditions(segment.baseline, baseline) !==
                                segmentConditions(segment.comparison, comparison))
                          "
                          >对照：{{ segmentConditions(segment.comparison, comparison) }}</small
                        >
                      </th>
                      <td>{{ averageDamage(segment.damage.baseline) }}</td>
                      <td>{{ averageDamage(segment.damage.comparison) }}</td>
                      <td
                        :class="{
                          'sf-record-up': (segment.damage.delta ?? 0) > 0,
                          'sf-record-down': (segment.damage.delta ?? 0) < 0,
                        }"
                      >
                        {{ segment.damage.delta == null ? '—' : signed(segment.damage.delta, 2) }}
                      </td>
                      <td>{{ segment.damage.delta == null ? '—' : change(segment.damage) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="sf-record-hint">
                各段单次未变，平均值变化来自使用次数构成；可切换「使用次数」查看。
              </p>
            </section>
            <p v-if="!singleSkills.length" class="sf-record-hint">
              {{
                onlyChanges
                  ? '单次伤害没有变化；可切换「使用次数」或取消「只看变化」。'
                  : '这两条记录均没有可展示的招式明细。'
              }}
            </p>
          </template>
          <div
            v-else-if="rows.length"
            class="sf-record-diff-scroll"
            tabindex="0"
            aria-label="伤害结构变化，可横向滚动"
          >
            <table class="sf-record-diff-table" :class="{ 'sf-record-count-table': countView }">
              <thead>
                <tr>
                  <th scope="col">
                    {{
                      dimension === 'agent'
                        ? '角色'
                        : dimension === 'type'
                          ? '伤害类型'
                          : '角色 · 招式'
                    }}
                  </th>
                  <th scope="col">{{ countView ? '基准次数' : '基准伤害' }}</th>
                  <th scope="col">{{ countView ? '对照次数' : '对照伤害' }}</th>
                  <th scope="col">{{ countView ? '次数变化' : '伤害变化' }}</th>
                  <th scope="col">变化率</th>
                  <th v-if="!countView" scope="col">占全队变化</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.id">
                  <th scope="row">
                    {{ row.name
                    }}<small v-if="row.state === 'added' || row.state === 'removed'">{{
                      row.state === 'added' ? '新增' : '移除'
                    }}</small>
                  </th>
                  <td>{{ number(metric(row).baseline, countView ? 6 : 0) }}</td>
                  <td>{{ number(metric(row).comparison, countView ? 6 : 0) }}</td>
                  <td
                    :class="{
                      'sf-record-up': metric(row).delta > 0,
                      'sf-record-down': metric(row).delta < 0,
                    }"
                  >
                    {{ signed(metric(row).delta, countView ? 6 : 0) }}
                  </td>
                  <td>{{ change(metric(row)) }}</td>
                  <td v-if="!countView">
                    {{ row.shareDelta > 0 ? '+' : ''
                    }}{{ (row.shareDelta * 100).toFixed(2) }} 个百分点
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="sf-record-hint">
            {{
              onlyChanges
                ? '此维度没有变化；取消「只看变化」可查看完整构成。'
                : '这两条记录在此维度均没有伤害条目。'
            }}
          </p>
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped>
.sf-record-compare {
  margin-top: 1rem;
  padding-top: 0.8rem;
  border-top: 1px solid var(--sf-analysis-border);
  color: var(--sf-analysis-text);
  min-width: 0;
}
h4 {
  margin: 0;
  font-size: 0.88rem;
}
.sf-record-hint {
  margin: 0.35rem 0;
  font-size: 0.74rem;
  color: var(--sf-analysis-muted);
}
.sf-record-selectors,
.sf-record-toolbar,
.sf-record-total {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
}
.sf-record-selectors {
  margin-top: 0.6rem;
}
.sf-record-selectors label {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  font-size: 0.76rem;
  max-width: 100%;
}
select {
  min-width: 0;
  max-width: 24rem;
  width: 100%;
  padding: 0.35rem;
  background: var(--sf-analysis-surface);
  color: var(--sf-analysis-text);
  border: 1px solid var(--sf-analysis-border);
  border-radius: 5px;
  font: inherit;
}
.sf-record-total {
  font-size: 0.85rem;
  margin: 0.6rem 0 0.3rem;
  font-variant-numeric: tabular-nums;
}
.sf-record-up {
  color: var(--sf-record-up, #82c9ac);
}
.sf-record-down {
  color: var(--sf-record-down, #e29b9b);
}
.sf-record-toolbar {
  justify-content: space-between;
  margin: 0.6rem 0 0.4rem;
  font-size: 0.76rem;
}
.sf-record-count-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.6rem 0 0.35rem;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}
.sf-record-count-summary > div {
  flex: 1 1 16rem;
  min-width: 0;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--sf-analysis-border);
  border-radius: 5px;
  background: var(--sf-analysis-surface);
}
.sf-record-count-summary dt {
  color: var(--sf-analysis-muted);
  margin-bottom: 0.25rem;
}
.sf-record-count-summary dd {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.4rem;
  margin: 0;
}
.sf-record-count-summary dd > span {
  margin-left: 0.3rem;
}
.sf-record-count-summary small {
  margin-left: 0.3rem;
}
.sf-record-toolbar label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
button {
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--sf-analysis-border);
  border-radius: 5px;
  color: inherit;
  background: var(--sf-analysis-surface);
  font: inherit;
  cursor: pointer;
  margin-right: 0.25rem;
}
button[aria-pressed='true'],
button:hover {
  border-color: var(--sf-analysis-accent);
  background: var(--sf-analysis-selected);
}
select:focus-visible,
button:focus-visible,
.sf-record-diff-scroll:focus-visible {
  outline: 2px solid var(--sf-analysis-accent);
  outline-offset: 2px;
}
.sf-record-diff-scroll {
  max-width: 100%;
  overflow-x: auto;
}
table {
  width: 100%;
  min-width: 650px;
  border-collapse: collapse;
  font-size: 0.77rem;
  font-variant-numeric: tabular-nums;
}
.sf-record-count-table,
.sf-record-segment-table {
  min-width: 560px;
}
th,
td {
  padding: 0.45rem;
  text-align: right;
  border-bottom: 1px solid var(--sf-analysis-border);
}
thead th {
  font-weight: 500;
  color: var(--sf-analysis-muted);
  white-space: nowrap;
}
th:first-child {
  text-align: left;
  font-weight: 500;
  min-width: 8rem;
}
small {
  display: inline-block;
  margin-left: 0.4rem;
  font-size: 0.7rem;
  color: var(--sf-analysis-muted);
}
.sf-record-view-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0.45rem 0 0.6rem;
  font-size: 0.76rem;
}
.sf-record-single-skill {
  margin: 1rem 0;
  min-width: 0;
}
.sf-record-single-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3rem 1rem;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}
.sf-record-single-heading h5 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 500;
}
.sf-record-single-heading > span {
  font-size: 0.7rem;
  color: var(--sf-analysis-muted);
}
.sf-record-single-average {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3rem 1rem;
  padding: 0.5rem 0.6rem;
  background: var(--sf-analysis-surface);
  font-size: 0.77rem;
  font-variant-numeric: tabular-nums;
}
.sf-record-single-average > span:first-child {
  color: var(--sf-analysis-muted);
}
.sf-record-single-average strong {
  font-weight: 500;
}
.sf-record-segment-context {
  max-width: 23rem;
}
.sf-record-segment-context small {
  display: block;
  margin: 0.2rem 0 0;
  font-weight: 400;
}
</style>
