# 设计 — BUG-20260918-002 需求/bug点击完成不应该触发管理记录提交，因为在新目录架构下，条目状态变更不需要同步提交到 git

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260914-007（经 `atb list` 核验真实存在，已 done）引入「人工确认完成和版本合并成功后自动提交管理文件」闭环；REQ-20260916-007（已 done）用户/应用数据分离整改后口径遗留——`status.json` 迁 `runtime/status/` 整目录忽略、version 类随版本账本入库取消后，该闭环失去存在前提但未随之下线。

## 根因分析

REQ-20260914-007 落地时，条目 `status.json` 与管理留痕文档都在 git 跟踪的条目目录内，「状态变更需同步入库」成立，故确认成功后在同请求/同命令内自动执行路径限定提交（`scripts/lib/mgt-commit.mjs`）。REQ-20260916-007 数据分离后：

1. 状态本体（`status.json`）已迁被忽略的 `runtime/`，「随完成入库状态」不复存在；
2. 闭环唯一还会提交的只剩 `confirmations.md` / `decisions.md` 两份人读留痕，可随既有通道（收口提交 / 人工提交 / REQ-20260917-002 放行的文档提交）入库；
3. 但确认完成入口仍同步执行 git 写（serve 场景与用户终端 git 存在锁竞争窗口，见 BUG-20260918-001），失败还引入「操作成功但提示失败」的混合反馈与人工重试流程（账本 `runtime/commits/mgt/`、反馈块五态、`重试提交` 按钮）。

即机制前提消失后闭环整体成为口径遗留。

## 方案

**定案：item 类管理记录提交闭环全量下线**（version 类已随 REQ-20260916-007 取消，无其他调用方，保留重试入口只会服务已不存在的生产者，且旧失败账本会在条目详情持续渲染过期失败块）：

1. `scripts/server.mjs`：`POST /api/item/:id/status` 确认完成分支不再采集基线、不再调用 `commitItemDoneMgmt`，响应不含 `mgtCommit`；删除 `POST /api/mgt-commit/retry` 路由；条目详情 `GET /api/item/:id` 不再附 `mgtCommit`（旧失败账本不再被读取，自然不再渲染）。
2. `scripts/atb.mjs`：`status` 分支移除基线采集、提交与全部管理记录输出行；删除 `mgt retry` 子命令与 import。
3. `scripts/lib/mgt-commit.mjs`：整模块删除（`commitItemDoneMgmt` / `retryMgmt` / 账本读写无剩余调用方）。
4. `scripts/web/app.js`：移除「管理记录提交」反馈块（`mgtCommitBlockHtml` / `drawerMgtBlockHtml`）、失败 toast（`mgtFailureToast`）、重试入口（`retryMgtCommit` + `data-mgt-retry` 绑定）与提交中态（`mgtSubmitting`）。
5. `scripts/web/build.js`：版本侧同类残留（服务端已不再返回 `mgtCommit` 的死代码：`mgtBlockHtml` / `retryMgt` / `data-ver-mgt-retry` / `mgtSubmitting`）一并清除。
6. `scripts/web/style.css`：`.mgt` 样式块移除。
7. `scripts/web/i18n.js`：管理记录提交相关文案中英双语同步移除（静态词条与 EN_DYNAMIC `⚠ 操作已成功，管理记录提交失败：◇` 等）。
8. `runtime/commits/mgt/` 旧账本为被忽略的应用数据，下线后不再被读取，无需迁移清理。
9. 文档同步：`README.md` 模块表移除 `mgt-commit.mjs` 行述；`scripts/lib/manual-closeout.mjs` 头注释更新；根 `AGENTS.md` 与 skills 文档无该机制表述（已核），不需改动。
10. 防呆不回退：确认完成的待人工决策未答拦截 / force 二次确认、状态机校验、驳回完成（done → in-progress）行为均不变。

**开源选型（REQ-20260909-015）**：本单为机制下线与文案/样式清理，纯删除既有自研代码，未引入新能力，无合适开源库可复用（也不涉及 vendor）；不创建 licenses.md。

## 风险与边界

- **旧失败账本的补交**：历史上确认完成提交失败的条目，其 `decisions.md` / `confirmations.md` 变更本就保留在工作区（未丢失），下线后经人工提交或文档提交通道入库；重试入口消失不再产生新的 git 写。
- **测试同步**：`mgt-auto-commit-20260914-007.test.mjs` 按新口径改写（确认完成不提交 / 重试入口下线 / 前端与 i18n 契约），`req-doc-entry-20260916-003.test.mjs` 声明路径清单移除 `scripts/lib/mgt-commit.mjs`；新增 `bug-20260918-002.test.mjs` 承载本单红→绿用例（含防呆与驳回完成回归）。
- **不改动**：确认完成防呆、状态机、收口提交（report 口径）与版本合并本身；`product-release-serve.test.mjs` 中提及该机制的历史注释仅说明断言宽松原因，行为不受影响。
