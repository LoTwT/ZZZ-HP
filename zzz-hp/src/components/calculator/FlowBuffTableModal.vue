<script setup lang="ts">
/**
 * 流程增益表 —— 以表格形式调整「流程招式 × 增益（效果块）」的生效开关。
 *
 * 设计（2026-09-21 用户方案）：
 * - **只改增益开关**：次数 / 失衡 / 代理人一律不在这里动
 * - **表格形态**：左列（流程招式）与表头（增益）双向固定，中间横向滚动
 * - **左列 = 流程招式**：与流程列表同源、同顺序、同条数；**技能组显示为「组标题行 + 成员缩进」**
 * - **列 = 增益**：按**效果块**聚合（一块一列）
 * - **行级只做减法**：全局未启用的增益，格子置灰不可点（避免"关了却没关"）
 * - 同名招式在流程里可多次出现 → 行名后带「第 x 次」小标签
 * - 名字显示不全时用 `title` 悬停看完整信息（增益效果 / 来源）
 * - 白天主题：`html[data-theme='light']` 覆盖（写法对齐 GameAffixRulesModal）
 */
import { computed, ref } from 'vue'
import type {
  FlowBuffCellState,
  FlowBuffTableBlock,
  FlowBuffTableRow,
} from '@/utils/flowBuffTable'

const props = defineProps<{
  rows: FlowBuffTableRow[]
  blocks: FlowBuffTableBlock[]
  /** `${rowKey}|${blockKey}` → on 生效 / off 本行关掉 / na 不可点（全局未启用或继承自组） */
  states: Record<string, FlowBuffCellState>
  /** 表格副标题（槽位 / 方案名），仅展示 */
  subtitle?: string
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ toggle: [rowKey: string, blockKey: string] }>()

const hoverKey = ref<string | null>(null)

const onCount = computed(() =>
  Object.values(props.states).filter((value) => value === 'on').length,
)
const offCount = computed(() =>
  Object.values(props.states).filter((value) => value === 'off').length,
)

function stateOf(rowKey: string, blockKey: string): FlowBuffCellState {
  return props.states[`${rowKey}|${blockKey}`] ?? 'na'
}

function onCellClick(rowKey: string, blockKey: string) {
  if (stateOf(rowKey, blockKey) === 'na') return
  emit('toggle', rowKey, blockKey)
}

function cellTitle(row: FlowBuffTableRow, block: FlowBuffTableBlock): string {
  const state = stateOf(row.key, block.key)
  const head = `${row.label} × ${block.label}`
  if (state === 'na') return `${head} —— 不可调整（全局未启用，或继承自技能组）`
  if (state === 'off') return `${head} —— 本行已关闭，点击恢复`
  return `${head} —— 生效中，点击可对本行关闭`
}
</script>

<template>
  <div v-if="open" class="fbt-mask" @click.self="open = false">
    <div class="fbt-card">
      <header class="fbt-head">
        <div class="fbt-head-main">
          <h3>流程增益表</h3>
          <span v-if="subtitle" class="fbt-sub">{{ subtitle }}</span>
        </div>
        <div class="fbt-head-stats">
          <span class="fbt-stat">生效 {{ onCount }}</span>
          <span class="fbt-stat is-off">本行关闭 {{ offCount }}</span>
        </div>
        <button type="button" class="mini-btn" @click="open = false">关闭</button>
      </header>

      <p class="fbt-hint">
        勾选 = 这一行<b>吃</b>该增益。取消勾选只影响<b>本行结算</b>：不改面板、不影响层数累计、不影响其它行。
        全局未启用的增益（灰色）在这里无法单独打开 —— 请到全局增益选择器里开。
      </p>

      <div class="fbt-body">
        <table class="fbt-table">
          <thead>
            <tr>
              <th class="fbt-th-name">招式</th>
              <th
                v-for="block in blocks"
                :key="block.key"
                class="fbt-th-block"
                :title="block.title ?? block.label"
              >
                <span class="fbt-th-text">{{ block.label }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.key"
              class="fbt-row"
              :class="{ 'is-group': row.kind === 'group', 'is-member': row.kind === 'member' }"
            >
              <th class="fbt-td-name" :title="row.label">
                <span class="fbt-name-text" :class="{ 'is-indent': row.kind === 'member' }">
                  {{ row.label }}
                </span>
                <span v-if="row.badge" class="fbt-badge">{{ row.badge }}</span>
                <span v-if="row.kind === 'group'" class="fbt-group-tag">技能组</span>
              </th>
              <td
                v-for="block in blocks"
                :key="block.key"
                class="fbt-td-cell"
                :class="`is-${stateOf(row.key, block.key)}`"
              >
                <button
                  type="button"
                  class="fbt-cell"
                  :class="`is-${stateOf(row.key, block.key)}`"
                  :disabled="stateOf(row.key, block.key) === 'na'"
                  :title="cellTitle(row, block)"
                  @mouseenter="hoverKey = `${row.key}|${block.key}`"
                  @mouseleave="hoverKey = null"
                  @click="onCellClick(row.key, block.key)"
                >
                  <span v-if="stateOf(row.key, block.key) === 'on'">✓</span>
                  <span v-else-if="stateOf(row.key, block.key) === 'off'">×</span>
                  <span v-else>·</span>
                </button>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td class="fbt-empty" :colspan="Math.max(1, blocks.length + 1)">
                当前槽位还没有流程条目。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fbt-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(6, 8, 12, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.2rem;
}
.fbt-card {
  box-sizing: border-box;
  width: min(72rem, 100%);
  max-height: min(84vh, 52rem);
  display: flex;
  flex-direction: column;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: #141820;
  color: #dfe6ef;
  overflow: hidden;
}
.fbt-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid #2a3038;
}
.fbt-head-main {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}
.fbt-head-main h3 {
  margin: 0;
  font-size: 1rem;
}
.fbt-sub {
  color: #9fb0c6;
  font-size: 0.82rem;
  max-width: 22rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fbt-head-stats {
  display: flex;
  gap: 0.4rem;
  margin-left: auto;
}
.fbt-stat {
  padding: 0 0.4rem;
  border: 1px solid #3d4653;
  border-radius: 999px;
  font-size: 0.78rem;
  color: #8fd3a5;
}
.fbt-stat.is-off {
  color: #ffd479;
}
.fbt-hint {
  margin: 0;
  padding: 0.45rem 0.75rem;
  color: #9fb0c6;
  font-size: 0.82rem;
  border-bottom: 1px solid #222833;
}
.fbt-body {
  overflow: auto;
  padding: 0 0 0.6rem;
}
.fbt-table {
  border-collapse: separate;
  border-spacing: 0;
  width: max-content;
  min-width: 100%;
}
.fbt-th-name,
.fbt-td-name {
  position: sticky;
  left: 0;
  z-index: 2;
  background: #171c25;
  border-right: 1px solid #2a3038;
  text-align: left;
  padding: 0.3rem 0.6rem;
  min-width: 10rem;
  max-width: 16rem;
  font-weight: 500;
}
.fbt-th-name {
  z-index: 3;
  top: 0;
  color: #9fb0c6;
  font-weight: 600;
  font-size: 0.82rem;
}
thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #171c25;
  border-bottom: 1px solid #2a3038;
}
.fbt-th-block {
  padding: 0.3rem 0.35rem;
  font-weight: 600;
  font-size: 0.78rem;
  color: #cbd5e1;
  white-space: nowrap;
  max-width: 8rem;
}
.fbt-th-text {
  display: inline-block;
  max-width: 7.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.fbt-row.is-group .fbt-td-name {
  background: #1b2230;
}
.fbt-row.is-group .fbt-name-text {
  font-weight: 600;
}
.fbt-row.is-member .fbt-td-name {
  background: #151a22;
}
.fbt-name-text.is-indent {
  padding-left: 1rem;
}
.fbt-name-text {
  display: inline-block;
  max-width: 11rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.fbt-badge {
  margin-left: 0.3rem;
  padding: 0 0.3rem;
  border: 1px solid #3d4653;
  border-radius: 999px;
  font-size: 0.7rem;
  color: #9fb0c6;
}
.fbt-group-tag {
  margin-left: 0.3rem;
  padding: 0 0.3rem;
  border: 1px solid #3f5a7a;
  border-radius: 3px;
  font-size: 0.7rem;
  color: #8fb7e6;
}
.fbt-td-cell {
  padding: 0.15rem 0.2rem;
  text-align: center;
  border-bottom: 1px solid #1e242e;
}
.fbt-cell {
  width: 1.55rem;
  height: 1.55rem;
  border-radius: 4px;
  border: 1px solid #3d4653;
  background: #10141b;
  color: #7f8fa3;
  cursor: pointer;
  line-height: 1;
  font-size: 0.9rem;
}
.fbt-cell.is-on {
  border-color: #3f7a55;
  background: #16241b;
  color: #8fd3a5;
}
.fbt-cell.is-off {
  border-color: #7a5f3f;
  background: #241d16;
  color: #ffd479;
}
.fbt-cell.is-na {
  border-color: #262c35;
  background: #12161d;
  color: #4a5462;
  cursor: not-allowed;
}
.fbt-cell:hover:not(:disabled) {
  border-color: #6f8299;
}
.fbt-empty {
  padding: 0.8rem;
  color: #7f8fa3;
}

/*
 * 白天主题：Teleport/浮层同样靠 html[data-theme='light'] 覆盖。
 * ⚠️ 必须把后代**一起写进** `:global(...)` 里 —— 写成 `:global([data-theme='light']) .xxx` 会被编译成
 * 只剩 `[data-theme='light']`（后代被吃掉），规则等于没写。同 SkillFlowSection.vue 里那条注释。
 * 2026-09-21 实测：改前编译产物是 `[data-theme='light'] { background: … }`，弹窗在白天主题下仍是深色。
 */
:global([data-theme='light'] .fbt-mask) {
  background: rgba(15, 23, 42, 0.35);
}
:global([data-theme='light'] .fbt-card) {
  border-color: #d5dae3;
  background: linear-gradient(180deg, #ffffff 0%, #f6f8fb 100%);
  color: #1c212a;
}
:global([data-theme='light'] .fbt-head) {
  border-color: #e4e7ec;
}
:global([data-theme='light'] .fbt-hint) {
  border-color: #e4e7ec;
  color: #5b6573;
}
:global([data-theme='light'] .fbt-sub) {
  color: #5b6573;
}
:global([data-theme='light'] .fbt-stat) {
  border-color: #cfd6e0;
  color: #1f7a45;
}
:global([data-theme='light'] .fbt-stat.is-off) {
  color: #9a6a00;
}
:global([data-theme='light'] .fbt-th-name),
:global([data-theme='light'] .fbt-td-name),
:global([data-theme='light'] .fbt-table thead th) {
  background: #f1f4f8;
  border-color: #e4e7ec;
}
:global([data-theme='light'] .fbt-row.is-group .fbt-td-name) {
  background: #e8eef7;
}
:global([data-theme='light'] .fbt-row.is-member .fbt-td-name) {
  background: #f7f9fc;
}
:global([data-theme='light'] .fbt-th-block) {
  color: #364152;
}
:global([data-theme='light'] .fbt-td-cell) {
  border-color: #eef1f5;
}
:global([data-theme='light'] .fbt-badge) {
  border-color: #cfd6e0;
  color: #5b6573;
}
:global([data-theme='light'] .fbt-group-tag) {
  border-color: #b9cde6;
  color: #2f5c94;
}
:global([data-theme='light'] .fbt-cell) {
  border-color: #cfd6e0;
  background: #ffffff;
  color: #7b8798;
}
:global([data-theme='light'] .fbt-cell.is-on) {
  border-color: #8fbf9f;
  background: #eef8f1;
  color: #1f7a45;
}
:global([data-theme='light'] .fbt-cell.is-off) {
  border-color: #d8bd8a;
  background: #fdf6e7;
  color: #9a6a00;
}
:global([data-theme='light'] .fbt-cell.is-na) {
  border-color: #e6e9ee;
  background: #f4f6f9;
  color: #b6bdc7;
}
:global([data-theme='light'] .fbt-empty) {
  color: #7b8798;
}
</style>
