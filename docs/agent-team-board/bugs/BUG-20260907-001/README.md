# BUG-20260907-001 抽屉头部残留 space-between 内联布局致 detail-close-btn T2 回归

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-06T16:08:08.586Z

## 现象

全量测试 scripts/tests/detail-close-btn.test.mjs T2 失败：app.js:1273 头部模板仍含 justify-content:space-between，断言要求不再有两端布局。发现于 BUG-20260906-008 修复的全量回归（与恢复本项改动无关，改动区域为 cxResumeItem 处理器）。复现：node scripts/tests/detail-close-btn.test.mjs

> 人工核对备注：登记后核对发现与既有 BUG-20260906-017（REQ-20260906-002 名下，submitted）同根因同现象，本条为重复登记，可在分诊时直接关闭/合并，以 BUG-20260906-017 为准。

## 复现步骤

1. `node scripts/tests/detail-close-btn.test.mjs`（登记时 T2 因 app.js 全文存在内联 `justify-content:space-between` 而失败）。

## 期望行为

app.js 全文不再出现内联 `justify-content:space-between`；批量抽屉头部（renderBatchDrawer）改用专用类名（`.batch-head`）承载两端布局，style.css 提供对应样式；detail-close-btn 契约测试全部通过。

## 处置说明（2026-09-07，worker zcode-batch-003-01）

与 BUG-20260906-017 同批重复登记，核对看板（均经 `atb list` 核验）：

- **BUG-20260906-016**（独立 Bug，2026-09-06 14:39 创建，最早登记）：同现象同根因，已由其完成修复实施并上报（`renderBatchDrawer` 头部改 `.batch-head` 类承载两端布局，detail-close-btn 新增 T5 恢复 app.js 全局无内联 space-between 断言，覆盖率 100%，待人工确认）。
- BUG-20260906-017（REQ-20260906-002 名下，2026-09-06 15:01 创建）：同现象同根因，前序 run 已验证修复在位并上报。
- BUG-20260906-011 / 012 / 013（更早的同问题重复登记）。

领取本单时该修复已在位（`scripts/web/app.js` `renderBatchDrawer` 使用 `class="batch-head"`（现约 1667 行，登记时 1273 行系修复前行号），全文 0 处内联 space-between；`scripts/web/style.css` 存在 `.batch-head { display:flex; justify-content:space-between; … }`（约 1078 行））。本次 worker 仅做验证与归因，未再改代码；detail-close-btn 5/5 用例通过、run-all 全量 57 个测试文件通过（详见 test-report.md）。请人工确认时合并/忽略本单（以 BUG-20260906-016 为准处理即可）。

## 关联（引入来源）

- 引入来源：REQ-20260906-002（批量实施抽屉 `renderBatchDrawer` 头部以内联 `justify-content:space-between` 实现两端布局，命中 REQ-20260906-005 的 app.js 全文旧布局移除断言，导致 detail-close-btn 契约测试回归；经 `atb list` 核验该需求在册）
- 重复条目：BUG-20260906-016（同根因，已实施修复）；BUG-20260906-017（同根因，已验证上报）；BUG-20260906-011/012/013（更早重复登记）
