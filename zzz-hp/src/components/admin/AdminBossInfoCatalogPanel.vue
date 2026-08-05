<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  fetchBossInfoList,
  updateBossInfoRecord,
  type BossInfoRecord,
} from '@/api/bossInfo'
import { resolveAssetUrl } from '@/utils/gameData'

const keyword = ref('')
const loading = ref(false)
const savingId = ref<number | null>(null)
const error = ref('')
const message = ref('')
const items = ref<BossInfoRecord[]>([])
const total = ref(0)
const editingId = ref<number | null>(null)
const draft = ref<Partial<BossInfoRecord>>({})

async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const result = await fetchBossInfoList({
      keyword: keyword.value.trim(),
      limit: 200,
      offset: 0,
    })
    items.value = result.items
    total.value = result.total
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function startEdit(row: BossInfoRecord) {
  editingId.value = row.id
  draft.value = { ...row }
}

function cancelEdit() {
  editingId.value = null
  draft.value = {}
}

async function saveEdit() {
  if (editingId.value == null) return
  savingId.value = editingId.value
  message.value = ''
  error.value = ''
  try {
    await updateBossInfoRecord(editingId.value, {
      boss_name: draft.value.boss_name,
      defense: Number(draft.value.defense) || 0,
      level: Number(draft.value.level) || 1,
      weakness: draft.value.weakness ?? null,
      resistance: draft.value.resistance ?? null,
      boss_image: draft.value.boss_image ?? null,
      crisis_base_hp:
        draft.value.crisis_base_hp != null && String(draft.value.crisis_base_hp).trim() !== ''
          ? Number(draft.value.crisis_base_hp)
          : null,
      stagger_multiplier: Number(draft.value.stagger_multiplier) || 1.5,
    })
    message.value = '已保存'
    cancelEdit()
    await loadList()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    savingId.value = null
  }
}

onMounted(loadList)
</script>

<template>
  <div class="boss-info-catalog">
    <header class="catalog-header">
      <div>
        <h1>怪物基础库</h1>
        <p>维护 boss_info 表：同名怪物在危局/防卫战/计算器中共用防御、弱点、抗性、失衡易伤等基础数据。</p>
      </div>
      <div class="search-row">
        <input
          v-model="keyword"
          type="search"
          placeholder="按名称搜索"
          @keydown.enter.prevent="loadList"
        />
        <button type="button" :disabled="loading" @click="loadList">
          {{ loading ? '加载中…' : '搜索' }}
        </button>
      </div>
    </header>

    <p v-if="message" class="catalog-message">{{ message }}</p>
    <p v-if="error" class="catalog-error">{{ error }}</p>
    <p class="catalog-meta">共 {{ total }} 条 · 失衡易伤默认 150%（1.5）</p>

    <div class="table-wrap">
      <table class="catalog-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>防御</th>
            <th>等级</th>
            <th>失衡易伤</th>
            <th>弱点</th>
            <th>抗性</th>
            <th>危局基础血量</th>
            <th>图片</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in items" :key="row.id">
            <template v-if="editingId === row.id">
              <td><input v-model="draft.boss_name" type="text" /></td>
              <td><input v-model.number="draft.defense" type="number" min="0" /></td>
              <td><input v-model.number="draft.level" type="number" min="1" /></td>
              <td>
                <input
                  v-model.number="draft.stagger_multiplier"
                  type="number"
                  min="0"
                  step="0.01"
                />
              </td>
              <td><input v-model="draft.weakness" type="text" /></td>
              <td><input v-model="draft.resistance" type="text" /></td>
              <td><input v-model.number="draft.crisis_base_hp" type="number" min="0" step="1" /></td>
              <td><input v-model="draft.boss_image" type="text" placeholder="/boss_image/..." /></td>
              <td class="actions">
                <button type="button" :disabled="savingId === row.id" @click="saveEdit">保存</button>
                <button type="button" class="ghost" @click="cancelEdit">取消</button>
              </td>
            </template>
            <template v-else>
              <td>{{ row.boss_name }}</td>
              <td>{{ row.defense }}</td>
              <td>{{ row.level }}</td>
              <td>{{ row.stagger_multiplier ?? 1.5 }}</td>
              <td>{{ row.weakness || '—' }}</td>
              <td>{{ row.resistance || '—' }}</td>
              <td>{{ row.crisis_base_hp ?? '—' }}</td>
              <td>
                <img
                  v-if="row.boss_image"
                  :src="resolveAssetUrl(row.boss_image)"
                  alt=""
                  class="thumb"
                />
                <span v-else>—</span>
              </td>
              <td class="actions">
                <button type="button" @click="startEdit(row)">编辑</button>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.boss-info-catalog {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem 0 2rem;
}

.catalog-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.catalog-header h1 {
  margin: 0 0 0.35rem;
  font-size: 1.35rem;
  color: var(--color-heading);
}

.catalog-header p {
  margin: 0;
  font-size: 0.86rem;
  color: var(--color-text);
  opacity: 0.75;
  max-width: 640px;
}

.search-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.search-row input {
  min-width: 220px;
}

.search-row button,
.actions button {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  padding: 0.35rem 0.75rem;
  cursor: pointer;
}

.actions button.ghost {
  background: transparent;
}

.catalog-meta {
  margin: 0 0 0.75rem;
  font-size: 0.82rem;
  opacity: 0.7;
}

.catalog-message {
  color: #7cb87c;
  margin: 0 0 0.5rem;
}

.catalog-error {
  color: #e57373;
  margin: 0 0 0.5rem;
}

.table-wrap {
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

.catalog-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}

.catalog-table th,
.catalog-table td {
  border-bottom: 1px solid var(--color-border);
  padding: 0.45rem 0.55rem;
  text-align: left;
  vertical-align: middle;
}

.catalog-table th {
  background: var(--color-background-soft);
  position: sticky;
  top: 0;
}

.catalog-table input {
  width: 100%;
  min-width: 72px;
}

.thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 6px;
}

.actions {
  white-space: nowrap;
  display: flex;
  gap: 0.35rem;
}
</style>
