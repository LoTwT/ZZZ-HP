# 求解链路性能规格

> **范围**：ZZZ-HP 角色计算器 · 「最优词条分配」求解链路（`affixOptimizer` → `evaluateAffixCounts*` → 事件求值 → 面板增益收集）。
> **用途**：把 2026-10-27 的性能评审稿（`calc-solve-perf-review.md`，仓库外）收敛为可施工、可验收的规格：定义**慢在哪**、**改什么**、**什么不许改**、**怎么验收**。
> **不在本文定义**：伤害公式（见 [`CALCULATOR_FORMULAS.md`](../../CALCULATOR_FORMULAS.md)）、增益语义（见 [增益功能链路](./buff-pipeline.md)）、搜索策略与预算口径（见开发目录 `dev-docs/词条最优分配.md`）。
> **状态**：已评审，未施工。数值与结构结论已按本分支源码核对；性能数字见 §2 的复核状态说明。

---

## 1. 适用范围与非目标

### 适用于

- 冷启动求解（`solveOptimalAffixAllocationAsync`）与 `bench-solve` 基线。
- 求解期被反复调用的共享下游：上下文签名、面板增益目录缓存、空对象分配。
- 三者都是**面板侧与最优侧共用**的代码，改动必然同时影响两条链路。

### 非目标

- 不为「上一轮记账/预览改造带来的约 35–40 ms」做任何专项优化（理由见 §8）。
- 不改任何数值结果。**总伤仍是 `53665119`** 是全流程硬门禁（§9）。
- 不新建「求解专用快路实现」（§8 第 2 条）。
- 不删除词条侧的预览 / 逐项展示功能（§8 第 3 条）。
- 本期不处理 `affixEvalCache` 命中率问题（§7，先查原因再立项）。

---

## 2. 现状基线（可复现）

| 项 | 值 | 复核状态 |
|---|---|---|
| 命令 | `cd zzz-hp && npx vite-node scripts/bench-solve.mjs` | 本期已执行 |
| 中位耗时 | **1914 ms**（5 轮：2137 / 1948 / 1808 / 1705 / 1914） | 本期已复核（Node v24.22.1） |
| 总伤害 | **53665119** | 本期已复核，5 轮一致 |
| 改造前 A/B 中位 | 1698.5 → 1737 ms（+38 ms，p=0.008） | 报告给出，**本期未复核**（需两版 worktree 交替跑） |
| 求解期调用量 | 643 次评估尝试 / 473 次真算 / 8.4 万次 mod 合并每轮 | 报告给出，**本期未复核**（需 V8 覆盖率） |
| 热点分布 | 词条目录收集/合并 58.9%、键与签名序列化 16.3%、逐事件求值 8.3%、伤害公式 1.0% | 报告给出，**本期未复核** |

> 基线只作本分支的对比锚点。同一台机器上耗时随系统负载漂移 ±10%（§2 的 5 轮跨度即 1705–2137 ms），所以**收益一律用「同机、同轮数、前后交替」测**，不跨机器比较绝对值。

---

## 3. 规格结论（上层约束）

1. **R1 投入方向**：优化对象是 profile 里的既有浪费（约 700 ms 量级），不是改造引入的 40 ms。
2. **R2 三个根因**按顺序施工：§4 上下文签名 → §5 目录缓存键与合并 → §6 空对象 churn。
3. **R3 数值不变**：任何一步都必须通过「总伤 = 53665119」与逐文件测试全绿。
4. **R4 契约不许破坏**：缓存键/签名必须保持现有**内容维度**（每条历史缺陷注释记录的字段一个都不能少），只允许改变**计算这些维度的手段**。
5. **R5 共享不分裂**：改动落在共享函数内，用开关或参数区分，不另写一份求解专用实现。

---

## 4. 根因一：上下文签名的 `eventState` 算在缓存查询之前

### 4.1 事实（已按源码核实）

`zzz-hp/src/utils/optimalAffixAlloc.ts:2192-2205`：

```ts
const affixCtxSignatureCache = new WeakMap<OptimalEvalContext, { eventState: string; signature: string }>()

function affixEvalContextSignature(ctx: OptimalEvalContext): string {
  const eventState = JSON.stringify([            // ← 每次调用无条件重算
    ctx.hits?.map(buildHitEvalFingerprint),
    ctx.panelContext.teamSlots.map(slot => [slot.agentId, /* … */]),
  ])
  const memo = affixCtxSignatureCache.get(ctx)   // ← 记忆化在这一步之后才生效
  if (memo?.eventState === eventState) return memo.signature
  const signature = computeAffixEvalContextSignature(ctx)
  affixCtxSignatureCache.set(ctx, { eventState, signature })
  return signature
}
```

- `buildHitEvalFingerprint`（`zzz-hp/src/utils/hitEvalCache.ts:105-130`）是**递归键排序**的 `stableJson`，覆盖 20 个字段（含 `multOverrides`、`panelMods`、嵌套 `skill.*`），单条成本远高于字符串拼装。
- miss 时 `computeAffixEvalContextSignature`（同文件 `2207-2308`）在 `2208` 行**再**执行一次 `ctx.hits?.map(buildHitEvalFingerprint)` —— 同一轮内同一批 hit 的指纹被算了两遍。
- `affixEvalContextSignature` 由 `resetAffixEvalCacheIfNeeded`（`2323-2336`）在**每次** `evaluateAffixCountsWithCacheInfo`（`2593`）开头调用，即每轮评估至少一次。

**结论**：报告 §2 的描述成立。这是「记忆化存在但判据本身最贵」的典型形态，属纯浪费。

### 4.2 目标行为

- 一次求解内，`ctx` 不变时，`affixEvalContextSignature` 的摊销成本应为 O(1)（一次 `WeakMap` 查询）。
- 单条 hit 的指纹在同一求解内**只算一次**。
- 签名**值**保持不变（`R3`），因此下游缓存键、短上下文 id（`affixEvalCacheCtxKey`）语义不变。

### 4.3 允许的实现方式（任选或组合，按风险递增）

1. **单 hit 指纹记忆化**（推荐首选）：`WeakMap<ResolvedHit, string>` 保存 `buildHitEvalFingerprint` 结果；`eventState` 改为按数组顺序拼装已缓存的指纹串，并把这份结果传入 `computeAffixEvalContextSignature`，消除 miss 时的重复计算。
   - 前提：hit 对象在求值期间不可变。**必须**用断言/测试证明（见 4.5）。
2. **廉价变更检测**：缓存上次的 `hits` 数组引用与 `teamSlots` 内容令牌；引用/令牌未变则直接返回上次 `signature`，完全跳过 `eventState` 构造。
   - ⚠️ **不得**对 `ctx.panelContext.teamSlots` 数组做对象身份记忆化 —— 见 4.4。

### 4.4 硬约束：`teamSlots` 不许按对象身份缓存（有历史事故）

`panelBuffCalc.ts:2442-2459` 记录了 2026-09-10 的实测事故：真实 UI 里 `DamageCalcPage.vue` 的 `teamSlots` 是 `reactive()` 数组，**全生命周期只有一个实例**，换人/换音擎/改影画都是**就地赋值**，而 `buildOptimalEvalContext` 的 `deepUnwrapReactive` 用 `toRaw` **不改变数组身份**。按身份缓存会把槽位键永久冻结在首次计算那一刻：

| 操作 | 真值 | 身份缓存路径 |
|---|---|---|
| 队友影画 0→6 | 62114191 → 71083794 | 62114191 → 62114191（错） |
| 队友 4 件套 | 58731561 → 58891841 | 58731561 → 58731561（错） |

因此 4.3 的方式 2 若涉及 `teamSlots`，只能比较**内容**（`agentId`/`rank`/`wengineId`/… 拼装令牌，即复用 `teamSlotsKey` 的形态），不能比较引用。`ctx.hits` 未发现就地修改（`optimalAffixAlloc.ts` 内对 `hits` 只读），但这一条**必须由测试锁定**，不能只靠阅读。

### 4.5 风险与验收

| 风险 | 处置 |
|---|---|
| hit 被就地修改 → 指纹过期 → 命中旧缓存 → **数值错** | 新增测试：同一 hit 对象在两次求值间改字段，断言签名改变（参照 `scripts/test-affix-cache-key.mjs` 的写法） |
| 改为引用比较后，UI 就地改 `teamSlots` 不失效 | 复用 `scripts/probe-inplace-team-mutation.mjs` 的用例作为门禁（影画 0↔6、4 件套切换） |
| 签名漏字段 | 现有 `scripts/test-env-buff-cache-key.mjs`、`test-affix-cache-key.mjs` 必须全绿；对比改动前后 `signature` 串逐字节相同 |

**预期收益**：报告给出 −280…300 ms/轮（−15%），本期未复核。验收以实测为准，不达成就回滚。

---

## 5. 根因二：目录缓存命中后仍重建键 + 重新 merge

### 5.1 事实（已按源码核实，与报告有两处差异）

`zzz-hp/src/utils/panelBuffCalc.ts:2839-2865`：

```ts
export function collectPanelBuffMods(ctx: PanelCalcContext): BuffStatModifiers {
  if (ctx.trace) return collectPanelBuffModsTraced(ctx)      // 求解路径不进入
  const key = buildBuffCatalogKey(ctx)                       // ① 命中也要算
  let entry = buffCatalogCache.get(key)
  if (!entry) { /* 未命中：整份重建 */ }
  touchBuffCatalogEntry(key, entry)                          // ② LRU 触点
  ensureNonConvertMods(entry, ctx)                           // ③ 命中时是 no-op
  if (ctx.skipConvert) return entry.nonConvertMods ?? createEmptyBuffStatModifiers()
  return mergeBuffStatModifiers(                             // ④ 命中仍新建对象
    entry.nonConvertMods ?? createEmptyBuffStatModifiers(),
    collectConvertOnlyMods(entry.packs, ctx),                // ⑤ 且 convert 侧每次重算
  )
}
```

实测成本（报告给出，未复核）：键侧 `buildBuffCatalogKey` ≈ 148.7 ms（7.6%），合并侧 `mergeBuffStatModifiers` ≈ 309.5 ms（15.8%，84k 次/轮，3.7 µs/次）。合并成本可从源码解释：`mergeBuffStatModifiers`（`calculatorUi.ts:744-762`）每次做一次展开 + **74 个字段**（`BUFF_STAT_FIELDS`）逐项累加，因此 3.7 µs/次是合理的量级。

**与评审稿的差异（需按本节为准）**

1. **`stringifyKeyPart` 已经做了对象身份记忆化**（`panelBuffCalc.ts:2427-2437` 的 `partKeyCache`，2026-09-10 落地）。所以报告 §3「键 memo，10 行，立得 7.6%」不是新增改动 —— 那 148.7 ms 是**已 memo 之后**的剩余，构成是 `teamSlotsKey` 拼装、`bangbooKey`、`environmentBuffsKey` 的 `JSON.stringify`、以及 10 段 `join(KEY_SEP)` 本身。
2. 报告引用的片段缺少 `if (ctx.skipConvert)` 短路，实际代码已有；不影响「命中仍 merge」这一结论。

### 5.2 目标行为

- 缓存命中时，若 `convert` 侧无覆盖，**不得**新建 mods 对象，直接返回 `entry.nonConvertMods`。
- 缓存命中时，`buildBuffCatalogKey` 的重复部分（按身份不变的部件）不得重算。
- 数值不变：返回对象内容与现状逐字段相同。

### 5.3 允许的实现方式

| 步骤 | 做法 | 风险 |
|---|---|---|
| 2-1 | 键部件记忆化补齐：对 `environmentBuffsKey` 等**内容不变**的集合做令牌化（不可用数组身份，见 4.4）；`teamSlotsKey` 保持每次拼装（成本已很低）或用内容令牌 | 低 |
| 2-2 | **无 convert 覆盖时直接返回 `entry.nonConvertMods`**，不 merge、不分配 | 中 |
| 2-3 | 缓存最终合并结果，键 = `(catalogKey, convert 输入令牌)` | 中高 |

### 5.4 硬约束与前置审计

- **别名审计（2-2/2-3 的前置条件）**：必须确认下游不会**写** `collectPanelBuffMods` 返回的对象。当前 `mergeBuffStatModifiers` 每次返回新对象，掩盖了任何别名写；改为共享对象后，一次写入就会污染缓存。审计范围：`computeFinalPanel`、`buildEventPanelContext`、`resolvePackMods*`、`affixPanelCalc` 全部调用点。
- **convert 维度**：`collectConvertOnlyMods` 依赖 `ctx.skillContext`、槽位等，若缓存最终合并结果，键必须包含 convert 输入（`skillContext` 已在 `catalogKey` 内，需确认是否足够）。
- **R4**：`buildBuffCatalogKey` 的 10 个组成部分一个都不能删（`rowBuffOverrideKey`、`environmentBuffsKey` 的内容维度等都有事故记录）。

**预期收益**：报告给出合计 −450 ms/轮（−23%），未复核。

---

## 6. 根因三：空对象 / 默认面板分配 churn

### 6.1 事实（已按源码核实）

- `createEmptyBuffStatModifiers()`（`calculatorUi.ts:542`）每次返回含 74 个字段的**新字面量**；`buffEffect.ts:185` 另有局部 `emptyMods()`。报告称每轮 59,381 次、自身 5.2%。
- `fillPanelStatsDefaults()`（`types/calculatorPanel.ts:340-342`）实现为 `{ ...DEFAULT_EXTERNAL_PANEL, ...panel }`，**每次返回新对象**；`types/calculatorPanel.ts:201-207` 的注释早已记录其实测占 9.8% CPU。求解路径上它由 `panelBuffCalc.ts:712-724`、`3183`、`3249`，`optimalAffixAlloc.ts:1156-1158` 等处高频调用。

### 6.2 目标行为

- 空 mods / 默认面板在**只读**语义下共享一份冻结实例；需要写入的调用点显式复制。
- 数值不变。

### 6.3 风险与约束

- **中风险**：`Object.freeze` 只能挡住严格模式下的写入；被冻结对象的别名写入在非严格上下文会**静默失败**（而不是报错），表现为数值不动。必须配合断言/测试。
- 分类处置：
  - `mergeBuffStatModifiers(target, source)` 已经 `{ ...target }` 复制 target，**读 source**，因此 source 可安全共享冻结实例。
  - `fillPanelStatsDefaults` 的返回被 `...spread` 到下游的调用点可共享；被直接赋值字段的调用点必须复制（逐个核对 §6.1 列出的 6 处调用）。
- 与 5.4 的别名审计共用同一份结论。

**预期收益**：报告给出 −120…190 ms/轮，未复核。

---

## 7. 附带发现：`affixEvalCache` 命中率仅 26.4%（本期不立项）

- 事实（已核实代码）：上限 `AFFIX_EVAL_CACHE_MAX = 800`（`optimalAffixAlloc.ts:2023`）；键 = 短上下文 id + 词条数/增量/每档/额外增益指纹（`2150-2157`）；清除时机 = 上下文签名变化（`2323-2336`）。因此**命中率低不是容量淘汰**，而是键粒度或评估顺序问题（例如 `panelDeltas`/`extraGains` 进了键但实际不影响结果，或同一组合被评估两次）。
- 结论：这是潜在的**第四条、可能更大**的收益，但原因未查明，本期只登记、不施工。
- 立项门槛：先出「重复键的成因分析 + 命中率可提升到多少 + 数值不变证明」，再并入 §9 门禁。

---

## 8. 明确不做

| 提案 | 不做理由 |
|---|---|
| 专项优化「改造带来的 40 ms」 | 收益 40 ms，风险在主干；同一次 profile 里有 700 ms 量级的现成浪费，性价比差 10–20 倍。且该差值精度只有 ±50 ms 不确定度（报告 σ32–45），不足以作为优化目标 |
| 给求解另写一条「快路」实现 | 会重新引入「两套算法各算各的」。本轮改造消灭的正是它（预览 0 次 vs 25 次调用就是这么来的）。**共享 + 开关**可以，「另写一份」不行（R5） |
| 删掉词条侧预览/展示 | 求解全程 `includeDetails=false`、`ctx.trace` 为 null（`optimalAffixAlloc.ts:1345`、`panelBuffCalc.ts:2842`），删了省不到时间，只减功能 |

---

## 9. 执行顺序与验收门禁

### 顺序

1. §5.3 步骤 2-1（键部件补齐）→ 量收益 → 合并。
2. §4.3（签名廉价判据）→ 量收益 → 合并。
3. 别名审计（5.4）→ §5.3 步骤 2-2 → §6。
4. §7 立项评估（独立进行，不阻塞 1–3）。

**每一步单独提交、单独度量、可独立回滚**（项目红线：一件事一个提交）。

### 门禁（全部离线可跑，在 `zzz-hp/` 下）

| 门禁 | 命令 / 判据 |
|---|---|
| 数值不变 | `npx vite-node scripts/bench-solve.mjs`：**总伤害 = `53665119`**，且「每轮结果一致 = true」 |
| 性能不退化 | `npx vite-node scripts/bench-calc-chain.mjs` 的 `affix-candidate` / `affix-sweep` 冷态中位不退化 |
| 单元测试 | `scripts/test-*.mjs` 全绿（当前 86 个） |
| 缓存键契约 | `scripts/test-affix-cache-key.mjs`、`scripts/test-buff-catalog-cache.mjs`、`scripts/test-env-buff-cache-key.mjs` 全绿 |
| 就地修改防护 | `scripts/probe-inplace-team-mutation.mjs` 用例通过（§4.4） |
| 类型 / 风格 / 构建 | `vue-tsc --noEmit -p tsconfig.app.json`、`eslint src scripts`、`vite build`、`git diff --check` |
| **新增**：求解期不记账 | 断言求解路径 `createEventTraceCollector` 调用数 = 0，防止将来有人在 `evaluateAffixCountsUncached` 里打开 `includeDetails`，把记账塞进数百次评估 |

### 度量方法（避免自我欺骗）

- 同机、同轮数、**前后交替**（A/B/A/B…）至少 16 组，取中位数与 95% CI；报告单次配对不确定度 ±50 ms。
- 收益不达标（低于预期的一半）就回滚，不叠加后续步骤。

---

## 10. 风险登记

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| 1 | hit 就地修改导致指纹过期 | 数值错（静默） | §4.5 新增断言 |
| 2 | `teamSlots` 按身份记忆化 | 数值冻结（已发生过一次） | §4.4 明确禁止 + probe 用例 |
| 3 | 返回 mods 被下游写入（别名） | 缓存污染（静默） | 5.4 别名审计 + 冻结/断言 |
| 4 | 冻结空对象被写入，非严格模式静默失败 | 数值不动 | 断言 + 逐调用点核对 |
| 5 | 签名/键漏维度 | 跨上下文串值（历史上多次） | R4 + 现有缓存键测试 |
| 6 | 性能测量噪声被当成收益 | 误判 | §9 度量方法 |

---

## 11. 证据与复现

- 评审稿原始证据（**不进仓库**，在作者工作区）：`artifacts/calc-chain-impl-20261026/s7-solve-profile.md`（两版热点对照、覆盖率、A/B 统计）；脚本 `diff-cpuprofile.mjs`、`summarize-profiles.mjs`、`analyze-solve.mjs`、`ab-stats.mjs`、`ab-cpu.ps1`、`cov-hook.cjs`。
- 方法要点：两版各用临时 worktree（S0 = `a487e2c`，`node_modules` 用 junction 借主仓）；`node --cpu-prof` 抓 profile；调用次数用 V8 精确覆盖率（`-r cov-hook`）逐函数比对。
- 本期已复核项：§2 基线（命令可直接复现）、§4/§5/§6 的代码结构与行号、§7 的上限与清除时机、§9 门禁命令的存在性（`bench-solve.mjs`、`bench-calc-chain.mjs` 的 `affix-candidate`/`affix-sweep` 模式、`test-*.mjs` 数量）。
- 环境要求：Node ≥ 20.12（`rolldown` 依赖 `node:util.styleText`）。

---

## 12. 对评审稿的勘误

| 评审稿原文 | 实际情况 |
|---|---|
| §3「键 memo（约 10 行，低风险）：`stringifyKeyPart` 结果按 `WeakMap` 记忆化 → 立得 7.6%」 | `partKeyCache`（`panelBuffCalc.ts:2427-2437`）**已实现**，该 10 行不是新增改动；剩余 148.7 ms 是 memo 之后的开销 |
| §3 引用 `collectPanelBuffMods` 声称命中后一定 merge | 命中路径已有 `if (ctx.skipConvert)` 短路（`2860`）；非 skipConvert 才 merge，结论不变 |
| §2 改法 2「先比 `ctx.hits` 数组引用 + `teamSlots` 的 agentId/element，引用相同就直接复用」 | `teamSlots` 在真实 UI 中就地赋值且引用不变（`panelBuffCalc.ts:2442-2459` 事故记录），引用比较会得到错误结果；必须比较**内容** |
| §1「`resolveConfigurationParameters` 0 次调用」 | 该函数在当前代码库中不存在，「0 次」是平凡为真 |
| §1「逐项相同（差异 ≤2 次/2 轮）」等覆盖率数字 | 本期未复核；如需作为规格依据，需重跑 `cov-hook` |
