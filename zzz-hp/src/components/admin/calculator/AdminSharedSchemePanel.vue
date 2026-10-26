<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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

/** 目录路径统一成 `/A/B`；根目录为空串 */
function normFolderPath(path: string | null | undefined): string {
  const text = String(path ?? '').trim().replace(/\\/g, '/')
  if (!text) return ''
  const withSlash = text.startsWith('/') ? text : `/${text}`
  return withSlash.replace(/\/+$/, '') || ''
}

function baseNameOf(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

const currentFolder = ref('')

/** 所有出现过（含上级）的目录 */
const allFolders = computed(() => {
  const set = new Set<string>()
  for (const item of schemes.value) {
    let folder = normFolderPath(item.folder)
    while (folder) {
      set.add(folder)
      const index = folder.lastIndexOf('/')
      folder = index > 0 ? folder.slice(0, index) : ''
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
})

const subFolders = computed(() => {
  const prefix = currentFolder.value ? `${currentFolder.value}/` : '/'
  return allFolders.value.filter((path) => {
    if (!path.startsWith(prefix)) return false
    return !path.slice(prefix.length).includes('/')
  })
})

const entriesInFolder = computed(() =>
  schemes.value
    .filter((item) => normFolderPath(item.folder) === currentFolder.value)
    .sort(
      (a, b) =>
        Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) ||
        a.name.localeCompare(b.name, 'zh-CN'),
    ),
)

const breadcrumbSegments = computed(() => {
  if (!currentFolder.value) return []
  const parts = currentFolder.value.split('/').filter(Boolean)
  return parts.map((name, index) => ({
    path: `/${parts.slice(0, index + 1).join('/')}`,
    name,
  }))
})

function folderSchemeCount(path: string): number {
  return schemes.value.filter((item) => {
    const folder = normFolderPath(item.folder)
    return folder === path || folder.startsWith(`${path}/`)
  }).length
}

/** 目录被删空 / 重新导入后，避免停留在不存在的目录 */
watch(allFolders, (folders) => {
  if (currentFolder.value && !folders.includes(currentFolder.value)) currentFolder.value = ''
})

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

    <nav class="shared-breadcrumb" aria-label="共用方案目录路径">
      <button
        type="button"
        class="bc-seg"
        :class="{ current: currentFolder === '' }"
        @click="currentFolder = ''"
      >
        全部预设
      </button>
      <template v-for="seg in breadcrumbSegments" :key="seg.path">
        <span class="bc-sep">/</span>
        <button
          type="button"
          class="bc-seg"
          :class="{ current: currentFolder === seg.path }"
          @click="currentFolder = seg.path"
        >
          {{ seg.name }}
        </button>
      </template>
      <span class="bc-count">{{ subFolders.length + entriesInFolder.length }} 项</span>
    </nav>

    <p v-if="!schemes.length && !loading" class="scheme-empty">
      还没有共用方案。导入一个 `zzz-hp-schemes` JSON 后，用户端「方案库 → 预设方案」就能看到。
    </p>
    <p v-else-if="!subFolders.length && !entriesInFolder.length" class="scheme-empty">
      此目录暂无共用方案。
    </p>
    <ul v-else class="shared-list" role="list">
      <li v-for="dir in subFolders" :key="dir" class="shared-card shared-dir">
        <button type="button" class="shared-dir-main" @click="currentFolder = dir">
          <span class="shared-dir-icon">📁</span>
          <span class="shared-main">
            <strong>{{ baseNameOf(dir) }}</strong>
            <span class="shared-sub">{{ folderSchemeCount(dir) }} 个方案</span>
          </span>
        </button>
      </li>
      <li v-for="item in entriesInFolder" :key="item.id" class="shared-card">
        <div class="shared-main">
          <strong class="shared-name" :title="item.id">{{ item.name }}</strong>
          <span class="shared-sub">
            {{ item.description || '—' }} · 更新
            {{ item.updatedAt ? String(item.updatedAt).replace('T', ' ').slice(0, 19) : '—' }}
          </span>
        </div>
        <div class="shared-actions">
          <button
            type="button"
            class="chip"
            :class="{ active: item.enabled }"
            :disabled="busy"
            @click="toggleEnabled(item)"
          >
            {{ item.enabled ? '已启用' : '已停用' }}
          </button>
          <button type="button" class="danger-btn" :disabled="busy" @click="pendingDelete = item">
            删除
          </button>
        </div>
      </li>
    </ul>

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

.shared-breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin: 0.75rem 0 0.5rem;
  font-size: 0.82rem;
}

.bc-seg {
  border: none;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  opacity: 0.75;
}

.bc-seg:hover {
  background: var(--color-background-soft);
  opacity: 1;
}

.bc-seg.current {
  color: var(--color-heading);
  font-weight: 700;
  opacity: 1;
  cursor: default;
}

.bc-sep {
  opacity: 0.5;
}

.bc-count {
  margin-left: auto;
  opacity: 0.6;
}

.shared-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.6rem;
}

.shared-card {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  min-width: 0;
}

.shared-dir {
  padding: 0;
}

.shared-dir-main {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.shared-dir-main:hover {
  background: color-mix(in srgb, var(--color-border) 25%, transparent);
}

.shared-dir-icon {
  font-size: 1.1rem;
}

.shared-main {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.shared-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shared-sub {
  font-size: 0.74rem;
  opacity: 0.65;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shared-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
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
