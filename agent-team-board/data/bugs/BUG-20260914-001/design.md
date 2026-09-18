# 设计 — BUG-20260914-001 AI 分析任务中重复显示了“本轮完善队列已处理完毕（条目均保持已接受，后续流转由人工判断）”，请修复

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：**REQ-20260907-003**（`atb list` 核验存在，已计划→done）。该需求首次引入完善面板
  `renderRefinePanel()`（scripts/web/app.js）：概况页同时存在两处收尾语义渲染——
  ① 服务端 notice 透传（`/api/refine/current` → `data.notice`，文案来自 `refine-store.mjs checkRefineBatch()`）；
  ② `batchDone && !b.aborted` 时本地硬编码的绿色 `notice ok` 条。
  正常收尾（finished、未终止、剩余 0）时两个条件同时成立 → 同屏各渲染一条，语义重复。
  两处文案「均」字有无、句号有无的不一致为历史固有分叉（git 首见即不同），REQ-20260913-003
  重定文案（ed5da9d）时两处仍未对齐，缺陷可见度随之固定。以上经 `git log -S`/`git blame`
  追溯：两处代码均随 2026-09-12 的聚合提交 6f2ead6 首次入库（此前历史被压缩，条目级溯源以
  面板归属需求 REQ-20260907-003 为准）。

## 根因分析

概况页提示区对「收尾完成」这一语义存在**双通道渲染且互不感知**：

1. 服务端通道：`checkRefineBatch()`（scripts/lib/refine-store.mjs:1179）在 `remaining === 0`
   且未终止/未暂停时生成 notice「本轮完善队列已处理完毕（条目均保持已接受，后续流转由人工判断）」，
   经 `server.mjs` `/api/refine/current` 以 `notice` 字段透传，前端以普通样式
   `<div class="notice">` 无条件渲染；
2. 前端通道：`renderRefinePanel()`（scripts/web/app.js）在 `batchDone && !b.aborted` 时
   又硬编码渲染 `<div class="notice ok">本轮完善队列已处理完毕（条目保持已接受，后续流转由人工判断）。</div>`。

正常收尾态两通道同时命中 → 两条同语义提示上下叠加；且两处文案措辞分叉（「均」/句号），
观感上既是重复又是文案 bug。终止路径因 ok 条有 `!b.aborted` 守卫、服务端走终止文案，
语义不同不构成重复（维持现状）。

## 方案

**只收敛看板 UI 展示口径，不动 CLI / 服务端**（notice 同时服务 CLI 主调度核对协议，验收明确不回归）：

`scripts/web/app.js` `renderRefinePanel()`：

- 新增 `doneNoticeOnly = batchDone && !b.aborted && !b.pauseRequested`（与
  `checkRefineBatch` 的收尾 notice 生成分支同口径：finished、未终止、未暂停、剩余 0——
  该态下服务端 notice 必为收尾文案）；
- 普通 notice 渲染加 `&& !doneNoticeOnly` 守卫：收尾态不再以普通样式叠加服务端 notice；
- 绿色 ok 条改为承接服务端文案：`esc(data.notice || '本轮完善队列已处理完毕（条目均保持已接受，后续流转由人工判断）')`——
  有 notice 时与 CLI `atb refine check` 逐字一致；notice 缺失（兜底路径）时前端兜底文案
  与 `checkRefineBatch` 权威文案同措辞同句读（含「均」、无句号）；
- `scripts/web/i18n.js`：词典键由旧措辞（无「均」、带句号）替换为与服务端一致的新文案键
  （EN 译文同步补「all」），避免英文界面出现未翻译回退与措辞分叉；
- 条目 `ui-demo.html`「修复后」分支同步为逐字服务端文案（去掉演示时多加的句号）。

不改动：`refine-store.mjs`、`server.mjs`、CLI 行为；运行中/暂停/终止等其余场景的
服务端 notice 普通样式展示、warn/info 提示、「启动新一轮」入口均保持原状。

**开源选型（REQ-20260909-015）**：自研（前端模板两行收敛 + 词典键同步），无引入第三方库的
必要——不涉及新能力，仅收敛既有渲染逻辑；无合适库可复用（引入成本高于自研）。
未使用开源库，不创建 licenses.md。

## 风险与边界

- **CLI 协议零改动**：`atb refine check` notice 生成与 JSON 载荷完全不变，主调度核对不受影响。
- **兜底文案漂移**：若日后服务端收尾文案改词而前端兜底未同步，会重新出现措辞分叉——
  已加静态测试（B2）从 `refine-store.mjs` 源码提取权威文案与前端兜底逐字比对，改词不同步即测试变红。
- **边界态**：finished 且 pauseRequested 同时成立的极端组合下维持旧展示（普通 notice + info 条 + ok 条），
  与修复前行为一致，不做额外收敛（该态实际不可达：remaining 归零收尾与暂停互斥）。
- **英文界面**：收尾态渲染的服务端文案现为词典键，EN 模式可正常翻译；其余动态服务端
  notice 的翻译口径维持现状。

## 实施记录

- `scripts/web/app.js`：`renderRefinePanel()` 新增 `doneNoticeOnly` 守卫 + ok 条改用
  `data.notice`（兜底与服务端同文案）；删旧硬编码措辞。
- `scripts/web/i18n.js`：EN 词典键替换为新收尾文案。
- `scripts/tests/bug-refine-done-notice-dup-20260914-001.test.mjs`（新增，7 例）：B1 收尾整句
  恰好 1 次（ok 样式、文案与服务端逐字一致）/ B2 前端兜底与服务端权威文案逐字一致（源码提取比对）/
  B3 notice 缺失兜底单条 / B4-B6 运行中·暂停·终止场景不回归 / B7「启动新一轮」入口不回归。
  实施前 B1/B2 红（复现重复 2 次 + 措辞分叉），实施后全绿。
- 回归：`node scripts/tests/run-all.mjs` 全量 220 个测试文件全部通过。
- `docs/agent-team-board/bugs/BUG-20260914-001/ui-demo.html`：「修复后」分支文案与实现逐字对齐。
