# 设计 — REQ-20260913-001 添加一个构建模块，支持版本管理。模块位置在需求模块和任务模块之间

> 由 Agent 在 /dev 开发前补充，人可随时批注。README 中全部「待确认」项在本文落定。

## 背景

看板已有 dev + main 双分支工作流（REQ-20260911-009：开发在 dev，到待测试自动提交）与
条目 ↔ commit 双向索引（scripts/lib/git-flow.mjs `itemCommitStatusIndex`）。缺口是「版本」层：
把若干条目的 commit 集中合并入 main、给版本起名写描述、浏览并同步分支。本条目新增「构建」模块补齐。

## 方案（技术选型、接口设计、影响面）

### 模块标识与导航

- view 键名 `build`（深链 `?view=build`）；页签文案「构建 / Build」；容器 `#buildView`；
  模块 JS `scripts/web/build.js`（挂 `window.ATBBuild`，在 app.js 之前加载，范式同 release.js）。
- 页签顺序：需求 → **构建** → 任务 → 设置（index.html module-nav 在 status 与 runs 之间插入按钮）。
- `VIEWS = ['status', 'oncall', 'build', 'runs', 'files', 'marketing', 'release', 'settings']`
  （构建插在需求与任务之间，符合「讨论 → 需求 → 任务」历史序列语义；oncall/files/marketing/release
  仍隐藏且 HIDDEN_VIEWS 不新增键）。隐藏模块旧深链回落需求模块的兜底零回退。
- `MODULE_SUB.build = '版本计划与分支，集中在这里'`；模块搜索前端过滤（不发 API）：
  `SEARCH_SCOPE.build = '构建'`、`SEARCH_PLACEHOLDER.build = '搜版本 / 单号 / 分支…'`，
  词传 `ATBBuild.setQuery` 过滤版本列表与分支名。
- 快照：`saveViewSnapshot` 增 `build: window.ATBBuild?.snapshot?.() || null`；
  `applyViewSnapshot` 委托 `ATBBuild.restoreView`（范式同 release）。

### 开源选型（REQ-20260909-015）

自研。理由：版本计划是看板自身领域模型（与 REQ/BUG 状态机、条目索引强耦合），无现成库可复用；
git 操作全部经本机 `git` CLI（spawnSync），与既有 git-flow.mjs / release-git.mjs 同构，
不引入任何 npm 依赖。不创建 licenses.md（未使用开源库）。

### 数据层 scripts/lib/build-store.mjs

事实源 `<dataDir>/builds/versions/BLD-YYYYMMDD-NNN/version.json`（与 requirements/bugs/releases
隔离，不进 REQ/BUG 状态机）：

```json
{
  "id": "BLD-20260913-001", "name": "版本 20260913-1030", "description": "",
  "status": "draft",            // draft 计划中 | merging 合并中 | merged 已合并 | failed 失败
  "targetBranch": "main",
  "items": [{ "itemId": "REQ-…", "commit": "<hash>", "title": "…", "mergedAt": null,
              "mergeError": null }],   // mergedAt/mergeError 逐条目记录合并结果
  "createdAt": "…", "updatedAt": "…",
  "merge": { "startedAt": null, "finishedAt": null, "error": null, "baseBranch": "dev" }
}
```

- 校验：名称 ≤80 字（可空，创建时默认「版本 YYYYMMDD-HHMM」）；描述 ≤4000 字；
  条目 1..N（创建至少 1 条）；条目不重复；commit 必填且须为 40 位十六进制 hash；
  条目编号须存在于本看板（resolveItemDir 核验）。非法整单 400。
- 状态机：draft → merging →（merged | failed）；failed → merging（重试，只补未合并条目）；
  merging/merged 锁条目增删（README 口径落定：合并中禁用增删、已合并锁定增删）；
  merging 锁名称/描述编辑；merged/failed 允许编辑名称与描述。
- ref 名非法字符校验沿用 release-store 口径（`[\s~^:?*[\]\\]` 拒绝）。

### Git 执行层 scripts/lib/build-git.mjs

全部 spawnSync 本机 git（不引入 libgit2 等），只做下表操作，其余 git 写操作不提供：

| 函数 | 命令 | 语义 |
| --- | --- | --- |
| `listBranches(root)` | `branch --show-current` / `branch --format` / `branch -r --format` | 只读：当前 + 本地 + 远端分支 |
| `branchLog(root, branch, limit=50)` | `log <branch> -n --format=%H %h %an %aI %s` | 只读：提交记录（hash/说明/作者/时间） |
| `fetchRemote(root)` | `fetch --all --prune` | 受限写：拉取远端并清理失效远端分支引用（口径落定：附带 prune） |
| `pushBranch(root, {remote, branch})` | `push [-u] <remote> <branch>` | 受限写：首推（无上游）加 `-u` 建立跟踪 |
| `mergeCommitsIntoMain(root, {versionId, items})` | 临时工作树检出 main → 逐条 `merge --no-ff <hash> -m …` → 移除工作树 | 受限写：合并入 main |

- 合并口径（落定）：**本地 merge + 临时工作树隔离执行**，不复用 release-git 流水线
  （发布是推送远端，构建是本地集成分支，语义不同）。当前分支非 main 时在系统临时目录
  `git worktree add` 检出 main、逐条目 `merge --no-ff` 后移除工作树——全程不切换、不触碰
  用户当前工作区：未提交改动保留且不被卷入，**脏工作区不阻塞合并**（原「工作区干净前置」
  口径在实现评审时作废：切分支方案会把未提交改动卷入/阻塞合并，隔离方案严格更优且更安全）。
  当前分支就是 main 时原地合并。逐条目合并并逐条落 mergedAt / mergeError；任一失败版本置
  failed，已合并条目保持已合并，重试只补未合并条目（幂等续传：已在 main 的提交再合并返回
  Already up to date，结果仍为成功）。合并提交消息 `build: <版本名> 合并 <条目号>（<版本号>）`，
  消息含条目号 → 条目索引自然覆盖 merge commit。
- 与发布模块互斥（落定）：build merge 前检查 release 是否有活动 git 目标运行
  （复用 release-store `assertTargetFree(dataDir, 'git')`），有则 409 拒绝；
  反向不检查——build merge 是请求内同步短事务（成功/失败即时落盘），无跨请求活动态，无互斥窗口。
- 模块自身状态文件（`<dataDir>/builds/`）的写盘不进 git、不参与用户工作区；合并不要求
  看板数据先提交（未跟踪文件随切分支安全携带，git 需覆盖时会自行拒绝——隔离方案下更无此问题）。
- 服务重启恢复：merging 状态的版本启动时标记 failed（error=「服务重启中断，可重试」），
  不自动重跑（对齐 release `recoverInterrupted` 口径）。

### 服务端接口（server.mjs，绑定 ?project=）

```
GET  /api/build/state                汇总：{ initialized, isRepo, currentBranch, versions, merging }
GET  /api/build/candidates           条目 ↔ commit 候选（core.listItems + itemCommitStatusIndex）
GET  /api/build/branches             { isRepo, current, local[], remote[] }
GET  /api/build/branch-log?branch=   指定分支提交记录（≤50 条；分支名 ref 校验）
POST /api/build/version              创建版本计划 { name?, items: [{itemId, commit}] }
POST /api/build/version/save         编辑名称与描述 { id, name, description }
POST /api/build/version/items        增删条目 { id, action: 'add'|'remove', items: [{itemId, commit}] }
POST /api/build/version/merge        合并入 main { id }（显式确认后调用；同步执行返回结果）
POST /api/build/fetch                同步远端（fetch --prune）
POST /api/build/push                 推送 { remote, branch }
```

### 前端 build.js（布局沿 README 界面布局节）

- 子页签：版本计划（默认）/ 分支浏览。
- 版本计划：`bld-split` 左版本列表（名称、状态 chip、关联单数、更新时间、＋新建版本）
  + 右详情（名称/描述行内编辑保存、条目 ↔ commit 区每行换选下拉 + 移出、
  ＋添加条目选择面板、操作区「提示词与回答回填」「合并入 main」）。
- 新建版本侧拉面板（对齐 rel-panel）：选单（需求/Bug 可搜索、全选/全不选——全选只纳入有 commit
  候选的条目并提示跳过数）→ 每条 commit 下拉（默认最近一次提交）→ 版本名（留空用默认命名）→ 创建。
- 回填弹窗（两段式同一弹窗）：上段组装提示词 + 复制（clipboard API 不可用降级全选手动复制）；
  下段粘贴回答 → 解析预览 → 应用。提示词模板（落定）：

  ```
  请为看板版本 <版本号> 生成「版本名称」与「版本描述」。
  当前信息：名称…/描述…
  关联条目：<单号 标题（commit 短hash）…>
  要求：只按以下格式回答，不要附加其他内容：
  版本名称：<一行>
  版本描述：<可多行>
  ```

  解析约定（前端 `parseAnswer`）：`/^\s*版本名称[:：]\s*(.+)$/m` + `/^\s*版本描述[:：]\s*\n?([\s\S]+)$/m`；
  名称必中，描述可空；两者都解析不出 → 明确报错保留原文。预览并排新旧值，「应用」才落库。
- 合并确认弹窗列出 commit 清单（单号 + 短 hash + 说明）→ 确认后 merging（按钮禁用）→ 成功/失败反馈。
- 分支浏览：左分支列表（当前置顶带标识、本地/远端分组、同步远端入口、本地行推送操作）
  + 右提交记录（hash、说明、作者、时间；懒加载 + 刷新按钮；不自动轮询）。
  推送确认弹窗显示目标远端与分支名，区分「首推建立上游跟踪 / 更新已有远端分支」。
- 非 git 仓库（`state.isRepo === false`）：版本计划与分支浏览均显示引导卡（指向 `atb init` /
  设置模块初始化口径），不渲染必然失败的入口。
- 状态反馈四类齐备（加载/空/成功/失败/进行中），样式复用 release 模块口径新增 `bld-*` 前缀，
  深浅色走既有 CSS 变量。

### i18n（REQ-20260911-005 范式）

index.html「构建」页签与 app.js 新增中文键同步进 scripts/web/i18n.js 静态 EN 词典
（构建/Build、模块副标题、搜索范围与占位符）；build.js 动态渲染的高频标签词条一并入词典
（版本计划/分支浏览/合并入 main 等），未命中保持中文优雅降级。

### 影响面

新增文件：scripts/lib/build-store.mjs、scripts/lib/build-git.mjs、scripts/web/build.js、
scripts/tests/build-store.test.mjs、scripts/tests/build-serve.test.mjs、scripts/tests/build-ui.test.mjs。
修改：scripts/server.mjs（/api/build 路由）、scripts/web/index.html（页签/容器/脚本引用）、
scripts/web/app.js（VIEWS/MODULE_SUB/SEARCH_*/setView/快照）、scripts/web/i18n.js（词条）、
scripts/web/style.css（bld-* 样式）；既有导航顺序断言测试同步更新
（workbench-layout / hide-modules / hide-marketing-release / global-entry-panel / revert-ci-board /
global-board / layout-topbar-rail 的 VIEWS 与导航序列断言）。风险：合并入 main 与推送是真实写操作，
以显式确认 + 工作区干净前置 + 同步短事务兜底；不动用户未提交改动。

## 风险与边界

- 合并/推送失败不回滚已成功的条目（逐条记录可续传）；merge commit 一旦落 main 不撤销（与 git 语义一致）。
- 合并在临时工作树执行：不触碰用户当前工作区（不切分支、不暂存、不还原任何未提交改动）。
- 分支浏览只读；同步仅 fetch/push 两个显式入口，无 pull / 无 rebase / 无删除分支。
- 版本列表不自动轮询；merging 态在操作返回后即时刷新。
