# 测试报告 — BUG-20260914-009 dev 界面只加载最近 50 条，需要修复成显示所有，并支持分页展示

- 时间：2026-09-14T06:01:25.435Z
- 执行者：zcode-batch-048-BUG-20260914-009
- 测试框架：node:assert/strict + vm 桩 DOM + 真实 server HTTP（项目自研测试口径）
- 覆盖率：未统计

## 总结

分支浏览提交记录放开 50 条静默截断并支持分页：数据层 branchLog 改 {limit,offset}（默认 50/0、clamp 1..500、git log --skip 偏移、rev-list --count 返回 total）；服务端 /api/build/branch-log 透传 limit/offset 与 total；前端分页条（上一页/页码折叠/下一页/每页 20/50/100 + 第 x–y 条 / 共 N 条 + 末页已到末尾反馈）、翻页失败保留旧内容可重试、切分支重置第一页、刷新当前页。新增 build-serve S8b（>200 条跨页/末页/非法参数归一/超界空页）与 build-ui N7e/N7f（vm 行为 + 静态契约），先红后绿；全量 226 文件 0 失败。引入来源归因 REQ-20260913-001。

## 明细

（可粘贴命令输出、失败用例说明等）

### 变更清单

- `scripts/lib/build-git.mjs`：`branchLog(root, branch, { limit = 50, offset = 0 } = {})`——放开原
  「默认 50 / 上限 200 且无翻页」：limit clamp [1,500]、offset ≥0（`git log -n <n> --skip <offset>`）、
  `git rev-list --count` 取 total，响应 `{ branch, commits, total, limit, offset }`；offset ≥ total 返回空页不报错。
- `scripts/server.mjs`：`GET /api/build/branch-log` 透传 `?limit=&offset=`（缺省/非法由数据层归一）；
  接口文档注释由「≤50 条」更新为分页口径。
- `scripts/web/build.js`：state 增 `logPage/logPageSize(20|50|100)/logRetryTarget`；`selectBranch(branch, page=1)`
  切分支重置第一页；`loadLog(target)` 带 `&limit=&offset=` 请求，翻页失败保留已加载内容与页码 + 行内错误 +
  `#bldLogRetry` 重发目标页（首次加载失败维持原清空 error 态）；`gotoLogPage/setLogPageSize/retryLogPage`
  行为接缝；`logPagerHtml()` 纯函数渲染分页条（上一页 / 页码折叠 … / 下一页 / 每页条数下拉 /
  「第 x–y 条 / 共 N 条」/ 当前页 `aria-current="page"`）；末页「已到末尾 · 共 N 条提交（可翻至分支首个提交）」；
  头部「刷新」改刷当前页；bindCommon 绑定 `[data-pg]`、`#bldLogSize`、`#bldLogRetry`。
- `scripts/web/style.css`：新增 `.bld-log-pager / .bld-log-gap / .bld-log-range / .bld-log-eof`
  （跟随既有深浅色 CSS 变量，窄屏 range 换行）。
- 测试：`scripts/tests/build-serve.test.mjs` S8b 分页段（独立 long 分支 commit-tree 造 62 提交、总 64）；
  `scripts/tests/build-ui.test.mjs` N7e（vm 行为 9 组断言）/ N7f（静态契约）。

### TDD 过程

- 红：build-ui → 14 用例失败 2（N7e「首屏请求 limit=50&offset=0」、N7f「bindCommon 循环绑定 data-pg」）；
  build-serve → 1 用例失败 1（S8b「默认响应带 total 总数」）。
- 绿：实现后 build-ui 14 用例失败 0；build-serve 1 用例失败 0。期间两次仅修正测试断言自身
  （long 总数按 dev 既有 2 提交修正为 64；第 41 新条位置公式修正 bulk 22），实现未回改。
- 全量回归：`node scripts/tests/run-all.mjs` → 共 226 个测试文件，失败 0。
- 完整日志：`docs/agent-team-board/dispatch/runs/run-20260914-231/test-log.md`。

### 用例覆盖要点（对验收说明）

1. 完整性：limit=10000 归一 500 下 64 条全量可达；offset=62 翻到分支首个提交（init）。
2. 分页交互：翻页 offset 跟随、首页/末页按钮禁用、失败保留旧内容 + 重试恢复、翻页期间 loading 反馈。
3. 切分支重置回第一页并重新加载；刷新当前页；未选分支占位不变。
4. 状态反馈不回归：加载中 / 失败 / 空分支文案与现状一致；分支列表功能用例（N7d）不变仍绿。
5. 接口分页参数生效；负数 / 非数字 / 超大 limit、负 offset、超界 offset 均归一或宽容空页。
6. 边界：空分支无分页控件；每页条数切换回第一页。

### 归因

- 引入来源：REQ-20260913-001（`atb list` 核验存在，done）——分支浏览面板、branchLog 数据层与
  branch-log 接口由该需求建立，初始即为截断口径。详见条目 `design.md`。

