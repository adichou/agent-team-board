# BUG-20260906-012 detail-close-btn 契约测试 T2 断言范围过宽：批量抽屉头部内联 space-between 导致全量回归常红

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-06T11:51:59.206Z

## 现象

现象：npm test 中 scripts/tests/detail-close-btn.test.mjs T2 失败。该用例对整个 app.js 全局断言不含 justify-content:space-between，实际命中 renderBatchDrawer() 批量抽屉头部（app.js 约 1171 行的内联样式），并非其目标条目详情头部；详情头部 T1/T3/T4 均通过。影响：全量回归退出码恒为 1，掩盖真实回归。REQ-20260906-002 独立验收报告已记录为『测试范围过宽导致的失败』。建议方向：将 T2 断言收窄到目标 drawer-head 模板块，或批量抽屉头部改用类样式；按归因流程核实后修复。

## 复现步骤

1.

## 期望行为
