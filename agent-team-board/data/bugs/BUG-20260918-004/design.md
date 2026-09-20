# 设计 — BUG-20260918-004 确认闭环全量测试硬编码 600 秒超时，长套件永远无法通过确认

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：BUG-20260915-008（确认/核验任务转异步时沿用同步路径的 600 秒上限；同步上限源自 REQ-20260914-001 确认闭环引入的 npm test 复验。两个编号均经 atb list 核验存在）

## 根因分析

两条链路超时口径各自为政（均已源码核实）：

1. **批次执行**（server.mjs oncall/refine 泵，:1003/:1172）：`timeoutMs: (run.timeoutMin || settings.timeoutMin || 60) * 60_000`——run 单项时限 → 项目设置（dispatch-store SETTING_RANGE 5–240，设置页可配）→ 默认 60 分钟。
2. **确认/核验任务**（server.mjs `startConfirmTask`，:2509）：登记时硬编码 `timeoutMs: 600_000`（源自 BUG-20260915-008 异步化时沿用同步路径上限；同步上限源自 REQ-20260914-001 确认闭环引入的 npm test 复验），临时缓解提交 7329efe 上调为 `36_000_000`，仍是与批次执行无关的硬编码常量。

600 秒确定性 SIGKILL → 退出码 null + `test.timedOut=true` → `verifyCommitConfirm` / `confirmCommitContinue` 判「测试未通过」拒绝——长套件仓库确认闭环永远无法通过。另：`runProjectTests` / `runProjectTestsAsync` 默认参数 `timeoutMs = 600_000`（confirm-store.mjs :155/:181），当前服务端总是注入 testRunner 才未踩到，但未注入的调用方（CLI / 直连 / 未来新增）仍会踩同一坑。

## 方案

确认任务超时改与批次执行完全同口径，消灭全部与批次无关的硬编码超时常量：

1. **confirm-store.mjs 新增 `confirmTestTimeoutMs(dataDir, itemId, settingsTimeoutMin)`**：读确认记录 → 容错读关联 run（`runtime/dispatch/runs/<runId>/run.json`）→ `(run.timeoutMin || settingsTimeoutMin || 60) * 60_000`。run 读取容错（记录缺失 / 账本被清理 → 按设置与默认口径回退，不阻断确认任务）；settings 由调用方传入（本层不 import dispatch-store——batch 已 import 本层，反向引入会成环，维持既有分层注释约束）。zcode 批次 run.json 无 timeoutMin 字段 → 自然落到 settings → 60，与批次链路取值一致。
2. **server.mjs `startConfirmTask`**：`timeoutMs: 36_000_000` → `confirmStore.confirmTestTimeoutMs(dataDir, itemId, dispatchStore.loadSettings(dataDir).codex.timeoutMin)`（与批次路径同一 loadSettings 入口）。临时上调的 36_000_000 不保留上限语义——口径值本身受 SETTING_RANGE（5–240 分钟）约束。
3. **confirm-store.mjs `runProjectTests` / `runProjectTestsAsync` 默认参数** `600_000` → `60 * 60_000`（开发阶段决定：统一到同口径，避免未来未注入 testRunner 的调用方再踩 600 秒坑；调用方显式传值不受影响）。
4. **前端口径对齐（scripts/web/app.js）**：`confirmTaskHtml` 超时上限展示兜底 `600_000` → `60 * 60_000`；`watchConfirmTask` 观察窗口默认 `620_000` → `60 分钟 + 20 秒余量`，verify / continue 两处调用改为按 POST 返回任务句柄的 `task.timeoutMs + 20_000` 取窗口（句柄缺失回落函数默认）——观察窗口不再固定在 600 秒时代余量，长套件运行中完成时 toast / 面板结论照常回填（观察超时本就由主轮询兜底，不改也正确，此为体验对齐；无文案改动，不涉 i18n）。

**开源选型（REQ-20260909-015）**：不引入开源库——改动为既有超时取值链路的口径统一（一个纯函数 + 两处常量替换），无合适的库可替代，自研成本低于引入成本。未使用开源库，不创建 licenses.md。

## 风险与边界

- **行为变化**：确认任务超时从 10 小时（临时缓解值）变为口径值（默认 60 分钟、上限 240 分钟）——被管仓库全量测试超过 240 分钟时确认会超时拒绝；这是与批次执行一致的既有口径边界（设置页可调），README 验收 4 要求批次路径不受影响，本方案不动批次路径。
- **tasks.json 落账兼容**：timeoutMs 仅作展示与超时依据，账本消费方（前端卡片「超时上限 M 秒」、运行态视图）为纯数值展示，值域变化无兼容问题；遗留 running 任务的恢复逻辑不读 timeoutMs。
- **回归面**：`runProjectTestsAsync` 显式传小超时的既有测试（bug-async-verify-20260915-008 A1b）不受默认参数影响；该测试 S1 对 `task.timeoutMs === 36_000_000` 的断言随行为一并于本单更新为口径默认值 3_600_000。短套件 / 无测试脚本项目走 skipped 口径，不受影响。

**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库，优先复用——以依赖方式引入
（Node/Web 项目走 npm，Apple 平台走 SPM / CocoaPods），禁止复制开源库源码进项目仓库；仅当库无包分发渠道
且确需使用时才允许 vendor（内嵌源码），须在 licenses.md 标注复制范围与原因。License 只用开源友好白名单：
MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；GPL / LGPL / AGPL / SSPL 等
强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 /
引入成本高于自研的原因。引入开源库须在条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），
未使用开源库的条目不创建该文件。

## 风险与边界
