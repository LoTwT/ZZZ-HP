-- ZZZ-HP 网站说明（site_info_section）
-- 由 scripts/export-site-content.mjs 导出 · 2026-10-05T18:36:24.042Z
-- 导入：cmd /c "mysql -u root -p --default-character-set=utf8mb4 zzz < scripts\data\cloud-import\site-content.sql"
-- 更新日志（changelog）不在此文件：由 scripts/seed_changelog.mjs 在服务器上写库。

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `site_info_section` (
  `panel_key` VARCHAR(32) NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `content` TEXT NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`panel_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

REPLACE INTO `site_info_section` (`panel_key`, `title`, `content`) VALUES ('about', '关于本站', 'ZZZ-HP 是由粉丝制作的《绝区零》非官方工具站，旨在整理玩法数据、提供计算辅助，并搭建玩家交流空间。\n\n本站与 HoYoverse / 米哈游官方无任何隶属或授权关系，所有功能由爱好者社区维护，仅供交流与学习使用。\n\n【开发人员名单】\n涅七白\nhttps://space.bilibili.com/3546388866534032\n\n憧憬成为江东铁壁\nhttps://space.bilibili.com/3992380\n\n快乐小咸鱼a\nhttps://space.bilibili.com/206966910\n\n菅名\nhttps://space.bilibili.com/4002872\n\nLo丶\nhttps://space.bilibili.com/14760451\n\n【QQ交流群】\n还是摆烂吧\n951685472');
REPLACE INTO `site_info_section` (`panel_key`, `title`, `content`) VALUES ('credits', '借鉴与参考', '【InterKnot】\nhttps://interk.net/\n留言板与「敲敲」通知 / 聊天交互、弹层与卡片布局、个人名片展示、@ 提及样式及部分线框图标交互。\n\n很成熟的绳网论坛，功能较为完善，整体也很活跃，留言板的格式不少是参考的InterKnot，大家感兴趣的可以去看看。\n\n【ZZZ Calculator】\nhttps://zzzcaculator.top/\n最优词条计算的展示项参考其中词条分析，后续buff的展示可能也会参考，目前ZZZ-HP的角色增益等太过死板，很多还是依赖人工调节，后蓄会优化。\n\n最近出世的背包最优驱动盘计算器，会扫描导入背包中的驱动盘，并且支持配对+不同buff下的最优驱动盘计算，会给出哪一套驱动盘是最适合的；唯一可惜的就是目前支持的角色还是太少，毕竟还是刚起步。\n\n【米游社】\n账号登录（扫码登录、可选手机号登录）。\n\n【nanoka】\nhttps://zzz.nanoka.cc/\n式舆防卫战等部分历史数据在维护时参考了该站的公开社区数据，仅供本站展示与对比使用。');
REPLACE INTO `site_info_section` (`panel_key`, `title`, `content`) VALUES ('features', '网站内容', '【数据查询】\n支持查询危局强袭战、式舆防卫战以及临界推演的往期详细的怪物历史数据与buff信息； \n血量折线图直观展示血量增长情况与膨胀幅度；\n怪物对比允许选定怪物，查看特定怪物的血量变化； \n危局强袭战与临界推演板块专属血量分数转化器，支持查询分数与血量之间的对应关系。\n\n【伤害计算】\n导入队伍面板、选定邦布增益与地方环境、配置局内buff与招式流程之后，显示当前词条下，各副词条收益、456号位与2件套的最优情况以及在当前基础上如何添加词条收益最高； \n面板导入包含词条导入与面板直接导入，同时允许米游社面板截图导入； \n允许配置招式流程，更加贴合实际； \n具有折线收益图与伤害柱状图，可直观看到收益与伤害。\n\n【留言板】\n小型交流论坛，支持发布/浏览委托，如分类筛选、搜索、评论、点赞、收藏；支持图文与表情、@ 提及； \n允许匿名发布：委托与评论可隐藏账号信息，仍归属本人，可随时取消匿名；\n名片有「匿名委托」分区； 敏感内容的封面与图片可模糊遮罩、点击查看； \n有个人名片功能，包含头像/横幅、我的委托/评论/收藏、粉丝与关注（星标置顶）、查看他人名片等； \n特殊模块敲敲，用于系统通知、关注动态、私信聊天； 支持米游社扫码登录与多账号切换。');
REPLACE INTO `site_info_section` (`panel_key`, `title`, `content`) VALUES ('legal', '版权声明', 'ZZZ-HP 是粉丝制作的网站。\n\n游戏中相关的图像、角色、名称、UI 元素及其他资产的版权与商标权均归 HoYoverse 所有。\n\n本站不对游戏内数据的准确性作官方保证，亦不代表任何官方立场。');
