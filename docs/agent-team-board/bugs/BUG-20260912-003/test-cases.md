# 测试用例 — BUG-20260912-003 提交号显示优化

> Bug 条目原文档只有 README；本文件为修复阶段补录的用例清单（TDD 先行）。

## 复现口径

需求看板已完成/待测试条目的提交状态展示（`scripts/web/app.js`，数据源 `/api/commit/item-status`）：

1. 提交号以完整 40 位 hash 展示（列表卡片「N 个提交号」折叠项内、详情抽屉「提交状态」字段），过长占位。
2. 有提交记录时先渲染绿色「已提交」徽标（`cm-committed`），提交号藏在折叠层里，双层信息冗余。
3. 复制需逐个点击行尾「复制」按钮（`data-copy-hash` click），双击提交号文本无任何反应。

## 口径确认（按 README「待确认」默认执行）

- 双击复制完整 40 位 hash（与既有 `copyHash` 口径一致，git 命令可直接使用）。
- 提交号展示前 5 位（用户明确要求 5 位，非 git 默认 7 位）。
- 多提交号直接并列展示，不保留「N 个提交号」折叠。
- 「未提交」「提交状态加载失败（含重试）」口径与交互保持现状；纯前端展示裁剪，不动数据源与提交账本。

## 用例

- T1 徽标移除：有成功提交记录时，列表卡片（`commitBadgeHtml(it, { inline: true })`）不再渲染
  「已提交」徽标（`cm-committed`）与 `<details class="commit-hashes">`/「N 个提交号」折叠层，
  原徽标位置直接渲染 `commitHashListHtml` 短提交号列表；详情位（非 inline）徽标部分返回空串，
  由 `commitStatusDetailHtml` 渲染同一列表，两处口径一致且不重复。
- T2 短号展示：`commitHashListHtml` 每行 `<code class="commit-hash">` 文本只含前 5 位十六进制
  前缀（`commitShortHash = slice(0, 5)`）；悬停 `title` 含完整 40 位 hash；不再有独立「复制」按钮
  （无 `copy-hash-btn`/`复制</button>`）。
- T3 双击复制：`bindCommitWidgets` 对 `[data-copy-hash]` 绑定 `dblclick` → `copyHash`，且
  `dblclick`/`click` 均 `stopPropagation`（双击前的单击不冒泡打开详情抽屉）；复制内容为完整
  40 位 hash（`navigator.clipboard.writeText(hash)`，execCommand 降级保留）；复制成功有反馈
  （`copied` 高亮 + toast），失败保留「复制失败，请手动框选完整提交号」降级提示。
- T4 未受影响状态回归：done 无记录仍显示「未提交」；查询失败仍显示「提交状态加载失败」+
  `data-commit-retry` 重试，不伪装成未提交；非 done/待测试条目不渲染。
- T5 i18n 同步：新增动态词条（title 提示、复制成功 toast）入 `EN_DYNAMIC`（◇ 键 ↔ $1 值）；
  不可达旧键「已提交」「◇ 个提交号」「复制提交号 ◇」随 UI 移除从词典清理；i18n-coverage 全绿。
- T6 样式：`.cm-committed` 样式随徽标移除；`.commit-hash` 加 `cursor: copy`，新增 `.copied`
  成功高亮；`.commit-hashes`/`.commit-hash-row` 折叠布局死样式清理。

## 验收

- `node scripts/tests/bug-commit-hash-display-20260912-003.test.mjs` 通过；
- 既有 commit-ui-20260910-014（U6/U9 更新为新口径）、commit-rollback-20260911-010（R10 更新）、
  dev-flow-20260911-009（D12 不动仍绿）与全量 `npm test` 保持绿。
- 页面视觉与双击复制手感待人工在 Status Board 验收（本仓库测试为源码级静态/VM 断言）。
