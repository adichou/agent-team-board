# AGENTS.md — 开发本产品的仓库规则

本文件面向「在本仓库开发 agent-team-board 本体」的 Agent 与人。用本产品管理**其他项目**的任务时，规范入口是 skills/agent-team-board/SKILL.md（本文件不复制其内容）；两个场景的详细边界见文末「双入口边界」。

## 开发必须走看板

1. **改前先登记**：改动本仓库任何源码（scripts/、commands/、skills/、hooks/、插件 manifest、根文档）前，必须先 `/req` 或 `/bug` 登记条目 → 人工在看板「接受」→ 人工「移入计划」→ `node scripts/atb.mjs claim <ID>` 认领（认领即产生认领锁）。
2. **源码受硬保护**：无有效认领锁时，PreToolUse 钩子（hooks/hooks.json → scripts/state-guard.mjs）会确定性拦截对源码的写入（REQ-20260901-003）。不要尝试绕过；看板数据目录（docs/agent-team-board/ 的条目 markdown）编辑不受限。
3. **状态铁律**：绝不直写任何 `status.json`；绝不把条目置为 accepted / planned / done（仅限人工）；Agent 的常规状态操作只有 claim 与 report。

## TDD 与收口

1. **测试先行**：在 scripts/tests/ 新增 `<前缀>-<单号小写>.test.mjs`（先跑红），实现后跑绿；交付前 `npm test` 全量必须通过。
2. **report 收口**：完成后 `node scripts/atb.mjs report <ID> --summary "…"`——系统按认领时工作区快照归因，自动把本单改动提交到 dev（只 commit 不 push）。**不要手工 git commit**（Bash 提交会被钩子拦截）、**不要自动 push**、**不要把条目置为 done**；report 后用 `atb show <ID> --json` 与 `atb commit log <ID>` 核验待测试状态与提交 hash。
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
| 直写 status.json / 置人工状态被拦 | 改用 atb 子命令；接受 / 置计划 / 确认完成请人工操作 |
| 无认领锁改源码被拦 | 先登记 → 人工接受并移入计划 → `atb claim` 认领后再改 |
| Bash 里 git commit 被拦 | `atb report` 后系统自动收口提交，无需手工提交 |

## 文档地图

- 项目定位、目录与模块地图、环境与运行命令：README.md
- 开发本产品：本文件 + README.md
- 使用本产品管理任务（任意项目）：skills/agent-team-board/SKILL.md（唯一权威）
- 工程事实源与历史单据：docs/agent-team-board/（批量任务详解：batch-execution.md）

## 双入口边界

- 本文件只写「**开发本产品**」的行动规则；SKILL.md 只写「**使用本产品管理任务**」的数据规范与流程铁律。两边各管一域，不互相复制内容。
- 两个场景同时适用（在本仓库用本产品开发本产品）时：先读本文件获知流程硬约束与收口规则，具体命令与状态机细节查 skills/agent-team-board/SKILL.md。
