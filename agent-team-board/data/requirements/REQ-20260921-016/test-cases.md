# 测试用例 — REQ-20260921-016 版本计划列表中的操作按钮优化

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 用例落位：`scripts/tests/req-20260921-016.test.mjs`（T1~T8 + S1 静态契约）；
> 既有回归适配：req-20260921-013 / bug-build-ver-card-acts-20260913-004 / bug-20260920-005 /
> bug-build-ver-published-chip-20260917-001 / build-release-card-items-search-20260915-003 /
> build-ui(N9a) / bug-build-merge-click-feedback-20260920-006 / product-release-ui(H1)。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 列表精简：卡片不再渲染 AI 完善 / 合并入 main（含失败重试）/ 创建并预检 / 查看发布记录，card-acts 操作行整体移除无留白 | 高 | 通过 |
| T2 | 删除迁卡片标题行右端：.t 行内名称之后、quiet 弱化、aria-label 带版本号、长名 title 提示；merging 禁用 / 其余状态可用不回归 | 高 | 通过 |
| T3 | 详情概况描述块头部：右侧操作组「AI 完善」紧邻「编辑」左边、仅两键；bld-plan-acts 顶部操作行移除；切步骤隐藏 / 切回恢复 | 高 | 通过 |
| T4 | 编辑表单并存：表单打开两入口随描述块替换隐藏、取消恢复；编辑键 merging 禁用与 pushed 可用规则不变；AI 完善锁定口径（merging / pushed 禁用、merged 未推送可用）不回归 | 高 | 通过 |
| T5 | 切换版本不串单：两入口随选中版本换绑；AI 弹窗版本号与提示词对新版本；删除确认仍按目标卡片版本打开 | 高 | 通过 |
| T6 | 合并 / 创建并预检 / 发布记录仍在详情对应步骤（合并步主按钮、正式发布步创建并预检 + 发布记录区），列表不再重复入口 | 高 | 通过 |
| T7 | 空态：无版本 / 未选择时无悬空 AI 完善 / 编辑 / 删除 / 合并 / 发布入口，详情显示选择引导 | 中 | 通过 |
| T8 | i18n：本次仅迁移位置不新增文案，沿用词条均在词典（AI 完善 / 编辑 / 删除 / 各禁用说明） | 中 | 通过 |
| S1 | 静态契约：renderVersionList 不再产出合并 / 发布 / AI 入口与 card-acts；data-ver-release-view 按钮与绑定移除；其余 data-ver-* 绑定保留；CSS 标题行删除右端对齐 + 描述头操作组、移除 bld-plan-acts / rel-card card-acts | 高 | 通过 |
