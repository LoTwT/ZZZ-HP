<script setup lang="ts">
defineProps<{
  name: string
  mult?: string
  dtype?: string
  dtypeKind?: 'direct' | 'anomaly'
  stypes?: string[]
  agentPair?: string
  agentTitle?: string
  damage?: string
  skip?: boolean
  index?: number
}>()

const emit = defineEmits<{
  'select-agents': []
}>()
</script>

<template>
  <li class="sf-card" :class="{ 'sf-card--skip': skip }">
    <div class="sf-lead">
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
      <button
        v-if="agentPair"
        type="button"
        class="sf-agents"
        :title="agentTitle || agentPair"
        @click.stop="emit('select-agents')"
      >
        {{ agentPair }}
      </button>
    </div>
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
.sf-lead {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
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
  box-sizing: border-box;
  flex: 0 0 8.5rem;
  width: 8.5rem;
  min-width: 0;
  padding: 0.08rem 0.4rem;
  border: 1px solid #2d323a;
  border-radius: 4px;
  background: #0f1217;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
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
  text-align: left;
}
.sf-dtype,
.sf-stype,
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
  flex: 0 1 auto;
  gap: 0.2rem;
  min-width: 0;
  overflow: hidden;
}
.sf-stype {
  background: #15241f;
  border: 1px solid #2f5c52;
  color: #8fd4c4;
}
.sf-agents {
  appearance: none;
  background: #241833;
  border: 1px solid #6b4ea0;
  color: #d4b8f0;
  cursor: pointer;
  font: inherit;
}
.sf-agents:hover {
  filter: brightness(1.08);
}
.sf-damage {
  flex: 0 0 auto;
  min-width: 4.5rem;
  text-align: right;
  font-size: 0.82rem;
  font-weight: 800;
  color: #c4a0e8;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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
