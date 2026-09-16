---
name: agent-team-board
description: Agent Team Board 看板工具（atb）：用 /req /bug /dev /board 命令，或直接提及 atb、agent-team-board、Status Board、REQ-/BUG-YYYYMMDD-NNN 编号时使用。规定 docs/agent-team-board 数据规范、两阶段 TDD 流程与状态铁律。
---

# Agent Team Board（智能体团队看板）

三栏协作体系：**Project Board**（ZCode 自带项目/会话列表，不改造）、**Discussion Board**（当前聊天窗口 + `/req` `/bug` `/dev` `/board` 命令）、**Status Board**（插件本地网页看板，端口 8888）。事实源是项目内 `docs/agent-team-board/` 目录（非隐藏，随代码进 git）。

工具入口：本 skill 所在插件根目录下的 `scripts/`（即本文件相对路径 `../../scripts/`）。下文用 `$ATB` 指代 `node <插件根>/scripts/atb.mjs`，用 `$SERVER` 指代 `node <插件根>/scripts/server.mjs`。

## 数据规范

```
docs/agent-team-board/
├── config.json                        # 按日重置的全局计数器（需求、Bug 各一；Bug 全局唯一）
├── requirements/REQ-YYYYMMDD-NNN/     # 需求
│   ├── status.json                    # 机器状态（atb 维护，禁止手改）
│   ├── README.md / design.md / test-cases.md / test-report.md
│   └── bugs/BUG-YYYYMMDD-NNN/         # 存量归属 Bug（结构同构；新建不再落入）
└── bugs/BUG-YYYYMMDD-NNN/             # 独立 Bug
```

- `status.json` 字段：`id` `type`（requirement/bug）`title` `status` `parent` `owner` `createdAt/updatedAt` `agentCompletedAt` `lastReport` `history[]`。
- Bug 一律独立创建（`bugs/`，REQ-20260908-009 去掉了创建时归属需求选项）；源单（引入来源）写 design.md「引入来源（源单）」节详述、README 开头头部 `- 引入来源：` 行速览（REQ-20260908-012），不再用目录归属表达关联。`atb move <BUG-ID> --req <REQ-ID>|--standalone` 仅作存量归属 Bug 的整理。
- 人读 markdown：需求四件套 README（描述+验收标准；涉及 UI 需含「界面展示」——完善阶段须为条目目录内可交互 `ui-demo.html` 演示：README 链接 `./ui-demo.html` 并保留布局/交互/状态反馈文字说明，单文件、内联 CSS/JS、无外网依赖、无构建步骤；创建阶段可先内嵌 ASCII 线框 / 结构示意，REQ-20260908-021）/ design（方案，开发阶段补）/ test-cases（用例，开发阶段补）/ test-report（报告）。Bug 生成 README 与 design（含「引入来源」节），至少再有 test-report。
- **Bug 修复阶段必须归因引入来源**（REQ-20260830-004 规范；登记时可暂空或写「未定位」——登记时通常尚未定位）。来源写入
  Bug design.md「引入来源（源单）」节详述，**并在 README 开头头部元信息区补一行 `- 引入来源：…`**（「创建」行之前、
  有「归属需求」行则其后，打开第一屏即见，样式见 BUG-20260907-017）：`REQ-…（引入了什么）` / `BUG-…` /
  `未定位（排查过程：…）` 三选一；来源 ID 需 `atb list/show` 核验真实存在；根因分析与 test-report
  同样写明来源，已有来源直接引用，缺失则排查补充，**禁止编造**。末尾「关联」节仅作补充关联（其他相关条目）的可选位置。

## 状态机与铁律

```
submitted ──人工──▶ accepted ──人工──▶ planned ──Agent claim──▶ in-progress ──人工──▶ done
   ▲                                    │                          │
   └──────────────── 不存在此路径 ───────┼──────────────────────────┘
                                        │            done ──人工驳回──▶ in-progress
                                        └──人工移出计划──▶ accepted（回退边）
```

**Agent 必须遵守（PreToolUse 钩子会确定性拦截，不要尝试绕过）：**

1. **绝不**用 Write/Edit 直接写任何 `docs/agent-team-board/**/status.json`——会被拦截。状态只能通过 `$ATB` 子命令变更。
2. **绝不**把条目置为 `accepted`、`planned` 或 `done`（包括 `$ATB status <ID> …`、curl 调 Status Board 的 `/api/item/*/status`）。这三个状态**仅限人工**（planned = 已计划排期，REQ-20260908-010）。
3. 常规开发的状态操作为 claim/report；用户明确授权单项例外开发时，另见 [收尾规则](dev-closeout.md) 的状态收尾边界：
   - `$ATB claim <ID>`——认领（accepted/planned → in-progress，O_EXCL 原子锁防并行冲突），认领即实施；
   - `$ATB report <ID> --coverage N --summary "…"`——写 test-report.md 并标记「待人工确认完成」。
4. 开发过程中可以并且应该**直接编辑条目下的 markdown**（README/design/test-cases），这是人的阅读界面，不经过状态机。实施要点写入 design.md 作为实施记录。
5. **需求质量前置（REQ-20260903-001、REQ-20260908-015、REQ-20260908-021）**：涉及 UI 的需求必须在 README 描述里讲清界面布局、交互行为与状态反馈，并提供「界面展示」。两阶段口径：**创建**阶段（/req）README 内嵌 ASCII 线框 / 结构示意即可，人工接受前直观看到界面形态；**完善**阶段（refine 批次）界面展示须升级为条目目录内可交互 `ui-demo.html` 演示（README 链接并保留文字说明，浏览器直接打开可交互）——接受即视为设计认可，Agent 直接按描述实施，不再有方案对齐环节。
6. **插件源码受认领锁保护（REQ-20260901-003）**：无有效认领锁时 Write/Edit/Bash 改动本插件源码（scripts/commands/skills/hooks/manifest 等）会被钩子拦截——改码前必须先在看板登记并 claim；锁有效期内方可修改，看板数据目录（docs/）markdown 不受限。

## CLI 速查

```bash
$ATB init                                        # 初始化数据目录（每项目一次）
$ATB new req "标题" [--desc "描述"]              # 创建需求 → submitted
$ATB new bug "标题" [--desc "描述"]              # 创建 Bug（一律独立；引入来源写 design.md）
$ATB list [--type req|bug] [--status accepted]   # 总览（--json 供程序读）
$ATB show <ID>                                   # 详情 + 历史
$ATB claim <ID> [--by <会话标识>]                # 认领（accepted/planned → in-progress；批次开发中被拒）
$ATB report <ID> --coverage 87 --framework "…" --summary "…" [--by 会话] [--run RUN-ID]
                                                 # 写测试报告并标记待测试；不带 --run（手动 /dev）时
                                                 # report 成功后系统自动收口提交本单改动到 dev
                                                 # （BUG-20260915-007：认领时快照归因，与批量同口径）
$ATB status <ID> <状态>                          # 仅人工终端用；Agent 会被拦
$ATB move <BUG-ID> --req <REQ-ID> | --standalone # 整理存量 Bug 归属（新建一律独立，不再归属）
$ATB batch create                                 # 批量开发：创建批次并输出主调度提示词（幂等，冻结全部可实施候选）
$ATB batch next [--batch ID] --by <会话>         # worker 领取本批一项（原子预留+实施互斥）
$ATB batch check [--batch ID]                    # 主调度最小核对（≤2KiB）
$ATB run receipt <RUN-ID> --result reported --report-ref test-report.md
                                                 # worker 交最终回执（reported 必带 --report-ref；
                                                 # blocked/failed 必带 --reason，详细错误落盘后引用；
                                                 # reported 核验通过后系统自动 commit 本单改动到 dev）
$ATB run release <RUN-ID> [--reason "…"]         # 释放未认领的预留（认领冲突换单）
$ATB run autocommit <RUN-ID>                     # 重试到待测试自动提交（REQ-20260911-009；幂等，仅 reported 运行）
$ATB commit log <ITEM-ID> | which <HASH>         # 条目↔提交双向索引（单→全部提交 / 提交→单号反查）
$ATB hold declare <ID> (--question "决策问题")… [--reason "…"] [--run RUN-ID] [--by 会话]
                                                 # worker 声明「待人工决策」并附问题清单（REQ-20260911-007；
                                                 # 随后仍交 blocked 回执；存量滞留单可由人工补登记）
$ATB hold list [--all] | show <ID>               # 待人工确认持久清单 / 单条详情（等待时长、未答计数、留痕）
$ATB hold answer <ID> --q q1 --text "答复" [--note "…"] [--by 人工]   # 人工补决策（仅人工，Agent 被拦；支持草稿）
$ATB hold resume <ID> | cancel <ID> [--note "…"] # 人工复工（决策齐备 → 回已计划重新取单）/ 作废（仅人工）
$ATB cli install [--to <目录>]                   # 安装终端 atb 命令（符号链接到 bin/atb；缺省自动选
                                                 # PATH 中可写的 /usr/local/bin → ~/.local/bin → ~/bin；
                                                 # 装好后终端直接敲 atb …，无需 node 全路径）
$ATB cli uninstall [--to <目录>] | cli status     # 卸载（仅删指向本插件的链接）/ 查看安装状态
```

## 批量任务（REQ-20260908-020：任务模块「批量完善 / 批量开发」，仅子代理模式）

- **批量开发**：看板「⚡ 批量开发」从**已计划（planned）**队列最旧优先实时取单。创建批次并复制
  通用主调度提示词（REQ-20260909-011 起执行端无关），在当前项目的 Agent 会话粘贴发送；主会话每轮派一个新子 Agent，
  子 Agent 按 `docs/agent-team-board/dispatch/worker-spec.md` 只实施一项（batch next → claim → TDD → report --run →
  run receipt）。运行中新置计划的条目自动进入队列。支持暂停/恢复与终止（`$ATB batch pause|abort`）。
- **批量完善**：面向**已接受（accepted）未完善**单，每轮领取时实时读取候选（新接受的单自动进入本轮范围）。
  子代理只补条目文档（需求补 README：描述 + 验收标准；涉及 UI 须产出条目目录内可交互 `ui-demo.html` 演示——单文件、
  内联 CSS/JS、无外网依赖、无构建步骤、浏览器直接打开可交互，README 界面展示节链接 `./ui-demo.html` 并保留布局/交互/
  状态反馈文字说明；Bug 补现象/复现/期望/验收，涉及 UI 的 Bug 同样须产出上述可交互 `ui-demo.html` 演示并链接
  `./ui-demo.html`，建议对照展示缺陷现象与期望修复后状态——BUG-20260908-017），条目全程
  保持 accepted，不进状态机、不占实施互斥。已接受单带三态徽标：未完善 / 完善中 / 已完善（`refine next` → 完善中，
  `refine done` 核验通过 → 已完善，`fail`/`release`/终止 → 未完善）；**完善中的单不可驳回回待接受**（CLI/UI 双侧拦截），
  再次接受一律重置未完善。CLI：`$ATB refine create|next|done|fail|release|check|summary|pause|abort|records`。
- **待人工决策承接（REQ-20260911-007）**：worker 遇「需人工决策」的阻塞时 `hold declare` 声明（附问题清单）后交
  blocked 回执——条目保持 in-progress，进入 Status Board「⚠ 待人工确认」持久聚合区与 `atb hold list`（不随批次结束消失）；
  人工在聚合区补决策（草稿可存、缺项时复工禁用）并一次操作**复工**（`hold resume`，决策齐备后条目经专用通路回已计划队列，
  被批量开发重新取单），或 force 二次确认越过未答项直接确认完成。待决期间 claim 对该条目一律拒绝（防第二实施者）；
  `hold answer/resume/cancel` 为人工专属（Agent 调用被 state-guard 拦截）；决策与事件留痕写条目目录 `decisions.md`。
- 回执与核对响应各 ≤2 KiB；批次/运行账本在 `dispatch/` 与 `refine/`（不进版本控制）；完善三态索引在
  `refine/states.json`（执行账本，不写条目 status.json）；待人工决策账本在 `holds/holds.json`（同口径）。
  执行 Agent 展示与四路子代理模型/智能档位在设置「批量任务」
  分区配置（`tasks/settings.json`）。详约见项目内 `docs/agent-team-board/batch-execution.md`。

## TDD 开发流程（/dev 触发）

1. 确定目标：`/dev <ID>` 用指定条目；`/dev next` 则 `$ATB list --json` 选第一条 planned（已计划；同类型取创建最早的）。没有 planned 的条目就告诉用户先在看板上接受并「移入计划」（调度/开发启动均从已计划队列取单，REQ-20260908-010）。
2. **读文档**：条目 `README.md`、`design.md`、`test-cases.md`（Bug 读 README 与 design 的引入来源节）。信息不足先澄清或补文档（直接编辑 markdown，允许）；实施要点写入 design.md 作为实施记录。
3. `$ATB claim <ID> --by <会话名>`（accepted/planned → in-progress）。失败说明被其他会话认领或状态不对，如实转告用户。
4. **TDD**：test-cases.md 补用例并**写测试跑红** → 实现代码**跑绿** → 重构。新问题按 `/bug` 登记（登记时不填引入来源）。**修复 Bug 必须归因**：根因分析与 test-report 写明引入来源（design.md「引入来源（源单）」节已有则引用，缺失则排查补充并写入，三选一 REQ-/BUG-（`atb list` 核验存在）/未定位（附排查过程），禁止编造），并在 Bug README 开头头部补写 `- 引入来源：…` 行（第一屏可见，样式见 BUG-20260907-017）。**开源选型（REQ-20260909-015）**：方案优先复用成熟开源库，以依赖方式引入（npm / SPM / CocoaPods），禁止复制开源库源码进项目仓库（仅 vendor 例外且须标注复制范围与原因）；仅用开源友好许可（MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense），GPL / LGPL / AGPL / SSPL 及 License 不明禁止引入；引入开源库须在条目目录维护 `licenses.md`（库名 / 版本 / 引入方式 / License / 仓库地址），未使用不创建；自研须写三选一理由（引用了哪些库 / 无合适库的原因 / 引入成本高于自研的原因）。
5. **提交与待测试**：必须读取并执行 [dev 收尾规则](dev-closeout.md)：真实测试通过 → report（系统随后自动收口提交本单代码/测试/文档及报告状态，BUG-20260915-007；Agent 不再手工执行 git 提交）→ 核验提交 hash 和本轮待测试状态。用户明确授权例外开发也须按该规则收尾；收口/上报失败时明确报告未完成项，不宣称完整交付。不自动 push，不代替人工验收。
6. **实施中需人工决策**（范围/口径确认、方案取舍、账号或真机操作、排除项批准等，REQ-20260911-007）：
   `$ATB hold declare <ID> (--question "决策问题")… [--reason "…"] --by <会话名>` 声明后告知用户到
   Status Board「待人工确认」区作答并复工；不得代替人工作答或复工（`hold answer/resume` 为人工专属）。

## 会话调度规则

- **会话名约定（REQ-20260901-005）**：认领者显示会话名，格式 `<工具/语义名>` 全小写连字符（如 `zcode-login-view`、`codex-dev-loop`）。Agent 在 claim 时**应**主动起语义名：`$ATB claim <ID> --by zcode-<本次任务关键词>`，多会话并行便于看板区分；未传 --by 时工具生成可读缺省名（`前缀-MMDD-4位随机`，前缀可由环境变量 `ATB_AGENT_NAME` 注入，如 zcode/codex），不再出现裸 terminal。
- 一次会话同一时刻只认领一个条目；阶段一完成（停在待对齐）或实施完成（report 后）再取下一个。
- `/dev loop` 逐条处理：认领 → TDD 实施 → report → 本单 Git 提交与待测试核验 → 取下一个 planned（已计划），直到没有已计划条目。**失败处理**：认领冲突、开发错误等记录后跳过；提交/上报失败或归属不明改动遗留时按收尾规则停止取单；结束时输出完成/跳过清单与剩余状态分布。
- claim 冲突（已被他人认领）不是错误：`$ATB list` 换一个。
- 用户在聊天里描述的新需求/新缺陷：分别走 `/req`、`/bug` 创建，不要自行 accept。
- 看到条目是 submitted：提醒用户去 Status Board 接受；看到「待对齐」：提醒用户查阅 design.md 并对齐。

## Status Board（/board 触发）

单服务多项目：一个 server 实例可展示多个项目，`?project=<项目根绝对路径>` 决定看板数据源；顶栏有项目切换器兜底。页面内还有「文件」视图（File Board）：树形浏览项目文件并语法高亮，深链 `&view=files`。

**目标项目两级优先级（REQ-20260910-004）**：提示词（命令参数或用户消息）中提及的项目**优先**——
即使当前会话位于另一项目；提示词里没有提及任何项目时，按当前会话所属项目（左侧项目栏）**兜底**，
流程与现状一致。

1. `curl -sf http://127.0.0.1:8888/api/health` 检查服务是否已在运行（响应含已知项目列表
   `projects` 与 `defaultProject`，留存供项目名解析）。
2. 未运行则在项目根目录以**后台任务方式**拉起（Bash 后台运行模式执行
   `node <插件根>/scripts/server.mjs`，输出重定向 /tmp/agent-team-board.log），等 1 秒后再次 curl 验证
   （端口被占用时按日志提示处理，默认重开 http://127.0.0.1:8888 即可）。
3. **解析目标项目**：**绝对路径**（含 `~` 展开）目录存在即用，沿用服务端 `?project=` 校验与首次
   访问自动登记；**项目名**与已知项目列表各路径的**末段**（basename）做**忽略大小写**匹配，
   **唯一命中**才用；路径不存在 / 项目名无命中 / 多个同名项目 / 同时提及多个项目时**不打开猜测
   的项目**，向用户说明原因并列出已知项目（含完整路径）请澄清后再继续。提示词未提及项目时跳过
   解析，直接用当前会话项目根。
4. 加载 browser-use 的 control-browser skill，用浏览器打开
   `http://127.0.0.1:8888/?project=<encodeURIComponent(目标项目根绝对路径)>`
   （未提及项目时目标 = 会话所在项目根目录：git root 或含 `docs/agent-team-board/` 的目录；拿不准就用 cwd 绝对路径，
   服务端向上探测）。桌面端展开内置浏览器面板；无法使用浏览器时把 URL 告诉用户手动打开。
   目标项目尚未初始化时打开不报错，显示既有「当前项目尚未初始化看板」空态与「初始化」按钮。
5. 看板上的人工操作：接受（submitted→accepted）、**置计划（accepted→planned）/移出计划（planned→accepted）**、确认完成（in-progress→done）、
   驳回完成（done→in-progress）、新建需求/Bug 表单、项目切换；卡片可拖拽换列。服务 2 秒轮询自动刷新。

## 常见错误

| 报错 | 原因与处理 |
| ---- | ---------- |
| `未找到 docs/agent-team-board` | 项目还没初始化：`$ATB init` |
| `尚未被人工接受，不能认领` | 条目还是 submitted，请用户先接受 |
| `已被 <owner> 认领` | 并行冲突，`$ATB list --status accepted` 换任务 |
| `待人工决策（N 项未答）` | 条目正等人工作答（REQ-20260911-007）：请人工在 Status Board「待人工确认」补决策并复工后再实施 |
| `非法流转：…` | 状态机单向；检查当前状态（`$ATB show <ID>`） |
| 钩子拦截提示 | 你触碰了铁律 1/2，改用 `$ATB` 子命令或请用户人工操作 |
| 终端嫌 `node <插件>/scripts/atb.mjs` 太长 | 提示用户执行一次 `$ATB cli install`，之后终端直接敲 `atb …`（REQ-20260908-007） |
