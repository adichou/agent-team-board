# 设计 — REQ-20260920-002 设置界面的初始化 dev 分支改为切换至 dev 分支

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

## 方案

纯前端文案与反馈改造（scripts/web/app.js + scripts/web/i18n.js），后端零改动：

- `gitWorkflowAreaHtml` 主按钮「初始化 dev 分支」→「切换至 dev 分支」；就绪态「已在 dev 分支」、非 Git 指引、状态行、禁用与忙碌逻辑不变。
- 确认框改为切换导向：标题「切换至 dev 分支？」、正文「将把整个项目工作区切换至 dev 分支。若 dev 不存在，将先创建再切换。仅本地操作，不 push。」、确认按钮「切换至 dev」；取消不发请求（既有 `uiConfirm` 取消语义）。
- 执行提示「正在切换至 dev 分支…」；成功刷新 `/api/git/branch-state` 并反馈「✓ 已切换至 dev 分支」；失败展示真实原因 +「（可重试；不会丢弃工作区修改）」并恢复入口。
- `/api/git/init-dev` 与 `ensureDevWorkflow`（按需创建 + 切换、幂等、仅本地不 push）原样保留，不重命名 API、不重建已有 dev。
- i18n：新增 6 条静态词条 + 1 条 EN_DYNAMIC 失败动态键，移除 6 条旧词条 + 1 条旧动态键；英文主操作按验收口径为「Switch to dev branch」。

**开源选型（REQ-20260909-015）**：本单为既有代码文案改造，未引入任何开源库（无合适库可复用，引入成本高于自研），不创建 licenses.md。

## 风险与边界

- 不触碰 `/api/git/init-dev`、`ensureDevWorkflow`、`branch-state` 的行为与数据形态；本单不扩展为 API 重命名或 Git 工作流重构。
- 「已初始化并切换到…」（数据布局迁移 toast，app.js 其他功能）为合法异功能文案，不移除；测试断言按功能区切片 + 字面量口径避免误伤。
- 既有测试 dev-flow-20260911-009.test.mjs D12 两条旧文案断言随实现同步更新为新口径。
