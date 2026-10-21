import type {
  AgentBuffDoc,
  BangbooBuffDoc,
  CalculatorBuffData,
  CalculatorBuffImportSummary,
  DamageEventMode,
  DriveDiscBuffDoc,
  FollowUpSkillRule,
  Skill,
  SkillGroup,
  SkillSubcategory,
  WengineBuffDoc,
} from '@/types/calculator'
import { handleAdminSessionExpired, withAdminAuthHeaders } from '@/utils/adminAuth'

interface ApiResponse<T> {
  code: number
  message: string
  data: T
  /** 冲突响应里后端会额外平铺这两个字段（409 / error='stale'） */
  error?: string
  updatedAt?: string | null
}

export class CalculatorBuffApiError extends Error {
  status: number
  apiCode: string

  constructor(message: string, status: number, apiCode = '') {
    super(message)
    this.name = 'CalculatorBuffApiError'
    this.status = status
    this.apiCode = apiCode
  }
}

/**
 * 保存被拒：库里的行已经被其它操作更新（后端 HTTP 409 / `error: 'stale'`）。
 *
 * 管理端「角色增益」面板保存时会提交整份 7 档 mindscapeBuffs；面板打开期间库里被
 * 批量脚本、SQL 之类改过，再写回去就是整份旧覆盖。所以后端拒绝写入，前端必须
 * **不提示保存成功**，改为提示刷新，并把 `updatedAt`（库里当前值）带出来备查。
 */
export class StaleWriteError extends CalculatorBuffApiError {
  /** 可识别标记：`err.code === 'stale'` */
  code = 'stale' as const
  /** 库里当前最新 updated_at（ISO），可能为 null（例如行已被删） */
  updatedAt: string | null

  constructor(message: string, updatedAt: string | null = null) {
    super(message, 409, 'STALE_WRITE')
    this.name = 'StaleWriteError'
    this.updatedAt = updatedAt
  }
}

/** 把 409 / stale 响应统一成可识别错误 */
export function isStaleWriteError(err: unknown): err is StaleWriteError {
  if (err instanceof StaleWriteError) return true
  return (
    err instanceof CalculatorBuffApiError &&
    (err.status === 409 || err.apiCode === 'STALE_WRITE')
  )
}

function readApiCode(data: unknown): string {
  if (!data || typeof data !== 'object' || !('code' in data)) return ''
  const code = (data as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

function readStaleMarker(json: ApiResponse<unknown>): string {
  const fromData =
    json.data && typeof json.data === 'object' && 'error' in json.data
      ? (json.data as { error?: unknown }).error
      : undefined
  if (typeof fromData === 'string') return fromData
  return typeof json.error === 'string' ? json.error : ''
}

function readStaleUpdatedAt(json: ApiResponse<unknown>): string | null {
  const fromData =
    json.data && typeof json.data === 'object' && 'updatedAt' in json.data
      ? (json.data as { updatedAt?: unknown }).updatedAt
      : undefined
  for (const candidate of [fromData, json.updatedAt]) {
    if (typeof candidate === 'string' && candidate) return candidate
  }
  // 行已被删时后端给 null
  return null
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const headers = withAdminAuthHeaders(init?.headers)
  const response = await fetch(input, { ...init, headers })
  let json: ApiResponse<T>
  try {
    json = (await response.json()) as ApiResponse<T>
  } catch {
    throw new CalculatorBuffApiError(`请求失败: ${response.status}`, response.status)
  }
  if (!response.ok || json.code !== 200) {
    const apiCode = readApiCode(json.data)
    // 会话已被服务器判死：同步清掉本地登录态，路由守卫才不会拿旧标记拦人
    if (response.status === 401 || apiCode === 'ADMIN_AUTH_REQUIRED') {
      handleAdminSessionExpired()
    }
    // 保存并发保护：409 / error='stale' → 可识别的 StaleWriteError（含后端给的 updatedAt）
    if (response.status === 409 || readStaleMarker(json) === 'stale') {
      throw new StaleWriteError(
        json.message || '数据已被其它操作更新',
        readStaleUpdatedAt(json),
      )
    }
    throw new CalculatorBuffApiError(
      json.message || `请求失败: ${response.status}`,
      response.status,
      apiCode,
    )
  }
  return json.data
}

export function isAdminAuthError(err: unknown): boolean {
  return (
    err instanceof CalculatorBuffApiError &&
    (err.status === 401 || err.apiCode === 'ADMIN_AUTH_REQUIRED')
  )
}

export async function fetchCalculatorBuffs(): Promise<CalculatorBuffData> {
  return requestJson<CalculatorBuffData>('/api/calculator-buffs')
}

/** 保存角色时的请求体：`baseUpdatedAt` = 加载该行时拿到的 `updatedAt`（乐观锁基准） */
export type AgentBuffSavePayload = AgentBuffDoc & { baseUpdatedAt?: string }

export async function saveAgentBuff(doc: AgentBuffSavePayload): Promise<AgentBuffDoc> {
  return requestJson<AgentBuffDoc>('/api/calculator-buffs/agents', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function fetchSkillSubcategories(): Promise<SkillSubcategory[]> {
  return requestJson<SkillSubcategory[]>('/api/calculator-buffs/skill-subcategories')
}

export async function saveSkillSubcategory(
  doc: SkillSubcategory,
): Promise<SkillSubcategory> {
  return requestJson<SkillSubcategory>('/api/calculator-buffs/skill-subcategories', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteSkillSubcategory(id: string): Promise<void> {
  await requestJson<{ id: string }>(
    `/api/calculator-buffs/skill-subcategories/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export async function fetchPresetSkills(): Promise<Skill[]> {
  return requestJson<Skill[]>('/api/calculator-buffs/skills')
}

export async function savePresetSkill(doc: Skill): Promise<Skill> {
  return requestJson<Skill>('/api/calculator-buffs/skills', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deletePresetSkill(id: string): Promise<void> {
  await requestJson<{ id: string }>(`/api/calculator-buffs/skills/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function fetchPresetSkillGroups(): Promise<SkillGroup[]> {
  return requestJson<SkillGroup[]>('/api/calculator-buffs/skill-groups')
}

export async function savePresetSkillGroup(doc: SkillGroup): Promise<SkillGroup> {
  return requestJson<SkillGroup>('/api/calculator-buffs/skill-groups', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deletePresetSkillGroup(id: string): Promise<void> {
  await requestJson<{ id: string }>(
    `/api/calculator-buffs/skill-groups/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export async function saveFollowUpSkillRule(
  doc: FollowUpSkillRule,
): Promise<FollowUpSkillRule> {
  return requestJson<FollowUpSkillRule>('/api/calculator-buffs/follow-up-rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteFollowUpSkillRule(id: string): Promise<void> {
  await requestJson<{ id: string }>(
    `/api/calculator-buffs/follow-up-rules/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export async function fetchDamageEventModes(): Promise<DamageEventMode[]> {
  return requestJson<DamageEventMode[]>('/api/calculator-buffs/damage-event-modes')
}

export async function saveDamageEventMode(doc: DamageEventMode): Promise<DamageEventMode> {
  return requestJson<DamageEventMode>('/api/calculator-buffs/damage-event-modes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteDamageEventMode(id: string): Promise<void> {
  await requestJson<{ id: string }>(
    `/api/calculator-buffs/damage-event-modes/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export async function deleteAgentBuff(id: string): Promise<void> {
  await requestJson<{ id: string }>(`/api/calculator-buffs/agents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function saveWengineBuff(doc: WengineBuffDoc): Promise<WengineBuffDoc> {
  return requestJson<WengineBuffDoc>('/api/calculator-buffs/wengines', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteWengineBuff(id: string): Promise<void> {
  await requestJson<{ id: string }>(`/api/calculator-buffs/wengines/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function saveBangbooBuff(doc: BangbooBuffDoc): Promise<BangbooBuffDoc> {
  return requestJson<BangbooBuffDoc>('/api/calculator-buffs/bangboos', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteBangbooBuff(id: string): Promise<void> {
  await requestJson<{ id: string }>(`/api/calculator-buffs/bangboos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function saveDriveDiscBuff(doc: DriveDiscBuffDoc): Promise<DriveDiscBuffDoc> {
  return requestJson<DriveDiscBuffDoc>('/api/calculator-buffs/drive-discs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteDriveDiscBuff(id: string): Promise<void> {
  await requestJson<{ id: string }>(`/api/calculator-buffs/drive-discs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function fetchCalculatorBuffSnapshot(): Promise<CalculatorBuffData> {
  return requestJson<CalculatorBuffData>('/api/calculator-buffs/export')
}

export async function importCalculatorBuffSnapshotFile(
  file: File,
): Promise<CalculatorBuffImportSummary> {
  const form = new FormData()
  form.append('file', file)
  return requestJson<CalculatorBuffImportSummary>('/api/calculator-buffs/import', {
    method: 'POST',
    body: form,
  })
}
