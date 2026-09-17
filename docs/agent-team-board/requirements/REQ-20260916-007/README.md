# REQ-20260916-007 用户数据和应用数据要分离，commit 只需提交用户数据，应用数据不用 commit

- 状态：submitted（待人工接受）
- 创建：2026-09-16T07:38:47.839Z

## 描述

### 目标

1、用户数据指用户的源代码、提交的需求，bug 及相应的文档，还有 atb 的 readme 和 agents.md 等文档，这些都是使用 atb 所必须了解的资产，必须通过 git 进行版本管理。
2、应用数据是指用于 atb 运行过程中产生的数据，例如需求的状态，任务批次，版本计划，设置结果，这些东西在不同用户的设备上都是不一样的，所以不适合提交到 git 上。

需要全面排查，看看哪些文件需要提交，哪些留在本地就行；并把「应用数据不进 git」落为一致的机制（忽略规则、初始化与自动收口提交口径、文档说明同步）。

### 数据分类口径

**用户数据（继续提交进 git）**

- 项目源码、构建配置与根文档：`scripts/`、`commands/`、`skills/`、`hooks/`、插件 manifest、`package.json`、根 `README.md`、`AGENTS.md` 等。
- 看板条目文档：`docs/agent-team-board/requirements|bugs/<ID>/` 下的 `README.md`、`design.md`、`test-cases.md`、`test-report.md`、`licenses.md`、`ui-demo.html`、`attachments/`（含需求归属 bug：`requirements/<REQ>/bugs/<BUG>/`）。

**应用数据（本地留存，不进 git）**

- 条目实时状态：各条目 `status.json`（由 atb 工具机器读写，Agent 写入也会被钩子拦截）。
- 全局计数器与设置结果：`docs/agent-team-board/config.json`（条目编号计数器，按日重置）、`tasks/settings.json`、`discussions/settings.json`、`dispatch/settings.json`、`dispatch/policies.json`、`refine/settings.json`、`oncall/settings.json`、`oncall/dispatches.json`。
- 执行账本（部分已被现有 `.gitignore` 排除）：`.locks/`、`dispatch/runs/`、`dispatch/batches/`、`dispatch/run/`（遗留旧运行目录）、`oncall/runs/`、`oncall/tickets/ASK-*/ticket.json`（咨询单元数据；正文 md 属用户数据）、`refine/runs/`、`refine/batches/`、`refine/states.json`、`commits/runs/`、`commits/batches/`、`commits/mgt/`、`confirms/`。
- 构建 / 发布运行账本（版本计划类）：`builds/versions/BLD-*/version.json`、`builds/publish-runs/BPUB-*/`（`run.json` 及 `artifacts/`、`source/`）、`releases/runs/REL-*/run.json`、`releases/product-runs/PREL-*/run.json`。
- 看板共享文档与运行记录（2026-09-17 人工确认归应用数据）：`docs/agent-team-board/` 根下 `README.md`（由 `core.mjs` `DATA_README` 模板生成，可随时重建）、`batch-execution.md`、`marketing-roadmap.md`、`codex-ab-test-*.md`、`test-runs/`（A/B 测试方案与报告）、`test-audits/`、`discussions/` 讨论文档、`marketing/` 营销档案与指标观察（含 `profile.json`、`metrics/`）、`oncall/` 咨询单正文与附件（`question.md`、`rounds/<N>/{question,answer}.md`、`attachments/`）。

### 现状排查（2026-09-17，事实源为本仓库当前工作区）

- `docs/agent-team-board/.gitignore` 已排除部分执行账本：`.locks/`、`dispatch/runs/`、`dispatch/batches/`、`oncall/runs/`、`refine/runs/`、`refine/batches/`、`refine/states.json`、`commits/runs/`、`commits/batches/`、`commits/mgt/`、`confirms/`。这些规则由 `scripts/lib/` 各 store（`core.mjs`、`batch.mjs`、`git-flow.mjs`、`refine-store.mjs`、`oncall-store.mjs`、`confirm-states.mjs`、`hold-states.mjs`、`mgt-commit.mjs`）幂等追加维护。
- 仍被 git 跟踪、且随运行持续变化的应用数据：326 个条目 `status.json`、`config.json`（git 状态长期 dirty）、七个模块级 `settings/policies/dispatches.json`、5 个 `oncall` `ticket.json`、`builds/`/`releases/` 下的 `run.json`/`version.json`——日常运行后 `git status` 大量脏文件即来源于此。
- 未跟踪但也未被忽略（持续产生 untracked 噪音）：`dispatch/run/`（旧运行目录）、`builds/publish-runs/BPUB-*/artifacts/`、`source/`。
- 文档口径与新分类冲突：`docs/agent-team-board/README.md` 与 `scripts/lib/core.mjs` 的 `DATA_README` 模板均写明「本目录是事实源，请随项目代码提交进 git」「实时实施与验收状态以各自 status.json 为准」，未区分两类数据。
- `git-flow.mjs` 自动收口提交的 doc 组会收集看板数据目录内全部脏路径（注释口径含 `.gitignore / config.json / dispatch 索引`），应用数据移出版本控制后该归因口径需同步调整。

### 待确认（人工决策，不阻塞其余验收项）

- 应用数据不提交后，多设备 / 多人协作下单号计数器（`config.json`）与条目状态不再经 git 同步，可能出现跨设备单号重复、状态视图不一致——是否需要配套约定（如设备前缀、单人单库）由人工决策；本需求至少在文档中如实说明该取舍。

## 验收标准

- [ ] 分类清单文档化：`skills/agent-team-board/SKILL.md` 与 `docs/agent-team-board/README.md` 维护「用户数据 / 应用数据」权威分类清单，与实际 `.gitignore` 规则一致；存疑项按「待确认」结论落实或明确标注保留提交。
- [ ] 忽略规则全覆盖：`docs/agent-team-board/.gitignore` 排除全部应用数据——含三类条目目录（`requirements/`、`bugs/`、`requirements/<REQ>/bugs/`）下的 `status.json`、`config.json`、各模块 `settings.json`/`policies.json`/`dispatches.json`、`oncall/tickets/*/ticket.json`、`oncall/` 咨询单正文与附件（`question.md`、`rounds/`、`attachments/`）、看板共享文档（根 `README.md`、`batch-execution.md`、`marketing-roadmap.md`、`codex-ab-test-*.md`、`test-runs/`、`test-audits/`、`discussions/` 正文、`marketing/`）、`builds/versions/`、`builds/publish-runs/`（含 `artifacts/`、`source/`）、`releases/runs/`、`releases/product-runs/`、`dispatch/run/`；既有账本排除项（`.locks/`、`commits/*`、`confirms/` 等）不回退、不重复。
- [ ] 用户数据不受误伤：条目 markdown（README / design / test-cases / test-report / licenses）、`ui-demo.html`、`attachments/` 仍被 git 正常跟踪；对上述代表性路径逐一 `git check-ignore` 验证不命中。
- [ ] 历史清理：已跟踪的应用数据文件经 `git rm --cached`（本地文件保留、atb 功能不受影响）移出索引并随本单提交；完成后连续执行 atb 常规操作（登记 / 认领 / 回执 / 批量任务），`git status` 不再出现任何应用数据路径的脏文件或 untracked 噪音。
- [ ] 功能回归：忽略生效后 atb 全流程正常——`/req` `/bug` 登记、`claim`、`report` 自动收口提交（提交内容不再包含任何被排除的应用数据路径，`atb commit log <ID>` 可核验）、`refine` 领取与回执、Status Board（`/board`）状态展示正常。
- [ ] 新项目口径一致：全新目录初始化（`core.mjs` `ensureDataDir` 及各 store 幂等补行）产出的 `.gitignore` 覆盖口径与本仓库一致，不含已废弃的旧口径；新登记条目只产生用户数据文件入库。
- [ ] 文档与模板同步：`core.mjs` `DATA_README` 模板（`docs/agent-team-board/README.md` 由其生成）、`git-flow.mjs` 归因注释及相关说明改为新口径，明确「状态/账本/共享文档不入库、以本地文件为准」，并写明多设备下状态与单号计数器不同步的取舍说明；根 `AGENTS.md` 文档地图对 `batch-execution.md` 等共享文档的引用同步调整（共享文档不入库后新克隆设备上不存在，需迁移至 `skills/` 等用户数据位置或移除引用）。
- [ ] `npm test` 全量通过；涉及 `.gitignore` 自动补行、自动收口归因的既有测试按新口径同步更新（TDD：先在 `scripts/tests/` 新增/改造用例跑红，再实现跑绿）。
