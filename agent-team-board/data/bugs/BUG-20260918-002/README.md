# BUG-20260918-002 需求/bug点击完成不应该触发管理记录提交，因为在新目录架构下，条目状态变更不需要同步提交到 git

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-18T01:27:34.769Z

## 现象

在 REQ-20260916-007 落地的新目录架构（`agent-team-board/data/` 用户数据进 git、`agent-team-board/runtime/` 应用数据整目录忽略）下，对 in-progress 的需求 / Bug 条目点击「确认完成」时，系统在状态流转成功之外还会**自动执行一次 git 提交**（管理记录提交），而条目状态变更本身已不需要同步提交到 git。具体现状（2026-09-18 以当前工作区代码核实）：

- **网页端**：条目详情抽屉或「待人工确认」聚合区卡片点击「确认完成」→ `POST /api/item/:id/status`（`scripts/server.mjs` 确认完成分支）：`to === 'done'` 时先采集条目目录下 `confirmations.md` / `decisions.md` 的基线（`mgtCommit.beforeBaseline` + `mgtCommit.itemMgtFiles`），`core.setStatus` 成功后调用 `mgtCommit.commitItemDoneMgmt` 创建提交（主题 `doc: 人工确认完成 <ID>`，路径限定提交，实现见 `scripts/lib/mgt-commit.mjs`）。
- **CLI 同口径**：`atb status <ID> done`（`scripts/atb.mjs` status 分支）触发同一提交，成功时回显「✓ 管理记录已提交 · <hash>」，失败回显「⚠ 操作已成功，管理记录提交失败」并指引 `atb mgt retry item <ID>`。
- **界面连带负担**：确认完成后条目详情出现「管理记录提交」反馈块（提交中 / 已提交 / 已同步 / 未自动提交 / 失败五态，`scripts/web/app.js` 的 `mgtCommitBlockHtml` / `drawerMgtBlockHtml`），失败时另有独立 toast 与「重试提交」按钮（`POST /api/mgt-commit/retry`）；提交失败账本持久化在 `agent-team-board/runtime/commits/mgt/item-<ID>.json`，刷新 / 重启后仍渲染失败提示。
- **机制沿革**：该闭环由 REQ-20260914-007 引入，初衷是把当时仍在条目目录内、进 git 的 `status.json` 随确认完成入库；REQ-20260916-007 数据分离后 `status.json` 已迁 `runtime/status/`（整目录忽略，不再提交），本闭环如今唯一还会提交的只剩 `confirmations.md` / `decisions.md` 两份人读留痕文档——「状态变更需同步提交」的前提已不存在。

附带影响（与 BUG-20260918-001 的 git 锁冲突背景相关）：确认完成入口在 serve 场景同步执行 git 写操作（add + commit），与用户终端 git 操作存在锁竞争窗口；提交失败还引入「操作成功但提示失败」的混合反馈与人工重试流程。

## 复现步骤

前提：项目已按新目录架构初始化（存在 `agent-team-board/data/`），项目是 git 仓库，且存在一个 in-progress 条目（如 `REQ-20260917-002` 这类已被认领 / 上报待确认的单，任意 `agent-team-board/data/{requirements,bugs}/<ID>/` 均可）。

1. 启动看板服务：`node scripts/atb.mjs serve`，浏览器打开 Status Board。
2. 找到该 in-progress 条目，打开详情抽屉，点击「确认完成」（或在该条目「待人工决策」聚合区卡片上点击同名按钮；若无未答决策则无二次确认弹窗，直接提交）。
3. 观察：条目状态切换为 done 的同时，详情抽屉出现「管理记录提交」反馈块（「已提交 · <hash>」或「已同步 · 无新变化」；若目标文件暂存区有其他变更则为失败态 + 「重试提交」按钮）。
4. 终端验证：`git log --oneline -3` 可见新增一条 `doc: 人工确认完成 <ID>` 提交（该条目目录下 `confirmations.md` / `decisions.md` 确有刷新时；无刷新则为 noop 空提示、不产生提交）。
5. CLI 口径复现：另取一个 in-progress 条目执行 `node scripts/atb.mjs status <ID> done`，输出含「✓ 管理记录已提交 · <hash>」（或失败提示与 `atb mgt retry` 指引）。

## 期望行为

1. **确认完成不触发 git 提交**：网页端「确认完成」与 CLI `atb status <ID> done` 只做状态流转（in-progress → done：校验状态机、释放认领锁与手工实施占用、闭环 hold 记录、刷新 `confirmations.md` / `decisions.md` 留痕），不采集基线、不执行任何 `git add / commit`；`confirmations.md` / `decisions.md` 留在工作区，随既有通道（收口提交 / 人工提交 / REQ-20260917-002 放行的文档提交）入库。
2. **界面与命令面同步收敛**：条目详情不再渲染「管理记录提交」反馈块与「重试提交」按钮，确认完成不再出现「管理记录提交失败」toast；相关文案在 `scripts/web/i18n.js` 中英双语同步清理。
3. **连带通道处置**：`POST /api/mgt-commit/retry`、CLI `atb mgt retry`、`runtime/commits/mgt/` 账本及条目详情接口附带的 `mgtCommit` 状态字段，随确认完成入口一并下线或收敛（具体保留 / 下线清单以 design.md 定案为准，含版本合并入口是否同口径——该入口的 version 类已随 REQ-20260916-007 取消，预期仅剩 item 类需处理）。
4. 不回退既有保护：确认完成的待人工决策防呆（未答项拦截 / force 二次确认）与状态机校验行为不变。

## 验收说明

1. 网页端对 in-progress 条目点击「确认完成」后：状态变为 done、留痕文档（如有刷新）留在工作区，`git log` 无新增提交；详情抽屉无「管理记录提交」反馈块，无失败 toast，无「重试提交」入口。
2. CLI `atb status <ID> done` 输出不再含管理记录提交相关行；`atb mgt retry` 等重试入口按 design 定案下线或收敛，调用不再产生 git 提交。
3. 确认完成防呆（未答决策拦截、force 越过）与驳回完成（done → in-progress）等既有行为回归通过。
4. 既有承载用例 `scripts/tests/mgt-auto-commit-20260914-007.test.mjs` 及引用该机制的测试按新口径改造（先行红、实现后绿），`npm test` 全量通过。
5. `scripts/web/i18n.js` 中管理记录提交相关文案双语言同步移除 / 调整，i18n 相关测试通过。
6. 引入来源在 design.md 归因（预期为 REQ-20260914-007 引入、REQ-20260916-007 整改后口径遗留），并评估文档同步面（根 AGENTS.md、skills 文档中如涉及该机制的表述是否需更新）。

## 界面展示

- **界面布局**：演示复现条目详情抽屉的核心区——条目标识（ID + 状态徽标 + 标题）、「确认完成 / 驳回完成（退回开发）」操作行、其下的「管理记录提交」反馈块区域；右侧并列终端 `git log` 对照面板，直观呈现点击完成后是否新增 `doc: 人工确认完成 <ID>` 提交。
- **交互行为**：点击「确认完成」走状态流转（可再「驳回完成」复位反复演示）；顶部「现状（缺陷）/ 修复后（期望）」模式开关对照两种行为；现状模式提供「模拟提交失败」开关，可演示失败反馈块与「重试提交」按钮的补交流程。
- **状态反馈**：覆盖正常（提交中 → 已提交 · hash）、空（无新变化 noop 提示口径见反馈块五态设计）、失败（⚠ 操作已成功，管理记录提交失败 + 原因 + 重试转成功）等状态切换；修复后模式点击完成仅切状态 + 成功 toast，无任何提交反馈。深浅色跟随系统。

可交互演示：[./ui-demo.html](./ui-demo.html)（单文件、无外网依赖，浏览器直接打开）
