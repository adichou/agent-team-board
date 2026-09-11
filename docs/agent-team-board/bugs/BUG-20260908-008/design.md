# 设计 — BUG-20260908-008 设置界面去掉项目设置这个标题

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260907-004（经 `atb list` 核验在册）。其测试报告载明交付含「任务/设置页面化」：设置从抽屉改为 `#settingsView` 页面视图（`renderSettingsView()`）时，沿用了任务模块抽屉的 `header.batch-head > .batch-title`（`<h2>项目设置</h2>` + `span.path`）头部结构，未按同一需求「第三行移除页面标题，仅保留模块副标题」口径清理视图内部大标题，形成本 Bug 的三重模块标识。

## 根因分析

`scripts/web/app.js` 的 `renderSettingsView()`（约 4153 行）输出以 `header.batch-head > .batch-title` 开头，内含 `<h2>项目设置</h2>` 与项目路径 `span.path`。REQ-20260907-004 布局口径下模块归属已由第二行「设置」页签（`data-view="settings"`）+ 第三行副标题 `MODULE_SUB.settings`（「当前项目的派发默认值」）承担，视图内大标题属口径落地遗漏的冗余标识。

## 方案

1. 移除 `renderSettingsView()` 输出中的整个 `header.batch-head`（含 `<h2>项目设置</h2>` 与 `span.path`）——按 README 期望 2 的默认建议随标题一并移除整个标题头；项目路径仍可从顶栏项目选择器悬停提示获得。视图内容自说明文案（`p.muted.small`）开始。
2. 新增契约测试 `scripts/tests/settings-title-removed.test.mjs`（沿 type-chip-removed.test.mjs 的 vm 沙箱模式）：
   - T1 动态：沙箱内执行 `renderSettingsView()`，断言 `#settingsView` 输出不含「项目设置」标题/`batch-title`，且说明文案、「批量任务」分区、「模型与推理强度」、`#stSave`/`#tsSave`/运行环境区块保留。
   - T2 静态契约：`renderSettingsView` 函数体内不再拼接 `batch-head`/`batch-title`/`<h2>项目设置</h2>`。
   - T3 范围边界：任务模块抽屉 `renderBatchDrawer` 的 `<h2>任务</h2>` 头部保持原样（README 明确不在本 Bug 范围）；「已保存项目设置（用于后续新执行）」toast 文案保留（操作反馈，非标题）。
3. 不动 `style.css`：`.batch-head/.batch-title` 仍被任务抽屉头部引用，样式规则保留。

## 风险与边界

- 设置视图顶部失去标题头后直接以说明文案开场，属预期（第二/第三行已承载模块标识）；深浅主题与多宽度下的间距由既有 `.settings-body` 布局承担，无新增样式。
- 其余模块（讨论/需求/任务/文件）与设置视图功能字段（CLI 路径、单项时限、重试、自动继续、非 Git 放行、运行环境检查、两类保存按钮、加载失败重试）不受影响。
- 回归入口：`node scripts/tests/settings-title-removed.test.mjs` + `node scripts/tests/run-all.mjs`。
