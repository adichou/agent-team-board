# 测试报告 — REQ-20260920-002 设置界面的初始化 dev 分支改为切换至 dev 分支

- runId: run-20260920-305
- owner: zcode-batch-053-3
- 日期: 2026-09-20
- 框架: node:test 风格自研断言脚本（node:assert/strict，与仓库既有测试同口径）

## 改动

- scripts/web/app.js：`gitWorkflowAreaHtml` 主按钮「初始化 dev 分支」→「切换至 dev 分支」；确认框标题「切换至 dev 分支？」、正文（整体工作区切换 / dev 不存在先创建再切换 / 仅本地不 push）、确认按钮「切换至 dev」；执行提示「正在切换至 dev 分支…」；成功反馈「✓ 已切换至 dev 分支」；失败「失败：<原因>（可重试；不会丢弃工作区修改）」。就绪态「已在 dev 分支」、非 Git 指引、状态行、禁用与忙碌防重复逻辑不变；`/api/git/init-dev` 与 `ensureDevWorkflow` 能力保留。
- scripts/web/i18n.js：新增 6 条静态词条（含 EN 主操作「Switch to dev branch」）+ 1 条 EN_DYNAMIC 失败动态键；移除 6 条旧初始化导向词条 + 1 条旧动态键。
- scripts/tests/req-20260920-002.test.mjs：新增 TDD 测试（T1–T7，先跑红后跑绿）。
- scripts/tests/dev-flow-20260911-009.test.mjs：D12 两条旧文案断言同步新口径。
- 条目文档：test-cases.md 用例表 6 例全部通过；design.md 补方案与风险边界。

## 测试结果

- 新测试（先红后绿）：`node scripts/tests/req-20260920-002.test.mjs` — T1–T7 全部通过（首次运行 5 红确认 TDD 红灯；实现后全绿）；补 T8（ui-demo.html + README 契约）后 8 用例全部通过。
- 受影响既有测试：`node scripts/tests/dev-flow-20260911-009.test.mjs` — 全部通过。
- 全量：`npm test` — 288 个测试文件，失败 0（见 test-output.log）。

## 覆盖率口径

README 验收标准 8 条全部有测试映射（T1–T7 覆盖交互与 i18n 验收，T8 覆盖 ui-demo.html 交付验收；无提交仓库 / 状态加载失败重试为未改动行为，由既有测试覆盖），coverage 记 100。
