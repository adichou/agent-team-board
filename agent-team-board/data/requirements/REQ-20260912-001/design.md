# 设计 — REQ-20260912-001 设置中的 git 工作流的描述需要更详细

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

设置页「Git 工作流」分区（REQ-20260911-009 引入）的就绪态只有一行简短提示
「开发在 dev 分支进行，到待测试自动提交；仅本地分支操作，不 push。」，
未说明双分支模型全貌，用户不了解 main 分支的角色与自动提交口径。

## 方案

（技术选型、接口设计、影响面）

纯前端文案改造，无接口/数据层变更：

- `scripts/web/app.js` 新增 `gitWorkflowDescHtml()`，在 `gitWorkflowAreaHtml()` 就绪态
  无条件渲染详细描述（git 仓库与非 git 仓库状态都可见，初始化前即可了解全貌）：
  1. 总述：采用 dev + main 双分支协作；
  2. 分支职责：dev 分支承载需求设计、开发和测试；main 分支承载版本构建，发布构建物；
  3. 自动提交：每个需求或 Bug 单开发完自动提交到本地（仅本地分支操作，不 push）。
- 非 git 仓库状态在描述块之后保留原初始化指引（与现状一致）；加载/错误态不变。
- 描述与现状实现一致，不引入新行为承诺（ensureDevWorkflow 仅本地建 dev，
  main 在 git init 时作为初始分支创建；自动提交由 git-flow.mjs autoCommitForRun 承担）。
- `scripts/web/i18n.js`：新增三条 EN 词条（键 = 中文原文全文，值不含中文、全局唯一），
  移除被替换的旧单行提示词条；就绪 toast 文案与其词条保持不变。
- 无新增依赖：未使用开源库（README 无 licenses.md）。

## 风险与边界

- i18n 覆盖卡点（i18n-coverage / i18n-dict）要求新中文文案必须同步词典，
  已同步并验证；旧词条移除后无残留引用。
- 仅影响设置页 Git 工作流分区展示，不改动 `/api/git/*`、git-flow 数据层与批量提交行为。
- 既有 dev-flow-20260911-009 D12 静态断言全部保留通过。

## 实施记录（2026-09-12）

- 测试：新增 `scripts/tests/git-workflow-desc-20260912-001.test.mjs`（T1~T6，静态契约 +
  i18n 词典断言），先跑红后跑绿；全量 204 个测试文件（含本单新增）0 失败。
- 改动文件：`scripts/web/app.js`（新增 gitWorkflowDescHtml + 就绪态模板改写 +
  移除旧单行提示）、`scripts/web/i18n.js`（+3 词条 / -1 旧词条）。
- 用例结果见 test-cases.md（T1~T6 全部通过）。
