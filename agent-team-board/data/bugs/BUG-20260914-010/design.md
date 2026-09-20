# 设计 — BUG-20260914-010 批量开发暂扣待人工提交的改动缺少人工提醒通道

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：BUG-20260913-006（已核验存在于看板，状态 done）。

BUG-20260913-006（「批量实施 auto-commit 漏提交业务源码」）的修复引入了暂扣机制：
auto-commit 归因时，非看板路径若「预留时工作区已脏且本单动过」（`dirtyTouched` / 带预留前
基线的 `changed`）则列入 `pendingManual` 不自动提交，且本单 test/业务组一并暂扣（`heldGroups`），
仅提交 doc 组（`scripts/lib/git-flow.mjs` 约 283–356 行，BUG-20260913-006 注释自述
「不静默留脏」）。该修复补齐了「不误提交、不静默留脏」（账本 `auto-commit.json` + 回执 JSON
上抛 pendingManual），但没有做后一半：**把暂扣状态升级为人工可见的持续提醒**。本 Bug 即该
修复引入的缺口。

## 根因分析

信息流在 worker → 主调度一段是通的，之后三处断路（均已在 2026-09-14 复现核实）：

1. **主调度提示词无对应指令**（`scripts/lib/batch.mjs` `generatePrompt()`，约 458–471 行）：
   要求主会话「只接收规定的短回执」「不逐项输出长总结」「收尾只给本轮计数和异常入口」，
   定义的异常仅 `needs_attention`；回执里的 `autoCommit.pendingManual` 是普通 JSON 字段，
   没有任何一句要求出现时报告人工。
2. **`batch check` 不感知暂扣**（`scripts/lib/batch.mjs` `checkBatch()`，约 932–1010 行）：
   nextAction 只看在途运行、批次 needs_attention（仅 failed/blocked 运行触发）、终止、暂停、
   剩余数；`reported` 且带暂扣的运行是成功终态，收尾 notice 只报「本轮队列已处理完毕」。
3. **看板无展示**：Status Board「⚠ 待人工确认」聚合区为 `hold declare`（REQ-20260911-007
   人工决策）专用，读 `holds/holds.json`；`server.mjs` 与 `web/build.js` 中不存在
   pendingManual/heldGroups 任何出口。

后果放大机制（滚雪球）：暂扣路径（如 `scripts/web/build.js`）留在工作区未提交，后续每单只要
再动它就必然再次命中「预留前已脏且本单动过」→ 再次暂扣。batch-20260913-048 一轮内从 run-221
起连续 5 单如此，人工零感知。

## 方案

三层通道组合（对应 README 验收 1–3），全部复用既有结构、无新账本：

1. **`checkBatch()` 汇总暂扣**：遍历本轮 `reported` 运行的 `runs/<id>/auto-commit.json`（已含
   pendingManual/heldGroups），计数 >0 时拼入 notice（stop 收尾与 continue 运行中均携带）；
   注意 CHECK_MAX_BYTES 上限，超限时降级为「N 单暂扣，明细见 dispatch/runs/*/auto-commit.json」。
2. **看板聚合**：新增服务端只读接口（或扩展既有 holds 聚合接口）汇总暂扣单，前端「⚠ 待人工确认」
   区内新增「待人工提交」分组展示单号与路径数（README ASCII 示意）；人工提交后以工作区/账本
   状态为口径自然消失（下一轮轮询刷新），无需新增状态写入。
3. **调度提示词补一句**：`generatePrompt()` 增加「回执 JSON 含 autoCommit.pendingManual 时，
   立即向用户报告单号与暂扣路径数，不得当作普通成功回执」。

**开源选型（REQ-20260909-015）**：本修复为既有 CLI/服务端/前端内的小幅扩展（读本地 JSON 账本、
拼 notice、渲染一组列表），无合适开源库可替代该内部结构整合，不引入新依赖，无需 licenses.md。

## 风险与边界

- `batch check` 响应 ≤2 KiB 上限：暂扣单数多时 notice 必须截断为计数 + 入口，不逐单列路径；
- 看板口径「提交后消失」依赖工作区状态推断（auto-commit.json 是运行时快照，人工提交不改写它），
  实现时以「账本记录的路径当前是否仍处于未提交脏状态」为消失判据，避免提醒残留；
- `generatePrompt()` 变更只影响新生成的调度提示词，已在跑的旧轮不追溯（可接受）；
- 暂扣机制本身的归因正确性（BUG-20260913-006 已修）不在本单范围；本单只补提醒通道。
