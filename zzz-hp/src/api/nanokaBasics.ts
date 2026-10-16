import { handleAdminSessionExpired, withAdminAuthHeaders } from '@/utils/adminAuth'

/**
 * nanoka 采集（基础数据）管理端接口。
 *
 * 后端：`zzz-hp-backend` 的 `/api/admin/nanoka/preview` 与 `/api/admin/nanoka/apply`。
 * 预览只比对「本地采集工具产出的候选文档」与库现状，**不写库**；录入只写界面勾选的条目 / 字段，
 * 且 `expect` 带的是预览时的库现值（乐观锁：库变了后端会跳过并说明原因）。
 */

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export type NanokaCandidateKind = 'agent' | 'wengine'

/** 候选条目的来路：新增 / 补空缺 / 覆盖 */
export type NanokaEntryAction = 'insert' | 'fill' | 'overwrite'

/**
 * 字段级状态：
 * - `insert` 库里没有（可新增）
 * - `fill` 库里为空（可补写）
 * - `conflict` 库里非空且与 nanoka 不同（需显式勾选覆盖）
 * - `equal` 与库现值一致（无需动作）
 * - `exists` 同 id 已存在（新增会被后端跳过）
 * - `stale` 库里值已变（后端会拒写这一项）
 */
export type NanokaFieldStatus = 'insert' | 'fill' | 'conflict' | 'equal' | 'exists' | 'stale'

export interface NanokaPreviewField {
  key: string
  label: string
  /** nanoka 侧的值 */
  nanoka: unknown
  /** 候选文档里记的库旧值（仅 fill / overwrite 条目有） */
  local: unknown
  /** 当前库里的值 */
  current: unknown
  status: NanokaFieldStatus
}

export interface NanokaPreviewEntry {
  kind: NanokaCandidateKind
  action: NanokaEntryAction
  id: string
  name: string
  nanokaId?: string | number | null
  /** 库里是否已有同 id 记录 */
  exists: boolean
  element?: string
  profession?: string
  rarity?: string
  fields: NanokaPreviewField[]
  /** 仅 `insert` 条目有：可直接回传的完整对象 */
  payload?: Record<string, unknown> | null
}

export interface NanokaPreviewCounts {
  insert: number
  fill: number
  conflict: number
  equal: number
  exists: number
  stale: number
}

export interface NanokaPreviewResult {
  buildTag: string | null
  generatedAt: string | null
  counts: NanokaPreviewCounts
  entries: NanokaPreviewEntry[]
}

export interface NanokaApplyField {
  key: string
  nanoka: unknown
  /** 预览时的库现值：库里变了这一项会被后端跳过 */
  expect?: unknown
}

export interface NanokaApplyEntry {
  kind: NanokaCandidateKind
  id: string
  action: NanokaEntryAction
  /** `insert` 条目必带（后端按 payload 整条建记录） */
  payload?: Record<string, unknown> | null
  fields: NanokaApplyField[]
}

export interface NanokaApplyPayload {
  entries: NanokaApplyEntry[]
}

export interface NanokaApplyAppliedField {
  key: string
  ok: boolean
  from?: unknown
  to?: unknown
  reason?: string
}

export interface NanokaApplyDetail {
  kind: NanokaCandidateKind
  id: string
  action: string
  ok: boolean
  name?: string
  applied?: NanokaApplyAppliedField[]
  reason?: string
}

export interface NanokaApplySummary {
  created: number
  updated: number
  skipped: number
  failed: number
  details: NanokaApplyDetail[]
}

export interface NanokaApplyOutcome {
  summary: NanokaApplySummary
  /** 后端现成的结果句，可直接展示 */
  message: string
}

export class NanokaBasicsApiError extends Error {
  status: number
  apiCode: string

  constructor(message: string, status: number, apiCode = '') {
    super(message)
    this.name = 'NanokaBasicsApiError'
    this.status = status
    this.apiCode = apiCode
  }
}

function readApiCode(data: unknown): string {
  if (!data || typeof data !== 'object' || !('code' in data)) return ''
  const code = (data as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

async function requestApi<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<{ data: T; message: string }> {
  const headers = withAdminAuthHeaders(init?.headers)
  const response = await fetch(input, { ...init, headers })
  let json: ApiResponse<T>
  try {
    json = (await response.json()) as ApiResponse<T>
  } catch {
    throw new NanokaBasicsApiError(`请求失败: ${response.status}`, response.status)
  }
  if (!response.ok || json.code !== 200) {
    const apiCode = readApiCode(json.data)
    // 会话已被服务器判死：同步清掉本地登录态，路由守卫才不会拿旧标记拦人
    if (response.status === 401 || apiCode === 'ADMIN_AUTH_REQUIRED') {
      handleAdminSessionExpired()
    }
    throw new NanokaBasicsApiError(
      json.message || `请求失败: ${response.status}`,
      response.status,
      apiCode,
    )
  }
  return { data: json.data, message: json.message ?? '' }
}

export function isNanokaBasicsAuthError(err: unknown): boolean {
  return (
    err instanceof NanokaBasicsApiError &&
    (err.status === 401 || err.apiCode === 'ADMIN_AUTH_REQUIRED')
  )
}

/** 预览候选文档：请求体就是候选文档本身，返回逐字段状态（不写库） */
export async function previewNanokaCandidates(doc: unknown): Promise<NanokaPreviewResult> {
  const { data } = await requestApi<NanokaPreviewResult>('/api/admin/nanoka/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
  return data
}

/** 按勾选录入：只写传进来的条目 / 字段，insert 条目要带 payload */
export async function applyNanokaCandidates(
  payload: NanokaApplyPayload,
): Promise<NanokaApplyOutcome> {
  const { data, message } = await requestApi<NanokaApplySummary>('/api/admin/nanoka/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { summary: data, message }
}
