# ZZZ-HP 修复与优化清单（给朋友）

> 整理：2026-08-11　基于两轮深度审查  
> 合入说明（`3.1.6.3`）：已合并 handoff1；本地密钥闸门与上传加固保留。  
> **本清单进度随 `3.1.6.3` P1 施工更新**（✅ 已做 / 🟨 部分 / ⏳ 未做）。

## P0 —— 只能你来做的事（涉及凭据/仓库/服务器）

1. 🟨 **管理员凭据曾泄露，确认生产已轮换**：仓库侧已脱敏/删 dump；请确认生产 `set-admin-password.mjs` + 清 `data/*.json`。
2. ⏳ **dump 隐私告知**：是否告知留言板用户由你决定。
3. 🟨 **前端 lockfile**：本地已是 3.1.6.x；干净环境再跑一次 `npm ci` 验证即可。

## P1 —— 建议下个版本修

4. ✅ **fetch 竞态**：`createRequestEpoch` + HomeGuestbook / history·defense 各 Panel 加载令牌。
5. ✅ **最优词条 enemyInput**：提升到 `DamageCalcPage`，面板与最优词条 `v-model:enemy-input` 共享。
6. ✅ **`is_site_admin` 授标收窄**：改 `isSiteAdmin` 字段仅密码管理员会话可写；资料编辑仍允许站管。
7. ✅ **OCR 配额防绕过**：clientId 与 IP **双桶**计数，换 id 无法绕过同 IP 限额。
8. 🟨 **事务/唯一约束**：手机号绑定已包事务 + `FOR UPDATE`；其余 toggle/唯一索引仍待。
9. 🟨 **上传链路**：鉴权/魔数此前已做；**永久删帖**时清理 `guestbook_image` 本地文件（软删 15 天后 purge）。孤儿定期扫描仍可加强。
10. 🟨 **运行时 DDL / health**：`/health` 已加 DB `SELECT 1`；schema 自愈合并仍待。
11. ✅ **破坏性脚本闸门**：此前已 dry-run + `--apply`。
12. 🟨 **腾讯 SDK**：已升 ^4.1.289；**OCR 联调回归**仍须你在本机验证。
13. ✅ **session 撤销**：封禁 `revokeAllSessionsForUser(markBanned)`；改密 `revokeOtherSessionsForUser` 保留当前；logout 原有单 token 撤销。

## P2 —— 结构债（长期，未动）

14. HomeGuestbook 拆分  
15. 镜像表单一事实源  
16. JSON 会话入库  
17. 临界推演 mock  
18. 增益录入工具化  

## 已在途 / 已合入

- normalize bugs、batch1、UI 重设计、拼贴 v4、密钥闸门、上传加固 → 见 `BRANCH_CHANGELOG.md` `3.1.6.x`
