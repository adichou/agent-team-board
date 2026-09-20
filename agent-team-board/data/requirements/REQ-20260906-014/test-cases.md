# 测试用例 — REQ-20260906-014 详细页面的操作按钮不要二次确认，提供撤销按钮

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 详情页「确认完成 / 驳回完成」点击立即 POST 流转，全程零 `window.confirm`；成功 toast 带「撤销」按钮 | P0 | ✅ 通过 |
| T2 | 撤销映射契约：done→in-progress、in-progress→done 提供撤销；accepted 无撤销（状态机唯一回退边）；映射边与 core.TRANSITIONS 逐条核验 | P0 | ✅ 通过 |
| T3 | toast 第三参操作按钮：文本用 textContent 组装、按钮点击隐藏并执行 run；无 action 时保持纯文本旧行为 | P0 | ✅ 通过 |
| T4 | 详情页「接受」走 acceptItems 且跳过确认（零 confirm、直接 POST accepted）；批量入口 confirm 不回归 | P0 | ✅ 通过 |
| T5 | 点击撤销：POST 反向状态并刷新（poll/refreshDrawer）；失败时错误 toast 不假成功 | P0 | ✅ 通过 |
| T6 | 静态契约：抽屉 `[data-act]` 绑定 drawerAction（不再 attemptTransition）；attemptTransition 保留 confirm（拖拽路径不回归） | P1 | ✅ 通过 |
| T7 | CSS：.toast 行内按钮布局与 .toast-act 样式存在 | P1 | ✅ 通过 |
| M1 | 浏览器实测：详情页三按钮即点即生效，完成/驳回后 toast 可撤销 | P1 | 待人工 |

执行：`node scripts/tests/drawer-undo.test.mjs`（先红 7/7 → 实现后绿 7/7）。
全量回归：`npm test` 40 个测试文件，39 通过；唯一失败 detail-close-btn.test.mjs T2 为存量回归
（批量实施抽屉头部 space-between，与本项目无关，已登记 BUG-20260906-013）。
