# ZZZ-HP 分支介绍与更新日志

对照本地 / 远程分支用途与内容。站点首页更新日志由 `zzz-hp-backend/scripts/seed_changelog.mjs` 写入数据库；本文件面向开发与发版选分支。

**维护约定**（见 `.cursor/rules/git-workflow.mdc`、`CONTRIBUTING.md`）：新建分支或该分支首次功能提交前，先在本文件补一条介绍；版本线面向用户时同步改 `seed_changelog.mjs`。勿另建零散分支 `.md`。

**当前推荐发布线**：`3.1.6.3`（合入 handoff1 稳定性批 + 拼贴 v4，保留本地密钥闸门 / 上传加固）。  
**上一完整线**：`3.1.6.1` / `3.1.6.2`（尖端在合入前相同）。  
**稳定主干**：`main`（含 3.1.6 级管理端鉴权，尚未含 UI 重设计与后续安全加固）。

---

## 一、版本发布分支

### `main`

| 项 | 说明 |
|---|---|
| **定位** | 稳定主干，默认合入目标 |
| **尖端** | 管理端写接口鉴权与部署层加固（与 `3.1.6` 同级安全修复） |
| **含** | requireAdmin、Helmet / CORS / 限流、生产错误脱敏等 |
| **不含** | 绝区零风格 UI、`3.1.6.2` 上传/路径/OTP 加固、密钥扫描闸门 |
| **建议** | 日常 PR 合入此处；发版前再决定是否快进/合并 `3.1.6.1` |

### `3.0.9.1`

| 项 | 说明 |
|---|---|
| **定位** | 历史四段版本线（不再新增此类分支名） |
| **内容** | 3.0.9 计算器增益效果块体系 + 云部署 `pack-update` 打包脚本 |
| **状态** | 归档保留，勿在此继续开发 |

### `3.1.1`

| 项 | 说明 |
|---|---|
| **定位** | 流明 / 蕾米埃尔早期线 |
| **内容** | Remiel 种子与 upsert 工具；流明与多产生者事件结算基础 |
| **状态** | 历史版本，功能已并入后续线 |

### `3.1.2`

| 项 | 说明 |
|---|---|
| **定位** | 耀变结算与危局展示 |
| **内容** | 蕾米埃尔本人耀变公式、敌方抗性配置；危局 roomType / 图表提示修正 |
| **状态** | 历史版本 |

### `3.1.3`

| 项 | 说明 |
|---|---|
| **定位** | 伤害模式缓存与管理端可视化 |
| **内容** | 自定义伤害模式按队伍缓存；管理端内容编辑与 changelog 文档 |
| **状态** | 历史版本 |

### `3.1.6`

| 项 | 说明 |
|---|---|
| **定位** | 安全加固基线 + 伤害事件体验 |
| **package** | `3.1.6` |
| **更新要点** | |
| | · 管理端写接口统一 `requireAdmin` |
| | · Helmet、CORS 白名单、API / 登录限流；生产默认不暴露错误详情 |
| | · 伤害事件产生角色显示；模式侧栏搜索；列表独立滚动 |
| | · 前端管理写请求附带管理员鉴权头 |
| **建议** | 只要鉴权安全、不要 UI 大改时可用；完整体验请用 `3.1.6.1` |

### `3.1.6.1`

| 项 | 说明 |
|---|---|
| **定位** | UI 重设计 + 协议边界修复，**并已合入 `3.1.6.2` 全部安全改动** |
| **基于** | `3.1.6` → UI/fix → 再快进合并 `3.1.6.2` |
| **尖端** | 与 `3.1.6.2` 相同（含本分支文档提交） |
| **package** | 合入后为 `3.1.6.2`（版本号随安全提交） |
| **相对 3.1.6 新增** | |
| | · 绝区零风格首页 / 模式页外壳（tokens、拼贴背景、邦布、自定义光标） |
| | · 亮色暖纸主题；移动端期数按钮暗色隐形修复 |
| | · logout `revokeUserSession`；模式保留 `ownerAgentId` / `radiance`；Buff scope 补全 |
| **相对 3.1.6.2（已合入）** | 见下一节全部要点 |
| **建议** | 已分叉出 `3.1.6.3` 合并线；日常可继续用此线或跟进 `3.1.6.3` |

### `3.1.6.2`

| 项 | 说明 |
|---|---|
| **定位** | 安全加固专题线（上传 / 路径 / OTP / 密钥闸门） |
| **基于** | 曾基于 `3.1.6.1`；现已并回 `3.1.6.1`，两尖端一致 |
| **package** | `3.1.6.2` |
| **更新要点** | |
| | · 移除跟踪中的 `zzz_full_dump.sql`；历史明文管理员口令改为 `REDACTED_ADMIN_PASSWORD` |
| | · 头像路径白名单 + `realpath` containment |
| | · 用户头像鉴权前移；留言/头像内存接收 + 魔数 + 限流 + 容量上限 |
| | · OTP 用 `crypto.randomInt`；生产默认不打印验证码 |
| | · Buff 空 `*Factor` 默认 0；`defaultStacks=0` 可保留 |
| | · 危险删除脚本默认 dry-run（需 `--apply`） |
| | · `scripts/check-no-secrets.ps1`：**只拦截明文管理员密码**；计算器/危局/防卫/站点业务 SQL **放行** |
| | · 接入 `pack-update.ps1`、release skill、CONTRIBUTING、PR 模板 |
| **建议** | 可删可留；内容以 `3.1.6.1` 为准即可 |

### `3.1.6.3`（当前合并线）

| 项 | 说明 |
|---|---|
| **定位** | 合并 `zzz-hp-handoff1`：batch1 稳定性 + 拼贴 v4 |
| **基于** | `3.1.6.1`（已含 `3.1.6.2` 密钥闸门 / 上传加固 / dump 脱敏策略） |
| **package** | `3.1.6.3` |
| **合入要点** | |
| | · OCR 识别失败不扣配额；封禁用户编辑帖被拦；`resolveGuestbookStaff` 兜底 |
| | · 短信验证码 fail-closed（仅 `SMS_MOCK=1` 回传）；验证码不写日志 |
| | · 脚手架死代码删除；oxlint 清零类清理；腾讯 OCR SDK / body-parser 升级 |
| | · 背景拼贴 v4（去期数编号、危险条纹 / 微注记 / QR 点缀） |
| | · 交接待办 `TODO-FOR-OWNER.md`（P0/P1/P2） |
| | · **P1 施工（本分支继续）**：共享 enemyInput；fetch 竞态令牌；OCR 双桶配额；封禁/改密撤 session；站管授标收窄；删帖清图；`/health` 探 DB；绑定手机事务 |
| | · **P1 收尾**：toggle/拉黑事务与手机号唯一；孤儿图扫描 `--orphans [--apply]`；启动 `ensureRuntimeSchema` |
| | · **管理端**：整期「软删除 → 恢复 / 清理」；确认提醒；「已删除未清理」徽章；防卫战不再用危局日期生成空期骨架 |
| | · **计算器（方案 / 事件）**：并入 `3.1.6.4` 半成品后收口为「事件跟随方案」 |
| | · · 编辑不自动写全局；侧栏「编辑事件」；未落盘不标「方案/全局」；「更新到全局」/「存为方案事件模式」按当前目标写入 |
| | · · 无已加载方案时弹窗可选「新建或加载方案」或「存为全局」（方案库 z-index 高于事件窗；确认框独立 Teleport） |
| | · · 方案持久化事件模式名；进入页不默认加载/高亮上次或首位方案；「取消当前方案」解除绑定（不删库） |
| | · · 方案库摘要条对齐事件模式摘要（同框左文右钮）；白天主题补齐确认框 / 去向弹窗 / 取消钮 |
| | · · 迁移不再把全局自定义合并灌入空方案；实现说明见 `SCHEME-EVENTS-FULL-IMPL.md` |
| **刻意保留（不覆盖）** | |
| | · **不**引入 handoff 的 `zzz_full_dump.sql` |
| | · 本地 `scripts/check-no-secrets.ps1`、上传魔数 / 鉴权前置、路径白名单加固 |
| | · 历史明文管理员口令已按 `REDACTED_ADMIN_PASSWORD` 策略处理 |
| **建议** | 合并与验证用此分支；通过后再考虑并回 `3.1.6.1` / `main` |

---

## 二、站点更新日志对照（seed）

写入首页「更新日志」的版本条目（`seed_changelog.mjs`）：

| 版本 | 标题 |
|---|---|
| 3.1.6 | 管理端鉴权加固与伤害事件体验 |
| 3.1.6.1 | 绝区零风格 UI 与协议边界修复 |
| 3.1.6.2 | 清除敏感凭据与上传计算边界加固 |
| 3.1.6.3 | handoff1 稳定性批与拼贴 v4（保留密钥闸门） |

更早版本（3.0.0–3.1.5）仍在 seed 脚本中，按既有条目维护。

---

## 三、功能 / 实验分支

### `feature/skill-flow-redesign`（进行中）

| 项 | 说明 |
|---|---|
| **基线** | 从 `3.1.6.4` 拉出（= `upstream/main` + 方案库修复批 + 未上线的「事件跟随方案」） |
| **目标** | 伤害计算「事件」模块重构为三层：招式库（全局）→ 准备阶段（跟方案）→ 流程（跟方案） |
| **方案** | `dev-docs/skill-flow-redesign.md`（工作区根，不在仓库内） |
| **要点** | 招式 = 伤害类型 ×1 + 招式类型 ×N + 增益锚点 ×0..1；异常类两者均留空。公共预设仅按元素的属性异常（含霜、无流明）。招式库筛选：直伤类/异常类、自建/预设；按角色+本元素是底线。方案导出含自建招式，导入整包覆盖。流程模块下有伤害统计框架 |
| **DB** | **现有数据零改动**。靠「招式类型 → 旧 (大类, 小类) 坐标」映射，Buff 限定、招式小类、追加攻击规则全部不动；仅新增招式库 |
| **迁移** | 全局 → 全局：旧全局事件模式库转成全局自定义招式库，方案不动，流程留空由用户重排 |
| **将删** | 已删：`migrateLegacyGlobalEvents`、旧事件编辑器 UI。`resolveIsFollowUp` 保留（锚点推定追加攻击 / 无流程 Buff 收集） |
| **状态** | **骨架阶段**，未发版。计算页页内展开招式流程；公共预设仅按元素的属性异常。待办：工作区 `dev-docs/skill-flow-todo.md`；未来改造：`dev-docs/skill-flow-future.md` |

### 历史专题（`cursor/*`）

多为已合入主干的历史专题，仅作对照，勿当发布分支：

| 分支 | 内容简介 |
|---|---|
| `cursor/add-defense-stat-c687` | 防御力作基础伤害来源，补全防御增益字段 |
| `cursor/anomaly-producer-scope-c687` | 属性异常产生角色范围放宽为全队 |
| `cursor/convert-crit-attrs-c687` | 转模来源支持暴击 / 爆伤 |
| `cursor/convert-initial-base-c687` | 转模支持初始值，仅超出部分折算 |
| `cursor/convert-panel-admin-visible-c687` | 转模队友局外面板；危局管理员可见未公开期 |
| `cursor/convert-pierce-source-c687` | 转模来源支持贯穿力 |
| `cursor/fix-convert-buff-display-c687` | 局外面板变更后同步局内 Buff 展示 |
| `cursor/fix-direct-dmg-formula-display-c687` | 直伤公式展示与期望详情修正 |
| `cursor/fix-turbulence-release-events-b441` | release-mult 测试改用 vite-node |
| `cursor/hybrid-defense-pen-c687` | 异常基础防御区：穿透取产生角色、减防取主 C |
| `cursor/same-day-public-c687` | 危局/防卫仅开始日当天公开 |
| `cursor/settlement-dmg-mult-c687` | 决算倍率作为直伤独立分量 |

---

## 四、其他分支

| 分支 | 介绍 |
|---|---|
| `pr-12-preview` | PR 预览：组队导入弹窗与槽位卡片 UI 整合（后续已进主线） |
| `backup/local-wip-20260728` | 本地 WIP 备份，勿发版、勿合入 |
| `handoff/feature-zzz-ui-redesign` | 外部交接：UI 重设计（内容已 cherry-pick 进 `3.1.6.1`） |
| `handoff/fix-backend-normalize-bugs` | 外部交接：logout / ownerAgentId / radiance / scope（已合入） |
| `zzz-hp-handoff1`（目录交接） | 2026-08-11：batch1 + 拼贴 v4 → 合入 `3.1.6.3`；**不**带入其 `zzz_full_dump.sql` |

---

## 五、运维注意

1. 生产若曾用过历史 dump 中的明文管理员口令：立刻轮换密码并清管理员 session（`set-admin-password.mjs`）。
2. 历史 rewrite 后，旧 clone 请重新 `clone` 或按新历史重置。
3. 提交 / 打包前运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-no-secrets.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-no-secrets.ps1 -StagedOnly
```

4. 闸门策略：**只拦明文管理员密码**；`character` / `w-engine` / `drive_disc` / `bangboo`、`boss` / `buff` / `boss_info` / `date`、`changelog` / `site_info_section` 等业务数据放行。
