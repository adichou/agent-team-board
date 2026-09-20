# 测试用例 — REQ-20260910-009 搜索模块优化

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 自动化：`node scripts/tests/search-module-20260910-009.test.mjs`（零依赖静态契约，参照 global-search-ui.test.mjs）；
> 旧契约 `global-search-ui.test.mjs`（REQ-20260906-015）须同时保持通过。M 系列为浏览器人工验收。
> 结果（2026-09-10，zcode-batch-031-4）：S1–S11 全部通过；全量 scripts/tests 138 个测试文件 0 失败
> （REQ-20260910-008 的 L3 随本条提示语升级同步改写为「搜索命中条目 N 项（当前档可见 M 项）」口径）。
> M1–M5 待人工浏览器验收。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | `#pageHead` 搜索组含常显范围标签 `#searchScope`；`SEARCH_SCOPE` 覆盖 status/oncall/runs/global/files 五模块且与 `SEARCH_PLACEHOLDER` 同键；设置模块隐藏整组 | 高 | 通过 |
| S2 | 输入组含显式清除按钮 `#searchClear`（`aria-label`），点击走 `clearSearch`；`clearSearch` 把焦点交还 `#searchInput` 且不调用 `closeDrawer` | 高 | 通过 |
| S3 | 输入框 `Enter` 清防抖定时器并立即 `runSearch`；`Esc` `stopPropagation` 后清空；防抖常量 250ms 保留 | 高 | 通过 |
| S4 | 统一反馈条 `#searchFeedback` 紧邻 `#pageHead` 之后、`#filterBar` 之前，带 `role="region"` 与 `aria-live`；旧 `#docHits` / `#fileSearchHits` 已移除 | 高 | 通过 |
| S5 | 需求视图结果分「条目」「文档」两组各标数量，条目行点击 `openDrawer`、文档行 `loadDoc`；文件命中数量带 `data-goto-view="files"` 入口；文件视图有 `data-goto-view="status"` 返回入口，路径 chip 点击 `openFile`；跨模块入口只 `setView` 不清关键词 | 高 | 通过 |
| S6 | 状态机：`state.search` 含 `error` / `resQ`；失败时 `s.error` 持久渲染 + `.hits-retry` 重试按钮（调用 `runSearch`）；加载文案「正在搜索」；旧结果标注「旧结果」；空结果「未找到匹配结果」；不再用 toast 作为唯一失败反馈 | 高 | 通过 |
| S7 | 列表头提示区分总命中与当前档可见（`搜索命中条目 N 项` + `当前档可见`）；零可见时说明筛选影响；截断提示含「仅显示部分结果」 | 高 | 通过 |
| S8 | 竞态与重解释：`seq` 守卫保留；`clearSearch` 递增 `seq`；`setView` 后 `ensureSearchForView` 在需求/文件视图缺少本词结果时重发；`switchProject` 仍重发 | 高 | 通过 |
| S9 | 讨论前端过滤计数：`oncall.js` 导出 `searchStats`；全局视图用 `globalTaskMatches` 计数；反馈条前端模块不发 `/api/search` | 中 | 通过 |
| S10 | style.css：`.search-scope`、`.search-clear`、`.search-feedback`、`.hits-group` 规则存在；`≤720px` 媒体查询下 `.module-search` 独占整行（`flex: 1 1 100%`）；`.hit-row:focus-visible` 等键盘焦点描边；`.global-search` 保留 `min-width` | 高 | 通过 |
| S11 | `ui-demo.html` 存在于条目目录且 README 含 `./ui-demo.html` 相对链接；演示为单文件内联（无外链 script/css） | 中 | 通过 |
| M1 | 1280px：副标题左、搜索组右同一行；375px：搜索组独占一行，反馈条按钮换行，无横向滚动 | 高 | 人工待验收 |
| M2 | 输入 → 250ms 出结果；Enter 立即；Esc / ✕ 清空后焦点仍在输入框，已打开详情不关闭 | 高 | 人工待验收 |
| M3 | 断网后搜索：反馈条内红色失败说明 + 重试；恢复后点重试成功且错误消失 | 高 | 人工待验收 |
| M4 | 需求视图切「已完成」等档位：列表头显示「搜索命中条目 N 项（当前档可见 M 项）」，M=0 时提示切换筛选 | 中 | 人工待验收 |
| M5 | 讨论视图输入关键词后切到需求视图：自动发起搜索，不再停留「搜索中」 | 中 | 人工待验收 |
