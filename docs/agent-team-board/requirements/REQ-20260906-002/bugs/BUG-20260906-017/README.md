# BUG-20260906-017 批量抽屉头部内联 space-between 布局致 detail-close-btn 契约测试回归

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260906-002
- 创建：2026-09-06T15:01:29.713Z

## 现象

现象：node scripts/tests/detail-close-btn.test.mjs T2 失败——断言 app.js 全文不得出现内联 justify-content:space-between。根因：renderBatchDrawer（批量实施抽屉头部，app.js 约 1273 行）在 drawer-head 内用了内联 style justify-content:space-between，命中 REQ-20260906-005 的旧布局移除断言（该断言针对 app.js 全文文本）。影响：run-all 43 个测试文件中此 1 个失败，与 REQ-20260906-008 改动无关（该条目仅改 index.html/style.css，未触碰 app.js，实施前已存在）。建议：批量抽屉头部改用专用类名布局，去掉内联 space-between，与条目抽屉头部结构对齐。

## 复现步骤

1. `node scripts/tests/detail-close-btn.test.mjs`（修复前 T2/T5 因 app.js 全文存在内联 `justify-content:space-between` 而失败）。

## 期望行为

app.js 全文不再出现内联 `justify-content:space-between`；批量抽屉头部（renderBatchDrawer）改用专用类名（`.batch-head`）承载两端布局，style.css 提供对应样式；detail-close-btn 契约测试全部通过。

## 处置说明（2026-09-07，worker zcode-batch-003-01）

本单与在册条目重复登记同一问题，核对看板：

- **BUG-20260906-016**（独立 Bug，2026-09-06 14:39 创建，早于本单 15:01）：同现象同根因，已由其完成修复实施并上报（`renderBatchDrawer` 头部改 `.batch-head` 类承载两端布局，detail-close-btn 新增 T5 恢复 app.js 全局无内联 space-between 断言，覆盖率 100%，待人工确认）。
- BUG-20260906-011 / 012 / 013（更早的同问题重复登记）。

领取本单时该修复已在位（`scripts/web/app.js` `renderBatchDrawer` 使用 `class="batch-head"`，全文 0 处内联 space-between；`scripts/web/style.css` 存在 `.batch-head { display:flex; justify-content:space-between; … }`）。本次 worker 仅做验证与归因，未再改代码；detail-close-btn 5/5 用例通过、run-all 全量回归通过（详见 test-report.md）。请人工确认时合并/忽略本单（以 BUG-20260906-016 为准处理即可）。

## 关联（引入来源）

- 引入来源：REQ-20260906-002（批量实施抽屉 `renderBatchDrawer` 头部以内联 `justify-content:space-between` 实现两端布局，命中 REQ-20260906-005 的 app.js 全文旧布局移除断言，导致 detail-close-btn 契约测试回归；与 REQ-20260906-008 改动无关）
- 重复条目：BUG-20260906-016（同根因，已实施修复）；BUG-20260906-011/012/013（更早重复登记）
