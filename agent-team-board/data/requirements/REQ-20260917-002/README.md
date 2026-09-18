# REQ-20260917-002 调整 state-guard 拦截口径，放行文档讨论轮对看板条目文档的 git 提交

- 状态：accepted（已人工接受；流程状态以系统维护的 status.json 为准）
- 创建：2026-09-17T07:07:41.367Z

## 描述

### 背景

1. 文档讨论评审轮（如 REQ-20260916-007 的分类口径讨论）中，讨论流程提示词（`scripts/lib/oncall-store.mjs` 生成，REQ-20260914-003）明确要求 Agent「每轮回答后检查按需更新文件，更新完成后自动执行 git 提交（只 commit 不 push）」且提交消息须含讨论单号；但 state-guard 按 REQ-20260911-009 对看板项目内 Agent 经 Bash 的版本提交**一律拦截**，仅留两条通道：atb 系统自动收口提交（需 claim + report，条目须为 accepted/planned）与人工终端提交。submitted 状态的条目（正是评审讨论的常态）两条通道都走不了，讨论轮改动只能滞留工作区等人工终端补提交（2026-09-17 实例：REQ-20260916-007 讨论轮提交被拦，改动滞留）。
2. 守卫按字面 token 匹配还产生**非提交命令的误拦**：命令参数文本中出现「git」token 后随「commit」字样（如本需求的登记命令描述里引用拦截提示原文）即被当作提交命令拦截。本次登记 `atb new req` 即被误拦一次，换措辞后才成功。

### 已核实的现状（2026-09-17，事实源为当前工作区代码）

- 拦截实现：`scripts/state-guard.mjs` bash 模式第 (5) 条——`gitSubcommandOf(tokens) === 'commit'` 且 `boardDataDirOf(hook.cwd)` 能向上找到 `docs/agent-team-board` 即拒绝；**不看 pathspec、不看提交范围**，看板项目内 Agent Bash 的 git commit 一律拦。既有授权通道有二：atb 进程内部执行的自动收口提交（不经 Agent Bash，天然不过守卫）与人工终端提交（REQ-20260911-010 起 CMT 豁免已随回退移除）。
- 误拦机制：bash 模式对命令段先 `stripPairedQuotes`（引号内拼接归一）再按空白切 token，`gitSubcommandOf` 在段内**任意位置**找 basename 为 `git` 的 token 并取其后首个非选项 token 当子命令——`atb new req --desc "…流程外 git commit 已拦截…"` 中引号内的 `git`、`commit` 两个词经去引号后成了独立 token，被误判为提交命令。分段层面（`splitShellSegments` 已按 `;` / `&&` / `|` 切段逐段检查）没有问题，问题在段内不区分「命令位」与「参数位」。
- 既有测试：`scripts/tests/dev-flow-20260911-009.test.mjs` 的 D10 用例（看板项目内流程外 git commit 一律拦；无看板项目放行；`git add` 放行）承载现行口径，需按新口径改造并补充放行 / 误拦用例。
- 文档现状：根 `AGENTS.md`「测试与拦截速查」表的「Bash 里 git commit 被拦」行、`skills/agent-team-board/SKILL.md` 开发流程（report 后系统自动收口提交，Agent 不手工 git 提交）与「常见错误」表（钩子拦截提示行）均按「一律拦截」口径书写，需随新口径同步。

### 目标

1. **放行文档讨论轮提交**：Agent 经 Bash 执行版本提交，当提交范围**仅含看板用户数据文档**时放行——范围限定为条目目录用户数据：`docs/agent-team-board/{requirements,bugs}/<ID>/` 下的 markdown（README / design / test-cases / test-report / licenses / decisions 等）、`ui-demo.html`、`attachments/`（含需求归属 bug 嵌套 `requirements/<REQ>/bugs/<BUG>/`），与 REQ-20260916-007 的用户数据口径一致；提交主题须带条目编号（与仓库提交主题规范「类型: 描述 单号」一致）。
2. **维持既有保护不回退**：涉及源码路径（`scripts/`、`commands/`、`skills/`、`hooks/`、插件 manifest、根文档）、任何 `status.json`、以及应用数据路径（`config.json`、各模块 settings / policies / dispatches、运行账本等，口径同 REQ-20260916-007）的提交仍拦截；不带 pathspec 的裸提交（会连带暂存区其他改动）仍拦截。
3. **消除文本误拦**：守卫对「命令里出现 git+commit 字样」的判定改为识别真实的提交命令意图（如按命令位语义解析而非全文 token 扫描），`atb new req --desc "…git commit…"` 这类含引用文本的合法命令不再被拦。

### 拦截口径细则（放行须同时满足，任一不满足即拦）

1. 管辖判定不变：cwd 向上能找到 `docs/agent-team-board`（非看板项目不管辖，维持现状）。
2. 是真实的 git commit 命令：`git` 处于命令位（段首或跟在 shell 分隔 / 环境变量赋值之后），而非参数文本中的词。
3. 命令带 pathspec，且全部 pathspec 解析（结合 hook.cwd）后均落在上述条目目录用户数据范围内；无 pathspec（含 `git commit -a` 之类的暂存区整体提交形态）一律拦。
4. 提交主题含条目编号（REQ-/BUG-；讨论轮可含讨论单号）。

## 验收标准

- [ ] 放行口径生效：Agent 对仅含条目目录用户数据文档路径的版本提交可执行成功（测试覆盖带 pathspec 提交、目录整体作 pathspec、嵌套需求归属 bug 路径）；提交主题含条目编号。
- [ ] 讨论轮场景打通：模拟文档讨论轮（编辑 submitted / accepted 条目 markdown 后以带 pathspec + 主题含单号提交）可成功提交，该场景此前被拦。
- [ ] 保护不回退：含源码路径、`status.json`、应用数据路径的提交被拦；无 pathspec 的裸提交被拦；REQ-20260911-009 既有拦截用例（D10 等）在改造后全部保持通过。
- [ ] 文本误拦消除：命令参数文本中含 git 与 commit 相邻字样的非提交命令（如 `atb new req --desc "…git commit…"`、`grep "git commit" 说明文档`）不再被误拦；以分号 / `&&` / `|` 拼接真实提交命令的绕过尝试仍被拦。
- [ ] TDD：先在 `scripts/tests/` 新增 / 改造 state-guard 口径用例跑红，再实现跑绿；`npm test` 全量通过。
- [ ] 文档同步：根 `AGENTS.md`「测试与拦截速查」（含「Bash 里 git commit 被拦」行）、skills/agent-team-board/SKILL.md 提交通道描述与「常见错误」表按新口径更新（明确放行范围、仍拦场景与主题规范）。

## 待确认（开发阶段定案，不阻塞本单完善）

- pathspec 静态解析深度：相对路径 / 通配符 / 目录整体作 pathspec 的处理方式；守卫只做命令文本静态分析，是否以及如何对照 git 索引或文件系统复核落点。
- 主题校验的执行位置：守卫是否在拦截层校验「主题含条目编号」，还是仅靠文档约定与 commit-store 主题规范（`scripts/lib/commit-store.mjs`）在提交通道约束。
- `git commit --amend`、`--only` / `--include` 等变体的归类（建议默认按「非授权形态拦」，含 `--amend`——它会改写上一笔提交，超出本单放行语义）。
- 与 REQ-20260916-007 的落地顺序：本单放行口径以「路径分类」为准，不依赖应用数据是否已移出 git 跟踪；两单先后落地均不冲突，实现时是否需要联动复核。

## 关联

- REQ-20260911-009：现行「流程外 git commit 一律拦截」口径的来源单，本需求在其基础上放宽文档讨论轮场景。
- REQ-20260916-007：用户数据 / 应用数据分离（本需求放行范围采用其用户数据口径），其讨论轮提交被拦是本需求的直接触发实例。
- REQ-20260914-003：讨论流程提示词的「每轮更新后自动 git 提交」约定，本需求为其提供可行的提交通道。
- REQ-20260911-010：CMT 批次提交通道回退、豁免移除的历史决策，本需求不恢复该通道。
