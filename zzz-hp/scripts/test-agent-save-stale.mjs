/**
 * 管理端保存并发保护（乐观锁）：前端契约测试
 *
 * 事故背景（2026-10-18）：角色增益面板保存时提交整份 7 档 mindscapeBuffs，
 * 面板打开期间库里被别的东西改过就整份旧覆盖（菲欧妮丢了一整天四批数据）。
 * 现在前端把「加载时拿到的 updatedAt」作为 baseUpdatedAt 发给后端；
 * 后端发现库里的行已变就回 409，前端必须识别成 stale、不提示保存成功、提示刷新。
 *
 * 这里用假 fetch 顶替后端（真实判定在 zzz-hp-backend/src/services/calculatorBuffService.js
 * 的 assertNotStale，另有后端测试 scripts/agent-stale-write.test.mjs 覆盖），
 * 只验证**前端这一侧的契约**：发什么、怎么解析 409、store 怎么读写本地。
 *
 * 运行：npm run test:agent-stale-write
 */

// 必须在导入被测模块前装好 localStorage 桩（adminAuth 会读登录态）
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

const { createPinia, setActivePinia } = await import('pinia')
const { saveAgentBuff, isStaleWriteError, StaleWriteError, CalculatorBuffApiError } = await import(
  '../src/api/calculatorBuffs.ts'
)
const { useCalculatorBuffStore } = await import('../src/stores/calculatorBuffs.ts')

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 秒级 ISO（与后端 normalizeUpdatedAt 同口径） */
function secondsIso(value) {
  const ms = new Date(value).getTime()
  return new Date(Math.floor(ms / 1000) * 1000).toISOString()
}

const DB_UPDATED_AT = '2026-10-18T15:22:09.000Z'
const LEGACY_UPDATED_AT = '2026-10-18T09:00:00.000Z'

function agentDoc(overrides = {}) {
  return {
    id: 'fione',
    name: '菲欧妮',
    profession: '强攻',
    element: '以太',
    supportNeeds: [],
    avatar_image: null,
    note: '',
    basePanel: {},
    mindscapeNotes: ['', '', '', '', '', '', ''],
    mindscapeBuffs: [],
    ...overrides,
  }
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload
    },
  }
}

function staleResponse(currentUpdatedAt) {
  const message = '数据已被其它操作更新'
  return jsonResponse(409, {
    code: 409,
    message,
    data: { error: 'stale', message, updatedAt: currentUpdatedAt },
    error: 'stale',
    updatedAt: currentUpdatedAt,
  })
}

/**
 * 假后端：只实现「读全量」和「保存角色」两条链
 * - 保存带 baseUpdatedAt 且与库里一致 → 200（并回新的 updatedAt）
 * - 保存带 baseUpdatedAt 但与库里不一致 → 409 + { error: 'stale', message, updatedAt }
 * - 保存不带 baseUpdatedAt → 200（老客户端，行为不变）
 */
function makeFakeBackend() {
  const state = { rowUpdatedAt: DB_UPDATED_AT, requests: [] }
  const fetchImpl = async (input, init = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
    state.requests.push({ url, method, body })

    if (url === '/api/calculator-buffs' && method === 'GET') {
      return jsonResponse(200, {
        code: 200,
        message: 'success',
        data: {
          agents: [{ ...agentDoc(), updatedAt: state.rowUpdatedAt }],
          bangboos: [],
          driveDiscs: [],
          wengines: [],
          skillSubcategories: [],
          followUpSkillRules: [],
        },
      })
    }
    if (url === '/api/calculator-buffs/agents' && method === 'PUT') {
      if (!body || typeof body !== 'object') {
        return jsonResponse(400, { code: 400, message: '坏请求', data: null })
      }
      const base = body.baseUpdatedAt
      if (base != null) {
        const current = state.rowUpdatedAt
        if (!current || secondsIso(base) !== secondsIso(current)) {
          return staleResponse(current)
        }
        // 一致 → 放行；写入后 updated_at 往前走一秒（模拟 ON UPDATE CURRENT_TIMESTAMP）
        state.rowUpdatedAt = new Date(new Date(current).getTime() + 1000).toISOString()
      }
      const saved = { ...body, updatedAt: state.rowUpdatedAt }
      delete saved.baseUpdatedAt
      return jsonResponse(200, { code: 200, message: '角色保存成功', data: saved })
    }
    // 其它（伤害事件模式 / 招式 / 技能组）一律空数组，够 loadAll 跑通
    return jsonResponse(200, { code: 200, message: 'success', data: [] })
  }
  return { state, fetchImpl }
}

async function withFakeBackend(fetchImpl, run) {
  const original = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

/** 每个用例一个干净的 store（agents 直接铺成「已加载」的样子） */
function freshStore(overrides = {}) {
  setActivePinia(createPinia())
  const store = useCalculatorBuffStore()
  store.agents = [
    { ...agentDoc(), updatedAt: DB_UPDATED_AT },
    { ...agentDoc({ id: 'anby', name: '安比' }), updatedAt: DB_UPDATED_AT },
  ]
  store.loaded = true
  for (const [key, value] of Object.entries(overrides)) store[key] = value
  return store
}

// ① 不带 updatedAt（新建 / 老数据）：请求体里不该凭空多出 baseUpdatedAt，行为与加保护之前一致
{
  const backend = makeFakeBackend()
  const store = freshStore()
  const saved = await withFakeBackend(backend.fetchImpl, () =>
    store.upsertAgent(agentDoc({ id: 'newbie', name: '新人' })),
  )
  const body = backend.state.requests[0].body
  check('① 不带 updatedAt 时请求体不含 baseUpdatedAt', !('baseUpdatedAt' in body))
  check('① 不带 updatedAt 时照常保存成功', saved.id === 'newbie' && Boolean(saved.updatedAt))
  check(
    '① 保存成功后本地新增该角色',
    store.agents.some((item) => item.id === 'newbie'),
  )
}

// ② 带 updatedAt 且与库里一致 → 放行，并把基准一起发过去
{
  const backend = makeFakeBackend()
  const store = freshStore()
  const saved = await withFakeBackend(backend.fetchImpl, () =>
    store.upsertAgent({ ...store.agents[0], name: '菲欧妮（改）' }),
  )
  const body = backend.state.requests[0].body
  check(
    '② 带 updatedAt 时请求体里带 baseUpdatedAt（且与 updatedAt 一致）',
    body.baseUpdatedAt === DB_UPDATED_AT,
    String(body.baseUpdatedAt),
  )
  check('② 基准与库里一致 → 放行', saved.name === '菲欧妮（改）')
  check(
    '② 返回值带保存后的最新 updatedAt',
    saved.updatedAt === '2026-10-18T15:22:10.000Z',
    String(saved.updatedAt),
  )
  const local = store.agents.find((item) => item.id === 'fione')
  check('② 成功后把返回的 updatedAt 写回本地 agents', local?.updatedAt === saved.updatedAt)
  check('② 归一化没把 updatedAt 丢掉', local?.updatedAt === '2026-10-18T15:22:10.000Z')
  check('② 本地内容更新为保存后的值', local?.name === '菲欧妮（改）')
}

// ③ 不一致（面板开着的时候库里被别的东西改了）→ 抛可识别的 STALE_WRITE，本地不被旧副本覆盖
{
  const backend = makeFakeBackend()
  const store = freshStore()
  const before = store.agents.map((item) => ({ id: item.id, name: item.name }))
  let caught = null
  try {
    await withFakeBackend(backend.fetchImpl, () =>
      store.upsertAgent({ ...store.agents[0], updatedAt: LEGACY_UPDATED_AT, name: '旧副本' }),
    )
  } catch (err) {
    caught = err
  }
  const after = store.agents.map((item) => ({ id: item.id, name: item.name }))
  check('③ 库里已变 → 抛错而不是成功', caught != null)
  check('③ 错误是 StaleWriteError', caught instanceof StaleWriteError, String(caught))
  check('③ err.code === "stale"', caught?.code === 'stale', String(caught?.code))
  check('③ err.status === 409', caught?.status === 409, String(caught?.status))
  check(
    '③ 带上后端给的 updatedAt（库里当前值）',
    caught?.updatedAt === DB_UPDATED_AT,
    String(caught?.updatedAt),
  )
  check('③ isStaleWriteError 能认出来', isStaleWriteError(caught))
  check('③ 普通错误不会被误判成 stale', !isStaleWriteError(new Error('别的错')))
  check('③ isStaleWriteError 对空值安全', !isStaleWriteError(null))
  check('③ 409 时本地数据保持原样（没被旧副本覆盖）', JSON.stringify(before) === JSON.stringify(after))
}

// ④ API 客户端：409 → StaleWriteError（可直接调用 saveAgentBuff 的场景）
{
  const backend = makeFakeBackend()
  let caught = null
  try {
    await withFakeBackend(backend.fetchImpl, () =>
      saveAgentBuff({ ...agentDoc(), baseUpdatedAt: LEGACY_UPDATED_AT }),
    )
  } catch (err) {
    caught = err
  }
  check('④ saveAgentBuff 把 409 转成 StaleWriteError', caught instanceof StaleWriteError)
  check(
    '④ StaleWriteError 同时是 CalculatorBuffApiError（旧的错误处理不会漏）',
    caught instanceof CalculatorBuffApiError,
  )
  check('④ 错误消息用后端文案', caught?.message === '数据已被其它操作更新', String(caught?.message))
  check('④ 只有 error=stale 的字段没被当成普通 400', caught?.status === 409)
}

// ⑤ 读取侧：GET /api/calculator-buffs 下发的 updatedAt 经过 normalizeAgent 不丢
{
  const backend = makeFakeBackend()
  const store = freshStore()
  store.loaded = false
  await withFakeBackend(backend.fetchImpl, () => store.loadAll(true))
  const local = store.agents.find((item) => item.id === 'fione')
  check(
    '⑤ 读取侧 updatedAt 经过归一化仍在（否则保存永远无保护）',
    local?.updatedAt === DB_UPDATED_AT,
    String(local?.updatedAt),
  )
}

console.log('')
console.log(failed === 0 ? `✅ all passed（${passed}）` : `❌ ${failed} 项失败（通过 ${passed}）`)
process.exit(failed === 0 ? 0 : 1)
