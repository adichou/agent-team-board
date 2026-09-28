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
未使用开源库的条目不创建该文件。本单为业务状态机口径修正（版本记录新增一个确认字段 + 判定换基准），
无合适开源库可复用，自研实现。

### 判定口径（正式发布 = 发布按钮 + 二次确认）

- 新增 `v.release.confirmedAt`（+ `confirmedRunId`）：正式发布确认时点，由「发布」按钮二次确认后的一键
  发布链路（BUG-20260928-002）在 `build-publish.start()` 校验通过、运行置 `running` 时经
  `buildStore.recordReleaseConfirm()` 落账；幂等——首次确认时点固化（重试 / 取消后再发布不重置，与
  「成功不可逆」同向）。版本记录缺失或写入失败不阻断发布执行（best-effort 落账）。
- `isPushed(v)`（推送即锁定）改为 `isReleased(v) = !!(v.release && v.release.confirmedAt)`；推送
  （动作一 push / 发布管线 sync-source 原子推送）只落推送事实（`pushedAt` / 官网检测窗口起点），不构成
  正式发布、不触发范围锁定。
- 锁点全部换基准、提示文案不变：build-store（条目增删 / 换 commit / 补入提交 / 重开合并 / 文档语言集 /
  自定义文档清单）、publish-flow 五步门禁（docs / docmerge / merge 锁定与 release 步查看放开）、
  server 端点守卫（version/merge、docs/merge）。
- `/api/build/state` 的 `pushed` 键改为 `released`（= isReleased）；前端 `pushedOf` → `releasedOf`
  （读 `v.released`）。
- 界面：发布步「动作一 · 推送远端」完成态追加一句说明——推送完成不等于正式发布，正式发布以「发布」按钮
  二次确认为准，确认后版本范围锁定；i18n 中英文同步（scripts/web/i18n.js）。

### 存量处理（验收 3）

已推送但未经发布按钮确认的存量版本（如 BLD-20260927-001）：按新口径自动解锁（`pushedAt` 仅为推送事实，
`confirmedAt` 缺失即未正式发布），条目增删 / 文档合并等恢复可用；补确认路径 = 现有「发布」按钮 → 二次确认
→ 一键发布链路 start 即落 `confirmedAt` → 进入与现状一致的正式发布锁定态。不做数据迁移、不新增解锁入口。

## 风险与边界

- 边界（不改）：`releasedAt` /「发布于」展示维持 REQ-20260922-006 口径（推送成功时间，含存量回退）——
  本单只改「正式发布锁定」判定，不重定义发布时间展示；「已发布」卡片标签维持 BUG-20260917-001 口径
  （`release.published`，任一 succeeded 运行）不变。
- 发布运行失败 / 取消后 `confirmedAt` 已落账：版本保持锁定（重试入口保留，重试 / 再发布不重置确认时点）；
  与 BUG-20260928-002「锁定不放宽、不新增解锁路径」一致。
- 前端 mock `pushed: true` 的既有测试夹具随键名换为 `released: true`（bug-20260920-005 / 20260921-016 /
  20260920-006 / 20260913-004 / 20260915-003），断言文案不变。
