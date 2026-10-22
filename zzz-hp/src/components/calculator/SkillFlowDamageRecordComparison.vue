<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SkillFlowDamageRecord } from '@/utils/skillFlowDamageRecords'
import {
  compareSkillFlowDamageRecords,
  type SkillFlowDamageComparisonRow,
} from '@/utils/skillFlowDamageRecordComparison'

const props = defineProps<{ records: SkillFlowDamageRecord[] }>()
const baselineId = ref('')
const comparisonId = ref('')
const dimension = ref<'agent' | 'type' | 'skill'>('agent')
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
    if (!ids.includes(baselineId.value) || baselineId.value === comparisonId.value)
      baselineId.value = [...ids].reverse().find((id) => id !== comparisonId.value)!
  },
  { immediate: true },
)

const baseline = computed(() => props.records.find((record) => record.id === baselineId.value))
const comparison = computed(() => props.records.find((record) => record.id === comparisonId.value))
const result = computed(() =>
  baseline.value && comparison.value && baselineId.value !== comparisonId.value
    ? compareSkillFlowDamageRecords(baseline.value, comparison.value)
    : null,
)
const rows = computed(() =>
  (result.value?.[dimension.value] ?? []).filter(
    (row) =>
      !onlyChanges.value ||
      row.delta !== 0 ||
      Math.abs(row.shareDelta) > 1e-10 ||
      row.state === 'added' ||
      row.state === 'removed',
  ),
)
const missingNames = computed(() =>
  [baseline.value, comparison.value]
    .filter((record) => record && !record.snapshot)
    .map((record) => record!.schemeName)
    .join('、'),
)

function number(value: number) {
  return Math.round(value).toLocaleString('zh-CN')
}
function signed(value: number) {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value))}`
}
function change(row: SkillFlowDamageComparisonRow) {
  if (row.changeRatio == null) return '从 0 增加'
  return `${row.changeRatio > 0 ? '+' : ''}${(row.changeRatio * 100).toFixed(2)}%`
}
function optionLabel(record: SkillFlowDamageRecord, index: number) {
  return `#${index + 1} ${record.schemeName} · ${new Date(record.savedAt).toLocaleTimeString('zh-CN', { hour12: false })}${record.snapshot ? '' : '（仅总伤）'}`
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
              :disabled="record.id === comparisonId"
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
              :disabled="record.id === baselineId"
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
            v-if="rows.length"
            class="sf-record-diff-scroll"
            tabindex="0"
            aria-label="伤害结构变化，可横向滚动"
          >
            <table class="sf-record-diff-table">
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
                  <th scope="col">基准伤害</th>
                  <th scope="col">对照伤害</th>
                  <th scope="col">伤害变化</th>
                  <th scope="col">变化率</th>
                  <th scope="col">占全队变化</th>
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
                  <td>{{ number(row.baseline) }}</td>
                  <td>{{ number(row.comparison) }}</td>
                  <td :class="{ 'sf-record-up': row.delta > 0, 'sf-record-down': row.delta < 0 }">
                    {{ signed(row.delta) }}
                  </td>
                  <td>{{ change(row) }}</td>
                  <td>
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
</style>
