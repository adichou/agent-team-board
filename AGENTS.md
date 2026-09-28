# AGENTS.md — 开发本产品的仓库规则

[中文](./AGENTS.md) | [English](./AGENTS_en.md)

本文件面向「在本仓库开发 agent-team-board 本体」的 Agent 与人。用本产品管理**其他项目**的任务时，规范入口是 [skills/agent-team-board/SKILL.md](./skills/agent-team-board/SKILL.md)（本文件不复制其内容）；两个场景的详细边界见文末「双入口边界」。

本文随发布计划 BLD-20260927-001（版本 1.0.0，首个基线版本）整理；以下为仓库协作规则，发布文档不替代任务管理 skill。

## 开发必须走看板

1. **改前先登记**：改动本仓库任何源码（scripts/、commands/、skills/、hooks/、插件 manifest、根文档）前，必须先 `/req` 或 `/bug` 登记条目 → 人工在看板「接受」→ 人工「移入计划」→ `node scripts/atb.mjs claim <ID>` 认领（认领即产生认领锁）。**例外：插件根第一层发布文档**（REQ-20260918-002 根 README.md；REQ-20260923-001 扩展）——根 `README.md` / `CHANGELOG.md` / `FEATURES.md` / `AGENTS.md` 四类标准发布文档与发布看板文档编写页加入的自定义文档（版本记录 `v.customDocs` 清单内，如 `MIGRATION.md`；语言变体 `<KEY>_<lang>.md`、`LICENSE.md` 暂不在内）均为纯文档，用户与 Agent 无需认领锁即可直接更新，并可经 Bash 提交仅含这些文件、主题符合「类型: 描述 单号」提交规范（带条目编号）的改动。
2. **源码受硬保护**：无有效认领锁时，PreToolUse 钩子（hooks/hooks.json → scripts/state-guard.mjs）会确定性拦截对源码的写入（REQ-20260901-003）。不要尝试绕过；看板用户数据目录（agent-team-board/data/ 的条目 markdown）编辑不受限。
3. **状态铁律**：绝不直写任何条目状态文件（`agent-team-board/runtime/status/*.json`）；绝不把条目置为 accepted / planned / done（仅限人工）；Agent 的常规状态操作只有 claim 与 report。

## TDD 与收口

1. **测试先行**：在 scripts/tests/ 新增 `<前缀>-<单号小写>.test.mjs`（先跑红），实现后跑绿；交付前 `npm test` 全量必须通过。
2. **report 收口**：完成后 `node scripts/atb.mjs report <ID> --summary "…"`——系统按认领时工作区快照归因，自动把本单源码、测试与条目文档改动提交到 dev（只 commit 不 push）；条目文档（条目目录内 README/design/test-cases/test-report.md 等，工程单据、用户数据）随收口 doc 组提交（`doc: <标题> <单号>`），看板板级共享路径（迁移搬移、留痕出库等）仍随收口收纳；**根第一层文档**（根目录 `.md`，含 README/AGENTS/CHANGELOG/FEATURES/DESIGN 与语言变体、LICENSE.md 等）不随收口提交、不触发暂扣（REQ-20260923-002）——差异保留在工作区，由人工/发布文档流程处理。**开发收口不要手工 git commit**（收口提交由系统自动完成，不经 Agent Bash）、**不要自动 push**、**不要把条目置为 done**；report 后用 `atb show <ID> --json` 与 `atb commit log <ID>` 核验待测试状态与提交 hash（源码、测试与条目文档的提交 hash；根目录文档差异留在工作区走发布文档流程）。文档讨论轮的条目文档提交放行口径见下表（REQ-20260917-002）。
3. **受阻走 hold**：实施中需人工决策（范围 / 方案取舍 / 账号真机操作等）时，`atb hold declare` 声明问题清单并交 blocked 回执；不得代替人工作答或复工。

## 质量基线

- **中英文同步**：界面文案集中在 scripts/web/i18n.js（中文原文为键：静态精确 EN / 动态 EN_DYNAMIC 插值），任何文案改动必须同步两语言并跑 i18n 相关测试（BUG-20260912-001）。
- **开源选型**：按 REQ-20260909-015 执行——优先复用成熟开源库并以依赖方式引入（npm），禁止复制库源码进仓库；License 仅用 MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense 白名单；引入时在该条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址）。
- **提交主题**：带条目编号，规范校验在 scripts/lib/commit-store.mjs（自动收口提交已按此生成）。

## 测试与拦截速查

| 场景 | 命令 / 处理 |
| ---- | ---- |
| 全量测试 | `npm test`（= `node scripts/tests/run-all.mjs`） |
| 单个测试 | `node scripts/tests/<name>.test.mjs` |
| 直写条目状态文件 / 置人工状态被拦 | 改用 atb 子命令；接受 / 置计划 / 确认完成请人工操作 |
| 无认领锁改源码被拦 | 先登记 → 人工接受并移入计划 → `atb claim` 认领后再改；根第一层发布文档（README / CHANGELOG / FEATURES / AGENTS 与 `v.customDocs` 清单内自定义文档）无锁可直接改（REQ-20260918-002 / REQ-20260923-001） |
| Bash 里 git commit 被拦 | 开发收口：`atb report` 后系统自动收口提交（提交源码、测试与条目文档；根目录文档不随收口提交、不触发暂扣——REQ-20260923-002，留在工作区走下方发布文档口径），无需手工提交。文档讨论轮放行口径（REQ-20260917-002）：仅含 `agent-team-board/data/{requirements,bugs}/<条目ID>/` 条目目录用户数据 + 命令带 pathspec + 提交主题含条目编号（`doc: … REQ-/BUG-…`）三者同时满足才放行。发布文档放行口径（REQ-20260918-002 / REQ-20260923-001）：pathspec 全为根第一层豁免发布文档 + 主题行「类型: 描述 单号」合规；无 pathspec 裸提交、范围含源码 / runtime 应用数据 / status.json、主题无单号、`--amend` 等不可静态核验形态仍拦 |

## 数据与发布协作

- 条目说明、设计、用例和报告保存在 `agent-team-board/data/`，随 Git 管理（条目创建与删除由系统同步提交留痕——REQ-20260927-001 / REQ-20260923-004）；状态、锁、设置、确认留痕和执行账本保存在 `agent-team-board/runtime/`，仅本地留存，不作为发布文档提交。
- 编写发布材料时，以版本计划关联提交及其实际代码为依据。需求文字、当前 dev 分支功能和文档提交本身都不能单独证明功能已进入该版本；已回退或入口隐藏的能力须按实际状态描述。
- 发布 README 链接同语言 CHANGELOG 与 FEATURES；AGENTS 只写适用协作规则。完成文档不代表已验收、已合并或已发布，不擅自执行推送和部署。
- 发布文档按两阶段推进（REQ-20260921-012；BUG-20260926-002 起不再设整体审查完结确认）：默认语言发布文档（四类文档与版本设计文档 DESIGN.md）先 AI 总结并逐文件人工审核；其余语言经 AI 翻译后逐文件审查；语言集内全部文件审核通过后文档编写步骤才完结、提交才解锁。

## 文档地图

- 产品与运行入口：[README.md](./README.md)；本版变化：[CHANGELOG.md](./CHANGELOG.md)；功能说明：[FEATURES.md](./FEATURES.md)；设计说明：[DESIGN.md](./DESIGN.md)
- 开发本产品：本文件 + README.md
- 使用本产品管理任务（任意项目）：skills/agent-team-board/SKILL.md（唯一权威）
- 工程单据（用户数据，进 git）：agent-team-board/data/；运行应用数据（本地留存）：agent-team-board/runtime/；批量任务详解：skills/agent-team-board/batch-execution.md

## 双入口边界

- 本文件只写「**开发本产品**」的行动规则；SKILL.md 只写「**使用本产品管理任务**」的数据规范与流程铁律。两边各管一域，不互相复制内容。
- 两个场景同时适用（在本仓库用本产品开发本产品）时：先读本文件获知流程硬约束与收口规则，具体命令与状态机细节查 skills/agent-team-board/SKILL.md。
