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
import os from 'node:os'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { nextTick } from 'vue'
import ts from 'typescript'
import { ARTIFACTS_DIR, FRONTEND_ROOT, BUFFS_JSON, resolveSchemePath } from './_paths.mjs'

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
  path.join(FRONTEND_ROOT, 'src', 'utils', 'optimalAffixAlloc.ts'),
  path.join(FRONTEND_ROOT, 'src', 'utils', 'skillFlowCalculation.ts'),
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
      if (['selectEntriesForSlot', 'collectPanelBuffMods', 'resolveBuffEffectParameters', 'projectEventEffectRecords'].includes(name)) {
        inserts.push({
          at: node.body.getStart(source) + 1,
          text: ` globalThis.__ccProbe?.(${JSON.stringify({ kind: name })});`,
        })
      }
      if (name === 'buildBuffCatalog') {
        const entry = node.body.statements.find(statement => ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'entries'))
        if (!entry) throw new Error('buildBuffCatalog miss boundary missing')
        inserts.push({ at: entry.getStart(source), text: "globalThis.__ccProbe?.({ kind: 'catalogBuild' }); " })
      }
      if (name === 'evaluateSkillFlowHit') inserts.push({ at: node.body.getStart(source) + 1,
        text: " if (includeDetails) globalThis.__ccProbe?.({ kind: 'replay' }); " })
      if (name === 'resolvePackMods') {
        inserts.push({ at: node.body.getStart(source) + 1,
          text: " globalThis.__ccEnter?.({ viewKey: ctx.trace?.viewKey ?? JSON.stringify([ctx.mainSlotIndex,ctx.skillContext,ctx.restrictToSlotIndex,ctx.effectSourcePolicy]), stage: ctx.traceStage ?? (ctx.skipConvert ? 'preConvert' : 'convert'), identities: ctx.traceIdentities, source: sourceOptions?.traceSource, extra: ctx.extraGains, traced: !!ctx.trace }); try { " })
        inserts.push({ at: node.body.end - 1, text: " } finally { globalThis.__ccLeave?.(); } " })
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
  const state = { judge: 0, op: 0, opsByEffect: Object.create(null), opsByIdentity: Object.create(null), counters: Object.create(null) }
  const frames = []
  return {
    enter(frame) { frames.push(frame) },
    leave() { frames.pop() },
    reset() {
      state.judge = 0
      state.op = 0
      state.opsByEffect = Object.create(null)
      state.opsByIdentity = Object.create(null)
      state.counters = Object.create(null)
    },
    record(event) {
      if (!event) return
      if (event.kind === 'judge') state.judge += 1
      else if (event.kind === 'op') {
        state.op += 1
        state.opsByEffect[event.effectId] = (state.opsByEffect[event.effectId] ?? 0) + 1
        const frame = frames.at(-1)
        const item = frame?.identities?.get(event.effectId)
        const extra = frame?.extra?.find(gain => gain.effects?.some(effect => effect.id === event.effectId))
        const parts = event.effectId.split('::')
        const sourceKey = item?.sourceKey ?? frame?.source?.sourceKey ?? (extra ? `extra-${extra.id}` : parts[0])
        const blockId = item?.blockId ?? frame?.source?.blockId ?? extra?.id ?? parts[1] ?? ''
        const identity = JSON.stringify([frame?.traced ? 'traced' : 'numeric', frame?.viewKey ?? 'selfcheck', frame?.stage ?? 'selfcheck', sourceKey, blockId, event.effectId])
        state.opsByIdentity[identity] = (state.opsByIdentity[identity] ?? 0) + 1
      } else state.counters[event.kind] = (state.counters[event.kind] ?? 0) + 1
    },
    snapshot() {
      return {
        judge: state.judge,
        op: state.op,
        opsByEffect: { ...state.opsByEffect },
        opsByIdentity: { ...state.opsByIdentity },
        counters: { ...state.counters },
      }
    },
  }
}

async function loadInstrumented(probe) {
  globalThis.__ccProbe = (event) => probe.record(event)
  globalThis.__ccEnter = (frame) => probe.enter(frame)
  globalThis.__ccLeave = () => probe.leave()
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
  // 候选评估/扫掠要的工厂与缓存清理
  const calculatorPanel = await server.ssrLoadModule('/src/types/calculatorPanel.ts')
  const affixOptimizer = await server.ssrLoadModule('/src/utils/affixOptimizer.ts')
  const affixLibrary = await server.ssrLoadModule('/src/utils/affixLibrary.ts')
  const agentPanelSources = await server.ssrLoadModule('/src/utils/agentPanelSources.ts')
  const resolvedHit = await server.ssrLoadModule('/src/utils/resolvedHit.ts')
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
    modules: {
      skillFlowCalculation,
      optimalAffixAlloc,
      hitEvalCache,
      buffEffect,
      harness,
      pipelineHarness,
      calculatorPanel,
      affixOptimizer, affixLibrary, agentPanelSources, resolvedHit,
    },
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
  return { mode, context: fixture.context, hit, fixture }
}

async function mountEventComponent(loading, item) {
  const file = path.join(FRONTEND_ROOT, 'src/components/calculator/PanelCalcSection.vue')
  const source = fs.readFileSync(file, 'utf8').split('</script>')[0]
  const imports = {}
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    const key = match[1]
    if (key === 'vue' || key.endsWith('.vue') || key in imports) continue
    imports[key] = await loading.server.ssrLoadModule(key.startsWith('@/') ? `/src/${key.slice(2)}.ts` : key)
  }
  const { mountVueSetup } = await loading.server.ssrLoadModule('/scripts/_vueSetupHarness.mjs')
  const { createPinia } = await loading.server.ssrLoadModule('pinia')
  const f = item.fixture
  const slotPanels = Object.fromEntries(Object.entries(f.panels).map(([id, panel]) => [id, { active: 'imported', importedPanel: panel }]))
  return mountVueSetup(new URL(`file:///${file.replaceAll('\\', '/')}`), { imports, plugins: [createPinia()], props: {
    enemyInput: f.context.enemyInput, agents: f.agents, teamSlots: f.teamSlots,
    wengines: [], driveDiscs: [], slotPanels, convertSlotPanels: {}, slotBuffSelections: null,
    skillTalentLevelsByAgent: f.context.panelContext.skillTalentLevelsByAgent,
    editedSlotIndex: 0, staggerPhase: 'stagger', damageKind: 'anomaly', calcMode: 'panel', hits: [item.hit],
    extraGains: f.extraGains, environmentBuffs: [], bangboos: [], selectedBangbooId: 'none', bangbooRefine: 1,
  } })
}

async function runMeasurements(rounds, warmup) {
  const probe = createProbe()
  const loading = await loadInstrumented(probe)
  const { evaluateSkillFlowHit, resolveSkillFlowCalculationDetail } = loading.modules.skillFlowCalculation
  const { evaluateAffixCounts, evaluateAffixCountsForSweep, clearAffixEvalCache } =
    loading.modules.optimalAffixAlloc
  const { createEmptyAffixCounts } = loading.modules.calculatorPanel
  const { resolveEventBuffPreviewInputs } = loading.modules.optimalAffixAlloc
  const { buildHitEvalFingerprint, hitEvalCacheKey, internHitEvalContext } =
    loading.modules.hitEvalCache

  const results = []
  let fixedInput = null
  const schemePath = resolveSchemePath(flag('scheme', undefined))
  const buffs = JSON.parse(fs.readFileSync(BUFFS_JSON, 'utf8'))
  const pack = JSON.parse(fs.readFileSync(schemePath, 'utf8'))
  const scheme = Object.values(pack.schemes)[0]
  const skills = new Map([...(buffs.skills ?? []), ...(pack.customSkills ?? [])].map(skill => [skill.id, skill]))
  const flow = loading.modules.resolvedHit.resolveFlow({ slots: scheme.slots, teamSlots: scheme.teamSlots,
    findSkill: id => skills.get(id) ?? null, skillSubcategories: buffs.skillSubcategories })
  const mainSlotIndex = Number(scheme.activeSlot ?? 0)
  const mainId = scheme.teamSlots[mainSlotIndex]?.agentId
  const agent = buffs.agents.find(item => item.id === mainId)
  const mainStats = loading.modules.agentPanelSources.schemeAffixInputs(scheme, mainId).affixDriveDiscMainStats ??
    { slot4MainStat: 'mastery', slot5MainStat: 'dmgBonus', slot6MainStat: 'energyRegen' }
  const fixedContext = loading.modules.optimalAffixAlloc.buildOptimalEvalContext({
    isMb: agent?.profession === '命破', isFengYu: agent?.profession === '锋御',
    teamSlots: scheme.teamSlots, agents: buffs.agents, wengines: buffs.wengines,
    bangboo: loading.modules.pipelineHarness.dummyBangboo(), bangbooRefine: 1, driveDiscs: buffs.driveDiscs,
    mainSlotIndex, driveDiscMainStats: mainStats,
    enemyInput: { level: 60, defense: 953, resistanceType: 'normal', vulnerableMultiplier: 1, staggerMultiplier: 1.5, specialMultiplier: 1 },
    baseDamageSource: agent?.profession === '命破' ? 'pierce' : agent?.profession === '锋御' ? 'def' : 'atk',
    buffSelection: null, slotBuffSelections: scheme.multiSlotBuffSelection ?? null,
    activeSlotPanels: loading.modules.agentPanelSources.schemeActivePanels(scheme), convertSlotPanels: scheme.convertSlotPanels,
    hits: flow.hits, resolveSubcategory: id => buffs.skillSubcategories.find(sub => sub.id === id) ?? null,
    skillSubcategories: buffs.skillSubcategories, followUpSkillRules: buffs.followUpSkillRules,
  })
  const entries = loading.modules.affixLibrary.createDefaultAffixLibrary()
  const budget = Number(flag('rolls', '30'))
  fixedInput = { schemePath, schemeHash: sha256(schemePath), dataHash: sha256(BUFFS_JSON), budget, entries, hitCount: flow.hits.length }
  for (const [name, run] of Object.entries({
    'fixed-numeric': () => evaluateSkillFlowHit(fixedContext, null, flow.hits[0], false),
    'fixed-candidate': () => evaluateAffixCounts(fixedContext, createEmptyAffixCounts()),
    'fixed-sweep': () => evaluateAffixCountsForSweep(fixedContext, createEmptyAffixCounts(), { dmgBonus: 10 }),
    'fixed-solve': () => loading.modules.affixOptimizer.solveOptimalAffixAllocationAsync({ ctx: fixedContext, entries, maxTotalRolls: budget, candidateWidthMode: 'auto', manualCandidateWidth: 8 }),
  })) {
    for (let i = 0; i < warmup; i += 1) { clearAffixEvalCache(); await run() }
    const samples = [], counts = [], values = []
    for (let i = 0; i < rounds; i += 1) {
      clearAffixEvalCache()
      probe.reset()
      const started = performance.now()
      const value = await run()
      samples.push(performance.now() - started)
      counts.push(probe.snapshot())
      values.push({ total: value?.total ?? value?.totalDamage ?? value?.grandTotal, rolls: value?.rollsByEntryId })
    }
    results.push({ mode: 'scheme-dan', path: name, samplesMs: samples, medianMs: median(samples), counts, values })
  }
  // 候选评估 / 扫掠路径（Spec §7.4 第 7 项）：同一事件夹具上跑词条评估
  const affixCountsFor = (seed) => {
    const counts = createEmptyAffixCounts()
    counts.atkFlat = seed % 7
    counts.critRate = (seed + 3) % 5
    counts.mastery = seed % 4
    return counts
  }
  for (const mode of ['ordinary', 'extra-team']) {
    const candidateContext = buildEventCase(loading.modules, mode).context
    for (const [name, run] of Object.entries({
      // 候选评估：每次换一组词条，走完整事件汇总（含逐事件求值）
      'affix-candidate': (seed) => evaluateAffixCounts(candidateContext, affixCountsFor(seed)),
      // 扫掠：同一组词条 + 每次不同 panelDelta，走扫掠缓存键
      'affix-sweep': (seed) =>
        evaluateAffixCountsForSweep(
          candidateContext,
          affixCountsFor(seed),
          { dmgBonus: seed % 3 },
        ),
    })) {
      const samples = []
      const counts = []
      for (let i = 0; i < Math.max(1, rounds); i += 1) {
        clearAffixEvalCache()
        probe.reset()
        const started = performance.now()
        run(i + 1)
        samples.push(performance.now() - started)
        counts.push(probe.snapshot())
      }
      results.push({ mode, path: name, samplesMs: samples, medianMs: median(samples), counts })
    }
  }

  // 每个 (mode, path) 用各自新建的上下文：避免上一条路径的热缓存替下一路径预热，
  // 否则「先跑 numeric 再跑 detail」会把 detail 的求值全部命中成 0。
  for (const mode of ['ordinary', 'extra-team']) {
    const paths = {
      'event-numeric': (item) => evaluateSkillFlowHit(item.context, null, item.hit, false),
      'event-detail': (item) => evaluateSkillFlowHit(item.context, null, item.hit, true),
      'event-preview': (item) => resolveEventBuffPreviewInputs(item.context, null, item.hit, 0),
      // 与组件同一条真实路径：先取同快照 detail 条目（冷态一次正式重放并写回），再纯投影。
      // 热态应当命中 detail 轴、效果运算 0 次（K15）。
      'event-preview-cached': (item) => {
        const key = hitEvalCacheKey(
          buildHitEvalFingerprint(item.hit),
          internHitEvalContext(`bench|${item.mode}`),
          { ...item.panel },
          true,
        )
        const detail = resolveSkillFlowCalculationDetail(item.context, null, item.hit, key)
        return resolveEventBuffPreviewInputs(item.context, null, item.hit, 0, detail?.evaluation ?? null)
      },
      'component-preview-then-detail': (item) => {
        item.component.vm.getEventBuffPreviewInputs(0, item.hit, null)
        return item.component.vm.resolveFlowCalculationDetail(item.hit.id)
      },
      'component-detail-then-preview': (item) => {
        item.component.vm.resolveFlowCalculationDetail(item.hit.id)
        return item.component.vm.getEventBuffPreviewInputs(0, item.hit, null)
      },
    }
    for (const [name, run] of Object.entries(paths)) {
      const item = buildEventCase(loading.modules, mode)
      loading.modules.hitEvalCache.clearHitEvalCache()
      if (name.startsWith('component-')) item.component = await mountEventComponent(loading, item)
      item.panel = mode === 'ordinary' ? item.context.panelContext.activeSlotPanels?.owner : item.context.panelContext.activeSlotPanels?.owner
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
      item.component?.unmount()
    }
    // 淘汰与失效先在真实组件准备，计时和效果计数仅覆盖随后的首开。
    for (const name of ['numeric-then-preview', 'projection-evicted', 'detail-evicted', 'configuration-changed']) {
      const item = buildEventCase(loading.modules, mode)
      const component = await mountEventComponent(loading, item)
      const samples = []
      const counts = []
      const values = []
      try {
        for (let round = -warmup; round < rounds; round += 1) {
          const hits = Array.from({ length: name === 'detail-evicted' ? 505 : name === 'projection-evicted' ? 141 : 1 },
            (_, i) => ({ ...item.hit, id: `${name}-${round}-${i}` }))
          component.props.hits = hits
          component.props.skillFlowMainExternalOverride = null
          await nextTick()
          loading.modules.hitEvalCache.clearHitEvalCache()
          if (name === 'numeric-then-preview') evaluateSkillFlowHit(item.context, null, hits[0], false)
          else {
            component.vm.getEventBuffPreviewInputs(0, hits[0], null)
            for (let i = 1; i < hits.length; i += 1) component.vm.getEventBuffPreviewInputs(0, hits[i], null)
            if (name === 'configuration-changed') {
              component.props.skillFlowMainExternalOverride = { ...item.fixture.panels.owner, atk: 3000 + round }
              await nextTick()
            }
          }
          probe.reset()
          const started = performance.now()
          component.vm.getEventBuffPreviewInputs(0, hits[0], null)
          const duration = performance.now() - started
          const count = probe.snapshot()
          const evaluation = component.vm.resolveFlowCalculationDetail(hits[0].id)?.evaluation
          if (round >= 0) {
            samples.push(duration)
            counts.push(count)
            values.push({
              total: evaluation?.total,
              effectRecordCount: evaluation?.effectRecords?.length ?? 0,
              panelTraceCount: evaluation?.panelStageTraces?.length ?? 0,
              rawContributionCount: evaluation?.panelStageTraces?.reduce((sum, trace) => sum + trace.contributions.length, 0) ?? 0,
              cachedEntries: loading.modules.hitEvalCache.hitEvalCacheDebugStats().size,
              heapUsedBytes: process.memoryUsage().heapUsed,
            })
          }
        }
        results.push({ mode, path: `lifecycle-${name}`, samplesMs: samples, medianMs: median(samples), counts, values })
      } finally { component.unmount() }
    }
  }
  const unchanged = loading.verify()
  await loading.server.close()
  return { results, sourceHashes: loading.sourceHashes, unchanged, fixedInput }
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
  const eventCounts = []
  for (const mode of ['ordinary', 'extra-team']) {
    const effects = [
      createEffect({ id: 'stage-atk', stat: 'atk', value: 50, enabledDefault: true, applyTarget: 'team' }),
      createEffect({ id: 'stage-convert', stat: 'anomalyReleaseMult', kind: 'convert', enabledDefault: true, applyTarget: 'team',
        convert: { from: 'atk', panelSource: 'final', ratioPercent: 1, initialBase: 0, cap: null } }),
    ]
    const f = loading.modules.harness.eventFixture({ mode, damageType: 'anomalyRelease', effects })
    const hit = { ...f.hits[0], triggerAgentId: 'power' }
    eventCounts.push([mode, measure(() => loading.modules.skillFlowCalculation.evaluateSkillFlowHit(f.context, null, hit, true))])
  }
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
    ...eventCounts.map(([mode, count]) => [
      `${mode} 真实异放/来源转模的同视图阶段至多一次`,
      count.op > 0 && Object.entries(count.opsByIdentity).filter(([key]) => key.startsWith('["traced"')).every(([, value]) => value === 1),
      JSON.stringify(count.opsByIdentity),
    ]),
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
    const child = spawnSync(process.execPath, [SELF, '--child', '--rounds=1', ...args.filter(arg => arg.startsWith('--scheme=') || arg.startsWith('--rolls='))], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
    const line = String(child.stdout ?? '').split('\n').find((item) => item.startsWith('__CC_JSON__'))
    if (child.status !== 0 || !line) {
      broken.push(i + 1)
      console.error(`冷态样本 ${i + 1} 无效：${String(child.stderr ?? '').slice(-2000)}`)
      continue
    }
    coldSamples.push(JSON.parse(line.slice('__CC_JSON__'.length)))
  }
  const hotChild = spawnSync(process.execPath, [SELF, '--child', '--rounds=7', '--warmup=1', ...args.filter(arg => arg.startsWith('--scheme=') || arg.startsWith('--rolls='))], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  const hotLine = String(hotChild.stdout ?? '').split('\n').find((item) => item.startsWith('__CC_JSON__'))
  const hot = hotChild.status === 0 && hotLine ? JSON.parse(hotLine.slice('__CC_JSON__'.length)) : null

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

  console.log('\n== 效果运算计数（冷态首样本首轮） ==')
  for (const item of coldSamples[0]?.results ?? []) {
    const count = item.counts[0] ?? {}
    console.log(
      `  ${`${item.mode}/${item.path}`.padEnd(28)} judge=${count.judge ?? 0} op=${count.op ?? 0} ops=${JSON.stringify(count.opsByEffect ?? {})} ${JSON.stringify(count.counters ?? {})}`,
    )
  }
  console.log('\n== 效果运算计数（热态最后一轮，K15 门禁：热态应为 0） ==')
  for (const item of hot?.results ?? []) {
    const count = item.counts[item.counts.length - 1] ?? {}
    console.log(
      `  ${`${item.mode}/${item.path}`.padEnd(28)} judge=${count.judge ?? 0} op=${count.op ?? 0} counters=${JSON.stringify(count.counters ?? {})}`,
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
    JSON.stringify({ nodeVersion: process.version, cpu: os.cpus()[0]?.model, system: [os.platform(), os.release(), os.arch()],
      oid: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: FRONTEND_ROOT, encoding: 'utf8' }).trim(),
      diffHash: crypto.createHash('sha256').update(execFileSync('git', ['diff', 'HEAD'], { cwd: FRONTEND_ROOT })).digest('hex'),
      packageHash: sha256(path.join(FRONTEND_ROOT, 'package-lock.json')),
      samples, broken, coldSamples, hot }, null, 2),
    'utf8',
  )
  console.log(`原始样本：${outFile}`)
  const hotFailures = (hot?.results ?? []).filter(item =>
    (item.path === 'event-preview-cached' || item.path.startsWith('component-') || item.path === 'lifecycle-projection-evicted') &&
    item.counts.some(count => count.op !== 0 || (count.counters.replay ?? 0) !== 0))
  const duplicateOperations = [...coldSamples, hot].filter(Boolean).flatMap(run => run.results).flatMap(item =>
    item.counts.flatMap(count => Object.entries(count.opsByIdentity ?? {}).filter(([key, value]) => key.startsWith('["traced"') && value > 1)))
  const validSamples = coldSamples.length === samples && hot != null && hotChild.status === 0
  console.log(`热态共享结果门禁：${!validSamples ? '未验证（样本无效）' : hotFailures.length === 0 ? 'PASS' : 'FAIL'}；逐视图阶段恰好一次：${!validSamples ? '未验证（样本无效）' : duplicateOperations.length === 0 ? 'PASS' : 'FAIL'}`)
  if (broken.length || !hashesStable || !hot || hotChild.status !== 0 || hotFailures.length || duplicateOperations.length) process.exitCode = 1
}
