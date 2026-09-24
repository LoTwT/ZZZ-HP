# 增益体系改造：构建与筛选分离（施工规格）

> **状态**：**待用户确认后施工**（2026-09-24 出规格）。
> **上游**：方案与评审在仓库外 —— `dev-docs/buff-build-refactor.md`（方案）、
> `dev-docs/buff-build-refactor-review.md`（两轮评审 P1–P7 / N1–N3）。
> 本文是**施工规格**：字段、接口、判定规则、改动清单、缓存与失效、验收。冲突时以本文为准，
> 但**动手前仍要读一遍上述两份**。

---

## 0. 非目标（本次不做）

- 不改伤害公式、乘区与求值器（`resolveEffectsToMods` 及各面板）；
- 不改行级例外的**存储键**（`disabledBlockIds` / `disabledEffectIds`）与减法语义；
- 不改全局勾选（`buffSelection`）的结构；
- **额外增益并入（阶段 3）本次不实现**，只在本规格 §9 预留接口。

## 1. 不变量（施工必须保持）

1. **伤害数字逐位不变**（阶段 1、2 的硬指标）；
2. `collectAllBuffEffects(ctx)` 的**签名与对外语义不变**（只换内部实现）；
3. 消费层 mods 缓存的**键不变**（`buildBuffCatalogKey` 现有 9 个部件）；
4. 构建产物**冻结**：不给"就地改对象"的入口；多消费点共享同一份。

## 2. 数据模型

### 2.1 `CollectedEffect` 新增两个字段

```ts
/** 适用槽位集合：这条增益作用于哪些槽位（升序、去重） */
applicableSlots: number[]
/** 提供者槽位：这条是谁给的；null = 无主（邦布 / 场地） */
providerSlot: number | null
```

**折算规则**（阶段 1 在**构建时**算，属纯配置）：

| 情形 | `applicableSlots` |
|---|---|
| `effect.applyTarget === 'team'` | 当前全部槽位 `[0 … slotCount-1]` |
| `applyTarget === 'self'` 且能解析出槽位 | `[该槽位]` |
| `applyTarget === 'self'` 但解析不出槽位（兜底） | 当前全部槽位 —— **与旧行为一致**（旧实现解析不出即当"全队"） |
| 邦布 / 场地来源 | 当前全部槽位 |

`slotCount = slotLabels.length = teamSlots.length`（本仓库恒为 3，但**不得写死**）。

### 2.2 构建产物

```ts
export interface BuffBuild {
  /** 全量条目：与"主角"无关，谁都读这一份 */
  entries: CollectedEffect[]
  /** 只含配置的键 */
  key: string
}
```

## 3. 接口

### 3.1 构建层（新增）

```ts
/** 纯配置输入（不含任何运行期输入） */
export interface BuffBuildConfig {
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  wengines: WengineDoc[]
  driveDiscs: DriveDiscDoc[]
  bangboo: BangbooDoc | null
  bangbooRefine: number
  environmentBuffs: EnvironmentBuffEntry[]
  extraGains: ExtraBuffGain[]
}

export function buildBuffCatalog(config: BuffBuildConfig): BuffBuild
export function invalidateBuffBuildCache(): void
```

- **键**：`buildBuffConfigKey(config)` —— **只含** `teamSlotsKey`、`bangbooKey`、`envKey`、`extraGains`；
  **不得**含 `mainSlotIndex` / `buffSelection` / `skillContext` / `rowBuffOverride` / `restrictToSlotIndex` / `excludeBangboo`。
- **缓存**：模块级 `Map`，上限沿用现有 `BUFF_CATALOG_CACHE_LIMIT` 的策略；
  **产物放非响应式容器**（模块级），确需进 Vue 时用 `markRaw`（本仓库此前未用过，属新引入）。

### 3.2 消费层（新增，唯一筛选入口）

```ts
/** 从构建产物里取"这次给谁算"要用的条目 */
export function selectEntriesForSlot(input: {
  build: BuffBuild
  slotIndex: number
  rowBuffOverride?: FlowBuffOverride | null
  restrictToSlotIndex?: number | null
  excludeBangboo?: boolean
}): CollectedEffect[]

/** 行级减法判定（唯一实现；供目录条目与阶段 3 的额外增益共用） */
export function isEntryDisabledByRowOverride(
  entry: CollectedEffect,
  override: FlowBuffOverride | null | undefined,
): boolean
```

### 3.3 既有函数改造

- `collectAllBuffEffects(ctx)`：签名不变，内部改为
  `selectEntriesForSlot({ build: buildBuffCatalog(configOf(ctx)), slotIndex: ctx.mainSlotIndex, … })`；
- **折算函数下沉 utils（N1）** —— 页面与 utils 必须共用一份：

```ts
/** 行受益者槽位（持有者 + 异常强度提供者 + 触发者 → 槽位下标） */
export function resolveRowBeneficiarySlots(input: {
  hits: ResolvedHit[]
  teamSlots: TeamSlot[]
}): Map<string, number[]>
```

  页面 `SkillFlowSection.vue` 的 `flowBuffRowBeneficiarySlots` 改为调用它；utils 侧现有内联实现
  （`optimalAffixAlloc.ts:628`）同样改用它，**禁止出现第二份**。

## 4. 判定规则（唯一事实来源）

| 判定 | 规则 |
|---|---|
| 这条增益对"给槽位 k 算"是否相关 | `k ∈ entry.applicableSlots` |
| 行级例外 | `!(disabledEffectIds.includes(effectId) || disabledBlockIds.includes(blockKey))` |
| 增益表判灰 | `行受益者槽位 ∩ 适用槽位集合 ≠ ∅`，且上面两条成立 |
| 全局未启用（灰） | `isEffectEnabled(effect, selection)` —— **不进构建层**，消费层判 |
| 转模类"全队"增益取值 | 按 **`providerSlot`** 的面板折算（`mainAgentTeamConvertReadsPanel` 口径不变） |

## 5. 改动清单

| 文件 | 改什么 | 风险 |
|---|---|---|
| `src/utils/panelBuffCalc.ts` | 新增 §2.1 字段填充；拆键（配置键 / 消费键）；新增 §3.1 / §3.2 接口；`collectAllBuffEffects` 内部换实现 | 中（结算路径） |
| `src/utils/flowBuffTable.ts` | 受益者 / 「生效者」改读 `applicableSlots`（等价改写） | 低 |
| `src/utils/optimalAffixAlloc.ts` | 内联折算改用 `resolveRowBeneficiarySlots` | 低 |
| `src/components/calculator/SkillFlowSection.vue` | 折算改调共用函数 | 低 |
| `src/components/calculator/DamageCalcPage.vue` | 表的并集改读构建产物（**可选、独立小步**） | 低 |
| `scripts/test-flow-buff-table-columns.mjs` | 扩展：`applicableSlots` 折算用例 | 低 |
| `scripts/test-buff-build-parity.mjs`（新） | 「逐位不变」快照对照 | 低 |

## 6. 缓存与失效

- **构建层键**：只含配置（§3.1）；
- **失效入口**：`invalidateBuffBuildCache()`；现有 `invalidateBuffCatalogCache()` 要**同时清构建层**
  （管理端定义变化 —— 技能组导入、`gain:` 库重导 —— 都走它）；
- **不触发重建**：角色面板 / 词条导入（转模值按提供者面板**消费时**算）；
- **消费层键**：保持现状 9 部件不动。

## 7. 前置动作（开工第一步，四件）

1. **折算函数下沉 utils**（§3.3，N1）——不做则阶段 2 判灰必然两处漂移；
2. **「逐位不变」快照夹具**：方案集 = `scheme-dan.json` + 一个约 96 hit 的方案；改前存
   「每行数字 + 总伤」JSON；**快照写 `.dim\tmp\`** —— 实测 `.dim` 与 `.workbuddy` **不是同一份**
   （2026-09-24 写穿测试：往 `.dim\tmp\` 写文件，`.workbuddy\tmp\` 查不到），别两处都写；
3. **性能门槛脚本就位**：`bench-solve.mjs` / `probe-affix-perf.mjs` / `probe-row-override-cost.mjs`；
4. **调用点清单**：`collectAllBuffEffects` 现有十余处调用点逐一确认（签名不变 → 预期零改动）。

## 8. 验收

**阶段 1（加字段 + 折算下沉）**

- 伤害**逐位不变**（快照对照）；
- 增益表列头「生效者」与判灰**不变**；
- `scripts/test-flow-buff-table-columns.mjs` 扩展用例通过；`vue-tsc` / `eslint` 绿。

**阶段 2（构建与筛选分离）**

- 同阶段 1 的逐位不变；
- **三条性能门槛**（改前改后各跑一次）：
  `bench-solve.mjs` 30 词条求解中位数 **≤ 916 ms**；`probe-affix-perf.mjs` 收益表首屏 **≤ 68 ms**
  （含曲线 262 ms 一并记）；`probe-row-override-cost.mjs` 42 行带例外 **≤ 3.45 ms**
  （取该行中位数；脚本自带 10 次预热 + 10 次评估 × 3 轮交错）；
- 现有 47 个 `test-*.mjs` 与各探针全绿。

**回滚**：每阶段单独提交；`collectAllBuffEffects` 的内部替换是单点改动，回滚 = revert 该提交，
**不引入运行时开关**（签名不变，无需双跑开关）。

## 9. 阶段 3（额外增益并入）接口预留 —— 本次不实现

- 额外增益进入**同一份构建**（`extraGains` 已在配置键里；`applicableSlots` 用它自己的作用槽位折算）；
- 删除 `collectExtraGainEffects` 与"提前折成数字"的通道（`mergeExtraModsForEvent` 各调用点），
  否则同一条被算两遍；
- **定义结构允许扩展**（要能表达"来源 ≠ 作用范围"），**老字段必须能读**；行级例外的**键名不动**；
- 补齐"完整版"能力：招式多选、属性限定、叠层、转模、开关位置（加入即已勾选）。

## 10. 相关文档

- 方案与评审：仓库外 `dev-docs/buff-build-refactor.md`、`dev-docs/buff-build-refactor-review.md`
- 功能背景与逐轮证据：仓库外 `dev-docs/skill-buff-per-row.md`（第十五～十七轮）
- 性能基线：仓库外 `dev-docs/unified-effect-pipeline.md`「性能基线」
- 代办索引：仓库外 `dev-docs/TODO.md` `T22`
