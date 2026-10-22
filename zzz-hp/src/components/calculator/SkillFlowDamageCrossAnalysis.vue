<script setup lang="ts">
import type { BuffDamageType, StaggerPhase } from '@/types/calculator'
import type {
  SkillFlowDamageCrossRow,
  SkillFlowDamageFilter,
} from '@/utils/skillFlowDamageAnalysis'

defineProps<{
  name: string
  rows: SkillFlowDamageCrossRow[]
  filter: SkillFlowDamageFilter
}>()
const emit = defineEmits<{
  'select-type': [type: BuffDamageType]
  'select-cell': [type: BuffDamageType, phase: StaggerPhase]
}>()
function number(value: number) {
  return Math.round(value).toLocaleString('zh-CN')
}
</script>

<template>
  <section class="sf-cross" aria-label="伤害类型与失衡交叉分析">
    <h4>{{ name }} · 伤害类型 × 失衡状态</h4>
    <p>点击类型查看对应招式，点击伤害数值同时筛选类型与失衡状态。</p>
    <div
      v-if="rows.length"
      class="sf-cross-scroll"
      tabindex="0"
      aria-label="伤害与失衡交叉表，可横向滚动"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">伤害类型</th>
            <th scope="col">非失衡</th>
            <th scope="col">失衡期</th>
            <th scope="col">合计</th>
            <th scope="col">失衡期占该类型</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <th scope="row">
              <button
                type="button"
                :aria-pressed="filter.damageType === row.id"
                @click="emit('select-type', row.id)"
              >
                <i :style="{ background: row.color }" />{{ row.name }}
              </button>
            </th>
            <td v-for="phase in ['normal', 'stagger'] as const" :key="phase">
              <button
                type="button"
                :disabled="row[phase] <= 0"
                :aria-label="`${row.name} · ${phase === 'stagger' ? '失衡期' : '非失衡'}，筛选招式`"
                :aria-pressed="filter.damageType === row.id && filter.staggerPhase === phase"
                @click="emit('select-cell', row.id, phase)"
              >
                {{ number(row[phase]) }}
              </button>
            </td>
            <td>{{ number(row.total) }}</td>
            <td>{{ (row.staggerRatio * 100).toFixed(2) }}%</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else>当前范围暂无可分析伤害。</p>
  </section>
</template>

<style scoped>
.sf-cross {
  min-width: 0;
  color: var(--sf-analysis-text);
}
h4 {
  margin: 0;
  font-size: 0.88rem;
}
p {
  margin: 0.25rem 0 0.5rem;
  font-size: 0.74rem;
  color: var(--sf-analysis-muted);
}
.sf-cross-scroll {
  overflow-x: auto;
  max-width: 100%;
}
table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}
th,
td {
  padding: 0.4rem 0.5rem;
  text-align: right;
  border-bottom: 1px solid var(--sf-analysis-border);
}
thead th {
  color: var(--sf-analysis-muted);
  font-weight: 500;
  font-size: 0.73rem;
}
th:first-child {
  text-align: left;
}
button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
button:hover:not(:disabled),
button[aria-pressed='true'] {
  border-color: var(--sf-analysis-accent);
  background: var(--sf-analysis-selected);
}
button:disabled {
  color: var(--sf-analysis-muted);
  cursor: default;
}
button:focus-visible,
.sf-cross-scroll:focus-visible {
  outline: 2px solid var(--sf-analysis-accent);
  outline-offset: 2px;
}
i {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 2px;
}
</style>
