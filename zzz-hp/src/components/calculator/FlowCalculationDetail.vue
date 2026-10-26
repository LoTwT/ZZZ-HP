<script setup lang="ts">
import { computed } from 'vue'
import DamageResultDetail from '@/components/calculator/DamageResultDetail.vue'
import type { SkillFlowCalculationDetail } from '@/utils/skillFlowCalculation'
import { DAMAGE_EVENT_CRIT_MODE_OPTIONS } from '@/utils/damageEvent'
import { buildSkillBaseMultNote } from '@/utils/skillTalentLevels'

const props = defineProps<{ calculation: SkillFlowCalculationDetail }>()
const detail = computed(() => props.calculation.evaluation)
const critModeLabel = computed(() =>
  DAMAGE_EVENT_CRIT_MODE_OPTIONS.find((mode) => mode.id === detail.value.hit.critMode)?.label,
)
const skillMultLevelNote = computed(() =>
  buildSkillBaseMultNote(detail.value.hit.skill, detail.value.hit.skillTalentLevel),
)
function formatDamage(value: number) {
  return Math.round(value).toLocaleString('en-US')
}
</script>

<template>
  <section class="flow-calculation-detail" aria-label="本条流程计算过程">
    <p class="calculation-context">
      {{ detail.displayName }} · {{ detail.hit.staggerPhase === 'stagger' ? '失衡期' : '非失衡期' }}
      · {{ critModeLabel }}
      · 事件元素 {{ detail.eventElement ?? '待选择' }}
    </p>
    <p class="calculation-total">
      单次 <strong>{{ formatDamage(detail.perHit) }}</strong>
      × {{ detail.hit.count }} 次
      = 合计 <strong>{{ formatDamage(detail.total) }}</strong>
    </p>
    <p class="calculation-hint">悬停、聚焦或轻触公式中的数值，可查看计算组成与增益来源。</p>
    <DamageResultDetail
      :calc-parts="detail.result"
      :final-panel="detail.finalPanel"
      :external-panel="detail.external"
      :sources="detail.breakdown.sources"
      :pierce-mod="detail.breakdown.totalMods.pierce"
      :pierce-power="detail.piercePower"
      :enemy-input="calculation.enemyInput"
      :is-mb="calculation.isMb"
      :show="detail.kind === 'direct' || detail.kind === 'sharpen' ? 'direct' : 'anomaly'"
      :crit-mode="detail.hit.critMode"
      :anomaly-sub-kind="detail.anomalySubKind"
      :producer-final-panel="detail.producerFinalPanel"
      :producer-external-panel="detail.producerExternalPanel"
      :producer-sources="detail.producerBreakdown?.sources"
      :producer-agent-label="detail.producerAgentLabel"
      :bonus-final-panel="detail.bonusFinalPanel"
      :bonus-external-panel="detail.bonusExternalPanel"
      :bonus-sources="detail.bonusBreakdown?.sources"
      :skill-mult-level-note="skillMultLevelNote"
      :defense-trigger-final-panel="detail.defenseTriggerFinalPanel"
      :defense-trigger-external-panel="detail.defenseTriggerExternalPanel"
      :defense-trigger-sources="detail.defenseTriggerBreakdown?.sources"
      :defense-trigger-agent-label="detail.defenseTriggerAgentLabel"
      :base-agent-label="detail.baseAgentLabel"
      :bonus-agent-label="detail.bonusAgentLabel"
      :mutation-agent-label="detail.mutationAgentLabel"
      :mutation-final-panel="detail.mutationFinalPanel"
      :mutation-external-panel="detail.mutationExternalPanel"
      :mutation-sources="detail.mutationSources"
      :remiel-self-atk-source-items="detail.remielSelfAtkSourceItems"
      :remiel-self-mastery-source-items="detail.remielSelfMasterySourceItems"
      :remiel-self-external-panel="detail.remielSelfExternalPanel"
      :remiel-self-sources="detail.remielSelfSources"
      :remiel-self-final-panel="detail.remielSelfFinalPanel"
      :remiel-is-mb="detail.remielIsMb"
    />
  </section>
</template>

<style scoped>
.flow-calculation-detail {
  --calc-border: #d5dae3;
  --calc-text: #1c212a;
  --calc-muted: #697588;
  --calc-surface: #f8fafc;
  --calc-surface-2: #f1efe9;
  min-width: 0;
  padding: 0.85rem;
  border: 1px solid var(--calc-border, var(--color-border));
  border-radius: 8px;
  color: var(--calc-text, var(--color-text));
  background: var(--calc-surface, var(--color-background));
  font-weight: 400;
}
.flow-calculation-detail :deep(.formula-aligned-body) {
  flex-wrap: wrap;
  overflow-x: visible;
}
:global([data-theme='dark'] .flow-calculation-detail) {
  --calc-border: #2a2f37;
  --calc-text: #e8eaed;
  --calc-muted: #9aa3b0;
  --calc-surface: #171c26;
  --calc-surface-2: rgba(0, 0, 0, 0.25);
}
.calculation-context,
.calculation-hint {
  margin: 0 0 0.5rem;
  color: var(--calc-muted, var(--color-text));
  font-size: 0.8rem;
  line-height: 1.6;
}
.calculation-total {
  margin: 0 0 0.55rem;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}
</style>
