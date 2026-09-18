# 设计 — BUG-20260909-011 配置界面中的运行参数配置删除

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260906-003（已 `atb list` 核验存在，状态 in-progress）——配置表单引入 CLI 路径、单项时限、网络重试、重启后自动继续四项运行参数（其 README「项目级面板」节逐项列出）。
- 引入来源：BUG-20260906-010（已 `atb list` 核验存在，状态 in-progress）——项目设置新增 `allowNonGit`（默认 false）并在运行配置中显示「允许非 Git 项目执行」开关（其 README「方案」节明确记载该开关为项目设置 API 字段与界面展示）。登记时写「未定位」，本次修复阶段经排查 `docs/` 全文检索定位（仅该条目记载此开关的引入），未用 git 历史佐证（项目非 git 仓库）。
- 本单为 BUG-20260909-002（已核验存在）遗留「运行参数是否也需移除待确认」项的后续精简要求，两单口径衔接不冲突。

## 根因分析

不是功能性缺陷，而是界面精简边界问题：BUG-20260909-002 删除设置页「模型与推理强度」配置与「运行环境」检查时，明确保留运行参数分区并登记「是否也需移除待确认」；用户随后确认运行参数配置也需删除，故 `scripts/web/app.js` `paintSettingsView`（原约 4691-4721 行）仍渲染的 `<h4>运行参数</h4>` 分区（`#stCliPath`、`#stTimeout`、`#stRetries`、`#stResumeRestart`、`#stAllowNonGit` 五控件、`#stSave` 保存按钮与密钥说明）成为待删除的残留配置入口。服务端无对应缺陷。

## 方案

仅删除配置界面分区，不动服务端与派发消费逻辑（README 期望行为 3/4 与「范围与待确认」口径）：

1. `scripts/web/app.js` `paintSettingsView`：移除「运行参数」`<section class="cx-config">` 整块及只为该块服务的 `cfg` / `dis` 局部变量；设置页仅保留「批量任务」分区（其加载两阶段渲染由 `taskSettingsAreaHtml` 自理，不受影响）。
2. `scripts/web/app.js` `bindSettingsView`：移除 `#stSave` 点击处理（POST `/api/dispatch/settings` 携带五参数的保存逻辑与「已保存项目设置（用于后续新执行）」toast）。
3. `scripts/web/index.html`：更新设置模块注释（仅注释，无结构改动）。
4. 保持不动（待确认项，不在本单范围）：
   - `renderSettingsView` 仍 GET `/api/dispatch/settings` 预取 `state.codex.settings`（任务模块消费），读取失败仍整页「设置加载失败」+ `#stRetry` 重试；
   - 服务端 `GET/POST /api/dispatch/settings`（`scripts/server.mjs` 633/637 行）与落盘字段保留；
   - 派发消费点照常：`scripts/lib/scheduler.mjs` 读取 `settings().cliPath` / `settings().allowNonGit` / `cfg.resumeAfterRestart`，`scripts/lib/codex-adapter.mjs` 以 `allowNonGit` 追加 `--skip-git-repo-check`。既有落盘配置不清空、运行行为不变。

### 实施记录

- 新增契约测试 `scripts/tests/settings-runparams-removed-20260909-011.test.mjs`（TDD 先跑红：T1-T4 对现状失败，T5 为服务端不动边界契约；实现后全绿）。
- 按新口径更新锁定旧行为的测试：`scripts/tests/settings-simplify-20260909-002.test.mjs`（T1 翻转为分区已删除、T3 改为不再 POST）、`scripts/tests/settings-title-removed.test.mjs`（T1 翻转六控件断言、T3 改为 toast 随入口删除）、`scripts/tests/task-settings-simplify-20260909-001.test.mjs`（T5 加载态断言改为不渲染）。
- 全量回归 `npm test`：120 个测试文件全部通过（首轮 body-limit 偶发失败，复跑两次均通过，与本单无关）。

## 风险与边界

- 运行参数自此无 UI 编辑入口：取值来源（继续读既有落盘配置 vs 回落默认值）本单维持「继续读既有落盘配置」，与 README 期望行为 3 的待确认口径一致；如后续确认回落默认值或删除服务端字段，需另行登记条目处理。
- 已通过 API 保存过 `allowNonGit=true` 等值的项目：界面删除后取值仍生效（服务端消费未动），符合「不因删除界面清空既有落盘配置或改写运行中任务」的验收要求。
- `renderSettingsView` 的设置读取失败仍会使设置页整页报错（含重试）：这是既有行为，README 界面展示节已注明「该接口调用是否随分区删除调整，待确认」，本单不擅自调整。
