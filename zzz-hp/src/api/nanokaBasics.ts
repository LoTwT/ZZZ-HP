import { handleAdminSessionExpired, withAdminAuthHeaders } from '@/utils/adminAuth'

/**
 * nanoka 采集（基础数据）管理端接口。
 *
 * 后端：`zzz-hp-backend` 的 `/api/admin/nanoka/preview` 与 `/api/admin/nanoka/apply`。
 * 预览只比对「候选文档」与库现状，**不写库**；录入只写界面勾选的条目 / 字段，
 * 且 `expect` 带的是预览时的库现值（乐观锁：库变了后端会跳过并说明原因）。
 *
 * 另有「浏览器直采」的两个接口（服务端不联网，抓取一律发生在浏览器）：
 *   - `/api/admin/nanoka/scan`：把浏览器抓来的 `character.json` / `weapon.json` 交给后端与库比对；
 *   - `/api/admin/nanoka/collect`：把浏览器抓来的单条详情交给后端映射成候选条目。
 *   两者都**不写库**，产物最终还是要走 `/preview` + `/apply`。
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

// ---------------------------------------------------------------- 浏览器直采链路

/** 索引里「本地缺失」的角色（`element` / `profession` 已由后端查表转成中文） */
export interface NanokaScanMissingAgent {
  nanokaId: string
  code: string
  zh: string
  element: string
  profession: string
  rarity: number | string | null
}

/** 索引里「本地缺失」的音擎 */
export interface NanokaScanMissingWengine {
  nanokaId: string
  zh: string
  en: string
  rank: number | string | null
  atk: number | null
  sub: string
}

/** 本地有、nanoka 索引里没有的条目（只提示，不自动处理） */
export interface NanokaScanLocalItem {
  id: string
  name: string
}

export interface NanokaScanCounts {
  missingAgents: number
  missingWengines: number
  extraLocalAgents: number
  extraLocalWengines: number
}

/** `POST /api/admin/nanoka/scan` 的结果（后端只比对，不写库） */
export interface NanokaScanResult {
  buildTag: string
  counts: NanokaScanCounts
  missingAgents: NanokaScanMissingAgent[]
  missingWengines: NanokaScanMissingWengine[]
  extraLocalAgents: NanokaScanLocalItem[]
  extraLocalWengines: NanokaScanLocalItem[]
}

/** 被丢弃的项（仓库没有对应字段，如角色 basePanel 的 `impact`） */
export interface NanokaCollectUnsupported {
  name: string
  prop: number | string | null
  format: string | null
  value: number
  reason: string
}

/** `POST /api/admin/nanoka/collect` 的结果：可直接拼进候选文档的条目 + 被丢弃的项 */
export interface NanokaCollectResult {
  entry: Record<string, unknown>
  unsupported: NanokaCollectUnsupported[]
}

/** 索引比对：请求体是浏览器抓来的 character.json / weapon.json 原文（后端不联网） */
export async function scanNanokaBasics(payload: {
  buildTag: string
  charIndex: unknown
  weaponIndex: unknown
}): Promise<NanokaScanResult> {
  const { data } = await requestApi<NanokaScanResult>('/api/admin/nanoka/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return data
}

/** 单条详情映射：请求体是浏览器抓来的 `zh/character/<id>.json` 或 `zh/weapon/<id>.json` */
export async function collectNanokaBasics(payload: {
  kind: NanokaCandidateKind
  nanokaId: string
  meta: unknown
  detail: unknown
}): Promise<NanokaCollectResult> {
  const { data } = await requestApi<NanokaCollectResult>('/api/admin/nanoka/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return data
}

// ---------------------------------------------------------------- 招式（技能倍率）一键录入

/**
 * 缺 nanoka 招式的角色（`GET /api/admin/nanoka/agent-skill-gaps`）。
 *
 * 纯本地查询（不联网、不写库），可包含已有招式的角色供增量检查。
 * nanoka 数字 id 由浏览器抓 `character.json` 后匹配。
 */
export interface NanokaSkillGap {
  id: string
  name: string
  element: string
  profession: string
  /** 该角色本地现有招式条数（含非 nanoka 来源） */
  skillCount: number
  /** 其中 nanoka 来源的条数，不代表招式已完整 */
  nanokaSkillCount: number
}

/** 计划里「可新建」的一条（就是可直接写库的招式文档） */
export interface NanokaSkillPlanCreate {
  id: string
  agentId: string
  name: string
  damageType: string
  skillTypes: string[]
  buffAnchorId: string | null
  baseMult: number
  baseMultFactor: number
  settlementMult: number
  multSource: string
  element: string
  ownerGroupId: string | null
  note: string
  damagePercentage: number
  damagePercentageGrowth: number
  /** 异放/耀变等按技能等级缩放时的大类键 */
  radianceTalentKey?: string | null
}

/** 计划里「可覆盖倍率」的一条：只改倍率字段，其余（元素 / 类型 / 锚点 / 备注）保留 */
export interface NanokaSkillPlanOverwrite {
  id: string
  name: string
  from: number | null
  to: number
  expect: Record<string, number | string | null>
  changed: {
    baseMult: boolean
    damagePercentage: boolean
    damagePercentageGrowth: boolean
    multSource: boolean
  }
  /** 写库载荷（`{...库中现值, ...倍率字段}`）：非倍率字段一律保留 */
  doc: Record<string, unknown>
}

/** 计划里「已一致」的一条 */
export interface NanokaSkillPlanSame {
  id: string
  name: string
  baseMult: number
}

/** 计划里「本库有、nanoka 没有」的残留（只提示，不删） */
export interface NanokaSkillPlanUnmatched {
  id: string
  name: string
  baseMult: number
}

/** 计划里「人工建/手调的异常类招式」：不覆盖，只提示 */
export interface NanokaSkillPlanManual {
  id: string
  name: string
  damageType: string
  localBaseMult: number
  importedBaseMult: number
}

export interface NanokaSkillPlan {
  create: NanokaSkillPlanCreate[]
  overwrite: NanokaSkillPlanOverwrite[]
  skipSame: NanokaSkillPlanSame[]
  existingManual: NanokaSkillPlanManual[]
  unmatchedLocal: NanokaSkillPlanUnmatched[]
}

/** `POST /api/admin/nanoka/collect-skills` 的结果（只算不写） */
export interface NanokaSkillCollectResult {
  agentId: string
  agentName: string
  nanokaId: string | null
  /** 旧后端会忽略 selection；缺少此能力时禁止进入勾选录入。 */
  supportsSelection?: boolean
  plan: NanokaSkillPlan
}

/** 逐条写库明细 */
export interface NanokaSkillApplyDetail {
  action: 'create' | 'overwrite'
  id: string
  name: string
  baseMult?: number
  from?: number | null
  to?: number
  changed?: Record<string, boolean>
  skillTypes?: string[]
  ok: boolean
  reason?: string
}

/** `POST /api/admin/nanoka/apply-skills` 的结果（`dryRun: true` 时只算不写） */
export interface NanokaSkillApplyResult {
  agentId: string
  agentName: string
  nanokaId: string | null
  dryRun: boolean
  created: number
  updated: number
  skipped: number
  failed: number
  details: NanokaSkillApplyDetail[]
  plan: NanokaSkillPlan
}

export interface NanokaSkillPayload {
  nanokaId: string
  /** character.json 里那一条（拿 code / zh 供后端匹配本地角色） */
  meta: unknown
  /** `zh/character/<nanokaId>.json` 原文 */
  detail: unknown
  level?: number
}

export interface NanokaSkillSelection {
  id: string
  action: 'create' | 'overwrite'
  expect?: Record<string, number | string | null>
}

/** 默认列出未采过招式的角色，includeExisting 可列全部本地角色。 */
export async function listNanokaSkillGaps(
  options: { includeExisting?: boolean } = {},
): Promise<NanokaSkillGap[]> {
  const suffix = options.includeExisting ? '?includeExisting=1' : ''
  const { data } = await requestApi<NanokaSkillGap[]>(`/api/admin/nanoka/agent-skill-gaps${suffix}`)
  return data
}

/** 招式计划：请求体是浏览器抓来的角色详情，返回会改什么（**不写库**） */
export async function collectNanokaSkills(
  payload: NanokaSkillPayload,
): Promise<{ result: NanokaSkillCollectResult; message: string }> {
  const { data, message } = await requestApi<NanokaSkillCollectResult>(
    '/api/admin/nanoka/collect-skills',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  return { result: data, message }
}

/**
 * 招式录入：重算计划，按 selection 限定写入；覆盖核对预览旧值。
 * `dryRun: true` 时后端只算不写，等价于 `/collect-skills`。
 */
export async function applyNanokaSkills(
  payload: NanokaSkillPayload & { dryRun?: boolean; selection?: NanokaSkillSelection[] },
): Promise<{ result: NanokaSkillApplyResult; message: string }> {
  const { data, message } = await requestApi<NanokaSkillApplyResult>(
    '/api/admin/nanoka/apply-skills',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  return { result: data, message }
}
