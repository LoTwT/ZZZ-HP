<script setup lang="ts">
import { computed, ref } from 'vue'

/** 「当前编辑 ▾」下拉里的可选对象（代理人 / 音擎） */
interface OwnerOption {
  id: string
  name: string
  /** 次要信息，如「强攻 · 电」 */
  meta?: string
  /** 用于职业筛选 */
  profession?: string
}

const props = defineProps<{
  items: OwnerOption[]
  selectedId?: string
  placeholder?: string
  /** 需要职业筛选时传职业列表 */
  roleOptions?: readonly string[]
  /** 传了才显示「＋ 新增」按钮 */
  createLabel?: string
}>()

const emit = defineEmits<{
  select: [id: string]
  create: []
}>()

const search = ref('')
const roleFilter = ref('')

const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return props.items.filter((item) => {
    if (roleFilter.value && item.profession !== roleFilter.value) return false
    if (!keyword) return true
    return `${item.name} ${item.meta ?? ''} ${item.profession ?? ''} ${item.id}`
      .toLowerCase()
      .includes(keyword)
  })
})
</script>

<template>
  <div class="buff-owner-switcher">
    <input
      v-model="search"
      class="os-input"
      type="search"
      :placeholder="placeholder ?? '搜索名称'"
      autocomplete="off"
    />
    <select v-if="roleOptions?.length" v-model="roleFilter" class="os-input">
      <option value="">全部职业</option>
      <option v-for="role in roleOptions" :key="role" :value="role">{{ role }}</option>
    </select>

    <div class="os-list">
      <button
        v-for="item in filtered"
        :key="item.id"
        type="button"
        class="os-item"
        :class="{ 'is-active': item.id === selectedId }"
        @click="emit('select', item.id)"
      >
        <span class="os-name">{{ item.name }}</span>
        <span v-if="item.meta" class="os-meta">{{ item.meta }}</span>
      </button>
      <p v-if="!filtered.length" class="os-empty">没有匹配项</p>
    </div>

    <button v-if="createLabel" type="button" class="os-create" @click="emit('create')">
      {{ createLabel }}
    </button>
  </div>
</template>

<style scoped>
.buff-owner-switcher {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.os-input {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  padding: 0.3rem 0.45rem;
  font: inherit;
  font-size: 0.76rem;
}

.os-list {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  max-height: 16rem;
  overflow-y: auto;
}

.os-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.28rem 0.4rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 0.76rem;
  text-align: left;
  cursor: pointer;
}

.os-item:hover {
  background: color-mix(in srgb, var(--color-border) 45%, transparent);
}

.os-item.is-active {
  background: color-mix(in srgb, var(--color-heading) 16%, transparent);
}

.os-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.os-meta {
  flex: 0 0 auto;
  font-size: 0.7rem;
  opacity: 0.6;
}

.os-empty {
  margin: 0;
  padding: 0.3rem 0.4rem;
  font-size: 0.74rem;
  opacity: 0.6;
}

.os-create {
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  background: transparent;
  color: var(--color-heading);
  padding: 0.3rem 0.5rem;
  font: inherit;
  font-size: 0.76rem;
  cursor: pointer;
}
</style>
