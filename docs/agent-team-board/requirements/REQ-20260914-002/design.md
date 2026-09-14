# 设计 — REQ-20260914-002 分支浏览中支持在当前分支中搜索提交记录

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

构建模块「分支浏览」右侧提交记录面板（`renderBranchesPane`）仅有分页浏览（BUG-20260914-009），
无任何关键词定位手段；dev 分支自动提交持续增长，按单号 / 作者 / hash 找某条改动只能逐页翻看。
接口 `/api/build/branch-log` 与数据层 `buildGit.branchLog` 均无搜索参数。

## 方案

**技术选型：服务端搜索（扩展既有 `GET /api/build/branch-log`，新增可选 `q` 参数），数据层在
Node 侧做全量过滤分页。** 理由（对应 README「实现路径待确认」二选一）：

- 前端过滤必须先解决「未加载页不可搜」——要么预拉全部分支提交（大历史下浪费且首屏延迟），
  要么搜不全（验收硬门槛「能命中当前分页窗口之外的提交」直接不过）。故不可取。
- git 侧 `--grep/--author` 走正则语义、与 hash 前缀匹配无法在一个 OR 组合里统一表达，且
  用户输入会直接成为 git 参数模式（行为不可预期）。改为：`git log <ref> --format=…` 一次取
  全量提交元数据（本看板面向本机项目仓库，量级为数百~数千条，spawnSync 毫秒级），在
  `build-git.mjs` 内以**大小写不敏感的固定子串匹配**统一过滤 subject / author / short / hash
  四字段——关键词完全不进 git 参数，无注入面，计数即过滤结果长度，分页 = 过滤后切片。

### 接口设计

`GET /api/build/branch-log?branch=<ref>&q=<关键词>&limit=<n>&offset=<n>`

- `q` 缺省 / 空白（trim 后空）→ 既有默认分页行为不变（BUG-20260914-009 口径零回归）。
- `q` 非空 → 搜索模式：返回 `{ branch, query, commits, total, limit, offset }`，
  `commits` 为命中页切片（新→旧），`total` 为命中总数（供分页条计算页码与「共 N 条匹配」）。
- 匹配口径（README 最小集合落定）：提交说明 subject、作者 author、短 hash、完整 hash 前缀
  四字段任一命中即算；**大小写不敏感**（README 待确认项在此落定为不敏感）；固定子串匹配
  （非正则、非分词）；按日期区间过滤等范围外能力不做。
- 关键词约束：trim 后 ≤200 字符，超长截断；其余字符不限制（不进 git 参数，无注入面）。
- 只读边界：复用 `branchLog` 同款前置校验（`assertRefName` 防 ref 注入、`isGitRepo`、
  `refs/heads/<ref>` 存在性校验），不引入任何 git 写操作。

### 数据层（scripts/lib/build-git.mjs）

新增 `branchSearchLog(root, branch, { q, limit, offset })`：

1. `assertRefName(branch)` + 非 git 仓库报错（口径同 `branchLog`）。
2. `git log <ref> --format=%H%x09%h%x09%an%x09%aI%x09%s`（不带 `-n`，全量元数据行）。
3. Node 侧过滤：`subject / author / short / hash` 任一 `toLowerCase().includes(qLower)`。
4. limit/offset 归一沿用 `branchLog`（clamp [1,500] / 负归 0），切片返回；
   `offset ≥ total` 返回空页不报错（宽容口径一致）。

`branchLog` 本体不动（默认浏览路径零改动、零风险）。

### 前端（scripts/web/build.js `renderBranchesPane`）

- **搜索行**：`bld-log-head` 下方新增 `.bld-log-search` 行（仅选中分支后出现）：关键词输入框
  `#bldLogSearchInput`（placeholder「搜提交说明 / 作者 / hash…」）+「搜索」按钮 `#bldLogSearchGo`
  + 「清除」链接 `#bldLogSearchClear`（仅已有搜索词时出现）。
- **状态**：`state.logQuery`（已提交生效的关键词）与 `state.logQueryInput`（输入框草稿，
  `input` 事件回写防重渲染丢字）；`loadLog` 请求在 `logQuery` 非空时附加 `&q=`。
- **提交与防重复**：输入回车或点「搜索」提交；关键词空白等同清除（恢复默认列表）；`logPhase
  === 'loading'` 时入口禁用（按钮 disabled + 提交函数短路），不重复发请求；不做输入即搜
  （README 待确认项落定为回车 / 按钮显式触发，不防抖自动搜）。
- **结果展示**：沿用 `bld-log` 列表行与 `logPagerHtml` 分页条（同一套样式，不引入第二套）；
  列表上方加命中计数行「共 N 条匹配（关键词：xxx）」；命中关键词在说明 / 作者 / hash 上
  以 `<mark>` 高亮（README 可选增强在此落定为做；实现为转义后按大小写不敏感子串切分包裹，
  不含正则）。搜索态末页反馈文案为「已到末尾 · 共 N 条匹配」。
- **空态**：无命中显示「没有匹配的提交（关键词：xxx）」+ 一键「清除」回默认列表；与
  「该分支暂无提交」「未选分支」文案互斥，不混淆。
- **失败**：翻页 / 搜索失败沿用既有口径——已加载内容保留 + 行内错误 + 重试（`bldLogRetry`
  重发目标页带 q）；首次加载失败仍走 `logPhase='error'` 全区错误态。
- **生命周期口径**：
  - 切换分支：`selectBranch` 检测分支变化时重置搜索（关键词、草稿清空，回第一页默认列表）。
  - 「刷新」（`bldLogRefresh`）：保持当前关键词重查（`loadLog` 天然携带 q）。
  - 「⟳ 和远端同步」后重载（`doSync` 内 `selectBranch(state.logBranch)`）：分支未变 →
    不重置关键词，保持关键词口径重查（回第一页）。
  - 每页条数切换 / 页码跳转：搜索态下正常生效（q 随请求透传）。
- **互不串扰**：顶部模块搜索框走 `setQuery → filteredVersions`（版本名 / 单号），与提交搜索
  状态完全独立，互不注入。

### 样式与 i18n

- `style.css` 新增 `.bld-log-search`、`.bld-log-count`、`.bld-log li mark` 样式（深浅色走既有
  CSS 变量）。
- 新文案按 REQ-20260911-005 范式接入 `scripts/web/i18n.js`：静态键（搜索 / 清除 / placeholder /
  搜索中…）入 `EN`，动态拼接键（共 ◇ 条匹配（关键词：◇）/ 没有匹配的提交（关键词：◇）/
  已到末尾 · 共 ◇ 条匹配）入 `EN_DYNAMIC`（◇ 占位）。

### 影响面

- 改动文件：`scripts/lib/build-git.mjs`（新增 `branchSearchLog` 导出）、`scripts/server.mjs`
  （branch-log 路由读 `q` 分流，注释块同步）、`scripts/web/build.js`（搜索行 / 状态 / 行为 /
  高亮）、`scripts/web/style.css`（样式）、`scripts/web/i18n.js`（词条）。
- 测试：`scripts/tests/build-serve.test.mjs` 增服务端搜索用例；`scripts/tests/build-ui.test.mjs`
  增前端行为与 i18n 用例；既有 branch-log 用例不动必须全绿。

**开源选型（REQ-20260909-015）**：本需求为纯 git 只读查询 + 前端字符串渲染，标准库
（node:child_process / 浏览器 DOM）即可完整表达，无合适且必要引入的开源库（fuzzy-search
类库面向模糊评分排序，与本项目「固定子串 + git 全量元数据过滤」口径不符），不引入依赖、
不创建 licenses.md。

## 风险与边界

- **全量 git log 性能**：本看板面向本机项目仓库（数百~数千提交），元数据行一次读入
  毫秒级、内存 <1 MiB；git 调用沿用 `GIT_TIMEOUT_MS=120s` 超时兜底。超大仓库（数万提交）
  搜索耗时会线性增长，但属可接受的本机只读操作，不阻塞 UI 主线程（spawnSync 在服务端）。
- **注入面**：关键词只进 Node 字符串比较，不进 git 参数、不进正则、渲染经 `esc` 转义后
  才做高亮包裹，无命令注入 / XSS 面；ref 侧 `assertRefName` 口径不变。
- **回归面**：`branchLog` 默认路径零改动；搜索仅以可选参数旁路扩展，`q` 空白时与既有
  请求逐字节等价；前端搜索状态独立于版本列表搜索，快照（snapshot）不含搜索词（浏览态
  只持久化分支选择，恢复后回默认列表第一页，符合「切换/恢复回默认」口径）。
- **范围外**：跨分支搜索、日期区间过滤、正则 / 大小写敏感开关、独立快捷键绑定均不做
  （README 已列范围外；`/` 快捷键维持顶部模块搜索归属）。
