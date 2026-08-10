# 分支更新日志（3.1.6 线）

方便对照各短命版本分支内容。站点首页更新日志由 `zzz-hp-backend/scripts/seed_changelog.mjs` 写入数据库。

## 3.1.6

**基线**：安全加固 + 伤害事件体验  
**要点**：

- 管理端写接口 `requireAdmin`
- Helmet / CORS / 限流 / 生产错误脱敏
- 伤害事件产生角色显示、模式搜索、列表滚动

## 3.1.6.1

**基于**：`3.1.6`  
**要点**：

- 绝区零风格首页 / 模式页外壳重设计
- logout `revokeUserSession` 导入修复
- 伤害模式保留 `ownerAgentId` / `radiance`
- Buff scope 白名单补 `radiance` / `mutation`

## 3.1.6.2

**基于**：`3.1.6.1`  
**要点**：

- 清除仓库中的 `zzz_full_dump.sql`（含明文管理员密码），并禁止再提交真实库转储
- 头像路径 containment（白名单 + realpath）
- 用户头像鉴权前移；留言/头像内存接收 + 魔数校验 + 限流 + 容量上限
- OTP 使用 `crypto.randomInt`；生产不打印验证码
- Buff 空 `*Factor` 默认 0；`defaultStacks=0` 可保留

## 运维注意

- Git 历史中仍可能残留旧 dump；生产若曾用过 dump 内口令，请立刻轮换管理员密码并撤销 session。
- 历史 rewrite / force push 另开维护窗口，不与功能发版混做。
