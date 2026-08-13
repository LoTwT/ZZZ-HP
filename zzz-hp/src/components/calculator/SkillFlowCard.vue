<script setup lang="ts">
defineProps<{
  name: string
  meta?: string
  index?: number
  hint?: string | null
  skip?: boolean
}>()
</script>

<template>
  <li class="sf-card" :class="{ 'sf-card--skip': skip }">
    <div class="sf-card-head">
      <span v-if="index != null" class="sf-index">{{ index }}</span>
      <div class="sf-card-titles">
        <strong class="sf-name">{{ name }}</strong>
        <span class="sf-meta">{{ meta || '\u00a0' }}</span>
      </div>
    </div>
    <div class="sf-card-extra">
      <p class="sf-hint" :class="{ 'is-empty': !hint }">{{ hint || '\u00a0' }}</p>
      <div class="sf-extra-body">
        <slot />
      </div>
    </div>
    <div class="sf-card-actions">
      <slot name="actions" />
    </div>
  </li>
</template>

<style scoped>
/*
  三处招式外壳同一套尺寸：固定高度 + 三行网格（头 / 预留区 / 按钮）。
  预留区始终占位（hint 用 visibility，双代理人槽 min-height），避免有无内容时高度跳动。
  具体内部风格待用户定，这里只锁外壳。
*/
.sf-card {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: var(--sf-card-h, 9.1rem);
  display: grid;
  grid-template-rows: 2.1rem 3.6rem 1.65rem;
  gap: 0.25rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid #2a3038;
  border-radius: 10px;
  background: #141820;
  overflow: hidden;
}
.sf-card--skip {
  border-color: #6b3a3a;
}
.sf-card-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  min-height: 0;
}
.sf-index {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 999px;
  background: rgba(201, 165, 92, 0.16);
  color: #f0d7a2;
  font-size: 0.72rem;
  font-weight: 700;
}
.sf-card-titles {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
}
.sf-name,
.sf-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sf-name {
  font-size: 0.84rem;
  line-height: 1.2;
  color: #e8edf5;
  font-weight: 600;
}
.sf-meta {
  font-size: 0.72rem;
  line-height: 1.2;
  color: #9aa3b0;
}
.sf-card-extra {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  min-height: 0;
  overflow: hidden;
}
.sf-hint {
  margin: 0;
  flex: 0 0 1.05rem;
  height: 1.05rem;
  line-height: 1.05rem;
  font-size: 0.72rem;
  color: #c07a7a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sf-hint.is-empty {
  visibility: hidden;
}
.sf-extra-body {
  flex: 1;
  min-height: 2.35rem;
  min-width: 0;
  overflow: hidden;
}
.sf-card-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  overflow: hidden;
}
.sf-card-actions > :deep(*) {
  flex: 0 0 auto;
}
</style>
