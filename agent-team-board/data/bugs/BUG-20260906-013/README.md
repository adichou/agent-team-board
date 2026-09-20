# BUG-20260906-013 detail-close-btn T2 回归：批量实施抽屉头部重新引入 space-between 内联布局

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-06T12:42:21.034Z

## 现象

scripts/tests/detail-close-btn.test.mjs T2 断言整个 app.js 不得再出现 justify-content:space-between（REQ-20260906-005 移除旧详情页两端布局时冻结的契约），但 renderBatchDrawer（批量实施抽屉头部，约 app.js:1263）使用了相同的内联 space-between 布局，导致该测试在全量回归中失败。为存量回归，与 REQ-20260906-014 改动无关（已核实：014 的 diff 不含 space-between，插件缓存快照同位置同样存在）。修复方向：批量抽屉头部改用非 space-between 布局或收窄 T2 断言范围为详情页 drawer-head 模板。

## 复现步骤

1. `npm test`（即 `node scripts/tests/run-all.mjs`），detail-close-btn.test.mjs T2 失败。
2. `grep -n "space-between" scripts/web/app.js` 可见 renderBatchDrawer 头部（现约 app.js:1273）的内联 `justify-content:space-between`。

## 期望行为

detail-close-btn.test.mjs 的 T1–T4 全部通过；REQ-20260906-005 的静态契约只约束详情抽屉 `renderDrawer`，不受批量抽屉 `renderBatchDrawer` 内联布局影响；全量 `npm test` 保持全绿。

## 修复记录（2026-09-07，zcode-batch-002-1）

本条目与 BUG-20260906-011 为同一问题的重复登记（两者均描述 T2 全文件级断言被 renderBatchDrawer 的内联 space-between 击穿）。011 已于 2026-09-07 采用「收窄断言范围」方案完成修复：`scripts/tests/detail-close-btn.test.mjs` 新增 `renderDrawerJs()` 截取 `function renderDrawer()` 函数体，T2 的全文件级断言收窄到该作用域内（并在测试内注明批量抽屉内联布局不在 005 契约范围内，即保留 renderBatchDrawer 现有内联布局，生产代码零改动）。

本条目实施内容为验证与归因收尾，无新增代码改动：

- `node scripts/tests/detail-close-btn.test.mjs`：T1–T4 共 4/4 通过；
- 全量 `npm test`：43 个测试文件，失败 0；
- 本 Bug 登记的现象（T2 在全量回归中失败）已消失。

## 关联

- 引入来源：REQ-20260906-002（renderBatchDrawer 批量抽屉头部引入内联 `justify-content:space-between`，合入时击穿 REQ-20260906-005 先写入的全文件级 T2 断言；与 BUG-20260906-011 归因一致，REQ-20260906-002 经 `atb list` 核验存在）
- 同问题修复条目：BUG-20260906-011（经 `atb list` 核验存在）
