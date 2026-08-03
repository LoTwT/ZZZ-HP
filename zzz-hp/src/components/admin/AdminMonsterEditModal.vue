<script setup lang="ts">
import { computed } from 'vue'
import AdminMonsterPanel from '@/components/admin/AdminMonsterPanel.vue'
import type { AdminMonsterSlotContext, AdminScope } from '@/types/admin'

const props = defineProps<{
  scope: AdminScope
  context: AdminMonsterSlotContext | null
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{ saved: [] }>()

const title = computed(() => {
  if (!props.context) return '编辑怪物'
  if (props.context.mode === 'create') return '添加怪物'
  return `编辑 · ${props.context.bossName || '怪物'}`
})

const panelKey = computed(() => {
  const ctx = props.context
  if (!ctx) return 'empty'
  return [
    ctx.mode,
    ctx.recordId ?? '',
    ctx.version,
    ctx.phase,
    ctx.room ?? '',
    ctx.stage ?? '',
    ctx.roomInStage ?? '',
    ctx.wave ?? '',
  ].join('-')
})

function close() {
  open.value = false
}

function onSaved() {
  emit('saved')
  close()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && context"
      class="admin-monster-modal-overlay"
      role="presentation"
      @click.self="close"
    >
      <div class="admin-monster-modal" role="dialog" aria-modal="true" :aria-label="title">
        <header class="admin-monster-modal-header">
          <h3>{{ title }}</h3>
          <button type="button" class="close-btn" aria-label="关闭" @click="close">×</button>
        </header>
        <div class="admin-monster-modal-body">
          <AdminMonsterPanel
            :key="panelKey"
            :scope="scope"
            :slot-context="context"
            dialog-mode
            @saved="onSaved"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.admin-monster-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1400;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  padding: 1rem;
}

.admin-monster-modal {
  width: min(720px, 100%);
  max-height: min(92vh, 900px);
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
}

.admin-monster-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  background: var(--color-background);
  z-index: 1;
}

.admin-monster-modal-header h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-heading);
}

.close-btn {
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.75;
}

.close-btn:hover {
  opacity: 1;
}

.admin-monster-modal-body {
  padding: 0 1rem 1rem;
}

.admin-monster-modal-body :deep(.admin-form-panel--dialog) {
  padding: 0;
}
</style>
