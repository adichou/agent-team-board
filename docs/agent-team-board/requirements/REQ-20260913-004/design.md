# 设计 — REQ-20260913-004 支持版本删除

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

构建模块（REQ-20260913-001）的版本计划只能创建、编辑与合并，无删除能力：误建草稿、放弃的失败版本、
早已合并的历史版本永久留在列表。本需求为版本计划增加「删除版本」能力，语义按状态区分（draft/failed
= 放弃计划；merged = 仅移除看板记录；merging = 禁删），对齐批次删除（REQ-20260907-013）与待接受
条目删除（REQ-20260908-003）的破坏性操作口径。

## 方案

三层各一处增量，全部复用模块既有范式，无新依赖：

- **数据层**（`scripts/lib/build-store.mjs`）新增 `deleteVersion(dataDir, id)`：
  `readVersion` 兜底「找不到版本计划：<id>」（AtbError→400）；merging 抛 `BuildConflictError`
  （经服务端 runPost 映射 409）；其余状态整目录 `fs.rmSync(recursive, force)` 移除
  `builds/versions/<id>/`（对齐 `batch.deleteBatch` 口径），返回 `{ ok, id }`。不触碰 REQ/BUG
  状态机与 git（条目与提交不受影响）。
- **服务端**（`scripts/server.mjs`）新增 `POST /api/build/version/delete`（POST + JSON，
  对齐 `/api/batch/delete`）：透传数据层结果与错误；删除后的最新版本状态由前端统一刷新
  `/api/build/state`（选中失效回落既有规则复用）。
- **前端**（`scripts/web/build.js`）：每张版本卡片 `card-acts` 在「AI 完善 / 合并入 main」后加
  第三个「删除」键（`btn small quiet` 危险弱化；merging 卡片禁用 title「合并中，不可删除」；
  `mergeBusy` 与合并键同口径全局禁用）。删除必经 `rel-modal` 确认弹窗：标题「删除版本（<id>）」，
  正文列名称 / 状态 / 关联单数，按状态差异化提示（draft/failed 不可恢复、条目可重新纳入其他版本；
  merged 仅移除看板记录、不影响已合并入 main 的提交与代码）；「取消 / 确认删除」双键，确认键
  `btn danger`。执行期间弹窗保持展示、确认键禁用显示「删除中…」防重复提交；成功 toast
  「✓ 已删除版本（<id>）」并刷新（选中失效回落列表最新，空则既有空态）；失败 toast
  「✕ 删除失败：<原因>」（isErr 错误样式）、弹窗关闭、版本保留可重试。弹窗打开期间 state 守卫
  不再开第二个删除弹窗（遮罩 + Escape / 取消关闭，执行中不关防误触）。i18n 新文案入 EN / EN_DYNAMIC。

**开源选型（REQ-20260909-015）**：自研。删除是纯本地目录移除 + 既有 rel-modal/toast 范式复用，
单页面前端与 Node 内置 fs 即可覆盖，无合适引入的开源库（也无引入必要），未新增依赖、不创建 licenses.md。

## 风险与边界

- 删除不可恢复（整目录移除）：仅靠显式确认弹窗授权，确认键为危险样式、执行中防重复触发。
- merging 禁删为数据层硬校验（前端禁用只是体验层双保险），避免删除破坏合并状态机；
  服务重启后 merging 会被 recoverMerging 置 failed，此后可删。
- merged 删除只移除看板版本记录，git 历史与已合并提交不动（弹窗文案明确提示）。
- 删除不影响 REQ/BUG 条目本身与其 commit 关联索引（条目可重新纳入其他版本）。

