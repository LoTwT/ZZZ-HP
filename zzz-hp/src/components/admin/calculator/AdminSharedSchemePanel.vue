<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import {
  deleteSharedScheme,
  fetchAdminSharedSchemes,
  importSharedSchemesFile,
  updateSharedScheme,
  type SharedSchemeDoc,
} from '@/api/sharedSchemes'
import { isAdminAuthError } from '@/api/calculatorBuffs'
import { clearAdminAuthenticated } from '@/utils/adminAuth'
import '@/components/admin/calculator/adminCalculatorPanel.css'

const router = useRouter()

const schemes = ref<SharedSchemeDoc[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const importMode = ref<'merge' | 'replace'>('merge')
const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingFile = ref<File | null>(null)
const pendingDelete = ref<SharedSchemeDoc | null>(null)
const authDialogVisible = ref(false)
const replaceConfirmVisible = ref(false)

function handleAuthError(err: unknown): boolean {
  if (!isAdminAuthError(err)) return false
  authDialogVisible.value = true
  return true
}

function goRelogin() {
  clearAdminAuthenticated()
  authDialogVisible.value = false
  void router.push('/admin/login')
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    schemes.value = await fetchAdminSharedSchemes()
  } catch (err) {
    if (!handleAuthError(err)) error.value = err instanceof Error ? err.message : '读取共用方案失败'
  } finally {
    loading.value = false
  }
}

function chooseFile() {
  fileInputRef.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  pendingFile.value = input.files?.[0] ?? null
  message.value = pendingFile.value ? `已选择：${pendingFile.value.name}` : ''
}

async function upload() {
  if (importMode.value === 'replace') {
    replaceConfirmVisible.value = true
    return
  }
  await performUpload()
}

function confirmReplace() {
  replaceConfirmVisible.value = false
  void performUpload()
}

async function performUpload() {
  const file = pendingFile.value
  if (!file) {
    error.value = '请先选择一个方案 JSON 文件'
    return
  }
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const summary = await importSharedSchemesFile(file, importMode.value)
    message.value = `已导入 ${summary.imported} 个方案${summary.skipped ? `，跳过 ${summary.skipped} 个无效条目` : ''}`
    pendingFile.value = null
    if (fileInputRef.value) fileInputRef.value.value = ''
    await load()
  } catch (err) {
    if (!handleAuthError(err)) error.value = err instanceof Error ? err.message : '导入失败'
  } finally {
    busy.value = false
  }
}

async function toggleEnabled(item: SharedSchemeDoc) {
  busy.value = true
  error.value = ''
  try {
    await updateSharedScheme(item.id, { enabled: !item.enabled })
    await load()
  } catch (err) {
    if (!handleAuthError(err)) error.value = err instanceof Error ? err.message : '更新失败'
  } finally {
    busy.value = false
  }
}

async function confirmDelete() {
  const target = pendingDelete.value
  pendingDelete.value = null
  if (!target) return
  busy.value = true
  error.value = ''
  try {
    await deleteSharedScheme(target.id)
    message.value = `已删除「${target.name}」`
    await load()
  } catch (err) {
    if (!handleAuthError(err)) error.value = err instanceof Error ? err.message : '删除失败'
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="editor-panel shared-scheme-panel">
    <header class="panel-header">
      <h2 class="panel-title">共用方案</h2>
      <p class="panel-desc">
        导入方案库导出的
        JSON，发布为所有用户可见的只读预设。用户点「使用」会复制一份到自己本机，之后改名/覆盖不影响这里。
      </p>
    </header>

    <p v-if="loading && !schemes.length" class="panel-hint">正在读取共用方案…</p>
    <p v-else-if="error" class="form-error">{{ error }}</p>
    <p v-if="message" class="panel-hint">{{ message }}</p>

    <div class="import-bar">
      <label class="field">
        <span class="field-label">导入方式</span>
        <select v-model="importMode" class="field-input" :disabled="busy">
          <option value="merge">合并（推荐）</option>
          <option value="replace">整份替换</option>
        </select>
      </label>
      <button type="button" class="secondary-btn" :disabled="busy" @click="chooseFile">
        选择 JSON
      </button>
      <button type="button" class="primary-btn" :disabled="busy || !pendingFile" @click="upload">
        {{ busy ? '导入中…' : '导入并发布' }}
      </button>
      <input
        ref="fileInputRef"
        type="file"
        accept="application/json,.json"
        class="hidden-file"
        @change="onFileChange"
      />
      <span class="import-hint">
        上限 8MB / 200 条；「合并」按目录+名称更新，「替换」会清空现有预设。
      </span>
    </div>

    <div class="scheme-table" role="table" aria-label="共用方案列表">
      <div class="scheme-row scheme-head" role="row">
        <span>方案</span>
        <span>目录</span>
        <span>更新时间</span>
        <span>状态</span>
        <span>操作</span>
      </div>
      <div v-if="!schemes.length && !loading" class="scheme-empty">
        还没有共用方案。导入一个 `zzz-hp-schemes` JSON 后，用户端「方案库 → 预设方案」就能看到。
      </div>
      <div v-for="item in schemes" :key="item.id" class="scheme-row" role="row">
        <span class="scheme-name" :title="item.id">{{ item.name }}</span>
        <span class="scheme-folder">{{ item.folder || '根目录' }}</span>
        <span class="scheme-time">{{
          item.updatedAt ? String(item.updatedAt).replace('T', ' ').slice(0, 19) : '—'
        }}</span>
        <span>
          <button
            type="button"
            class="chip"
            :class="{ active: item.enabled }"
            :disabled="busy"
            @click="toggleEnabled(item)"
          >
            {{ item.enabled ? '已启用' : '已停用' }}
          </button>
        </span>
        <span>
          <button type="button" class="danger-btn" :disabled="busy" @click="pendingDelete = item">
            删除
          </button>
        </span>
      </div>
    </div>

    <AdminConfirmDialog
      :visible="Boolean(pendingDelete)"
      title="删除共用方案"
      :message="`确认删除「${pendingDelete?.name ?? ''}」？用户端预设区会立即消失；已经复制到用户本机的副本不受影响。`"
      confirm-text="删除"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
    <AdminConfirmDialog
      :visible="replaceConfirmVisible"
      title="整份替换共用方案"
      message="将清空现有全部共用方案，再写入这份文件。用户已经复制到本机的副本不受影响。确认继续？"
      confirm-text="替换"
      danger
      @confirm="confirmReplace"
      @cancel="replaceConfirmVisible = false"
    />
    <AdminConfirmDialog
      :visible="authDialogVisible"
      title="需要重新登录"
      message="当前后台会话无效或已过期，改动没法写进数据库。请重新登录管理员账号。"
      confirm-text="去登录"
      cancel-text="稍后"
      @confirm="goRelogin"
      @cancel="authDialogVisible = false"
    />
  </section>
</template>

<style scoped>
.import-bar {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin: 1rem 0;
}

.import-hint {
  flex-basis: 100%;
  font-size: 0.75rem;
  opacity: 0.65;
}

.hidden-file {
  display: none;
}

.scheme-table {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.scheme-row {
  display: grid;
  grid-template-columns: minmax(160px, 1.4fr) minmax(120px, 1fr) 170px 96px 72px;
  gap: 0.75rem;
  align-items: center;
  padding: 0.55rem 0.8rem;
  border-top: 1px solid var(--color-border);
  font-size: 0.82rem;
}

.scheme-row:first-child {
  border-top: none;
}

.scheme-head {
  background: var(--color-background-soft);
  font-weight: 700;
  font-size: 0.78rem;
}

.scheme-name {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scheme-folder,
.scheme-time {
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scheme-empty {
  padding: 1.2rem;
  opacity: 0.7;
  font-size: 0.85rem;
}

.danger-btn {
  border: 1px solid rgba(220, 80, 80, 0.5);
  background: transparent;
  color: #d65c5c;
  border-radius: 6px;
  padding: 0.25rem 0.6rem;
  cursor: pointer;
}

.danger-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.chip {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text);
  padding: 0.2rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}

.chip.active {
  border-color: rgba(90, 170, 110, 0.6);
  background: rgba(80, 150, 100, 0.14);
  color: #8fd3a2;
}

.chip:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
