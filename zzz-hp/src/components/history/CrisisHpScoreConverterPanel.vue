<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  fetchBossChart,
  fetchBossList,
  type BossOption,
  type HpChartPoint,
} from '@/api/crisisAssault'
import {
  CRISIS_SCORE_MAX,
  convertHpRatioToScore,
  convertScoreToHpRatio,
  describeConvertSegment,
  formatPercent,
  getScoreMarkers,
  scaleHpByRatio,
  type CrisisHpScoreConvertResult,
  type CrisisScoreMarker,
  type CrisisScoreTableMode,
} from '@/data/crisisScoreHpTable'
import { formatHp, resolveAssetUrl } from '@/utils/gameData'

type EditSource = 'hp' | 'score' | 'scorePct' | 'abs'
type HpAbsField = 'total' | 'dealt' | null

const tableMode = ref<CrisisScoreTableMode>('normal')
const editing = ref<EditSource>('hp')
const lastHpAbs = ref<HpAbsField>(null)
const hpPercentInput = ref('')
const scorePercentInput = ref('')
const scoreInput = ref('')
const totalHpInput = ref('')
const dealtHpInput = ref('')

const bossList = ref<BossOption[]>([])
const selectedBoss = ref('')
const phasePoints = ref<HpChartPoint[]>([])
const selectedPhaseLabel = ref('')
const bossListLoading = ref(false)
const bossChartLoading = ref(false)
const bossError = ref('')
const applyingBossHp = ref(false)

const markers = computed(() => getScoreMarkers(tableMode.value))
const selectedBossInfo = computed(() =>
  bossList.value.find((boss) => boss.boss_name === selectedBoss.value),
)

async function loadBossList() {
  bossListLoading.value = true
  bossError.value = ''
  selectedBoss.value = ''
  phasePoints.value = []
  selectedPhaseLabel.value = ''
  try {
    bossList.value = await fetchBossList(tableMode.value)
  } catch (error) {
    bossList.value = []
    bossError.value = error instanceof Error ? error.message : '加载怪物列表失败'
  } finally {
    bossListLoading.value = false
  }
}

async function loadBossPhases() {
  if (!selectedBoss.value) {
    phasePoints.value = []
    selectedPhaseLabel.value = ''
    return
  }
  bossChartLoading.value = true
  bossError.value = ''
  try {
    const points = await fetchBossChart(selectedBoss.value, tableMode.value)
    phasePoints.value = [...points].reverse()
    const latest = phasePoints.value[0]
    selectedPhaseLabel.value = latest?.label ?? ''
    if (latest) applyTotalHpFromBoss(latest.totalHp)
  } catch (error) {
    phasePoints.value = []
    selectedPhaseLabel.value = ''
    bossError.value = error instanceof Error ? error.message : '加载怪物期数失败'
  } finally {
    bossChartLoading.value = false
  }
}

function applyTotalHpFromBoss(hp: number) {
  if (!Number.isFinite(hp) || hp <= 0) return
  applyingBossHp.value = true
  lastHpAbs.value = 'total'
  totalHpInput.value = String(Math.round(hp))
  onTotalEdit()
  if (result.value) syncActualHpFromRatio(result.value.hpRatio)
  applyingBossHp.value = false
}

function onPhaseChange() {
  const point = phasePoints.value.find((item) => item.label === selectedPhaseLabel.value)
  if (point) applyTotalHpFromBoss(point.totalHp)
}

onMounted(loadBossList)
watch(tableMode, loadBossList)
watch(selectedBoss, loadBossPhases)

function parseLocaleNumber(raw: string): number | null {
  const text = raw.trim().replace(/,/g, '')
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

function formatHpPercent(ratio: number): string {
  return String(Number((ratio * 100).toFixed(4)))
}

function clampPercentField(raw: string): string {
  const value = parseLocaleNumber(raw)
  if (value == null) return raw
  if (value < 0) return '0'
  if (value > 100) return '100'
  return raw
}

function clampScoreField(raw: string): string {
  const value = parseLocaleNumber(raw)
  if (value == null) return raw
  if (value < 0) return '0'
  if (value > CRISIS_SCORE_MAX) return String(CRISIS_SCORE_MAX)
  return raw
}

function onHpPercentEdit() {
  editing.value = 'hp'
  hpPercentInput.value = clampPercentField(hpPercentInput.value)
}

function onScorePercentEdit() {
  editing.value = 'scorePct'
  scorePercentInput.value = clampPercentField(scorePercentInput.value)
}

function onScoreEdit() {
  editing.value = 'score'
  scoreInput.value = clampScoreField(scoreInput.value)
}

const result = computed<CrisisHpScoreConvertResult | null>(() => {
  if (editing.value === 'score') {
    const score = parseLocaleNumber(scoreInput.value)
    if (score == null) return null
    return convertScoreToHpRatio(tableMode.value, score)
  }
  if (editing.value === 'scorePct') {
    const percent = parseLocaleNumber(scorePercentInput.value)
    if (percent == null) return null
    return convertScoreToHpRatio(tableMode.value, (percent / 100) * CRISIS_SCORE_MAX)
  }
  if (editing.value === 'abs') {
    const total = parseLocaleNumber(totalHpInput.value)
    const dealt = parseLocaleNumber(dealtHpInput.value)
    if (total == null || total <= 0 || dealt == null) return null
    return convertHpRatioToScore(tableMode.value, dealt / total)
  }
  const percent = parseLocaleNumber(hpPercentInput.value)
  if (percent == null) return null
  return convertHpRatioToScore(tableMode.value, percent / 100)
})

watch(result, (next) => {
  if (!next) return
  if (editing.value !== 'hp' && editing.value !== 'abs') {
    hpPercentInput.value = formatHpPercent(next.hpRatio)
  }
  if (editing.value !== 'score') {
    scoreInput.value = String(Math.round(next.score))
  }
  if (editing.value !== 'scorePct') {
    scorePercentInput.value = formatHpPercent(next.score / CRISIS_SCORE_MAX)
  }
  if (editing.value !== 'abs') {
    syncActualHpFromRatio(next.hpRatio)
  }
})

function hasRatioInput(): boolean {
  return (
    result.value != null ||
    parseLocaleNumber(hpPercentInput.value) != null ||
    parseLocaleNumber(scoreInput.value) != null ||
    parseLocaleNumber(scorePercentInput.value) != null
  )
}

function syncActualHpFromRatio(hpRatio: number) {
  if (hpRatio <= 0) return
  const total = parseLocaleNumber(totalHpInput.value)
  const dealt = parseLocaleNumber(dealtHpInput.value)
  if (lastHpAbs.value === 'dealt' && dealt != null) {
    totalHpInput.value = String(Math.round(dealt / hpRatio))
    return
  }
  if (lastHpAbs.value === 'total' && total != null && total > 0) {
    dealtHpInput.value = String(scaleHpByRatio(total, hpRatio))
    return
  }
  if (total != null && total > 0) {
    dealtHpInput.value = String(scaleHpByRatio(total, hpRatio))
    return
  }
  if (dealt != null) {
    totalHpInput.value = String(Math.round(dealt / hpRatio))
  }
}

function clearBossSelection() {
  selectedBoss.value = ''
  phasePoints.value = []
  selectedPhaseLabel.value = ''
}

function onDealtEdit() {
  lastHpAbs.value = 'dealt'
  const total = parseLocaleNumber(totalHpInput.value)
  let dealt = parseLocaleNumber(dealtHpInput.value)
  if (total != null && total > 0 && dealt != null && dealt > total) {
    dealtHpInput.value = String(total)
    dealt = total
  }
  if (!hasRatioInput() && total != null && total > 0 && dealt != null) {
    editing.value = 'abs'
    return
  }
  if (result.value) syncActualHpFromRatio(result.value.hpRatio)
}

function onTotalEdit() {
  lastHpAbs.value = 'total'
  if (!applyingBossHp.value) clearBossSelection()
  if (editing.value === 'abs') return
  if (hasRatioInput()) {
    if (result.value) syncActualHpFromRatio(result.value.hpRatio)
    return
  }
  const total = parseLocaleNumber(totalHpInput.value)
  const dealt = parseLocaleNumber(dealtHpInput.value)
  if (total != null && total > 0 && dealt != null) editing.value = 'abs'
}

function clearInputs() {
  editing.value = 'hp'
  lastHpAbs.value = null
  hpPercentInput.value = ''
  scorePercentInput.value = ''
  scoreInput.value = ''
  totalHpInput.value = ''
  dealtHpInput.value = ''
  selectedBoss.value = ''
  phasePoints.value = []
  selectedPhaseLabel.value = ''
}

const reachedMarkers = computed(() => {
  if (!result.value) return []
  return markers.value.filter((marker) => result.value!.hpRatio + 1e-9 >= marker.hpRatio)
})

const nextMarker = computed(() => {
  if (!result.value) return null
  return markers.value.find((marker) => result.value!.hpRatio + 1e-9 < marker.hpRatio) ?? null
})

const roundedScore = computed(() => (result.value ? Math.round(result.value.score) : null))

const formulaText = computed(() => {
  const current = result.value
  if (!current || !current.row) return ''
  const t = current.progressInSegment
  const scoreDelta = current.nextScore - current.prevScore
  return `${current.prevScore.toLocaleString('zh-CN')} + ${t.toFixed(4)} × ${scoreDelta.toLocaleString('zh-CN')} = ${current.score.toFixed(2)}`
})

function applyMarker(marker: CrisisScoreMarker) {
  editing.value = 'score'
  scoreInput.value = String(marker.score)
}

const panelDesc = computed(() =>
  tableMode.value === 'hard'
    ? `满分 ${CRISIS_SCORE_MAX.toLocaleString('zh-CN')} 分（困难）。占比改其中一个即可；填总血后能看到已打血量，两项都填会反算占比。`
    : `满分 ${CRISIS_SCORE_MAX.toLocaleString('zh-CN')} 分（正常）。2 万分为满星 S（FS-HP）。占比改其中一个即可；填总血后能看到已打血量，两项都填会反算占比。`,
)
</script>

<template>
  <div class="score-convert-panel">
    <header class="panel-header">
      <h1 class="page-title">危局强袭战 · 血量分数转换器</h1>
      <p class="panel-desc">{{ panelDesc }}</p>
      <div class="header-actions">
        <div class="mode-toggle" role="group" aria-label="转换器模式">
          <button
            type="button"
            class="mode-btn"
            :class="{ active: tableMode === 'normal' }"
            @click="tableMode = 'normal'"
          >
            正常
          </button>
          <button
            type="button"
            class="mode-btn"
            :class="{ active: tableMode === 'hard' }"
            @click="tableMode = 'hard'"
          >
            困难
          </button>
        </div>
        <button type="button" class="clear-btn" @click="clearInputs">清空</button>
      </div>
    </header>

    <div class="convert-grid">
      <section class="convert-card">
        <h2 class="card-title">占比</h2>
        <label class="field">
          <span>血量占比</span>
          <span class="field-input">
            <input
              v-model="hpPercentInput"
              type="text"
              inputmode="decimal"
              aria-label="血量占比"
              @focus="onHpPercentEdit"
              @input="onHpPercentEdit"
            />
            <span class="suffix">%</span>
          </span>
        </label>
        <label class="field">
          <span>分数占比</span>
          <span class="field-input">
            <input
              v-model="scorePercentInput"
              type="text"
              inputmode="decimal"
              aria-label="分数占比"
              @focus="onScorePercentEdit"
              @input="onScorePercentEdit"
            />
            <span class="suffix">%</span>
          </span>
        </label>
        <label class="field">
          <span>分数（满分 {{ CRISIS_SCORE_MAX.toLocaleString('zh-CN') }}）</span>
          <input
            v-model="scoreInput"
            type="text"
            inputmode="numeric"
            aria-label="分数"
            @focus="onScoreEdit"
            @input="onScoreEdit"
          />
        </label>
        <div class="score-readout">
          <p class="score-readout-num" aria-live="polite">
            <span>
              <strong>{{
                roundedScore != null ? roundedScore.toLocaleString('zh-CN') : '—'
              }}</strong>
              <span> / {{ CRISIS_SCORE_MAX.toLocaleString('zh-CN') }}</span>
            </span>
          </p>
          <div class="marker-row" role="group" aria-label="快捷填入节点分数">
            <button
              v-for="marker in markers"
              :key="marker.id"
              type="button"
              class="marker-chip"
              :style="{ '--marker-color': marker.color }"
              @click="applyMarker(marker)"
            >
              {{ marker.shortLabel }}
            </button>
          </div>
        </div>
        <p class="field-hint">3项填1</p>
      </section>

      <section class="convert-card">
        <h2 class="card-title">实际血量</h2>
        <label class="field">
          <span>怪物</span>
          <span class="field-input">
            <img
              v-if="selectedBossInfo?.boss_image"
              :src="resolveAssetUrl(selectedBossInfo.boss_image)"
              :alt="selectedBoss"
              class="boss-thumb"
            />
            <select
              v-model="selectedBoss"
              class="boss-select"
              aria-label="从数据库选择怪物"
              :disabled="bossListLoading || !bossList.length"
            >
              <option value="">{{ bossListLoading ? '加载中…' : '从数据库选择' }}</option>
              <option v-for="boss in bossList" :key="boss.boss_name" :value="boss.boss_name">
                {{ boss.boss_name }}
              </option>
            </select>
          </span>
        </label>
        <label class="field">
          <span>期数</span>
          <select
            v-model="selectedPhaseLabel"
            class="boss-select"
            aria-label="选择怪物出现期数"
            :disabled="!phasePoints.length || bossChartLoading"
            @change="onPhaseChange"
          >
            <option value="">{{ bossChartLoading ? '加载中…' : '选择期数' }}</option>
            <option v-for="point in phasePoints" :key="point.label" :value="point.label">
              {{ point.label }} · {{ formatHp(point.totalHp) }}
            </option>
          </select>
        </label>
        <p v-if="bossError" class="boss-error">{{ bossError }}</p>
        <label class="field">
          <span>总血量</span>
          <input
            v-model="totalHpInput"
            type="text"
            inputmode="numeric"
            aria-label="总血量"
            @focus="onTotalEdit"
            @input="onTotalEdit"
          />
        </label>
        <label class="field">
          <span>已打血量</span>
          <input
            v-model="dealtHpInput"
            type="text"
            inputmode="numeric"
            aria-label="已打血量"
            @focus="onDealtEdit"
            @input="onDealtEdit"
          />
        </label>
        <p class="field-hint">有占比时2项填1，无占比时需要全部填</p>
      </section>
    </div>

    <section class="status-card">
      <h2 class="card-title">计算过程</h2>
      <template v-if="result">
        <p class="status-main">{{ describeConvertSegment(result) }}</p>
        <p class="status-line">
          已打血量 {{ formatPercent(result.hpRatio, 4) }} · 对应
          {{ (roundedScore ?? 0).toLocaleString('zh-CN') }} 分
          <template v-if="result.row">
            · 本段进度 {{ (result.progressInSegment * 100).toFixed(2) }}%
          </template>
        </p>
        <p class="status-line">
          插值区间：{{ formatPercent(result.prevHp, 4) }} / {{ result.prevScore.toLocaleString('zh-CN') }} 分
          → {{ formatPercent(result.nextHp, 4) }} / {{ result.nextScore.toLocaleString('zh-CN') }} 分
        </p>
        <p v-if="formulaText" class="status-formula">{{ formulaText }}</p>
        <p v-if="reachedMarkers.length" class="status-line">
          已过节点：{{ reachedMarkers.map((marker) => marker.label).join('、') }}
        </p>
        <p v-else class="status-line">尚未到达分数节点</p>
        <p v-if="nextMarker" class="status-line">
          下一节点：{{ nextMarker.label }}（还需
          {{ formatPercent(nextMarker.hpRatio - result.hpRatio, 4) }} 血量）
        </p>
      </template>
      <p v-else class="status-line">填入占比或分数后显示换算过程</p>
    </section>
  </div>
</template>

<style scoped>
.score-convert-panel {
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  padding: 0.5rem 0.35rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  text-align: center;
}

.page-title {
  font-size: clamp(1.15rem, 2.6vw, 1.7rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.03em;
}

.panel-desc {
  font-size: 0.82rem;
  color: var(--color-text);
  opacity: 0.72;
  line-height: 1.45;
  max-width: 44rem;
}

.mode-toggle {
  display: inline-flex;
  padding: 0.15rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
}

.mode-btn {
  min-width: 4.5rem;
  padding: 0.35rem 0.85rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.mode-btn:hover {
  background: var(--color-background-mute);
}

.mode-btn.active {
  background: var(--color-background-soft);
  color: var(--color-heading);
  box-shadow: inset 0 0 0 1px var(--color-border);
}

.header-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}

.clear-btn {
  min-width: 4.5rem;
  padding: 0.35rem 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
}

.clear-btn:hover {
  background: var(--color-background-mute);
}

.marker-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.35rem;
}

.marker-chip {
  padding: 0.28rem 0.7rem;
  border: 1px solid color-mix(in srgb, var(--marker-color, #e8a838) 55%, var(--color-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--marker-color, #e8a838) 16%, transparent);
  color: var(--color-heading);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.marker-chip:hover {
  background: color-mix(in srgb, var(--marker-color, #e8a838) 28%, transparent);
}

.convert-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
}

.convert-card,
.status-card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 0.95rem 1rem 1.05rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.card-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--color-heading);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text);
  opacity: 0.88;
}

.field--grow {
  flex: 1;
  min-width: 0;
}

.field-input {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.field input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 1rem;
  font-weight: 700;
}

.field input:focus {
  outline: 2px solid color-mix(in srgb, #e8a838 55%, transparent);
  outline-offset: 1px;
}

.boss-select {
  flex: 1;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.92rem;
  font-weight: 700;
}

.boss-select:focus {
  outline: 2px solid color-mix(in srgb, #e8a838 55%, transparent);
  outline-offset: 1px;
}

.boss-thumb {
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--color-border);
}

.boss-error {
  margin: 0;
  font-size: 0.75rem;
  color: #c62828;
}

.suffix {
  font-size: 0.9rem;
  font-weight: 800;
  color: var(--color-heading);
}

.abs-row {
  display: flex;
  align-items: flex-end;
  gap: 0.45rem;
}

.abs-slash {
  padding-bottom: 0.55rem;
  font-weight: 800;
  opacity: 0.45;
}

.field-hint {
  margin: 0;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  background: color-mix(in srgb, #e8a838 18%, transparent);
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.4;
  color: #b57914;
  opacity: 1;
}

.score-readout {
  margin: 0;
  min-height: 2.4rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.9rem;
  color: var(--color-text);
}

.score-readout-num {
  margin: 0;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 0.2rem;
}

.score-readout strong {
  font-size: 1.85rem;
  font-weight: 800;
  color: var(--color-heading);
  letter-spacing: 0.02em;
}

.placeholder-text {
  opacity: 0.55;
}

.status-card {
  gap: 0.35rem;
}

.status-main {
  margin: 0;
  font-size: 1.02rem;
  font-weight: 800;
  color: var(--color-heading);
}

.status-line {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--color-text);
  opacity: 0.82;
}

.status-formula {
  margin: 0.15rem 0 0;
  font-family: var(--zzz-font-mono, ui-monospace, monospace);
  font-size: 0.8rem;
  color: var(--color-heading);
}

@media (max-width: 768px) {
  .score-convert-panel {
    padding: 0.25rem 0.1rem 0.9rem;
  }

  .convert-grid {
    grid-template-columns: 1fr;
  }

  .score-readout {
    flex-wrap: wrap;
  }

  .marker-row {
    justify-content: flex-start;
  }
}
</style>
