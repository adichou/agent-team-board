# BUG-20260908-022 修改提示词功能去掉

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260906-011（引入待接受/已接受条目「修改」按钮：拉取现状文档组装为修改提示词复制；REQ-20260908-011 将按钮文案更名消歧为「修改提示词」。两 ID 均经 `atb list` 核验存在）
- 创建：2026-09-08T15:45:38.523Z

## 现象

Status Board 的「修改提示词」功能（点击按钮拉取条目全部现状文档、组装成修改提示词并复制到剪贴板）需要整体下线，但目前该功能仍完整在线上运行：

- 由 REQ-20260906-011 引入（原文案「修改」），REQ-20260908-011 更名消歧为「修改提示词」。
- 现仍出现在两处界面：
  - 列表页「待接受（submitted）/ 已接受（accepted）」两列卡片头部，单号复制按钮右侧（`scripts/web/app.js` 卡片渲染处调用 `editBtnHtml(it)`，约 1147 行）；
  - 详情抽屉操作区（`scripts/web/app.js` 约 2143–2144 行渲染、约 2182 行 `bindEditButtons(drawer)` 绑定）。
- 功能实现代码在 `scripts/web/app.js` 约 1305–1386 行（`editableStatus` / `editBtnHtml` / `bindEditButtons` / `itemDirRel` / `fetchItemEditPrompt` / `copyEditPrompt`），专属样式在 `scripts/web/style.css` 的 `.card-edit-btn` 块（约 1022–1030 行），专属测试 `scripts/tests/edit-prompt.test.mjs`。
- `scripts/lib/core.mjs` 中 `renameItem`（约 478 行）与 `editItem`（约 541 行）的非 submitted 报错文案仍引导用户「请用 Status Board『修改提示词』整理文档」；`scripts/tests/edit-content.test.mjs` 的 U4/U5 用例仍断言该按钮存在。

下线决策的动机登记时未注明（待确认；一个可能的相关背景是 REQ-20260908-011 已提供待接受条目「✎ 改标题/描述」直接编辑入口，但两者能力范围并不等价，不能替登记人认定）。

## 复现步骤

1. 启动看板服务：`node scripts/server.mjs`（默认 `127.0.0.1:8888`），浏览器打开 Status Board。
2. 任选一个处于「待接受」或「已接受」的需求或 Bug（本 Bug 自身即 accepted，可直接用）。
3. 观察该条目卡片头部按钮区：仍出现「修改提示词」按钮；点开详情抽屉，操作区同样出现该按钮。
4. 点击该按钮：前端拉取条目详情与全部现状文档，组装修改提示词写入剪贴板，按钮短暂显示「已复制 ✓」并 toast「已复制 `<单号>` 修改提示词…」——即待下线功能仍可正常使用。

## 期望行为

「修改提示词」功能整体移除，界面与代码均不残留：

1. 界面：submitted / accepted 条目的卡片与详情抽屉不再渲染「修改提示词」按钮；其余按钮（接受、✎ 改标题/描述、删除、导航等）布局与交互不受影响。详情抽屉操作区原有的占位兜底逻辑（`drawerActionsButtonHtml(it) || (editBtnHtml(it) ? '' : '—')`）需同步调整，避免移除后出现空白或错误占位。
2. 前端代码：删除 `scripts/web/app.js` 中该功能专属的函数与调用点（`editableStatus` / `editBtnHtml` / `bindEditButtons` / `itemDirRel` / `fetchItemEditPrompt` / `copyEditPrompt` 及卡片、抽屉两处调用）。
3. 样式：删除 `scripts/web/style.css` 的 `.card-edit-btn` 样式块。
4. 后端文案：`scripts/lib/core.mjs` 中 `renameItem` / `editItem` 报错文案不再引导使用「修改提示词」（改为「直接编辑条目目录 markdown 或另立新单」之类的口径，具体措辞开发阶段定）。
5. 测试：删除 `scripts/tests/edit-prompt.test.mjs`；`scripts/tests/edit-content.test.mjs` 中断言「修改提示词」按钮存在的 U4 / U5 用例同步改写。
6. 必须保留的共用能力（不得误删）：
   - `copyPlain()`（`scripts/web/app.js`，单号复制 / 路径复制仍在用）；
   - `/api/item/:id` 与 `/api/item/:id/doc/:name` 接口（详情抽屉等仍在用）；
   - REQ-20260908-011 的「✎ 改标题/描述」直接编辑与 `atb rename` / `atb edit` 能力。
7. 下线后非待接受条目修订文档的途径回归：直接手动编辑条目目录下 markdown，或另立新单 / 走 Bug 流程。

## 验收说明

- [ ] submitted / accepted 两列卡片与详情抽屉均不再出现「修改提示词」按钮；其余操作按钮布局无错位、无空白占位异常。
- [ ] 单号复制、「✎ 改标题/描述」、接受、删除、详情抽屉打开与上下条导航等既有交互不受影响。
- [ ] `grep -rn "editBtnHtml\|bindEditButtons\|card-edit-btn\|fetchItemEditPrompt\|copyEditPrompt\|data-edit-id\|itemDirRel" scripts/` 无功能残留（node_modules 除外）。
- [ ] `scripts/lib/core.mjs` 中不再出现引导使用「修改提示词」的报错文案；对非 submitted 条目调用 `atb rename` / 编辑接口仍正确报错拦截。
- [ ] `scripts/tests/edit-prompt.test.mjs` 已删除，`edit-content.test.mjs` 相关用例已改写；`npm test`（`node scripts/tests/run-all.mjs`）全部通过。
- [ ] 看板条目状态流转（status.json）不受本次改动影响。
