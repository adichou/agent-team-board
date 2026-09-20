# 测试报告 — REQ-20260910-009 搜索模块优化

- 时间：2026-09-10T04:01:51.274Z
- 执行者：zcode-batch-031-4
- 测试框架：node:assert 静态契约（零依赖）
- 覆盖率：8%

## 总结

搜索模块优化：搜索组新增常显范围标签 #searchScope（aria-label 随模块同步）与显式清除按钮 #searchClear（清空后焦点留输入框、不关详情、seq++ 作废在途响应）；Enter 清防抖立即搜索；统一反馈条 #searchFeedback（role=region/aria-live，替代 #docHits/#fileSearchHits）覆盖未输入/加载/旧结果/正常/空/失败重试/截断六态；需求结果分「条目/文档」两组各标数量，文件路径 chip 与 data-goto-view 跨模块入口保留关键词；列表头改为「搜索命中条目 N 项（当前档可见 M 项）」；ensureSearchForView 修复讨论输入后切需求停留「搜索中」；oncall.js 新增 searchStats 导出；≤720px 搜索组独占整行。S1–S11 全部通过；全量 scripts/tests 138 个测试文件 0 失败（REQ-20260910-008 L3 随口径升级同步改写）；任务面板不过滤缺口登记 BUG-20260910-009；M1–M5 待人工浏览器验收

## 明细

### 自动化（TDD：先红后绿）

- `node scripts/tests/search-module-20260910-009.test.mjs`：S1–S11 共 11 用例全部通过
  （实施前同测试 S1–S10 失败、S11 通过，为预期红态；旧契约 `global-search-ui.test.mjs` U1–U6 保持通过）。
- 全量回归：`scripts/tests/*.test.mjs` 138 个测试文件全部通过（0 失败）。
- 覆盖率口径：11 个自动化用例 / 138 个测试文件 ≈ 8%（与 REQ-20260910-008 报告口径一致，仅作规模参考）。

### 变更文件

- `scripts/web/index.html`：#searchScope / #searchClear 入组；新增 #searchFeedback；移除 #docHits / #fileSearchHits。
- `scripts/web/app.js`：state.search 增 resQ/error；SEARCH_SCOPE；clearSearch（seq++/落焦）；runSearch（失败持久 error、成功记 resQ、先渲染加载态）；bindSearchOnce（Enter 立即搜 / 清除按钮）；renderSearchFeedback（统一反馈条 + 点击绑定）；renderDocHits / renderFileHits 改分组构建；retrySearch / ensureSearchForView / syncSearchClearBtn；renderBoard 提示区分总命中与当前档可见。
- `scripts/web/oncall.js`：新增 searchStats 只读统计并导出。
- `scripts/web/style.css`：.search-scope / .search-clear / .search-feedback / .hits-group(-title) / 状态文案样式 / 键盘焦点描边 / ≤720px 搜索组整行；移除 .file-view > .hits-strip（条带已统一）。
- `scripts/tests/caption-toolbar-20260910-008.test.mjs`：L3 随本条提示语升级同步改写
  （「搜索命中 N 项」→「搜索命中条目 N 项（当前档可见 M 项）」，补 resQ 一致才显示的语义）。

### 关联

- 新登记 BUG-20260910-009（任务模块搜索不过滤批量完善 / 批量开发面板，既有缺口，本条仅在反馈条如实提示）。
- M1–M5 为浏览器人工验收项（宽窄屏布局、Enter/Esc/清除焦点行为、断网失败重试、档位可见数提示、讨论切需求自动补发），待人工在 Status Board 确认。

