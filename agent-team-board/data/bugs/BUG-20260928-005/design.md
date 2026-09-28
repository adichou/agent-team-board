# 设计 — BUG-20260928-005 推送完成即判定已正式发布并锁定范围，未以用户点击发布按钮并二次确认为准

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260926-002（发布模块五步重定义：「发布 = 推送到远端 + 官网资料更新」，`pushed` 判定为 `release.pushedAt` 落账，即推送完成即判「已正式发布」并锁定范围；编号已经 `atb list` 核验存在，状态 done）

## 根因分析（登记时排查记录）

「已正式发布」的系统口径是 `isPushed(v) = !!(v.release && v.release.pushedAt)`（scripts/lib/build-store.mjs:245），即**推送完成即判已发布**：

- 五步门禁（scripts/lib/publish-flow.mjs:812-844）与文档合并入口（publish-flow.mjs:819、server.mjs:3001、build-store.mjs:530/550/570）在 `pushed` 后一律锁定并提示「已正式发布，范围锁定（如需调整请新建版本）」；
- 本版本 BLD-20260927-001 的 `release.pushedAt=2026-09-27T16:18:17Z`、`pushedSha=687c88eb`（已核验在 origin/main 头），故推送后立即进入锁定态；
- 该口径来自 REQ-20260926-002 五步重定义（发布 = 推送 + 官网更新），未与「用户点击发布按钮 + 二次确认」绑定；BUG-20260928-002 补充发布按钮后，发布动作的用户语义与系统判定出现分离；
- 佐证：官网侧 `release.site.status=missed`（推送后扫描 8 轮、时间窗内 0 条提交），「官网资料更新」半边未完成，但锁定仅以 `pushedAt` 为准。

## 方案

**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库，优先复用——以依赖方式引入
（Node/Web 项目走 npm，Apple 平台走 SPM / CocoaPods），禁止复制开源库源码进项目仓库；仅当库无包分发渠道
且确需使用时才允许 vendor（内嵌源码），须在 licenses.md 标注复制范围与原因。License 只用开源友好白名单：
MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；GPL / LGPL / AGPL / SSPL 等
强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 /
引入成本高于自研的原因。引入开源库须在条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），
未使用开源库的条目不创建该文件。

## 风险与边界
