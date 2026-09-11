# 设计 — REQ-20260906-015 支持全局搜索，可以任意搜索需求，bug 和文件数中的文件。在需求看板界面就是搜索需求、bug，设计文档，在文件看板就是搜索文件

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

看板条目与文件数量增长后，人工在网页上找一条需求/Bug、一篇设计文档或一个项目文件只能靠肉眼扫四列卡片或逐层展开文件横幅。REQ-20260906-015 要求一个全局搜索入口，按当前视图给出不同结果形态。

## 方案

**服务端：新增 `GET /api/search?q=<关键词>`（server.mjs，与 /api/board 同层）**

返回 `{ q, items, docs, files, truncated }` 三桶结构：

- `items`：`core.listItems(dataDir)` 过滤 `id`/`title` 大小写不敏感子串命中，元素 `{ id, type, title, status }`。
- `docs`：对每个条目目录 `core.orderedDocs(dir)` 列出的 .md 逐文件读内容，取**首个非 H1**（不以 `# ` 开头）的匹配行，元素 `{ id, name, line, text }`（行号从 1 计，text 截断 160 字符）。
- `files`：从项目根 DFS 递归遍历，忽略 `FS_EXCLUDE`（node_modules/.git）、隐藏文件/目录与符号链接（防循环）；basename 大小写不敏感子串命中，元素 `{ path, size, mtime }`（path 为项目内相对路径）。
- 上限保护：每类最多 50 条（`truncated` 标记命中的桶）；DFS 深度 ≤16、扫描条目 ≤20000，超限即止。
- q trim 后为空（或缺失）→ 200 + 三个空数组；`dataDir` 不存在（未初始化项目）→ items/docs 为空、files 照常。

**前端（app.js / index.html / style.css）**

- `state.search = { q, seq, res }`：seq 自增序号做竞态防护（旧响应丢弃）。
- 顶栏 `.top-actions` 首位插入 `.global-search` 输入框；`setView` 时同步 placeholder 与结果条带可见性。
- 输入防抖 250ms → `api('/api/search?q=…')` → 更新 `state.search` → 按视图渲染：
  - status：`renderBoard` 在 q 非空时按 `items` 的 id 集合过滤各列卡片（列签名加入 q，避免轮询签名相同跳过重渲染）；`#docHits` 条带渲染 docs 命中，点击 `openDrawer(id)` 后 `loadDoc(name, true)` 定位文档。
  - files：`#fileSearchHits` 条带渲染 files 命中 chip，点击 `openFile(path)`；条带显示时隐藏常规文件横幅。
- 清空：input 事件检测空值 / `search` 事件（✕）/ 输入框内 Esc（stopPropagation，避免触发全局 Esc 关抽屉）。
- 样式：`.global-search` 胶囊输入框 + `.hits-strip` 通栏结果条带（docs 每条一行链接、files 为 chip 流式布局），沿用现有 CSS 变量与深浅色主题。

**影响面**

- server.mjs：+1 路由（只读，不触碰状态机）。
- web/index.html、app.js、style.css：顶栏 +1 输入框、+2 结果条带容器；`renderBoard` 过滤逻辑、`setView` placeholder 同步。
- 不改动任何 atb CLI / hooks / 状态流转；纯查询能力。

## 风险与边界

- 大项目全量 DFS 可能偏慢：以扫描条目上限 20000 + 深度上限兜底；本地单用户看板规模下可接受，后续如需可加索引缓存。
- 文档内容搜索只覆盖条目目录下 .md（README/design/test-cases/test-report），不搜全部项目文件内容（那是文件名搜索 + 点开查看的职责边界）。
- 搜索结果不改变看板数据，2 秒轮询与搜索过滤相互独立，过滤在轮询重渲染时持续生效。

## 实施记录（2026-09-07，zcode-batch-003-1）

- 服务端 `scripts/server.mjs`：新增 `GET /api/search?q=`（只读路由，位于 /api/board 旁）与 `handleSearchApi` / `searchItems` / `searchDocs` / `searchFiles`。每类上限 50（多取 1 条判定截断，`truncated` 数组标记命中的桶）；文件 DFS 忽略 `node_modules`/`.git`/隐藏条目/符号链接，深度 ≤16、扫描 ≤20000；文档搜索跳过每篇首行 H1，取首个匹配行（行号 1 起、摘要截 160 字符）；q trim 为空或未初始化项目返回空桶、HTTP 200。
- 前端 `scripts/web/index.html`：`.top-actions` 内 view-tabs 之前加 `.global-search`（`#searchInput`）；`#board` 之前加 `#docHits` 条带；`#fileView` 内 banner 之前加 `#fileSearchHits` 条带。
- 前端 `scripts/web/app.js`：`state.search = { q, seq, res, timer, loading }`；`SEARCH_DEBOUNCE_MS = 250` 防抖 + seq 竞态防护；`runSearch`/`clearSearch`/`bindSearchOnce`/`updateSearchPlaceholder`/`renderSearchHits`/`renderDocHits`/`renderFileHits`；`renderBoard` 经 `searchVisibleItems` 过滤各列卡片并把 `state.search.q` 纳入列签名（轮询不重置过滤）；`submittedItems`/`implCandidates` 同步走可见集合（全选只作用于可见卡片）；`setView` 同步 placeholder 并按新视图重渲染条带；`switchProject` 使旧结果失效并对新项目重搜；输入框内 Esc `stopPropagation`（不触发全局 Esc 关抽屉）。
- 样式 `scripts/web/style.css`：`.global-search` 胶囊输入框（focus 描边 --viewrail-accent、loading 态图标省略号指示）、`.hits-strip` 通用条带（docs 每条一行、files 复用 `.fchip` chip 流式布局）、`.file-view > .hits-strip` 贴合文件视图 padding；窄屏沿用 topbar wrap 降级。
- 测试：新增 `scripts/tests/search-api.test.mjs`（S1–S9，真实起 server 集成）与 `scripts/tests/global-search-ui.test.mjs`（U1–U6，静态契约）；`npm test` 全量 45 个测试文件 0 失败。M1（浏览器人工验收）留待人工。
