# 设计 — BUG-20260908-022 修改提示词功能去掉

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260906-011（引入待接受/已接受条目「修改」按钮——前端拉取条目现状文档、
  组装成修改提示词复制到剪贴板，引导粘贴到会话让 Agent 修订文档；REQ-20260908-011 将按钮
  文案由「修改」更名消歧为「修改提示词」。两 ID 均经 `atb list` 核验存在）
- 补充关联：REQ-20260908-011 同时提供了待接受条目「✎ 改标题/描述」直接编辑入口，但两者
  能力范围不等价（后者仅 submitted、仅标题/描述），本 Bug 为整体下线决策，不是被其替代。

## 根因分析

非代码缺陷，属产品决策下线：登记人要求「修改提示词」功能整体移除（界面与代码均不残留）。
该功能由 REQ-20260906-011 引入并完整在线运行（卡片 + 详情抽屉两处入口、专属样式、专属测试
`edit-prompt.test.mjs`）。下线动机登记时未注明，按 README 口径不做替登记人认定。

## 方案

1. 前端 `scripts/web/app.js`：
   - 整段删除「修改提示词」实现区块（含区块注释）：
     `editableStatus` / `editBtnHtml` / `bindEditButtons` / `itemDirRel` / `fetchItemEditPrompt` / `copyEditPrompt`；
   - 删除两处调用点：卡片 `reqRowEl` 内 `${editBtnHtml(it)}` 与 `bindEditButtons(el)`；
     详情抽屉 `renderDrawer` 内 `${editBtnHtml(it)}`（两处）与 `bindEditButtons(drawer)`；
   - 抽屉操作区占位回退 `drawerActionsButtonHtml(it) || (editBtnHtml(it) ? '' : '—')`
     简化为 `drawerActionsButtonHtml(it) || '—'`：submitted/accepted 均有常驻操作按钮，
     回退占位仅覆盖无操作按钮的状态，简化后行为不变。
2. 样式 `scripts/web/style.css`：删除 `.card-edit-btn` 三条规则与区块注释。
3. 后端文案 `scripts/lib/core.mjs`：`renameItem` / `editItem` 非 submitted 报错由
   「其余状态请用 Status Board『修改（提示词）』整理文档，或另立新单」改为
   「其余状态请直接编辑条目目录下的 markdown 文档，或另立新单」。
4. 测试：
   - 删除 `scripts/tests/edit-prompt.test.mjs`（run-all.mjs 按文件名聚合，删除即移出套件）；
   - `scripts/tests/edit-content.test.mjs`：U4/U5 改写为下线契约（无功能残留 + 共用能力保留），
     新增 C12 断言 `renameItem` / `editItem` 报错文案不再引导「修改提示词」且仍拒绝非 submitted。
5. 保留共用能力（不得误删）：`copyPlain()`（单号/路径复制仍用）、
   `/api/item/:id` 与 `/api/item/:id/doc/:name` 接口（详情抽屉仍用）、
   REQ-20260908-011 的「✎ 改标题/描述」与 `atb rename` / `atb edit`。

## 风险与边界

- 非 submitted 条目修订文档的途径回归：直接手动编辑条目目录 markdown，或另立新单 / 走 Bug 流程
  （与 README 期望行为第 7 条一致）；
- 不触碰状态机与任何 `status.json`；
- 被删函数引用的共用常量（`STATE_LABEL` 等）仍被其他功能使用，保留不动；
- 界面上 submitted/accepted 卡片按钮区各少一个按钮，其余按钮布局（flex 布局）自适应，无需样式补偿。

## 实施记录（2026-09-08，zcode-batch-018-1）

- `scripts/web/app.js`：删除「修改提示词」整段实现（`editableStatus` / `editBtnHtml` /
  `bindEditButtons` / `itemDirRel` / `fetchItemEditPrompt` / `copyEditPrompt`）及卡片、
  详情抽屉两处调用；抽屉操作区占位回退简化为 `drawerActionsButtonHtml(it) || '—'`。
- `scripts/web/style.css`：删除 `.card-edit-btn` 三条规则与区块注释。
- `scripts/lib/core.mjs`：`renameItem` / `editItem` 非 submitted 报错文案改为
  「其余状态请直接编辑条目目录下的 markdown 文档，或另立新单」。
- `scripts/tests/edit-prompt.test.mjs`：删除（原 C1–C6 随功能下线废弃）。
- `scripts/tests/edit-content.test.mjs`：U4/U5 改写为下线契约，新增 C12（TDD：先跑红后跑绿）。
- 核验：`edit-content.test.mjs` 20/20 通过；`npm test` 99 个测试文件失败 0；
  验收 grep（`editBtnHtml|bindEditButtons|card-edit-btn|fetchItemEditPrompt|copyEditPrompt|data-edit-id|itemDirRel`）
  仅命中新契约测试自身的「不存在」断言，功能代码零残留；「修改提示词」文案在 scripts/ 源码中零残留。
