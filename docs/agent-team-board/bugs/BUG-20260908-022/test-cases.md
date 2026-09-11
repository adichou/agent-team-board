# 测试用例 — BUG-20260908-022 修改提示词功能去掉

> 落点：`scripts/tests/edit-content.test.mjs`（U4/U5 改写 + 新增 C12）；
> `scripts/tests/edit-prompt.test.mjs` 整文件删除（原 C1–C6 随功能下线废弃）。

## 下线契约

- **C12**（core 行为）：非 submitted 条目调用 `renameItem` / `editItem` 仍被拒绝（AtbError、
  标题/描述不落盘）；报错文案不再出现「修改提示词」或「Status Board『修改』」引导，
  改为「直接编辑条目目录下的 markdown 文档，或另立新单」口径。
- **U4**（UI 静态，改写）：`app.js` 无功能残留——`editableStatus` / `editBtnHtml` /
  `bindEditButtons` / `itemDirRel` / `fetchItemEditPrompt` / `copyEditPrompt` /
  `data-edit-id` / 「修改提示词」文案均不存在；卡片与旧「修改」文案不复活；
  详情抽屉操作区占位回退简化为 `drawerActionsButtonHtml(it) || '—'` 且保留 '—' 兜底；
  `style.css` 无 `.card-edit-btn`。
- **U5**（UI 静态，改写）：共用能力不受影响——`copyPlain()`、`data-copy-id`（单号复制）、
  `data-delete-id`（删除）、`data-accept-id`（接受）、`data-rename-id`（✎ 改标题/描述）、
  `bindDeleteButtons(drawer)` / `bindCopyIdButtons(drawer)` 均保留。
- **T1**（测试套件）：`scripts/tests/edit-prompt.test.mjs` 已删除（`run-all.mjs` 按文件名聚合，
  文件不存在即移出套件；由仓库/目录核验，不在测试内自证）。

## 回归

- `edit-content.test.mjs` C1–C11、U1–U3 原样通过（编辑标题/描述能力不受影响）；
- `rename-reject.test.mjs`、`drawer-actions-row.test.mjs` 等既有套件全量通过（`npm test`）；
- 手工核验（B1，验收用）：`grep -rn "editBtnHtml\|bindEditButtons\|card-edit-btn\|fetchItemEditPrompt\|copyEditPrompt\|data-edit-id\|itemDirRel" scripts/` 无输出。
