# 测试报告 — REQ-20260921-013 AI 完善按钮移动到版本详细内容的版本计划页签内。版本计划页签改名为概况

- 时间：2026-09-21T13:10:48.713Z
- 执行者：REQ-20260921-013
- 测试框架：node:assert + vm 加载真实 build.js + 假 DOM（仓库自研测试骨架）
- 覆盖率：9%

## 总结

AI 完善入口从版本卡片迁入详情概况页签：STEP_LABEL.plan 改名概况（plan 标识/五步顺序/快照恢复/后端 PUBLISH_STEPS 键全兼容，外层版本计划导航不动）；卡片移除 answerBtn 其余四键原位；概况顶部 bld-plan-acts 操作行右对齐唯一按钮绑定选中版本，锁定口径原样迁移（merging/已正式发布禁用带原因，merged 未推送可用），openAnswerModal 与绑定循环零改动切版本不串单；AI 弹窗与就地编辑草稿独立共存不静默覆盖（syncPlanEditDraft 保障）；CSS .bld-plan-acts 窄屏换行；i18n 补两条 title 词条（概况=Overview 已有）。新增 req-20260921-013.test.mjs 9 例先红后绿；适配 4 个既有测试断言位置（口径不变）；npm test 315 文件仅 2 预存失败（工作区在途 README/AGENTS 发布文档重写所致，与本单文件零交集，HEAD 已验证通过）

## 明细

覆盖口径说明：上「覆盖率」字段记录的是新增测试用例数（9 例，非百分比）——本仓库前端测试
为 vm 加载真实 build.js + 假 DOM 行为断言，无行覆盖率工具。

新增 `scripts/tests/req-20260921-013.test.mjs`（TDD：实现前 7 例跑红，实现后 9/9 通过）：

```
✓ T1 页签改名：首个页签显示「概况」，其余四步名称与顺序不变、data-step="plan" 标识保留；外层模块导航「版本计划 / 分支浏览」不受影响
✓ T2 卡片迁移：版本卡片不再渲染 AI 完善按钮；其余四键原位保留
✓ T3 概况入口：概况内容区顶部操作行有唯一「AI 完善」按钮绑定当前版本；切至其余四步入口隐藏
✓ T4 切换版本不串单：详情按钮随选中版本换绑；弹窗标题与提示词对当前版本
✓ T5 锁定规则沿用：merging 禁用「合并中，请稍候……」；已正式发布禁用并说明；已合并未推送可用
✓ T6 直调守卫不回归：merging / pushed 直调与无参回落均不弹窗；merged / draft / failed 可打开
✓ T7 手动编辑共存：编辑表单草稿不被 AI 完善弹窗静默覆盖，关闭弹窗后草稿仍在
✓ T8 空态：无版本时详情显示选择引导且无 AI 完善入口（refresh 后选中回落为空，未确定版本无写入按钮）
✓ T9 i18n：「概况」EN=Overview；按钮 title 两词条补登记；外层「版本计划」词条保留
```

适配的既有回归测试（断言位置随入口迁移改写，锁定口径不变，均通过）：
`bug-build-ver-card-acts-20260913-004.test.mjs`（B1/B2/B4，8/8）、
`bug-20260920-005.test.mjs`（U1，7/7）、`build-ui.test.mjs`（N9a，17/17）、
`build-release-card-items-search-20260915-003.test.mjs`（R1，11/11）。

全量回归 `npm test`（run-all.mjs）：315 个测试文件，失败 2——`req-20260918-002.test.mjs`（D1）、
`req-doc-entry-20260916-003.test.mjs`（A1/A2/A3/B1a/B2a/B4）。二者断言仓库 README/AGENTS 的
既有文档结构，失败由工作区在途的发布文档重写（BLD-20260920-001 待发布 README + 未跟踪
CHANGELOG.md / FEATURES.md）导致；本单改动文件（build.js / style.css / i18n.js / 4 个测试文件）
与其零交集，且已在 HEAD 干净 worktree 上验证两文件全部通过，属预存失败、与本单无关
（与上一条目 BUG-20260921-011 测试报告记录的同一现象一致）。

