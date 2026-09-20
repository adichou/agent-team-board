# REQ-20260916-007 用户数据和应用数据要分离，commit 只需提交用户数据，应用数据不用 commit

- 状态：submitted（待人工接受）
- 创建：2026-09-16T07:38:47.839Z

## 描述

### 目标

1、用户数据指用户的源代码、提交的需求，bug 及相应的文档，还有 atb 的 readme 和 agents.md 等文档，这些都是使用 atb 所必须了解的资产，必须通过 git 进行版本管理。
2、应用数据是指用于 atb 运行过程中产生的数据，例如需求的状态，任务批次，版本计划，设置结果，这些东西在不同用户的设备上都是不一样的，所以不适合提交到 git 上。

2026-09-17 人工确认重构方案：分类不依赖各项目不固定的源码结构——项目自身内容（源码、文档）atb 不感知、不枚举，一律按 git 默认提交，用户需排除的自行修改项目 `.gitignore`；用户数据与应用数据改由 atb 初始化时建立的固定布局物理分离——项目根目录新建 `agent-team-board/`，下设 `data/`（用户创建的条目文档，提交进 git）与 `runtime/`（运行产生的应用数据，自动加入 `.gitignore`）。实施含：初始化布局改造、本仓库存量数据拆分迁移、忽略规则简化为整目录一条、自动收口提交与文档口径同步。

### 数据分类口径

**目录布局（2026-09-17 人工确认重构）**

atb 初始化在项目根目录新建 `agent-team-board/`，两个子目录实现物理分离，不再逐文件忽略：

- `agent-team-board/data/`：用户创建的需求 / Bug 条目相关文档——整目录提交进 git。
- `agent-team-board/runtime/`：atb 运行过程产生的全部应用数据——整目录自动加入项目 `.gitignore`。

目录示意图（`runtime/` 内部结构以 design.md 定案为准）：

```text
<项目根>/
├── …                            # 项目自身源码与文档（本仓库含 scripts/、skills/、根 README.md、根 AGENTS.md 等）：atb 不感知，按 git 默认提交
└── agent-team-board/
    ├── data/                    # 用户条目文档（进 git）
    │   ├── requirements/REQ-YYYYMMDD-NNN/
    │   │   ├── README.md / design.md / test-cases.md / test-report.md
    │   │   ├── ui-demo.html / licenses.md / attachments/ / decisions.md
    │   │   └── bugs/BUG-YYYYMMDD-NNN/        # 存量归属 bug，结构同构
    │   └── bugs/BUG-YYYYMMDD-NNN/            # 独立 Bug，结构同构
    └── runtime/                 # 运行应用数据（自动忽略，不进 git）
        ├── status/              # 条目实时状态（自条目目录移入）
        ├── config.json          # 条目编号计数器
        ├── tasks/ discussions/ dispatch/ refine/ commits/ confirms/ holds/
        ├── oncall/ builds/ releases/
        └── README.md / test-runs/ / test-audits/ / marketing/ …  # 共享文档与运行记录
```

旧布局项目（`docs/agent-team-board/`）提供**一键迁移**到新布局的能力（Status Board 设置界面提供开关入口，CLI 提供对应子命令；迁移口径与下方存量迁移一致）。运行约束（2026-09-17 人工确认）：**本项目仅支持单设备运行**，不考虑多设备状态同步——`runtime/` 不跨设备同步，条目状态与单号计数器以本地文件为准，多设备使用不在支持范围。

**用户数据（继续提交进 git）**

- 项目自身源码与文档：atb 不感知、不枚举各项目的源码结构（因项目而异、不固定），一律按 git 默认提交；用户需排除的内容自行修改项目 `.gitignore`。本仓库实例：`scripts/`、`commands/`、`hooks/`、`skills/`（`SKILL.md`、`dev-closeout.md`、`worker-spec.md` 及迁入后的 `batch-execution.md`）、插件 manifest、`package.json`、根 `README.md`、根 `AGENTS.md`——均为用户数据，继续提交；新导入项目内不落 skills 目录（技能随插件分发），项目内 atb 自有目录只有 `agent-team-board/`。
- 看板条目文档：`agent-team-board/data/` 下 `requirements/<ID>/`、`bugs/<ID>/`（含归属 bug 目录 `requirements/<REQ>/bugs/<BUG>/`）的 `README.md`、`design.md`、`test-cases.md`、`test-report.md`、`licenses.md`、`ui-demo.html`、`attachments/`、`decisions.md`（人工决策留痕）——整目录提交，目录内不再夹带任何机器状态文件。
- 机制文档：`skills/agent-team-board/batch-execution.md`（2026-09-17 决策，自旧位置 `git mv` 迁入；位于本仓库 skills 目录下的 agent-team-board 技能目录，随插件分发——安装后位于插件缓存 `~/.zcode/cli/plugins/cache/<市场>/agent-team-board/<版本>/skills/agent-team-board/`，ZCode 从插件缓存加载技能、项目内不落 skills 目录，其他项目同样可读）。迁移时同步整理内容：对齐本仓库 skills 文档（`SKILL.md`、`dev-closeout.md`、`worker-spec.md`）的风格，移除不必要描述——过时的「功能尚未实现」免责声明、2026-09-05～06 调研与选型过程叙述、已回退方案的细节；保留现行有效协议（批量开发 / 批量完善 / hold 机制、执行账本与回执协议，源码注释引用的章节语义保持可对位）。

**应用数据（本地留存，不进 git）——全部迁入 `agent-team-board/runtime/`**

原 `docs/agent-team-board/` 下全部应用数据整目录迁入 `runtime/`：

- 条目实时状态：各条目 `status.json`（机器读写，Agent 写入被钩子拦截）——重构后移出条目目录，由 `runtime/` 按条目存放（具体结构 design.md 定案）。
- 全局计数器与设置结果：`config.json`（条目编号计数器，按日重置）、`tasks/settings.json`、`discussions/settings.json`、`dispatch/settings.json`、`dispatch/policies.json`、`refine/settings.json`、`oncall/settings.json`、`oncall/dispatches.json`。
- 执行账本：`.locks/`、`dispatch/`、`refine/`、`commits/`、`confirms/`、`holds/`、`oncall/`（含咨询单全文与附件，2026-09-17 已确认按应用数据处理）。
- 构建 / 发布运行账本（版本计划类）：`builds/`、`releases/`。
- 看板共享文档与运行记录（2026-09-17 人工确认归应用数据）：数据目录 `README.md`（由模板生成，可随时重建）、`marketing-roadmap.md`、`codex-ab-test-*.md`、`test-runs/`、`test-audits/`、`discussions/` 讨论文档、`marketing/`。

**插件分发口径（2026-09-17 人工确认）**

- `skills/` 随插件分发，本插件为**多宿主**形态：`.zcode-plugin/plugin.json` 与 `.codex-plugin/plugin.json` 各自按宿主 schema 声明 `skills: ./skills`（内容同源）。技能如何生效遵循各 Agent 宿主**自己的**官方插件与 skills 机制（业界主流习惯与协议，不自造加载入口）：ZCode 宿主安装于插件缓存 `~/.zcode/cli/plugins/cache/<市场>/agent-team-board/<版本>/skills/agent-team-board/`；Codex 宿主经其插件机制安装于 Codex 自身目录（非 `~/.zcode/`，钩子按 `hooks/codex.json` schema，slash 命令为 ZCode 专属）；未来接入其他宿主（如 Claude Code）同样按该宿主官方约定适配安装位置。
- 根 `AGENTS.md` 不拷入插件包，仅作为 agent-team-board 仓库源码存在（其内容为「在本仓库开发本产品」的规则，对分发对象无意义）。
- 插件打包排除（2026-09-17 人工确认）：项目根目录下的 `agent-team-board/` 目录（`data/` 与 `runtime/` 均不进分发包）、根 `AGENTS.md`（仅作仓库源码）、`node_modules/`（零运行时依赖，561MB 全为开发工具链，业界惯例分发包不带依赖）、`electron/` 与 `output/`（桌面 App 构建链与产物，与插件分发属两条产品线）；其余内容维持现有整仓拷贝口径。

### 现状排查（2026-09-17，事实源为本仓库当前工作区；重构启动前的旧布局快照——`docs/agent-team-board/` 单目录混放两类数据、靠其内 `.gitignore` 逐文件忽略，实施时按上方目录布局整体迁移）

- `docs/agent-team-board/.gitignore` 已排除部分执行账本：`.locks/`、`dispatch/runs/`、`dispatch/batches/`、`oncall/runs/`、`refine/runs/`、`refine/batches/`、`refine/states.json`、`commits/runs/`、`commits/batches/`、`commits/mgt/`、`confirms/`。这些规则由 `scripts/lib/` 各 store（`core.mjs`、`batch.mjs`、`git-flow.mjs`、`refine-store.mjs`、`oncall-store.mjs`、`confirm-states.mjs`、`hold-states.mjs`、`mgt-commit.mjs`）幂等追加维护。
- 仍被 git 跟踪、且随运行持续变化的应用数据：326 个条目 `status.json`、`config.json`（git 状态长期 dirty）、七个模块级 `settings/policies/dispatches.json`、5 个 `oncall` `ticket.json`、`builds/`/`releases/` 下的 `run.json`/`version.json`——日常运行后 `git status` 大量脏文件即来源于此。
- 未跟踪但也未被忽略（持续产生 untracked 噪音）：`dispatch/run/`（旧运行目录）、`builds/publish-runs/BPUB-*/artifacts/`、`source/`。
- 文档口径与新分类冲突：`docs/agent-team-board/README.md` 与 `scripts/lib/core.mjs` 的 `DATA_README` 模板均写明「本目录是事实源，请随项目代码提交进 git」「实时实施与验收状态以各自 status.json 为准」，未区分两类数据。
- `git-flow.mjs` 自动收口提交的 doc 组会收集看板数据目录内全部脏路径（注释口径含 `.gitignore / config.json / dispatch 索引`），应用数据移出版本控制后该归因口径需同步调整。
- 人工闭环自动提交仍入库应用数据：确认完成（in-progress → done）后 `mgt-commit.mjs`（REQ-20260914-007）自动提交本条目 `status.json`（连同 `confirmations.md`、`decisions.md`）；版本合并成功后自动提交 `builds/versions/<BLD>/version.json`——两类目标文件按新口径均属应用数据（`runtime/`），入库通道需随目录重构整改。

### 待确认（人工决策，不阻塞其余验收项）

（无——原两项已于 2026-09-17 人工决策：旧项目提供一键迁移能力（设置界面开关入口）；本项目仅支持单设备运行，不考虑多设备状态同步。）

## 验收标准

- [ ] 布局重构（初始化）：`core.mjs` `ensureDataDir` 与各 store 初始化改为在项目根创建 `agent-team-board/data/` 与 `agent-team-board/runtime/`；条目文档仅写入 `data/`，一切运行数据（含 `status.json`，移出条目目录）仅写入 `runtime/`；不再创建 `docs/agent-team-board/`；`runtime/` 内部结构（status 按条目存放的形式等）design.md 定案。
- [ ] 忽略规则极简化：项目根 `.gitignore` 幂等追加 `agent-team-board/runtime/` 一条；旧逐文件规则（条目 `status.json`、`config.json`、各模块 `settings.json`/`policies.json`/`dispatches.json`、账本排除项）全部废弃不残留；`data/` 目录整体无忽略规则。
- [ ] 存量迁移（本仓库）：`docs/agent-team-board/` 现有内容按新口径拆分——条目文档 `git mv` 迁 `agent-team-board/data/`（保留历史），全部应用数据迁 `runtime/`（原已跟踪的应用数据同时移出 git 索引、本地文件保留、atb 功能不受影响）；`batch-execution.md` 迁 `skills/agent-team-board/` 并按用户数据清单的整理口径重写（skills 文档风格、移除过程性描述与过时免责、保留现行协议，`dispatch-store.mjs` 等源码注释引用同步）；迁移后旧目录移除，全仓检索（源码、测试、SKILL.md、根 `AGENTS.md`、根 `README.md`、钩子内路径）无 `docs/agent-team-board` 残留引用，含 `req-doc-entry-20260916-003` 测试断言同步。
- [ ] 旧项目一键迁移：提供 CLI 迁移子命令与 Status Board 设置界面开关入口；迁移口径与存量迁移一致（条目文档 → `data/`、应用数据 → `runtime/`、旧目录 `docs/agent-team-board/` 移除、项目 `.gitignore` 更新为 `agent-team-board/runtime/`）；幂等可重试、失败如实报告且不损坏数据；迁移前后条目数量与状态一致、看板展示正常；旧项目升级不被新规则误伤（不误提交其应用数据、功能不中断）。
- [ ] 用户数据不受误伤：`data/` 下代表性路径（README / design / test-cases / test-report / licenses / ui-demo.html / attachments / decisions.md）与 `skills/agent-team-board/batch-execution.md` 逐一 `git check-ignore` 验证不命中且被 git 正常跟踪。
- [ ] 打包分发口径：发布打包排除项目根 `agent-team-board/` 目录、根 `AGENTS.md`、`node_modules/`、`electron/`、`output/`，`skills/` 完整随包分发；ZCode 与 Codex 两个宿主的安装产物各自按其官方机制正常加载（ZCode 插件缓存、Codex 插件目录，遵循业界主流协议，不自造入口）；发布产物核验不含被排除路径（无依赖目录与构建产物，体积为纯源码量级）。
- [ ] 功能回归：新布局下 atb 全流程正常——`/req` `/bug` 登记、`claim`、`report` 自动收口提交（提交内容不含任何 `runtime/` 路径，`atb commit log <ID>` 可核验）、`refine`、hold、Status Board（`/board`）展示；state-guard 守卫（`status.json` 直写拦截、流程外提交拦截、源码认领锁）定位到新目录后全部有效；server 项目发现与数据源、`?project=` 路径解析改指新目录。
- [ ] 人工闭环自动提交整改（`mgt-commit.mjs`，REQ-20260914-007）：确认完成后的管理记录自动提交只收集 `data/` 下用户数据留痕（`confirmations.md`、`decisions.md`），不再提交 `status.json`（已迁 `runtime/` 且被忽略）；版本合并后的 `builds/versions/<BLD>/version.json` 自动入库整体取消（版本计划账本属应用数据，本地留存，「同内容双分支提交」机制随之废弃）；`commits/mgt/` 失败账本留在 `runtime/`；相关既有测试（`mgt-auto-commit-20260914-007` 等）按新口径改造，人工确认完成后 `git log` 不再出现任何 `runtime/` 路径的提交。
- [ ] 文档与模板同步：SKILL.md 数据规范节、根 `AGENTS.md`、根 `README.md`、`core.mjs` `DATA_README` 模板、`git-flow.mjs` 归因注释按新布局改写；SKILL.md 数据规范节及各涉及目录布局的说明文档给出清晰的目录树示意图（项目根 `agent-team-board/`、`data/` 条目结构、`runtime/` 主要子目录，与初始化实际产物一致）；写明产品仅支持单设备运行的约束（`runtime/` 不跨设备同步、条目状态与单号计数器以本地文件为准，多设备使用不在支持范围）。
- [ ] TDD：目录布局、忽略规则、存量迁移、守卫与 server 路径相关用例先红后绿；`npm test` 全量通过。
