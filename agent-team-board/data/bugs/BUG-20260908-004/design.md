# 方案 — BUG-20260908-004 单号前缀已区分类型，移除界面上的 REQ/BUG 类型徽章

## 引入来源（源单）

- 引入来源：未定位（排查过程：类型徽章随看板初始 UI 一起存在，早于首个登记需求 REQ-20260829-001——其 README 描述的是"当前布局问题"，说明 Status Board 页面先于它落成；REQ-20260906-005 / REQ-20260906-020 的验收标准只是引用了既有的 `[REQ/BUG chip]` 首行布局而非引入它；遍历 requirements/ 与 bugs/ 文档未发现引入该徽章的登记记录；项目目录无 git 历史可回溯）。

## 根因分析

- 位置：`scripts/web/app.js` 三处在单号旁渲染类型徽章，而紧邻的单号已含类型前缀，信息重复：

  ```js
  // reqRowEl 需求列表行（修复前）
  <span class="chip ${it.type === 'requirement' ? 'req' : 'bug'}">${it.type === 'requirement' ? 'REQ' : 'BUG'}</span>
  ${itemIdHtml(it.id)}
  // renderDrawer 抽屉头部（修复前）同上拼接
  // renderRefinePanel 需求完善候选行（修复前）
  <span class="chip type-${c.type === 'requirement' ? 'req' : 'bug'}">${c.type === 'requirement' ? 'REQ' : 'BUG'}</span>
  <span class="cid link" data-goto-item="${esc(c.id)}">…</span>
  ```

- 单号格式 `REQ-YYYYMMDD-NNN` / `BUG-YYYYMMDD-NNN` 本身即类型标识，徽章不提供任何增量信息，仅消耗首行横向空间。

## 方案

1. 删除三处徽章 span（列表行 / 抽屉头部 / 需求完善候选行），单号（含前缀）、复制按钮、`data-goto-item` 跳转全部保留；
2. `style.css` 移除失去引用的 `.chip.req` / `.chip.bug` 两行徽章配色；
3. 不动的内容与理由：
   - `--chip-req` / `--chip-bug` 色板变量保留（REQ-20260906-001 的 viewrail 强调色与该色系同源，作色彩语义参考，非徽章专属规则）；
   - 抽屉 meta-grid 的「类型：需求/Bug」字段保留——带标签的结构化详情字段，非与单号并排的"类型图标"，不在本 Bug 字面范围。

## 实施记录（批次 run-20260908-071）

- TDD：先写 `scripts/tests/type-chip-removed.test.mjs`（T1 列表行 requirement/bug 各一、T2 抽屉头部、T3 全局静态契约含 refine 候选行、T4 样式清理），修复前 4 用例全红；实施后全绿。
- 同步两处旧契约（原断言"首行应含 REQ/BUG chip"与新行为冲突）：`detail-close-btn.test.mjs` T1、`pending-accept-inline.test.mjs` T1 改为断言不含徽章并调整顺序校验。
- 验证：`npm test` 全量 84 个测试文件全部通过。

## 影响面

- `scripts/web/app.js`：删 3 行（三处徽章）。
- `scripts/web/style.css`：删 2 行（`.chip.req` / `.chip.bug`）。
- `scripts/tests/type-chip-removed.test.mjs`：新增（4 用例）。
- `scripts/tests/detail-close-btn.test.mjs`、`scripts/tests/pending-accept-inline.test.mjs`：各更新 T1 契约。
- 条目 README（补全现象/复现/期望）、本 design。
