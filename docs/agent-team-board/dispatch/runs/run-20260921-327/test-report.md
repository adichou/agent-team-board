# 测试报告 — BUG-20260921-010 刷新后，最近执行的命令看不见了（run-20260921-327）

- 日期：2026-09-21　执行：zcode-batch-060-1（批次 batch-20260921-060）
- 引入来源：REQ-20260920-004（commit 12ac4ae 引入 commands.js，recents 自始为内存态）
- 新增测试：`scripts/tests/bug-20260921-010.test.mjs`（TDD 先红后绿，6 例，输出见同目录
  test-output.log）
  - T1 成功执行后「刷新」页面（同 fake localStorage 全新 vm 沙箱重载 commands.js），
    最近执行列表仍显示该命令，不再回到空态（跑红用例）；
  - T2 刷新后点击最近执行条目，右侧回填该次参数与附加参数（带参命令 show 验证
    `value="REQ-1"` / `value="--json"` 与回填反馈）；
  - T3 项目隔离：/p 的最近执行不串到 /q；同会话切回 /p 从持久化恢复；
  - T4 localStorage 不可用（未注入）降级会话内行为：执行正常、会话内可见、刷新后
    空态不崩；
  - T5 持久化数据损坏（非法 JSON / 字段结构不对）回退空态不崩；
  - T6 刷新后保持按命令去重口径：同命令重复执行仍只占 1 条。
- 回归：`scripts/tests/bug-20260921-009.test.mjs`（4 例）与
  `scripts/tests/req-20260920-004.test.mjs`（10 例）零回归（C3c「历史 20 / 去重 10」
  行为标记仍命中）。
- 全量回归：`npm test` → **308 个测试文件，失败 0**
- 覆盖框架：Node 内建 `node:assert/strict` + `vm` 沙箱装载真实 commands.js 的自研
  runner（与仓库既有测试同构；「刷新」以同 storage 全新沙箱重载模拟浏览器刷新）

## 实现摘要

`scripts/web/commands.js`（唯一源码改动）：

1. 新增 `recentKey` / `loadRecents` / `saveRecents`：recents 持久化 localStorage
   （key `atb.cmd.recents:<项目根>`，按项目隔离；读取逐项校验 name/vals/extra/at
   字段结构，非法整单丢弃回退空态；不可用 / 写入失败 try-catch 静默降级会话内，
   不阻塞执行）。
2. `enter(project)`：项目恢复口径变化时从 localStorage 恢复该项目最近执行
   （同会话重复进入不覆盖，兼容降级数据，保 009 用例零回归）。
3. `withDone` 成功分支：更新去重列表后落盘（去重前 10 / 仅成功计入口径不变）。

未新增界面文案（空态文案沿用既有词条），无需 i18n 变更；未引入开源库（localStorage
单键 JSON 读写自研，见条目 design.md 选型说明）。
