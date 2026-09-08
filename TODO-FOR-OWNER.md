# ZZZ-HP 修复与优化清单（给朋友）

> 初始整理：2026-08-11，基于两轮深度审查。
>
> 历史合入背景：当时在 `3.1.6.3` 合入 handoff1，并保留本地密钥闸门与上传加固。
>
> 本文保留当时的完成状态、仍需确认事项和长期结构债，不定义当前开发或发布基线；现行规则见 [`docs/policies/git-workflow.md`](./docs/policies/git-workflow.md)。（✅ 已做 / 🟨 部分 / ⏳ 未做）

## P0 —— 只能你来做的事（涉及凭据/仓库/服务器）

1. 🟨 **管理员凭据曾泄露，确认生产已轮换**：仓库侧已脱敏并删除 dump。请确认云上生产环境已按[暂存与安全政策](./docs/policies/git-workflow.md#暂存与安全)轮换管理员口令，并使已有管理员会话全部失效。
2. ✅ **dump 隐私告知（无需对外）**：曾进 Git 的 `zzz_full_dump.sql` 来自本地测试库，不含云上真实用户数据，无需向留言板用户发隐私告知。相关数据入库边界见[暂存与安全政策](./docs/policies/git-workflow.md#暂存与安全)。
3. 🟨 **确认旧 clone 已处理**：Git 历史曾被重写。旧 clone 在继续推送前需重新 clone，或按新历史重置。
4. 🟨 **版本元数据一致性**：当前前后端 `package.json` 均为 `3.1.7`，两份 `package-lock.json` 的顶层 `version` 和 `packages[""]` 根包版本仍为 `3.1.6.3`。后续应分别使用 npm 工具重建两份 lockfile，并在干净环境运行 `npm ci` 验证。

## P1 —— 建议下个版本修

5. ✅ **fetch 竞态**：`createRequestEpoch` + HomeGuestbook / history·defense 各 Panel 加载令牌。
6. ✅ **最优词条 enemyInput**：提升到 `DamageCalcPage`，面板与最优词条 `v-model:enemy-input` 共享。
7. ✅ **`is_site_admin` 授标收窄**：改 `isSiteAdmin` 字段仅密码管理员会话可写；资料编辑仍允许站管。
8. ✅ **OCR 配额防绕过**：clientId 与 IP **双桶**计数，换 id 无法绕过同 IP 限额。
9. ✅ **事务/唯一约束**：手机号可空 + `uk_guestbook_user_phone`；toggle like/fav/评论赞与 `blockUser` 包事务；`followUser` 用 `INSERT IGNORE`。
10. ✅ **上传链路**：鉴权/魔数 + 永久删帖清图；`npm run check:guestbook-orphans`（`--apply` 删孤儿）。
11. ✅ **运行时 DDL / health**：`/health` 探 DB；启动 `ensureRuntimeSchema` 集中触发用户/留言板/社交自愈（完整表仍以 `init_schema.sql` 为准）。
12. ✅ **破坏性脚本闸门**：此前已 dry-run + `--apply`。
13. 🟨 **腾讯 SDK**：已升 ^4.1.289；**OCR 联调回归**仍须你在本机验证。
14. ✅ **session 撤销**：封禁 `revokeAllSessionsForUser(markBanned)`；改密 `revokeOtherSessionsForUser` 保留当前；logout 原有单 token 撤销。

## P2 —— 结构债（长期，未动）

15. HomeGuestbook 拆分
16. 镜像表单一事实源
17. JSON 会话入库
18. 临界推演 mock
19. 增益录入工具化
20. ⏳ **弱伤（dmgPenalty）展示口径不一致**（低优先级，当前无实际影响）
    - 背景：弱伤是减益，规则为「从增伤区里扣」（`1 + (增伤% − 弱伤%)/100`），**不是独立乘区**，故界面无需独立展示弱伤区——这点已确认无误。
    - 问题：通用乘区是直伤与异常**共用的底座**，而异常链**不扣弱伤**，因此引擎的通用乘区刻意用【未扣弱伤】的增伤区计算，直伤/命破/锐化链再在通用乘区之外单独补扣。结果是弱伤非 0 时，界面「增伤区」显示已扣弱伤的值（如 1.3），而「通用乘区」用的是未扣的值（等价于 1.5），**两点口径不一致**，用户拿界面数字手算会对不上。
    - 实测（增伤 50%、弱伤 20）：界面增伤区 1.3、通用乘区 1437.54，手算应得 1245.92。
    - 现状：全库 `dmgPenalty` **无非 0 条目**（空预留字段），界面上完全无表现。
    - 建议：等真正有角色/增益用到弱伤时，再决定是改「增伤区」显示口径（显示为未扣值 + 单独标注弱伤扣减），还是改「通用乘区」拆分直伤/异常两份。当前不动。

## 已在途 / 已合入

- normalize bugs、batch1、UI 重设计、拼贴 v4、密钥闸门、上传加固，见 [`docs/branch-history.md`](./docs/branch-history.md) 中的 `3.1.6.x` 历史记录。
