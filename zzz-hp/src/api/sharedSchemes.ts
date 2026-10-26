import type { Skill, SkillGroup } from '@/types/calculator'
import type { DamageCalcHistoryEntry } from '@/types/damageCalcHistory'
import { CalculatorBuffApiError } from '@/api/calculatorBuffs'
import { handleAdminSessionExpired, withAdminAuthHeaders } from '@/utils/adminAuth'

/**
 * 共用方案（服务端预设方案）。
 *
 * 读公开；写（导入 / 启停 / 删除）全部带管理员凭据。用户侧拿到的只是只读副本，
 * 点「使用」时由前端复制进本机方案库。
 */

export interface SharedSchemeDependencies {
  customSkills?: Skill[]
  skillGroups?: SkillGroup[]
}

export interface SharedSchemeDoc {
  id: string
  name: string
  folder: string
  description: string
  sortOrder: number
  enabled: boolean
  updatedAt?: string
  /** 公开接口带回；管理端列表不带 */
  payload?: DamageCalcHistoryEntry
  dependencies?: SharedSchemeDependencies
}

export interface SharedSchemeImportSummary {
  mode: 'merge' | 'replace'
  imported: number
  skipped: number
  ids: string[]
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

async function requestJson<T>(
  input: RequestInfo,
  init: RequestInit = {},
  options: { admin?: boolean } = {},
): Promise<T> {
  const headers = options.admin ? withAdminAuthHeaders(init.headers) : (init.headers ?? undefined)
  const response = await fetch(input, { ...init, headers })
  let json: ApiResponse<T>
  try {
    json = (await response.json()) as ApiResponse<T>
  } catch {
    throw new CalculatorBuffApiError(`请求失败: ${response.status}`, response.status)
  }
  if (!response.ok || json.code !== 200) {
    if (response.status === 401) handleAdminSessionExpired()
    throw new CalculatorBuffApiError(
      json.message || `请求失败: ${response.status}`,
      response.status,
    )
  }
  return json.data
}

export async function fetchSharedSchemes(): Promise<SharedSchemeDoc[]> {
  const data = await requestJson<{ schemes: SharedSchemeDoc[] }>('/api/shared-schemes')
  return data.schemes ?? []
}

export async function fetchAdminSharedSchemes(): Promise<SharedSchemeDoc[]> {
  const data = await requestJson<{ schemes: SharedSchemeDoc[] }>(
    '/api/shared-schemes/admin',
    {},
    { admin: true },
  )
  return data.schemes ?? []
}

export async function importSharedSchemesFile(
  file: File,
  mode: 'merge' | 'replace',
): Promise<SharedSchemeImportSummary> {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', mode)
  return requestJson<SharedSchemeImportSummary>(
    '/api/shared-schemes/admin/import',
    { method: 'POST', body: form },
    { admin: true },
  )
}

export async function updateSharedScheme(
  id: string,
  patch: { enabled?: boolean; name?: string; description?: string; sortOrder?: number },
): Promise<SharedSchemeDoc> {
  return requestJson<SharedSchemeDoc>(
    `/api/shared-schemes/admin/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    { admin: true },
  )
}

export async function deleteSharedScheme(id: string): Promise<void> {
  await requestJson<{ id: string }>(
    `/api/shared-schemes/admin/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    { admin: true },
  )
}
