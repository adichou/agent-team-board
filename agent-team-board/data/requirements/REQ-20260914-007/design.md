# 设计 — REQ-20260914-007 人工确认完成和版本合并成功后自动提交管理文件，失败时明确提示并支持重试

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

两个人工闭环入口（确认完成 in-progress → done；版本合并入 main）持续写看板管理文件
（status.json / confirmations.md / decisions.md / builds/versions/&lt;BLD&gt;/version.json），
但这些更新从未自动进 Git：条目状态长期积累为未提交；版本记录历史上被补交在 dev
（d12b646），而持有最终版本数据的 main 上 version.json 仍停留在 draft 状态。

## 方案

### 新数据层 `scripts/lib/mgt-commit.mjs`（管理记录自动提交）

- **目标文件集合**（操作前静态确定，提交时按「本次确有刷新」过滤）：
  - 确认完成：条目目录 `status.json` + `confirmations.md` + `decisions.md`（与 ui-demo 一致）；
  - 版本合并：`builds/versions/<BLD>/version.json`。
- **操作前基线**：入口在业务操作前采集目标文件的 porcelain 状态码 + 内容 sha1；
  操作成功后对每个目标文件分类：
  - 内容未变 → 不纳入（未刷新，不碰用户改动）；
  - 操作前 porcelain 干净（不在列表）或未跟踪（??）且本次刷新 → **可安全提交**；
  - 操作前已脏 / 已暂存（任何其他码）且本次刷新 → **pendingManual**（无法安全分离，
    整操作不提交任何目标文件，明确报告待人工处理；不破坏原有暂存状态）。
- **提交纪律**：沿用 git-flow 既定模式——`git add -A -- <paths>` + `git commit --only -m <subject> -- <paths>`，
  路径限定提交，绝不全量 add，不夹带其他条目 / 业务源码 / 未跟踪需求资料 / 预先暂存内容。
  提交说明：`doc: 人工确认完成 <REQ|BUG-…>` / `doc: 版本合并记录 <BLD-…>`（过
  validateCommitSubject 规范核验）。
- **版本记录提交到 main（合并目标分支）**：当前分支即 main → 原地路径限定提交；
  否则建临时工作树检出 main（与 build-git.mergeCommitsIntoMain 同隔离口径），把目标文件
  内容复制进临时工作树后提交，最后移除临时工作树——不切换当前工作区分支、不推送远端。
  同时在当前分支做一次同内容路径限定提交，使工作区不再遗留未提交的版本记录；
  结果中按分支记录（main 提交为主 SHA）。
- **幂等 / 空提交**：无可刷新文件 → `noop`（已同步 · 无新变化），不制造空提交；
  重复确认完成 / 重复合并被状态机拒绝（changed=false / 409），不重放业务操作；
  重试与重复请求不产生重复提交（已提交路径自然退出脏集合）。
- **串行协调**：所有管理记录提交（初次 + 重试）经 `dataDir/.locks/mgt-git-write.lock`
  文件锁串行（acquireLock 60s 过期自愈）；锁被占时返回明确的 failed 结果。
- **状态账本（刷新后仍可见的失败提示）**：`dataDir/commits/mgt/item-<ID>.json` /
  `version-<BLD>.json` 记录最近一次结果（status / 提交与短 SHA / 目标文件与内容哈希 /
  pendingManual / reason / advice / updatedAt）。`commits/mgt/` 由 ensureIgnore 补进看板
  `.gitignore`（幂等一次性；.gitignore 变更随下一次管理记录提交一并收纳），账本不进
  版本控制、不引起受跟踪文件反复变脏。
- **重试（只补交管理记录）**：按账本记录的目标文件 + 内容哈希复核当前态——
  已 clean → 已同步；内容与账本一致 → 可补交；内容已再变 → pendingManual；
  不重放确认完成 / 版本合并本身。重试成功（committed / noop）即清除失败态。

### 服务层接入（server.mjs）

- `POST /api/item/:id/status`：to=done 且流转成功后执行确认完成管理提交，响应附
  `mgtCommit` 结果（业务状态不受提交成败影响）；
- `GET /api/item/:id`：详情附账本 `mgtCommit`（刷新 / 重启后失败提示仍可见）；
- `POST /api/build/version/merge`：合并成功（merged）后执行版本记录管理提交，
  响应附 `mgtCommit`；合并失败不提交；
- `GET /api/build/state`：每个版本附账本 `mgtCommit`（仅响应装配，不写 version.json）；
- 新增 `POST /api/mgt-commit/retry` `{ kind: 'item'|'version', id }`：只补交管理记录。

### CLI（atb.mjs）

- `atb status <ID> done`：流转成功后执行同样提交，人读输出一行结果
  （已提交 · 短 SHA / 已同步 / 失败原因+建议），`--json` 结果对象携带 `mgtCommit`；
- 新增 `atb mgt retry item <ID>` / `atb mgt retry version <BLD>`：CLI 重试补交。

### 前端（app.js / build.js / style.css）

- 条目详情抽屉「基本信息」在完成状态附近、版本详情合并结果下方渲染统一的
  「管理记录提交」反馈块（`.mgt`）：提交中（spinner + 禁用重试）/ 成功（短 SHA + 说明）/
  已同步 / 失败（原因 + 未提交文件列表 + 建议 + 「重试提交」按钮，失败态来自账本，
  刷新后仍可见，重试成功后清除）；沿用现有布局与深浅色变量，不新造视觉语言。
- 提交进行中禁用对应重试 / 操作按钮（drawerAction 与版本卡片 mergeBusy 同口径）。

## 风险与边界

- 提交失败不伪装成功、不回滚业务操作：条目保持 done、版本保持 merged，两种结果在
  响应与界面上独立呈现；完整错误与明细落账本，reason ≤200 字。
- 非 git 项目 / detached 等无法提交的环境返回 `skipped`（带原因），不影响业务流转。
- 不做 hunk 级拆分：混合改动一律 pendingManual 待人工，与既有自动提交口径一致。
