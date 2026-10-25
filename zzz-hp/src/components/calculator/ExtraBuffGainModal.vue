<script setup lang="ts">
import { computed } from 'vue'
import ExtraBuffGainEditor from '@/components/calculator/ExtraBuffGainEditor.vue'
import type { ExtraBuffGain } from '@/types/extraBuff'
import { useMaskClose } from '@/composables/useMaskClose'
import type { SkillCategoryId } from '@/types/calculator'
import type { AgentBuffDoc } from '@/types/calculator'

const open = defineModel<boolean>('open', { default: false })
const gains = defineModel<ExtraBuffGain[]>('gains', { required: true })

defineProps<{
  skillSubcategories?: Array<{
    id: string
    agentId: string
    categoryId: SkillCategoryId
    name: string
  }>
  teamSlots?: Array<{ agentId?: string | null }>
  agents?: AgentBuffDoc[]
}>()

const gainCount = computed(() => gains.value.length)

function close() {
  open.value = false
}

// 遮罩点击关闭：只有「按下 + 松开都在遮罩上」才关，拖选文字出界松手不误关
const { onMaskPointerDown, onMaskClick } = useMaskClose(close)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="buff-picker-overlay"
      role="presentation"
      @pointerdown="onMaskPointerDown"
      @click="onMaskClick"
    >
      <div
        class="buff-picker-modal extra-buff-modal"
        role="dialog"
        aria-modal="true"
        aria-label="额外 Buff 增益"
      >
        <header class="buff-picker-header">
          <div class="buff-picker-header-main">
            <div class="buff-picker-title-row">
              <h3>额外 Buff 增益</h3>
              <button type="button" class="close-btn" aria-label="关闭" @click="close">×</button>
            </div>
            <p>
              未录入角色/音擎/邦布数据时的补充增益。目标按槽位固定（全队或角色1/2/3），不跟编辑中角色走。
            </p>
          </div>
        </header>

        <div class="extra-buff-modal-body">
          <ExtraBuffGainEditor
            v-model="gains"
            :skill-subcategories="skillSubcategories"
            :team-slots="teamSlots"
            :agents="agents"
          />
        </div>

        <footer class="buff-picker-footer">
          <span class="muted">已添加 {{ gainCount }} 条</span>
          <button type="button" class="primary" @click="close">完成</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/*
 * 弹窗 Teleport 到 body，用全局 `--color-*`（随 html[data-theme] 翻转）而不是写死深色，
 * 白天/暗夜同一套声明。字号整体上调一档：标题 1.2rem、正文 0.95rem、按钮 0.95rem。
 */
.buff-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(8, 12, 20, 0.62);
}

.buff-picker-modal {
  --eb-surface: var(--color-background-soft, #141922);
  --eb-surface-2: var(--color-background-mute, #1a1f2a);
  --eb-border: var(--color-border, #2d3646);
  --eb-text: var(--color-text, #e8ecf4);
  --eb-muted: color-mix(in srgb, var(--color-text, #e8ecf4) 64%, transparent);
  --eb-accent: #c9a55c;
  width: min(1120px, calc(100vw - 24px));
  max-height: min(90vh, 960px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--eb-border);
  border-radius: 16px;
  background: var(--eb-surface);
  color: var(--eb-text);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.38);
}

.buff-picker-header {
  padding: 1.1rem 1.3rem 0.95rem;
  border-bottom: 1px solid var(--eb-border);
  flex-shrink: 0;
}

.buff-picker-header-main {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.buff-picker-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.buff-picker-header h3 {
  margin: 0;
  font-size: 1.2rem;
  color: var(--color-heading, var(--eb-text));
}

.buff-picker-header p {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--eb-muted);
}

.close-btn {
  border: none;
  background: transparent;
  font-size: 1.7rem;
  line-height: 1;
  cursor: pointer;
  color: var(--eb-muted);
  padding: 0 0.25rem;
}

.close-btn:hover {
  color: var(--eb-text);
}

.extra-buff-modal-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1.05rem 1.3rem;
}

.buff-picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1.3rem;
  border-top: 1px solid var(--eb-border);
  flex-shrink: 0;
}

.buff-picker-footer .muted {
  font-size: 0.9rem;
  color: var(--eb-muted);
}

.primary {
  border: 1px solid color-mix(in srgb, #6b8f4e 70%, var(--eb-border));
  border-radius: 10px;
  background: color-mix(in srgb, #6b8f4e 26%, var(--eb-surface-2));
  color: var(--eb-text);
  padding: 0.5rem 1.15rem;
  font-size: 0.95rem;
  font-weight: 600;
  min-height: 2.4rem;
  cursor: pointer;
}

.primary:hover {
  background: color-mix(in srgb, #6b8f4e 38%, var(--eb-surface-2));
}
</style>
