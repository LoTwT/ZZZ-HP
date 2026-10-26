/**
 * 计算链路观测与性能基线（计算链路收敛 Spec §7.4 / K15 的测量入口）。
 *
 * 设计要点：
 * - **不改生产源码**：观察点用 Vite 插件的 transform 在内存里注入（TS AST 定位，不写盘），
 *   运行前后比对源码 SHA256，证明未被改写。
 * - **按效果身份计数**：「效果运算次数」= 某条效果的原始量真正进入 `addStat`；
 *   `resolveEffectsToMods` 的判定循环另计 `judge`，被排除的候选应当是「judge 有、op 无」。
 * - **冷/热分开**：冷态每个样本一个新进程（父进程 spawn 自己）；热态单进程预热后多轮。
 *
 * 用法：
 *   npx vite-node scripts/bench-calc-chain.mjs                # 计数自检 + 冷/热采样
 *   npx vite-node scripts/bench-calc-chain.mjs --selfcheck     # 只做计数自检（K9/K15 前置）
 *   npx vite-node scripts/bench-calc-chain.mjs --samples=7     # 指定冷态样本数
 *
 * 产物：$ZZZ_ARTIFACTS_DIR/bench-calc-chain-<时间戳>.json（原始样本，落开发目录，不进仓库）
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import ts from 'typescript'
import { ARTIFACTS_DIR, FRONTEND_ROOT } from './_paths.mjs'

const SELF = fileURLToPath(import.meta.url)
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const hasFlag = (name) => args.includes(`--${name}`)

const INSTRUMENTED_FILES = [
  path.join(FRONTEND_ROOT, 'src', 'utils', 'buffEffect.ts'),
  path.join(FRONTEND_ROOT, 'src', 'utils', 'panelBuffCalc.ts'),
]

const sha256 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()

/**
 * TS AST 插入观察点：
 * - `resolveEffectsToMods`：判定循环每条候选计 `judge`；`total = addStat(...)` 之后计 `op`。
 * - `buildBuffCatalog` / `selectEntriesForSlot` / `collectPanelBuffMods`：入口各计一次。
 */
function transformForCounters(code, file) {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const inserts = []

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const name = node.name.text
      if (name === 'buildBuffCatalog' || name === 'selectEntriesForSlot' || name === 'collectPanelBuffMods') {
        inserts.push({
          at: node.body.getStart(source) + 1,
          text: ` globalThis.__ccProbe?.(${JSON.stringify({ kind: name })});`,
        })
      }
      if (name === 'resolveEffectsToMods') {
        const walk = (child) => {
          if (ts.isForOfStatement(child) && ts.isBlock(child.statement)) {
            inserts.push({
              at: child.statement.getStart(source) + 1,
              text: ` globalThis.__ccProbe?.({ kind: 'judge', effectId: effect.id });`,
            })
          }
          if (
            ts.isBinaryExpression(child) &&
            child.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            child.left.getText(source) === 'total' &&
            ts.isCallExpression(child.right) &&
            child.right.expression.getText(source) === 'addStat'
          ) {
            inserts.push({
              at: child.end,
              text: `; globalThis.__ccProbe?.({ kind: 'op', effectId: effect.id, stat: effect.stat });`,
            })
          }
          ts.forEachChild(child, walk)
        }
        walk(node.body)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!inserts.length) return null
  inserts.sort((a, b) => b.at - a.at)
  let out = code
  for (const insert of inserts) out = out.slice(0, insert.at) + insert.text + out.slice(insert.at)
  return out
}

function createProbe() {
  const state = { judge: 0, op: 0, opsByEffect: Object.create(null), counters: Object.create(null) }
  return {
    reset() {
      state.judge = 0
      state.op = 0
      state.opsByEffect = Object.create(null)
      state.counters = Object.create(null)
    },
    record(event) {
      if (!event) return
      if (event.kind === 'judge') state.judge += 1
      else if (event.kind === 'op') {
        state.op += 1
        state.opsByEffect[event.effectId] = (state.opsByEffect[event.effectId] ?? 0) + 1
      } else state.counters[event.kind] = (state.counters[event.kind] ?? 0) + 1
    },
    snapshot() {
      return {
        judge: state.judge,
        op: state.op,
        opsByEffect: { ...state.opsByEffect },
        counters: { ...state.counters },
      }
    },
  }
}

async function loadInstrumented(probe) {
  globalThis.__ccProbe = (event) => probe.record(event)
  const sourceHashes = Object.fromEntries(INSTRUMENTED_FILES.map((file) => [file, sha256(file)]))
  const plugin = {
    name: 'calc-chain-count',
    enforce: 'pre',
    transform(code, id) {
      const file = path.normalize(id.split('?')[0])
      if (!INSTRUMENTED_FILES.some((target) => path.normalize(target) === file)) return null
      const out = transformForCounters(code, file)
      return out == null ? null : { code: out, map: null }
    },
  }
  const server = await createServer({
    configFile: path.join(FRONTEND_ROOT, 'vite.config.ts'),
    root: FRONTEND_ROOT,
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    logLevel: 'error',
    plugins: [plugin],
  })
  const skillFlowCalculation = await server.ssrLoadModule('/src/utils/skillFlowCalculation.ts')
  const optimalAffixAlloc = await server.ssrLoadModule('/src/utils/optimalAffixAlloc.ts')
  const hitEvalCache = await server.ssrLoadModule('/src/utils/hitEvalCache.ts')
  const buffEffect = await server.ssrLoadModule('/src/utils/buffEffect.ts')
  // 夹具也走同一份模块图：否则计数发生在另一份实例上
  const harness = await server.ssrLoadModule('/scripts/_eventElementHarness.mjs')
  const pipelineHarness = await server.ssrLoadModule('/scripts/_effectPipelineHarness.mjs')
  const verify = () => {
    const after = Object.fromEntries(INSTRUMENTED_FILES.map((file) => [file, sha256(file)]))
    return INSTRUMENTED_FILES.every((file) => sourceHashes[file] === after[file])
  }
  return {
    server,
    verify,
    sourceHashes,
    modules: { skillFlowCalculation, optimalAffixAlloc, hitEvalCache, buffEffect, harness, pipelineHarness },
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** K1 夹具（职业限制）：owner 强攻 / power 支援，团队固定增伤 25%。 */
function buildEventCase(modules, mode) {
  const { harness, pipelineHarness, buffEffect } = modules
  const effect = buffEffect.createEmptyBuffEffect({
    id: 'support-bonus',
    stat: 'dmgBonus',
    value: 25,
    kind: 'fixed',
    enabledDefault: true,
    applyTarget: 'team',
    applyProfession: '支援',
  })
  const fixture = harness.eventFixture({
    mode,
    damageType: 'anomaly',
    effects: [effect],
    agents: [pipelineHarness.testAgent('owner', { profession: '强攻' }), pipelineHarness.testAgent('power', { profession: '支援' })],
  })
  const hit = fixture.hits[0]
  hit.multOverrides = { ...hit.multOverrides, anomalyMult: 100 }
  return { mode, context: fixture.context, hit }
}

async function runMeasurements(rounds, warmup) {
  const probe = createProbe()
  const loading = await loadInstrumented(probe)
  const { evaluateSkillFlowHit } = loading.modules.skillFlowCalculation
  const { resolveEventBuffPreviewInputs } = loading.modules.optimalAffixAlloc
  const { clearHitEvalCache } = loading.modules.hitEvalCache

  const results = []
  // 每个 (mode, path) 用各自新建的上下文：避免上一条路径的热缓存替下一路径预热，
  // 否则「先跑 numeric 再跑 detail」会把 detail 的求值全部命中成 0。
  for (const mode of ['ordinary', 'extra-team']) {
    const paths = {
      'event-numeric': (item) => evaluateSkillFlowHit(item.context, null, item.hit, false),
      'event-detail': (item) => evaluateSkillFlowHit(item.context, null, item.hit, true),
      'event-preview': (item) => resolveEventBuffPreviewInputs(item.context, null, item.hit, 0),
    }
    for (const [name, run] of Object.entries(paths)) {
      const item = buildEventCase(loading.modules, mode)
      for (let i = 0; i < warmup; i += 1) run(item)
      const samples = []
      const counts = []
      for (let i = 0; i < rounds; i += 1) {
        probe.reset()
        const started = performance.now()
        run(item)
        samples.push(performance.now() - started)
        counts.push(probe.snapshot())
      }
      results.push({ mode, path: name, samplesMs: samples, medianMs: median(samples), counts })
    }
  }
  const unchanged = loading.verify()
  await loading.server.close()
  return { results, sourceHashes: loading.sourceHashes, unchanged }
}

/** 计数自检（Spec §7.4 第 3 项）：必须能区分 1 / 0 / 2 次效果运算。 */
async function selfCheck() {
  const probe = createProbe()
  const loading = await loadInstrumented(probe)
  const { createEmptyBuffEffect: createEffect, resolveEffectsToMods } = loading.modules.buffEffect
  const effect = createEffect({
    id: 'self-check',
    stat: 'dmgBonus',
    value: 10,
    kind: 'fixed',
    enabledDefault: true,
  })
  const options = { applyTargets: ['self', 'team'] }
  const measure = (fn) => {
    probe.reset()
    fn()
    return probe.snapshot()
  }
  const single = measure(() => resolveEffectsToMods([effect], options))
  const disabled = measure(() =>
    resolveEffectsToMods([effect], { ...options, selection: { enabledIds: { 'self-check': false } } }),
  )
  const twice = measure(() => {
    resolveEffectsToMods([effect], options)
    resolveEffectsToMods([effect], options)
  })
  const unchanged = loading.verify()
  await loading.server.close()

  const checks = [
    ['单条效果 → 恰好 1 次运算', single.opsByEffect['self-check'] === 1, JSON.stringify(single)],
    ['单条效果 → 判定至少 1 次', single.judge >= 1, JSON.stringify(single)],
    [
      '未启用 → 判定过但 0 次运算',
      (disabled.opsByEffect['self-check'] ?? 0) === 0 && disabled.judge >= 1,
      JSON.stringify(disabled),
    ],
    ['故意调用两次 → 2 次运算', twice.opsByEffect['self-check'] === 2, JSON.stringify(twice)],
    ['插桩后生产源码哈希不变', unchanged, JSON.stringify(loading.sourceHashes)],
  ]
  let failed = 0
  for (const [label, ok, detail] of checks) {
    if (!ok) failed += 1
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` —— ${detail}`}`)
  }
  if (failed) process.exitCode = 1
}

if (hasFlag('child')) {
  const out = await runMeasurements(Number(flag('rounds', '1')), Number(flag('warmup', '0')))
  process.stdout.write(`__CC_JSON__${JSON.stringify(out)}\n`)
} else if (hasFlag('selfcheck')) {
  console.log('== 计数自检 ==')
  await selfCheck()
} else {
  console.log('== 计数自检 ==')
  await selfCheck()

  const samples = Number(flag('samples', '7'))
  const coldSamples = []
  const broken = []
  for (let i = 0; i < samples; i += 1) {
    const child = spawnSync(process.execPath, [SELF, '--child', '--rounds=1'], { encoding: 'utf8' })
    const line = String(child.stdout ?? '').split('\n').find((item) => item.startsWith('__CC_JSON__'))
    if (child.status !== 0 || !line) {
      broken.push(i + 1)
      continue
    }
    coldSamples.push(JSON.parse(line.slice('__CC_JSON__'.length)))
  }
  const hotChild = spawnSync(process.execPath, [SELF, '--child', '--rounds=7', '--warmup=1'], { encoding: 'utf8' })
  const hotLine = String(hotChild.stdout ?? '').split('\n').find((item) => item.startsWith('__CC_JSON__'))
  const hot = hotLine ? JSON.parse(hotLine.slice('__CC_JSON__'.length)) : null

  const buckets = new Map()
  for (const run of coldSamples) {
    for (const item of run.results) {
      const key = `${item.mode}/${item.path}`
      if (!buckets.has(key)) buckets.set(key, { cold: [], hot: [] })
      buckets.get(key).cold.push(item.medianMs)
    }
  }
  for (const item of hot?.results ?? []) {
    const key = `${item.mode}/${item.path}`
    if (!buckets.has(key)) buckets.set(key, { cold: [], hot: [] })
    buckets.get(key).hot.push(item.medianMs)
  }

  console.log(`\n== 耗时（冷态 ${coldSamples.length}/${samples} 个新进程；热态预热1轮取7轮中位；ms） ==`)
  for (const key of [...buckets.keys()].sort()) {
    const bucket = buckets.get(key)
    console.log(
      `  ${key.padEnd(28)} 冷中位 ${Number(median(bucket.cold) ?? 0).toFixed(2).padStart(8)}   热中位 ${Number(median(bucket.hot) ?? 0).toFixed(2).padStart(8)}`,
    )
  }

  console.log('\n== 效果运算计数（冷态首样本） ==')
  for (const item of coldSamples[0]?.results ?? []) {
    const count = item.counts[0] ?? {}
    console.log(
      `  ${`${item.mode}/${item.path}`.padEnd(28)} judge=${count.judge ?? 0} op=${count.op ?? 0} ops=${JSON.stringify(count.opsByEffect ?? {})} ${JSON.stringify(count.counters ?? {})}`,
    )
  }
  const hashesStable = [...coldSamples, hot].filter(Boolean).every((run) => run.unchanged)
  console.log(`\n源码哈希全程稳定：${hashesStable ? '是' : '否（观察点写盘了，必须排查）'}`)
  if (broken.length) console.log(`失败样本序号：${broken.join(',')}`)

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outFile = path.join(ARTIFACTS_DIR, `bench-calc-chain-${stamp}.json`)
  fs.writeFileSync(
    outFile,
    JSON.stringify({ nodeVersion: process.version, samples, broken, coldSamples, hot }, null, 2),
    'utf8',
  )
  console.log(`原始样本：${outFile}`)
  if (broken.length || !hashesStable) process.exitCode = 1
}
