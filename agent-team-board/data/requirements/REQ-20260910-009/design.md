# 设计 — REQ-20260910-009 搜索模块优化

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

现状（`scripts/web/index.html` pageHead / docHits / fileSearchHits，`app.js` runSearch / renderDocHits / renderFileHits）：

- 搜索范围只靠占位符表达，输入后即消失；无显式清除按钮，清除后焦点落在别处。
- 需求视图的条目命中只体现在列表过滤，文档命中放在筛选条之下的独立条带；文件命中只有一句"在文件视图查看"文字，不可点击。
- 反馈条在结果未到时统一显示"搜索中…"，请求失败只弹 toast，区域内没有持久失败说明与重试入口。
- 讨论 / 任务 / 全局为前端过滤（不发请求），但搜索区域下方没有任何关键词 / 范围反馈。
- 列表头「搜索命中 N 项」取的是当前状态档过滤后的可见数，会冒充总命中数。
- 在讨论视图输入关键词后切到需求视图，`state.search.res` 为空又不重发请求，条带永远停留在"搜索中…"。

## 方案

**自研理由**：纯布局 / 交互整理，沿用既有零依赖前端（无框架、无构建），不引入开源库，不创建 licenses.md。

### 1. 搜索输入组（index.html `#pageHead`）

```
[⌕] [范围标签 #searchScope] [输入 #searchInput] [清除 #searchClear] [kbd /]
```

- `#searchScope` 常显当前模块范围（`SEARCH_SCOPE`：需求 / 讨论 / 任务 / 全局·跨项目 / 文件），输入前后均可见；
  `#searchInput` 的 `aria-label` 随范围同步（"在需求中搜索"），`aria-describedby` 指向范围标签。
- `#searchClear` 为显式清除按钮（`aria-label="清除搜索"`），仅在有关键词时显示；点击清空并把焦点交还输入框。
- 设置模块仍整组隐藏（`updatePageHead` 既有逻辑）。

### 2. 统一反馈条 `#searchFeedback`（紧邻 `#pageHead` 之后、`#filterBar` 之前）

替代原 `#docHits`（需求）与 `#fileSearchHits`（文件），五个模块共用一个 `.hits-strip.search-feedback`
区域（`role="region"`、`aria-live="polite"`），由 `renderSearchFeedback()` 按当前模块渲染：

| 模块 | 数据源 | 反馈内容 |
| --- | --- | --- |
| 需求 | `/api/search`（既有） | 关键词 · 范围 · `条目 N` / `文档 M` 两组（各标数量、可点击） · `文件 K · 在文件查看` 跨模块入口 · 截断提示 · 清除 |
| 文件 | `/api/search`（既有，同一响应） | 关键词 · 范围 · 路径 chip 列表（点击 `openFile`） · `需求 / Bug / 文档命中 N · 在需求查看` 跨模块入口 |
| 讨论 | 前端过滤（`ATBOncall.setQuery`） | 关键词 · 范围 · `命中 N / 共 T`（`ATBOncall.searchStats()` 新增只读统计） |
| 全局 | 前端过滤（`globalTaskMatches`） | 关键词 · 范围 · `命中 N（当前筛选可见 M）` |
| 任务 | 前端过滤（既有占位符语义） | 关键词 · 范围 · 提示"面板内前端过滤"（既有面板未真正过滤，另登记 Bug，不在本条扩展） |

需求列表继续按命中条目过滤（`searchVisibleItems` 不变），列表头提示改为
`搜索命中条目 N 项（当前档可见 M 项）`；`M === 0` 时明确"当前档无可见命中，切换状态筛选查看"，
可见数不再冒充总命中数。

文件模块搜索期间不再隐藏目录横幅（反馈条已在搜索区域下方，横幅属模块原有内容）。

### 3. 状态机（`state.search`）

`{ q, seq, res, resQ, timer, loading, error }`：

- **未输入**：`q` 为空 → 反馈条隐藏，仅范围标签可见，不显示"无匹配"。
- **加载**：`loading=true` → 反馈条显示"正在搜索「q」…"；若存在上一关键词的 `res`（`resQ !== q`），
  分组结果保留并标注"旧结果（「resQ」）"，不呈现为新词的完成结果。
- **正常**：`res` 且 `resQ === q` → 关键词、范围、分组数量与可点击结果。
- **空结果**：三类计数全为 0 → "未找到匹配结果"，给出修改关键词 / 清除搜索建议，与模块自身无数据区分。
- **失败**：`error` 持久显示在反馈条内 + 「重试」按钮（用当前关键词再次 `runSearch`），关键词保留，
  不再只用 toast；成功后清除错误。
- **截断**：`res.truncated` 非空 → "仅显示部分结果（每类前 50 条），请缩小关键词"。

### 4. 交互

- 输入沿用 250ms 防抖；`Enter` 清防抖定时器并立即 `runSearch`；`Esc` / 清除按钮走 `clearSearch()`：
  清关键词与结果、`seq++` 让在途响应作废、焦点留在输入框、不关闭已打开详情（不调 `closeDrawer`）。
- `setView` 后 `ensureSearchForView()`：需求 / 文件视图若关键词非空且没有对应本词的结果（`resQ !== q`）且未在加载，
  重发 `/api/search`（修复讨论视图输入后切需求"永远搜索中"）；讨论沿用 `setQuery`，任务 / 全局在各自渲染中读 `state.search.q`。
- 跨模块入口 `data-goto-view`：只 `setView(目标)`，关键词保留，由同一响应 / 前端过滤重新解释。
- 竞态：`seq` 守卫不变，清空 / 切模块后旧响应不覆盖当前状态。

### 5. 样式（style.css）

- `.search-scope` 胶囊标签、`.search-clear` 圆形小按钮，二者与输入框同组；`.page-head .module-search` 宽屏靠右
  `flex: 0 1 380px`，`≤720px` 改 `flex: 1 1 100%; margin-left: 0` 独占一行，无横向溢出。
- `.search-feedback`：头行 flex-wrap，分组 `.hits-group` / `.hits-group-title`，`.hit-row.item` 长标题省略并带 `title` 全文，
  文件 chip `max-width: 100%` + 名称省略；错误 `.hits-error`、旧结果 `.hits-stale`；区域内 `max-height` 滚动。
- 键盘：`.search-clear` / `.hit-row` / `.hits-retry` / `.hits-goto` 的 `:focus-visible` 描边。

## 风险与边界

- 不新增全文索引、排序、搜索历史、跨项目范围；搜索 API 与讨论 / 任务 / 全局的数据源不变。
- 旧契约测试 `global-search-ui.test.mjs`（REQ-20260906-015）以函数名 `renderDocHits` / `renderFileHits`、
  `loadDoc(` / `openFile(` 与 `.hits-strip` 断言，本次保留这些名称与类名。
- 任务模块面板（批量完善 / 批量开发）当前不按关键词过滤，属既有缺口：已登记 BUG-20260910-009，本条只在反馈条如实提示。
