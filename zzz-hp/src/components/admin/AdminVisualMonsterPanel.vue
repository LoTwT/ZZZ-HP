<script setup lang="ts">
import { computed, ref } from 'vue'
import { deleteBossRecord, deleteBuffRecord } from '@/api/admin'
import AdminBuffEditModal from '@/components/admin/AdminBuffEditModal.vue'
import AdminMonsterEditModal from '@/components/admin/AdminMonsterEditModal.vue'
import DefenseDetailPanel from '@/components/defense/DefenseDetailPanel.vue'
import HistoryDetailPanel from '@/components/history/HistoryDetailPanel.vue'
import type {
  AdminBuffSlotContext,
  AdminMonsterSlotContext,
  AdminScope,
} from '@/types/admin'
import { isDefenseScope } from '@/types/admin'

const props = defineProps<{
  scope: AdminScope
}>()

const detailRef = ref<{ reload?: () => Promise<void> } | null>(null)
const monsterEditOpen = ref(false)
const buffEditOpen = ref(false)
const monsterContext = ref<AdminMonsterSlotContext | null>(null)
const buffContext = ref<AdminBuffSlotContext | null>(null)
const actionError = ref('')

const isDefense = computed(() => isDefenseScope(props.scope))
const defenseVariant = computed(() => (props.scope === 'defense-new' ? 'new' : 'old'))

function openMonsterEdit(context: AdminMonsterSlotContext) {
  actionError.value = ''
  monsterContext.value = context
  monsterEditOpen.value = true
}

function openBuffEdit(context: AdminBuffSlotContext) {
  actionError.value = ''
  buffContext.value = context
  buffEditOpen.value = true
}

async function onDeleteMonster(recordId: number, label: string) {
  actionError.value = ''
  if (!window.confirm(`确认删除怪物「${label}」？此操作不可恢复。`)) return
  try {
    await deleteBossRecord(recordId)
    await detailRef.value?.reload?.()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '删除怪物失败'
  }
}

async function onDeleteBuff(recordId: number, label: string) {
  actionError.value = ''
  if (!window.confirm(`确认删除 Buff「${label}」？此操作不可恢复。`)) return
  try {
    await deleteBuffRecord(recordId)
    await detailRef.value?.reload?.()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '删除 Buff 失败'
  }
}

async function onMonsterSaved() {
  monsterEditOpen.value = false
  monsterContext.value = null
  await reloadDetail()
}

async function onBuffSaved() {
  buffEditOpen.value = false
  buffContext.value = null
  await reloadDetail()
}

async function reloadDetail() {
  try {
    await detailRef.value?.reload?.()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '刷新失败'
  }
}

defineExpose({ reload: reloadDetail })
</script>

<template>
  <div class="admin-visual-panel">
    <p v-if="actionError" class="admin-visual-error">{{ actionError }}</p>

    <HistoryDetailPanel
      v-if="scope === 'crisis-assault'"
      ref="detailRef"
      mode="crisis-assault"
      admin-mode
      @admin-monster="openMonsterEdit"
      @admin-delete-monster="onDeleteMonster"
      @admin-buff="openBuffEdit"
      @admin-delete-buff="onDeleteBuff"
    />

    <DefenseDetailPanel
      v-else-if="isDefense"
      ref="detailRef"
      admin-mode
      :variant-override="defenseVariant"
      @admin-monster="openMonsterEdit"
      @admin-delete-monster="onDeleteMonster"
      @admin-buff="openBuffEdit"
      @admin-delete-buff="onDeleteBuff"
    />

    <p v-else class="admin-visual-empty">当前模式暂不支持可视化管理</p>

    <AdminMonsterEditModal
      v-model:open="monsterEditOpen"
      :scope="scope"
      :context="monsterContext"
      @saved="onMonsterSaved"
    />

    <AdminBuffEditModal
      v-model:open="buffEditOpen"
      :scope="scope"
      :context="buffContext"
      @saved="onBuffSaved"
    />
  </div>
</template>

<style scoped>
.admin-visual-panel {
  min-height: 100%;
  width: 100%;
}

.admin-visual-error {
  margin: 0;
  padding: 0.55rem 0.75rem;
  border-radius: 0;
  border-bottom: 1px solid rgba(220, 80, 80, 0.45);
  background: rgba(220, 80, 80, 0.1);
  color: #e8a8a8;
  font-size: 0.85rem;
}

.admin-visual-empty {
  margin: 2rem 0;
  text-align: center;
  color: var(--color-text);
  opacity: 0.7;
}
</style>
