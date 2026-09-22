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
  FlowBuffTableColumn,
  FlowBuffTableRow,
} from '@/utils/flowBuffTable'

const props = defineProps<{
  rows: FlowBuffTableRow[]
  /** 列 = 一条增益一列（已按提供者分组、排好序） */
  columns: FlowBuffTableColumn[]
  /** `${rowKey}|${columnKey}` → on 生效 / off 本行关掉 / na 不可点（全局未启用或受益者对不上） */
  states: Record<string, FlowBuffCellState>
  /** 表格副标题（槽位 / 方案名），仅展示 */
  subtitle?: string
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ toggle: [rowKey: string, columnKey: string] }>()

/** 表头第一行：提供者分组（列已按分组排好，连续同名合并） */
const columnGroups = computed(() => {
  const out: { key: string; label: string; span: number }[] = []
  for (const column of props.columns) {
    const last = out[out.length - 1]
    if (last && last.key === column.groupKey) last.span += 1
    else out.push({ key: column.groupKey, label: column.groupLabel, span: 1 })
  }
  return out
})

/** 悬停卡片（比原生 title 快、能显示多行，且增益能看到具体效果） */
const tip = ref<{ x: number; y: number; title: string; lines: string[] } | null>(null)

function showTip(event: MouseEvent, title: string, lines: string[]) {
  tip.value = {
    x: event.clientX,
    y: event.clientY,
    title,
    lines: lines.filter(Boolean).slice(0, 8),
  }
}

function moveTip(event: MouseEvent) {
  if (!tip.value) return
  tip.value = { ...tip.value, x: event.clientX, y: event.clientY }
}

function hideTip() {
  tip.value = null
}

/** 行标题的悬停内容（同名第几次 / 技能组） */
function showTitleTip(event: MouseEvent, row: FlowBuffTableRow) {
  showTip(event, row.label, [
    row.badge ? `同名招式第 ${row.badge} 次出现` : '',
    row.kind === 'group' ? '技能组（成员逐行）' : '',
  ])
}

/** 单元格的悬停内容（状态 + 这条增益具体是什么、谁提供） */
function showCellTip(event: MouseEvent, row: FlowBuffTableRow, column: FlowBuffTableColumn) {
  showTip(
    event,
    `${row.label} × ${column.label}${column.badge ? `（第 ${column.badge} 条）` : ''}`,
    [stateWord(stateOf(row.key, column.key)), ...(column.details ?? [])],
  )
}

/** 卡片贴光标，右/下边界收一下，别跑出屏幕 */
const tipLeft = computed(() =>
  tip.value ? `${Math.max(8, Math.min(tip.value.x + 14, window.innerWidth - 320))}px` : '0',
)
const tipTop = computed(() =>
  tip.value ? `${Math.max(8, Math.min(tip.value.y + 16, window.innerHeight - 180))}px` : '0',
)

/** 表格总宽按列数算死：fixed 布局下若还有余量，浏览器会按内容重新分配列宽。
 *  含 border-spacing（列间距 2px，首尾各一份）。 */
const tableWidth = computed(() => `${230 + 96 * props.columns.length + 2 * (props.columns.length + 1)}px`)

const onCount = computed(() =>
  Object.values(props.states).filter((value) => value === 'on').length,
)
const offCount = computed(() =>
  Object.values(props.states).filter((value) => value === 'off').length,
)

function stateOf(rowKey: string, columnKey: string): FlowBuffCellState {
  return props.states[`${rowKey}|${columnKey}`] ?? 'na'
}

function onCellClick(rowKey: string, columnKey: string) {
  if (stateOf(rowKey, columnKey) === 'na') return
  emit('toggle', rowKey, columnKey)
}

function stateWord(state: FlowBuffCellState): string {
  if (state === 'na') return '不可调整（全局未启用，或这一行不吃这条增益）'
  if (state === 'off') return '本行已关闭，点击恢复'
  return '生效中，点击可对本行关闭'
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
        <table class="fbt-table" :style="{ width: tableWidth }">
          <colgroup>
            <!-- 用行内 style：scoped 选择器依赖 data-v 属性，<col> 常常拿不到，规则不生效 -->
            <col :style="{ width: '230px' }" />
            <col
              v-for="column in columns"
              :key="`col-${column.key}`"
              :style="{ width: '96px' }"
            />
          </colgroup>
          <thead>
            <!-- 第一行 = 提供者分组（角色1/2/3 → 其它 → 额外 Buff），第二行 = 一条增益一列 -->
            <tr>
              <th class="fbt-th-name" rowspan="2">招式</th>
              <th
                v-for="group in columnGroups"
                :key="group.key"
                class="fbt-th-group"
                :colspan="group.span"
              >
                {{ group.label }}
              </th>
            </tr>
            <tr>
              <th
                v-for="column in columns"
                :key="column.key"
                class="fbt-th-block"
                @mouseenter="showTip($event, column.label, column.details ?? [])"
                @mousemove="moveTip"
                @mouseleave="hideTip"
              >
                <span class="fbt-th-text">{{ column.label }}</span>
                <span v-if="column.badge" class="fbt-badge is-circle">{{ column.badge }}</span>
                <span class="fbt-th-beneficiary">生效者：{{ column.beneficiaryLabel }}</span>
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
              <th
                class="fbt-td-name"
                @mouseenter="showTitleTip($event, row)"
                @mousemove="moveTip"
                @mouseleave="hideTip"
              >
                <span class="fbt-name-text" :class="{ 'is-indent': row.kind === 'member' }">
                  {{ row.label }}
                </span>
                <span v-if="row.badge" class="fbt-badge is-circle">{{ row.badge }}</span>
                <span v-if="row.kind === 'group'" class="fbt-group-tag">技能组</span>
              </th>
              <td
                v-for="column in columns"
                :key="column.key"
                class="fbt-td-cell"
                :class="`is-${stateOf(row.key, column.key)}`"
              >
                <button
                  type="button"
                  class="fbt-cell"
                  :class="`is-${stateOf(row.key, column.key)}`"
                  :disabled="stateOf(row.key, column.key) === 'na'"
                  @mouseenter="showCellTip($event, row, column)"
                  @mousemove="moveTip"
                  @mouseleave="hideTip"
                  @click="onCellClick(row.key, column.key)"
                >
                  <span v-if="stateOf(row.key, column.key) === 'on'">✓</span>
                  <span v-else-if="stateOf(row.key, column.key) === 'off'">×</span>
                  <span v-else>·</span>
                </button>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td class="fbt-empty" :colspan="Math.max(1, columns.length + 1)">
                当前槽位还没有流程条目。
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 悬停卡片：名字太长时看全名；增益列还能看到具体效果 -->
      <div v-if="tip" class="fbt-tip" :style="{ left: tipLeft, top: tipTop }">
        <strong class="fbt-tip-title">{{ tip.title }}</strong>
        <p v-for="(line, index) in tip.lines" :key="index" class="fbt-tip-line">{{ line }}</p>
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
/* 列头第三行：生效者（全队 / 角色名） */
.fbt-th-beneficiary {
  display: block;
  font-size: 0.6rem;
  font-weight: 400;
  opacity: 0.7;
}
/* 第一行表头：提供者分组 */
.fbt-th-group {
  border-left: 1px solid #2a3038;
  color: #9fb0c4;
  font-weight: 600;
  text-align: center;
}
/* 同名标记：小圆圈 + 数字（只在重名时出现） */
.fbt-badge.is-circle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.2rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 0.62rem;
  line-height: 1;
  opacity: 0.85;
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
  /* 列间距：表头名字挨在一起时分不清列边界（2026-09-21 用户反馈）。
     表宽公式里必须一并算上间距，否则 fixed 布局又会按内容重分配列宽。 */
  /* 列间距收到 2px，改**用线条**区分列（2026-09-21 用户反馈：纯间距仍不够明显） */
  border-spacing: 2px 0;
  /* 列宽**限死**：招式列与增益列都固定（用 colgroup 钉，见下），名字过长一律省略号。
     注意别再写 `width: max-content` —— 那样会把声明列宽按内容重新分配（实测 96px 被撑成 123.5px）。 */
  table-layout: fixed;
}
/* colgroup + 行内表宽决定列宽；th/td 上不再写 width/min/max，避免和 col 冲突 */
.fbt-th-text,
.fbt-name-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 悬停卡片：名字太长时看全名；增益列还能看到具体效果 */
.fbt-tip {
  position: fixed;
  z-index: 40;
  width: min(300px, 70vw);
  padding: 0.5rem 0.6rem;
  border-radius: 8px;
  border: 1px solid #3a424e;
  background: #171c24;
  color: #e6ebf2;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  font-size: 0.78rem;
  line-height: 1.5;
}
.fbt-tip-title {
  display: block;
  margin-bottom: 0.2rem;
  color: #f0f2f6;
  word-break: break-all;
}
.fbt-tip-line {
  margin: 0;
  color: #9fb0c4;
  word-break: break-all;
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
  /* 每列自成一块 + 右侧竖线：线条比纯间距更容易分辨列边界（2026-09-21 用户反馈） */
  background: #171c25;
  border-right: 1px solid #313947;
  border-radius: 4px;
}
.fbt-th-text {
  display: inline-block;
  /* 收进列宽内（列只有 96px，写死 7.5rem 会超出单元格） */
  max-width: 100%;
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
  /* 与表头对齐的列竖线：整列一条线，扫读时列边界清楚 */
  border-right: 1px solid #262e3a;
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
:global([data-theme='light'] .fbt-tip) {
  border-color: #d5dae3;
  background: #ffffff;
  color: #1c212a;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
}
:global([data-theme='light'] .fbt-tip-title) {
  color: #1c212a;
}
:global([data-theme='light'] .fbt-tip-line) {
  color: #5b6573;
}
:global([data-theme='light'] .fbt-th-block) {
  border-right-color: #dbe1ea;
}
:global([data-theme='light'] .fbt-td-cell) {
  border-right-color: #e8ecf2;
}
</style>
