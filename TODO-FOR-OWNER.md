# ZZZ-HP 修复与优化清单（给朋友）

> 整理：2026-08-11　基于两轮深度审查（Kimi 前后端分治扫描 + 另一份外部 AI 审计报告，全部经人工源码复核）  
> 合入说明（`3.1.6.3`）：已合并 handoff1 的 batch1 / 拼贴 v4；**未**引入 handoff 的 `zzz_full_dump.sql`；本地密钥闸门与上传加固保留。  
> 已在分支上的修复见文末「已在途修复」，**本清单是还没做的**（部分 P0/P1 已在本地线完成，见标注）。

## P0 —— 只能你来做的事（涉及凭据/仓库/服务器）

1. **管理员凭据曾泄露，确认生产已轮换**：历史 dump 中 admin 行曾为明文密码（仓库内请用 `REDACTED_ADMIN_PASSWORD` / 闸门拦截，**勿再写入真实口令**）。操作：改密码（`set-admin-password.mjs`）→ 清所有 admin/user session（删服务器上 `data/*.json`）→ dump 已从当前树移除并做过历史替换 → 以后 dump 只导结构或脱敏数据。~~把 dump 再合回仓库~~（禁止）。
2. **dump 里还有用户隐私**：私信记录（`guestbook_dm_message`）、米游社 aid/mid。同上处理；评估是否需要告知留言板用户。
3. **前端 lockfile 仍是 3.0.9 旧锁**：`npm ci` 在干净环境必失败。在 Node 22/24 下重新 `npm install` 生成并提交 `zzz-hp/package-lock.json`。

## P1 —— 建议下个版本修（已核实，但未动，涉及行为/结构变化）

4. **fetch 竞态全站统一治理**：8 个历史/防卫面板 + HomeGuestbook 列表加载，快速切换时旧请求覆盖新数据。建议统一加"请求序号令牌"或 AbortController 模式。涉及：`history/*Panel.vue`、`defense/*Panel.vue`、`HomeGuestbook.vue:760`。
5. **最优词条页敌人状态独立**：`OptimalAffixAllocSection.vue:227` 自建 `enemyInput`，环境 Buff/Boss 联动只写进普通面板的隐藏状态 → 最优计算用旧敌方数据。修：enemyInput 提升到 `DamageCalcPage`，两模式共享 v-model。
6. **`is_site_admin` 权限过大且可自我复制**：持标用户可改任意用户资料/封禁/授标。建议拆成"站管"与"收举报联系人"两个角色，`editGuestbookUser` 的 `isSiteAdmin` 仅允许密码管理员会话操作。
7. **OCR 个人配额可绕过**（clientId 自报换 id 即重置）：建议 clientId 与 IP 指纹联合计数，或登录用户按账号计。
8. **事务/唯一约束**：手机号绑定改唯一索引+事务；拉黑/删帖等多步写入包事务；follow 等 toggle 加 ON DUPLICATE 或显式目标态。
9. **上传链路**：（本地 `3.1.6.2+` 已做鉴权前置 + 内存接收 + 魔数 + 限流 / 容量；删帖清图与孤儿清理仍可加强）原问题：鉴权前写盘、孤儿文件、删帖不清理图片。
10. **运行时 DDL 收敛**：schema 自愈散落在各 service，建议合并进 `init_schema.sql` 或做 `schema_version` 迁移表；`/health` 加 DB 可达检查。
11. **破坏性脚本闸门**：（本地已 dry-run 默认 + `--apply`）缺参即删真实期数的脚本需确认闸门仍在。
12. **uuid 漏洞（腾讯 SDK 依赖）**：需破坏性升级 `tencentcloud-sdk-nodejs`，影响面仅 OCR，可缓；升级时顺手回归 OCR 联调。（`3.1.6.3` 已升至 ^4.1.289，仍须回归）
13. **退出/改密不撤销 session**：`revokeAllSessionsForUser` 已是死代码，接到登出/改密/封禁路径上。（logout 已接 `revokeUserSession`；全量撤销仍待）

## P2 —— 结构债（长期）

14. `HomeGuestbook.vue` 7512 行巨型组件拆分 + 按需挂载 + 面板关闭时暂停轮询。
15. 经验等级表 / 危局血量系数表 / defenseId 编解码 前后端多处镜像，建议单一事实源（后端下发）。
16. JSON 文件存会话/配额/验证码 → 入库或 Redis。
17. 临界推演页目前是 mock 数据，要么接真数据要么先下线入口。
18. 计算器增益数据录入工作量大（网站说明里你自己提到的"太死板依赖人工"）——可参考 zzzcaculator.top 的背包扫描思路。

## 已在途修复（分支状态）

- `fix/backend-normalize-bugs`（4 个）：logout 缺导入必 500；官方伤害模式丢 ownerAgentId；radiance 事件被改 direct；增益 scope 白名单缺 radiance/mutation。→ 已合入 `3.1.6.1+`
- `fix/batch1-stabilization`（第一批）：OCR 失败不再扣配额；封禁用户编辑帖子被拦；resolveGuestbookStaff 加兜底；短信验证码 fail-closed + 不再写日志；路径加固（本地线更完整）；空 Buff 倍率因子默认 0；defaultStacks 合法 0；脚手架死代码删除；oxlint 清理；body-parser 升级。→ 已合入 `3.1.6.3`
- `feature/zzz-ui-redesign`：前端美化 + 拼贴 v4。→ 已合入 `3.1.6.1` / `3.1.6.3`
- 本地 `3.1.6.2`：dump 移除 + 历史脱敏、`check-no-secrets.ps1`、上传魔数 / 鉴权前置等（**合并时故意保留，不让 handoff dump 覆盖**）
