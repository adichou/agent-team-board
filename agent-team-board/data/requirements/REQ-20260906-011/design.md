# 设计 — REQ-20260906-011 待接收和已接收的需求和 bug 要提供修改按钮，将用户要修改的内容整理成提示词复制到剪贴板

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

submitted / accepted 两列条目在实施前的人工修订只能手动复制目录 markdown、手写提示词，
缺一个一键「整理现状 → 出修改提示词」的入口。

## 方案

仅改前端 `scripts/web/app.js`（+ 少量 `style.css`），后端 API 复用现成接口：

- `GET /api/item/:id`（`docs` 列表，卡片数据 `listItems` 不含 docs，点击时现取）；
- `GET /api/item/:id/doc/:name`（逐份文档全文）。

新增（与单号复制按钮 REQ-20260906-006 同一交互范式）：

- `editBtnHtml(it)`：`it.status` 为 submitted / accepted 时渲染
  `<button class="btn card-edit-btn" data-edit-id>`，插入 `itemIdHtml(it.id)` 之后
  （卡片头部）；详情抽屉插入操作区中心列（状态按钮旁）。
- `bindEditButtons(root)`：事件委托绑定，`stopPropagation` 防打开详情。
- `fetchItemEditPrompt(id)`：拉详情 + 逐份文档 → 组装提示词；任何一步失败向上抛错。
- `copyEditPrompt(id, el)`：禁用防重入 → 取提示词 → `copyPlain` 复制（clipboard 优先、
  execCommand 降级）→ 成功按钮闪「已复制 ✓」（1200ms 恢复）+ toast；失败 toast 报错并恢复。

提示词结构（四反引号围栏包裹文档，防文档自身含三反引号代码块）：

```
修改看板条目 <ID>「<标题>」（<需求|Bug> · <状态标签>）

请按下方「修改要求」修订该看板条目的文档，条目目录：<requirements|bugs>/<ID>/（docs/agent-team-board 下）。
只允许编辑该目录中的 markdown 文档；status.json 是机器状态，禁止改动；不要变更条目状态或流转。

修改要求：
（在此补充要修改的内容）

现状文档（以此为准逐份核对）：

#### README.md
````markdown
…
````
```

样式：`.card-edit-btn` 与 `.copy-id-btn` 同规格（flex:none、小字号、焦点轮廓），卡片头部允许换行已由
`.card-top { flex-wrap: wrap }` 覆盖。

## 风险与边界

- 卡片数据无 `docs` 字段，点击时实时拉取：本地服务开销小；失败如实 toast，不留中间态。
- 只对 submitted / accepted 出按钮：in-progress 已在实施（修改应走 /bug 或人工驳回），done 已完结。
- 提示词含文档全文可能较长，属预期（「整理成提示词」的目的就是给足上下文）；不截断。
- 文档名经 `/^[\w.-]+\.md$/` 校验的既有接口读取，无注入面；标题等一律 `esc` 转义进 HTML，
  提示词为纯文本复制不经 innerHTML。
- 轮询增量渲染（colSigs）不重建未变化列，按钮绑定随 `cardEl` 建立，无重绑问题。

## 实施记录（zcode-batch-005-1，2026-09-07）

- `scripts/web/app.js`：新增「修改按钮」小节（`editableStatus` / `editBtnHtml` / `bindEditButtons` /
  `itemDirRel` / `fetchItemEditPrompt` / `copyEditPrompt`）；`cardEl` 头部在单号复制按钮后插入，
  `renderDrawer` 操作区中心列插入并绑定。
- `scripts/web/style.css`：`.card-edit-btn` 与 `.copy-id-btn` 同规格 + 成功态。
- 顺手修复：`copyPlain` execCommand 降级抛错时临时文本域不清理（改 try/finally 移除），
  本条目 C6 用例覆盖该清理路径。
- 测试：`scripts/tests/edit-prompt.test.mjs` 6 用例（vm + mock DOM/fetch/clipboard）先红后绿；
  全量 58 个测试文件全部通过。
- 详情 / 文档拉取绑定发起时的 `state.project`，与批量接受等入口的在途请求语义一致。

