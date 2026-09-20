# BUG-20260918-001 serve 轮询实时 git 扫描持 index.lock，与终端 git 写操作互相锁冲突

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-18T00:29:00.159Z

## 现象

Status Board 页面开着（前端 2 秒轮询）时，用户终端执行 git add/commit 报 fatal: Unable to create .git/index.lock: File exists。2026-09-18 REQ-20260916-007 挂起确认补交（1763 个待入库路径）时连续四次撞锁。

## 根因（已实测定位）

前端 2 秒轮询 /api/confirms → listConfirms() → viewRecord()（confirm-store.mjs:723 scopeOfRec）→ confirmScopeForRun() → workingTreeSnapshot()（git status/diff 全量扫描工作区）。git status 默认做「机会性刷新 index stat 缓存」的可选写，须先创建 index.lock；工作区变更越多持锁窗口越长（1763 路径时达数百毫秒），与终端 git add 的持锁窗口重叠即冲突。

佐证：busy-loop 抓捕器在锁出现瞬间抓到持锁 git 子进程的父进程为 node scripts/server.mjs（pid 92965，2026-09-18 08:03，2-3 秒周期）；停止两个 serve 实例后锁彻底消失。注意：实测仓库级 git config core.optionalLocks=false 后轮询空闲期锁消失，但脚本运行期间仍出现锁冲突——链路中可能还有不受该配置约束的持锁 git 调用，修复时需定位完整清单。

代码侧核实（2026-09-18，本单补全时复核）：

- 前端 `setInterval(poll, 2000)`（scripts/web/app.js:8265）→ `poll()` 内批量抽屉打开时 `refreshBatch()`（app.js:1836）→ `refreshConfirms()`（app.js:5969 / 6961）→ `GET /api/confirms`（app.js:3222）；
- 服务端 `/api/confirms` GET（scripts/server.mjs:3219）→ `listConfirms`（scripts/lib/confirm-store.mjs:769）→ `viewRecord` → `scopeOfRec`（confirm-store.mjs:723）→ `confirmScopeForRun`（scripts/lib/git-flow.mjs:636）→ `workingTreeSnapshot`（git-flow.mjs:639 / 139）→ `gitRaw(root, ['status', '--porcelain', '-uall'])`（git-flow.mjs:141）；
- `gitRaw` 统一经 `spawnSync('git', args, { cwd: root })` 执行（git-flow.mjs:43-44），**未注入 `--no-optional-locks`**；
- `workingTreeSnapshot` 还对每个脏文件 `readFileSync` 计算 sha1（git-flow.mjs:154-159），脏路径越多扫描与持锁窗口越长；
- 同链路的其他入口：`legacyConfirmViews`（server.mjs:3223）、`confirmDetail`（server.mjs:3332 → confirm-store.mjs:788 的 `scopeOfRec` 与 `pathStates`）同样会触发实时扫描，修复时须一并覆盖（完整清单以修复时实测为准）。

## 修复方向

轮询链路（listConfirms / confirmDetail 及其他跑 git 的轮询接口）的 git 调用统一加 --no-optional-locks（gitRaw/spawn 统一注入或逐命令）；可叠加扫描结果 TTL 缓存（数秒）降低全量扫描频率。

## 复现步骤

前提条件：

1. 项目已初始化（agent-team-board/data/ 存在），且存在 develop 类挂起确认记录（waiting/confirmed），使 `GET /api/confirms` 清单非空——实测现场为 REQ-20260916-007 挂起确认补交（约 1763 个待入库路径）；
2. 工作区存在较多未提交变更（脏路径越多，git status 持锁窗口越长，越易复现）。

步骤：

1. 启动看板服务：`node scripts/atb.mjs serve`（其内启动 scripts/server.mjs），浏览器打开 Status Board；顶栏轮询指示显示「● 实时连接：每 2 秒自动刷新」。
2. 打开批量开发抽屉（develop 或 refine 模式均可），使「待人工确认」挂起确认区随 2 秒主轮询刷新（poll → refreshBatch → refreshConfirms → GET /api/confirms）；此时浏览器开发者工具 Network 面板可见 /api/confirms 每 2 秒请求一次，服务端每次都实时执行 git status 全量扫描。
3. 保持工作区脏路径规模（实测 1763 路径时持锁窗口达数百毫秒）。
4. 在终端执行 `git add …` 或 `git commit …`，与轮询扫描窗口重叠时即报 `fatal: Unable to create '.git/index.lock': File exists`（实测 2026-09-18 连续四次撞锁；可用 `for i in $(seq 1 20); do git add -A || echo "hit $i"; sleep 1; done` 一类循环提高撞中概率）。
5. 对照验证：停止全部 serve 实例（或关闭页面终止轮询）后重复第 4 步，不再出现撞锁。
6. （可选定位）busy-loop 监控 `.git/index.lock` 创建瞬间并抓持锁进程：父进程为 node scripts/server.mjs，周期 2-3 秒与轮询一致；另可设 `git config core.optionalLocks false` 观察——轮询空闲期锁消失，但脚本运行期间仍现锁冲突（链路存在不受该配置约束的持锁调用，完整清单待修复阶段定位）。

## 期望行为

1. serve 轮询链路（`/api/confirms`、`/api/confirms/:id`（详情/diff）等所有会执行 git 的轮询接口）的只读 git 扫描不再创建/持有 `.git/index.lock`（统一注入 `--no-optional-locks` 或等效手段），与终端并行的 git add/commit 互不阻塞。
2. Status Board 开着时，终端并行执行 git add/commit 不再出现 `index.lock: File exists`。
3. 挂起确认面板功能与口径不变：待提交实时计数（本单可归属 / 归属待确认，无法扫描时「待核对」兜底）继续随轮询刷新；若叠加 TTL 缓存，允许计数滞后数秒，但统计口径与展示文案不变。
4. serve 自身的写链路（report 自动收口提交等）不受修复影响，行为不变。

## 界面展示

本 Bug 现象发生在终端（git 报错），但根因挂在 Status Board 的轮询与「待人工确认」挂起确认面板链路上，界面侧对照演示见 [./ui-demo.html](./ui-demo.html)（单文件可交互演示，浏览器直接打开）：

- **界面布局**：左侧为 Status Board 页面示意——顶栏轮询指示（● 实时连接 / ○ 服务离线）与批量抽屉内置顶的「待人工确认」挂起确认卡片（计数文案「待提交：N 个路径（本单可归属 X · 归属待确认 Y）」）；右侧为用户终端窗口示意；中部为轮询 / index.lock / 终端操作三泳道时间线。
- **交互行为**：可切换「修复前 / 修复后（--no-optional-locks）」两种模式对照；可播放 / 暂停时间线、手动点击「终端执行 git add -A」或开启每 5 秒自动执行；可切换脏路径规模档位（影响 git status 持锁时长）与服务在线 / 离线。
- **状态反馈**：修复前 git add 与轮询持锁窗口重叠时终端输出红色 fatal 并在挂起卡片出现「git 索引被并发进程占用（瞬时冲突，可重试）」归类提示（与 BUG-20260915-004 口径一致）；修复后轮询扫描不再占锁轨，git add 全部成功、挂起卡片计数随轮询正常刷新；服务离线时轮询指示转 ○、时间线停止推进，对照「停 serve 后锁消失」的实测结论。

## 验收标准

1. Status Board 页面开着时，终端并行执行 git add/commit 不再出现 index.lock: File exists；
2. 挂起确认面板的实时计数（本单可归属/归属待确认）行为不变；
3. 测试覆盖：模拟轮询与 git 写操作并发场景。

## 验收说明

- 手工验证：按「复现步骤」搭建现场（大量脏路径 + develop 挂起确认记录 + 页面轮询中），循环执行 git add/commit 持续数分钟，确认不再出现 `fatal: Unable to create '.git/index.lock': File exists`；挂起确认卡片计数随轮询正常刷新、口径文案不变（含无法扫描时的「待核对」兜底）；停止 / 重启 serve 后行为一致。
- 自动化验证：新增并发场景测试（模拟轮询触发的 git 扫描与终端 git 写操作并发，断言无锁冲突且扫描结果口径不变），与挂起确认相关既有测试（confirm-serve-20260914-001、bug-confirm-panel-scope-20260915-003 等）一并保持通过；交付前 `npm test` 全量通过。
- 修复覆盖面核验：`/api/confirms` 清单、`legacyConfirmViews`、`confirmDetail`（详情 / diff / pathStates）等轮询链路入口逐一确认不再持锁（不受 `core.optionalLocks` 配置约束的持锁调用清单以修复时实测定位为准；本轮文档补全未逐一审计 server.mjs 全部 git 调用点，具体清单待确认）。

## 修复记录（2026-09-19，zcode-batch-049-006）

修复时实测定位的完整持锁清单（serve 进程内、随轮询/调度周期反复执行的只读扫描）：`git-flow.mjs` `workingTreeSnapshot` 的 `git status --porcelain -uall`（/api/confirms 清单、详情、pathStates、核验共用，主犯）、`fileDiffText` 的 `git diff HEAD -- <path>`（差异详情）、`scheduler.mjs` 工作区探针 `git -C root status --porcelain`（批量执行期周期运行——即上文佐证段「脚本运行期间仍现锁冲突」的未覆盖点）；其余读链路（rev-parse / branch / symbolic-ref / remote / log / ls-files）只读 refs 或对象库不持锁，写链路锁为本职所需不动。

修复：`git-flow.mjs` `gitRaw` 对只读子命令统一前置注入 git 官方全局选项 `--no-optional-locks`（优先级高于仓库 `core.optionalLocks` 配置与环境，禁用机会性 index 刷新，只读扫描彻底不创建 index.lock）；写命令（init / switch / branch / add / commit）严格不注入，report 收口等写链路行为逐字不变；scheduler 探针同口径注入。不叠加 TTL 缓存，实时计数与口径保持原样。测试：新增 `scripts/tests/bug-20260918-001.test.mjs` 6 用例（独立进程忙循环监视 index.lock 的并发实测、PATH shim 捕获真实 argv 断言注入面与写命令不注入、scheduler 探针源扫描、口径一致、并行写持锁容错），全量 `npm test` 277 个测试文件失败 0。归因：BUG-20260915-003（实时扫描接入轮询链路；底层 gitRaw 助手源自 REQ-20260911-009），详见 design.md 与 test-report。
