# 设计 — BUG-20260914-009 dev 界面只加载最近 50 条，需要修复成显示所有，并支持分页展示

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260913-001**（已 `atb list` 核验存在，状态 done）——构建模块「分支浏览」及其提交记录面板、
  `buildGit.branchLog` 数据层与 `GET /api/build/branch-log` 接口均由该需求建立，初始实现即写入「默认 50 / 上限 200、无翻页」
  的截断口径（`scripts/lib/build-git.mjs` `branchLog` 的 `Math.min(200, …)` 与 `git log -n` 无 `--skip`），本 Bug 是该口径的缺陷暴露。

## 根因分析

三层叠加，且任何单层都无法绕过：

1. **数据层**（`scripts/lib/build-git.mjs` `branchLog(root, branch, limit = 50)`）：
   `n = Math.max(1, Math.min(200, Number(limit) || 50))`——默认 50、调用方传大值也被硬顶 200；只执行
   `git log -n <n>`，无 `--skip`/offset，不支持翻页 ⇒ 第 201 条及更早提交在任何调用方式下都取不到。
2. **服务端**（`scripts/server.mjs` `GET /api/build/branch-log`）：不接收任何条数/偏移参数，直接
   `branchLog(root, branch)` 吃默认 50；接口注释也写死「≤50 条」；响应无总数（total），前端无从得知被截断。
3. **前端**（`scripts/web/build.js` `selectBranch()`）：请求不带分页参数，把返回 `commits` 一次性平铺渲染，
   无分页控件、无总数/已加载范围提示、无「还有更早记录」反馈——在 50 条处静默截断。

dev 分支因承载每次开发运行的自动提交（工作流约定），提交数持续增长、最先触顶，故以「dev 界面」名义报障；
实际限制对所有分支一致生效。

## 方案

分页交互形式按 ui-demo.html 示意落定为**页码方案**（上一页 / 页码 / 下一页 + 每页条数）：

### 1. 数据层 `buildGit.branchLog`（scripts/lib/build-git.mjs）

- 签名改为 `branchLog(root, branch, { limit = 50, offset = 0 } = {})`（唯一调用方是服务端，一并更新）。
- `limit` 归一：`Math.floor` 后 clamp 到 `[1, 500]`（上限从 200 放宽到 500，防滥用；缺省 50 首屏不变）。
- `offset` 归一：`Math.floor` 后 clamp 到 `>= 0`；`git log` 追加 `--skip <offset>` 与 `-n <limit>` 组合实现偏移分页。
- 新增总数：`git rev-list --count <ref>` 得 `total`，随响应返回。
- 响应结构：`{ branch, commits, total, limit, offset }`（`commits` 字段含义不变：该页提交，新→旧排序）。
- `offset >= total` 时返回空 `commits` 与正确 `total`（不报错）；ref 校验、非 git 仓库、注入拒绝等错误路径不变。

### 2. 服务端 `GET /api/build/branch-log`（scripts/server.mjs）

- 新增 query 参数 `limit`、`offset`（均非必填）：非数字/缺失走数据层缺省（50 / 0），负数与非法值由数据层 clamp 归一。
- 响应透传数据层结构（含 `total`）；接口文档注释由「≤50 条」更新为分页口径。

### 3. 前端分支浏览（scripts/web/build.js + style.css）

- `state` 新增：`logPage`（当前渲染页，从 1 起）、`logPageSize`（每页条数，默认 50）、
  `logRetryTarget`（翻页失败后重试的目标页）、既有 `logError` 复用为「行内错误 + 重试」。
- `selectBranch(branch, page = 1)`：切换分支重置回第一页；请求带 `&limit=&offset=(page-1)*size`。
- `loadLog(target)`（内部）：加载中沿用 `logPhase='loading'`（「加载提交记录中…」即翻页加载反馈）；
  **翻页/换页失败时保留已加载页内容与页码**，在列表上方显示行内错误条 +「重试」按钮（重发 `logRetryTarget`）；
  首次加载失败维持现状口径（清空 + error 态）。
- `gotoLogPage(p)` / `setLogPageSize(n)`：翻页与每页条数（20 / 50 / 100）切换；换页大小回第一页。
- 渲染（提交记录面板）：
  - 列表下方分页条 `.bld-log-pager`：`上一页`（首页 disabled）、页码（首末页 + 当前±1，中间折叠 `…`，当前页
    高亮 `aria-current="page"`）、`下一页`（末页 disabled）、每页条数下拉（20/50/100）、右侧「第 x–y 条 / 共 N 条」。
  - 末页下方「已到末尾 · 共 N 条提交（可翻至分支首个提交）」反馈。
  - 空分支（total=0）维持「该分支暂无提交」，不出分页控件。
- 头部「刷新」= 重新加载**当前页**；fetch 同步后的自动刷新回第一页（分支引用可能已变化）。
- 快照/恢复（`snapshot`/`restoreView`）仅持久化 `logBranch`，恢复回第一页（页码不持久化）。
- `style.css` 新增 `.bld-log-pager` / `.bld-log-eof` 样式（跟随现有深浅色变量）。

**开源选型（REQ-20260909-015）**：未引入开源库——本修复为 `git log -n --skip` 组合与既有渲染管线的小改，
无合适且值得引入的分页库（引入成本高于自研），无新增第三方依赖。

## 风险与边界

- **不传参数的兼容口径**：缺省仍 `limit=50, offset=0`，但响应新增 `total/limit/offset` 字段——既有消费方
  （仅本前端与测试）读 `commits`，加字段向后兼容；`branchLog` 第三参由位置参数改为 options 对象，唯一调用方
  （服务端）同步更新。
- **`git log -n + --skip` 语义**：`--skip` 先跳过再取 `-n` 条，新→旧方向分页，与前端「第 x–y 条（新→旧）」一致。
- **上限 500 的口径**：单页最多 500 条（防一次拉全量超大仓库的响应膨胀）；「显示所有」经翻页达成（任何提交
  都可达），不等于单次请求返回全部——README 期望行为（分页查看全部直到首个提交）满足。
- **远端分组分支**：`branchLog` 的 `refs/heads/<ref>` 校验为 REQ-20260913-001 既有口径（远端短名
  `origin/xxx` 不在 `refs/heads` 下会报「分支不存在」），本 Bug 不改动该行为（超出「50 条截断」范围）。
- **性能**：`rev-list --count` 与带 `--skip` 的 `log` 均为本地只读 git 操作，开销与原单次 `log` 同量级。
- **边界**：提交数恰 50 / 51、单条提交、空分支（无多余空页）；`limit/offset` 负数、非数字、超大值归一；
  `offset >= total` 返回空页不报错。
