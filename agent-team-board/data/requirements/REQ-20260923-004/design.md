# 设计 — REQ-20260923-004 删除需求需要同步提交

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

`core.deleteItem`（scripts/lib/core.mjs）删除待接受条目时只做 `fs.rmSync` + 删 runtime
状态文件，删除差异（porcelain ` D`）滞留工作区：无人收口（被删目录 owner 归因划入
excluded）、追溯名不副实、多机 clone 后 rebuild 会把已删条目「复活」。本设计给删除
补一条同步 git 提交，做到「删除即留痕」。

## 方案

（技术选型、接口设计、影响面）

### 1. 收口内核：`gitFlow.commitItemDeletion`（scripts/lib/git-flow.mjs，新导出）

放在 git-flow（而非 core）：core 被 git-flow 依赖（resolveItemDir / readStatus 等），
反向依赖会成环；且既有口径就是「git 操作集中在 git-flow，由 atb 进程内部 spawnSync
执行，不经 Agent Bash 工具、不受 state-guard 拦截」（REQ-20260911-009 授权口径）。

```js
commitItemDeletion({ projectRoot, itemId, itemDir })
// → { status: 'committed', commit: { hash, subject }, shortHash, reason: null }
// | { status: 'skipped', commit: null, reason }
// | { status: 'failed',  commit: null, reason }   // 永不抛错：删除已生效，失败只反馈
```

- 非 git 仓库：`isGitRepo` 判定 → skipped，reason「非 git 仓库，无法同步提交」（对齐
  autoCommitForRun 的 skipped 口径）。
- 无差异跳过：`git status --porcelain -- <itemRel>` 为空（条目目录从未入库，如新建即删）
  → skipped「无 git 差异，无需同步提交」，不产生空提交。
- 提交：复用 `commitPaths(projectRoot, [itemRel], 'doc: 删除待接受条目 <itemId>')`——
  与 autoCommitForRun 同一收口内核（`git add -A -- <路径>` 分块暂存 +
  `git commit -q --only -m <消息> -- <路径>`），**只 commit、不 push、不切分支**，
  `--only` 限定路径绝不卷入工作区其他脏改动；`itemRel` 相对仓库根
  （`rev-parse --show-toplevel`）计算，兼容项目根 ≠ 仓库根。删除已整体暂存等边界
  （BUG-20260917-002 pathspecMatchable）由 commitPaths 既有逻辑兜底。
- 消息：`doc: 删除待接受条目 <单号>`（`commitSubjectOf('doc', …)`）——被删条目目录是
  工程单据/用户数据（doc 组口径），前缀取 doc；经 `validateCommitSubject` 核验
  （五类前缀 + 含单号 + 描述 ≤120 字恒成立，不含标题避免超长）。
- 失败：catch 后返回 failed，reason =「同步提交失败：<git 错误>；请在终端人工补提交：
  `git add -A -- <itemRel> && git commit -m 'doc: 删除待接受条目 <单号>'`」。**不回滚
  删除**（目录已移除的事实保持），差异留在工作区/暂存区，不静默吞错。
- **不写 commits 账本**（committedItemIndex / commits/runs）：被删条目已不在看板，
  「已提交」徽标与 `atb commit log` 无从挂靠，只留 git 历史（README 待确认项定案：
  倾向口径即定案）。

### 2. 两条通道同口径接入（都调 commitItemDeletion，行为一致）

- **CLI**（scripts/atb.mjs `delete` 分支）：`core.deleteItem` 成功后调用，`projectRoot`
  取命令 cwd（`--dir` / process.cwd()，与 requireDataDir 同源）。输出：
  committed → `↳ 已同步提交（短号）：消息`；skipped → `↳ 原因`；failed → `⚠ 原因`
  （非零退出码保持 0：删除本身已成功）。
- **网页端**（scripts/server.mjs `DELETE /api/item/:id`）：同一函数，响应在既有
  `{ ok, id, title, type }` 上追加 `gitCommit: { status, shortHash?, subject?, reason? }`。

### 3. UI 反馈（scripts/web/app.js `deleteItem`）

- danger 确认文案补一句「删除将同步产生一条 git 提交」；
- 成功后按 `gitCommit.status` 分支：committed → toast「✓ 已删除 <单号>（提交 <短号>）」；
  skipped → toast「✓ 已删除 <单号>（<原因>）」；failed → 警告 toast（第二参 true）
  「已删除 <单号>，但同步提交失败：<原因>」；响应缺 gitCommit（旧服务兼容）保持旧文案。

### 影响面

- `core.deleteItem` 本体不动（校验/物理删除语义与既有约束完全不变：仅 submitted 可删、
  有下属 Bug 拒绝、计数器不回退）；
- 既有测试 item-delete.test.mjs（D1–D7、U1–U3）回归不受影响（temp 项目非 git 仓库 →
  skipped 路径）；
- `atb batch delete` 不涉及（runtime 域不进 git）。

**开源选型（REQ-20260909-015）**：无合适/必要引入的第三方库——需求是单条
`git add -A -- <路径>` + `git commit --only` 的确定性收口，项目已有同口径内核
（git-flow.mjs commitPaths，Node 内置 spawnSync），引入库成本高于复用；不创建 licenses.md。

## 风险与边界

- **提交失败不回滚**：目录移除保持；`git add` 已暂存的删除保留在 index，人工按 reason
  内指引补提交即可入库（验收第 4 条）。
- **不卷入无关改动**：路径限定 `--only`；预置脏文件原样保留（验收第 3 条）。
- **并发锁冲突**（index.lock）：如实 failed 反馈，服务轮询侧已全局 `--no-optional-locks`
  （BUG-20260918-001）降低冲突面。
- **幂等**：同一单号目录已删后不可二次删除（resolveItemDir 报错）；提交成功后路径退出
  脏集合，不会重复提交。
- **多仓库布局**：板根不一定是仓库根（项目根 ≠ repo top），路径一律相对 repo top 计算。
