# 设计 — BUG-20260921-001 req-20260920-003.test.mjs L4 夹具硬编码当日条目编号，跨日运行必失败

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260920-003（经 `atb list` 核验存在，状态 done）——构建和发布流程整改时新增
  scripts/tests/req-20260920-003.test.mjs，其 L4 服务接口用例夹具以硬编码的登记日编号
  （REQ-20260920-001 / REQ-20260920-002）驱动 core.createItem / core.setStatus，跨日即失效。
- 与 BUG-20260920-005 无关（失败点在夹具阶段，先于任何被改代码路径）。

## 根因分析

条目编号由 `core.nextId` 按 `localDateStamp()`（本地日期）生成：登记当日创建返回
REQ-20260920-001/002，本地日期越过 2026-09-20 后实际返回 REQ-YYYYMMDD-001/002。
夹具却按硬编码编号 `core.setStatus(dataDir, 'REQ-20260920-001', …)` 推状态，
`resolveItemDir` 找不到该目录即抛「找不到 REQ-20260920-001」，整文件 L4 用例必失败；
且 `/api/build/version` 校验 itemId 必须在看板中真实存在（BUG-20260913-001 / BUG-20260914-004
口径），后续创建版本引用同样会 400。

## 方案

夹具改为捕获 `core.createItem` 返回的真实 id（同 build-serve.test.mjs 的 reqA/reqB 口径）：

1. scripts/tests/req-20260920-003.test.mjs L4 夹具：`const reqA / reqB = core.createItem(…)`，
   状态流转 `core.setStatus(dataDir, it.id, …)`；创建版本（只关联 B）与文末 v2 还原处
   的 `itemId` 一并改用 `reqB.id` / `reqA.id`。git 提交消息中的 REQ-20260920-001/002
   仅为装饰性标签（与 L3 用例一致，流程不按消息匹配条目），保持不动。
2. 新增回归 scripts/tests/bug-20260921-001.test.mjs：R1 机制复现（编号携带本地日期，
   真实捕获 id 永远可推状态、硬编码历史日期编号报「找不到」）；R2 源契约（该文件不再出现
   「for (const id of ['REQ-…]) → setStatus(id)」硬编码形态，必须捕获返回值并以 .id 推状态）。

**开源选型（REQ-20260909-015）**：本单为测试夹具修复，未引入任何开源库（无合适库可复用——
改动域是本仓库自研测试的夹具数据流），不创建 licenses.md。

## 风险与边界

- 只改测试夹具与新增回归测试，不改任何产品源码（core.mjs / server.mjs / build-*.mjs 零改动）。
- 不采用「固定日期注入 localDateStamp」方案：需为 core 增加注入点或测试内 hack 时间，
  改动面大于夹具自身，且掩盖「编号随日期轮转」这一真实行为。
- L1–L3 / L5 用例不受影响（其 REQ-20260920-001/002 为纯数据标签，无看板交互）；
  全量 `npm test` 294 个测试文件 0 失败。
