<script setup lang="ts">
defineProps<{
  name: string
  mult?: string
  dtype?: string
  dtypeKind?: 'direct' | 'anomaly'
  stypes?: string[]
  source?: string
  agentPair?: string
  agentTitle?: string
  damage?: string
  skip?: boolean
  index?: number
}>()
</script>

<template>
  <li class="sf-card" :class="{ 'sf-card--skip': skip }">
    <span v-if="index != null" class="sf-index">{{ index }}</span>
    <strong class="sf-name" :title="name">{{ name }}</strong>
    <span v-if="mult" class="sf-mult-label">倍率</span>
    <span v-if="mult" class="sf-mult">{{ mult }}</span>
    <span v-if="dtype" class="sf-dtype" :class="dtypeKind === 'direct' ? 'is-direct' : 'is-anomaly'">
      {{ dtype }}
    </span>
    <span v-if="stypes?.length" class="sf-stypes">
      <span v-for="item in stypes" :key="item" class="sf-stype">{{ item }}</span>
    </span>
    <span v-if="source" class="sf-source">{{ source }}</span>
    <span v-if="agentPair" class="sf-agents" :title="agentTitle || agentPair">{{ agentPair }}</span>
    <span class="sf-damage">{{ damage || '' }}</span>
    <div class="sf-card-actions">
      <slot name="actions" />
    </div>
  </li>
</template>

<style scoped>
.sf-card {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 2.15rem;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.45rem;
  border: 1px solid #2a3038;
  border-radius: 6px;
  background: #141820;
}
.sf-card--skip {
  border-color: #6b3a3a;
}
.sf-index {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 999px;
  background: rgba(201, 165, 92, 0.16);
  color: #f0d7a2;
  font-size: 0.68rem;
  font-weight: 700;
}
.sf-name {
  flex: 0 1 7.5rem;
  min-width: 3.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8rem;
  color: #e8edf5;
  font-weight: 600;
}
.sf-mult-label {
  flex: 0 0 auto;
  font-size: 0.68rem;
  color: #9aa3b0;
  font-weight: 600;
}
.sf-mult {
  flex: 0 0 auto;
  min-width: 2.2rem;
  padding: 0.08rem 0.28rem;
  border: 1px solid #2d323a;
  border-radius: 4px;
  background: #0f1217;
  color: #e8edf5;
  font-size: 0.76rem;
  font-weight: 700;
  text-align: center;
}
.sf-dtype,
.sf-stype,
.sf-source,
.sf-agents {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  padding: 0.08rem 0.42rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  white-space: nowrap;
}
.sf-dtype.is-anomaly {
  background: #1a2a38;
  border: 1px solid #3a6a88;
  color: #8ec8e8;
}
.sf-dtype.is-direct {
  background: rgba(201, 165, 92, 0.14);
  border: 1px solid #8a6a1f;
  color: #f0d7a2;
}
.sf-stypes {
  display: flex;
  gap: 0.2rem;
  min-width: 0;
  overflow: hidden;
}
.sf-stype {
  background: #15241f;
  border: 1px solid #2f5c52;
  color: #8fd4c4;
}
.sf-source {
  background: #1a1d24;
  border: 1px solid #3a4150;
  color: #9aa3b0;
  font-weight: 600;
}
.sf-agents {
  background: #241833;
  border: 1px solid #6b4ea0;
  color: #d4b8f0;
}
.sf-damage {
  margin-left: auto;
  flex: 0 0 auto;
  min-width: 4.2rem;
  text-align: right;
  font-size: 0.82rem;
  font-weight: 800;
  color: #c4a0e8;
  font-variant-numeric: tabular-nums;
}
.sf-card-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.25rem;
  flex: 0 0 auto;
}
.sf-card-actions > :deep(*) {
  flex: 0 0 auto;
}
</style>
