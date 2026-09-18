# 测试用例 — REQ-20260908-021 完善需求时的 UI 设计要使用 html 进行可交互设计展示

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S5a（回归） | UI 需求 README 无「界面展示」节 → 仍报「涉及 UI 需界面展示」（UI_KEYWORDS 词表逐词），无节时不报占位/演示原因 | P1 | ✅ |
| S6a | UI 需求「界面展示」节有实质内容但条目目录缺 ui-demo.html → 报「涉及 UI 缺 ui-demo.html 演示」 | P0 | ✅ |
| S6b | ui-demo.html 存在但为空/仅 HTML 注释占位 → 报「ui-demo.html 演示待补充」 | P0 | ✅ |
| S6c | README「界面展示」节正文未出现 ui-demo.html 链接 → 报「界面展示节未链接 ./ui-demo.html」 | P0 | ✅ |
| S6d | 节 + html + 链接齐备（ASCII 线框降为可选补充）→ complete，不再报界面展示相关原因 | P0 | ✅ |
| S6e（回归） | 节存在但空/「（待补充）」占位 → 仍报「界面展示待补充」，不叠加演示原因 | P1 | ✅ |
| S6f（回归） | 「本需求不涉及界面改动」误判兜底保留：节内声明非 UI 即视为有效内容，不做 html 三查 | P1 | ✅ |
| S6g（回归） | 非 UI 纯流程需求 / Bug：不引入任何 ui-demo.html 相关判定 | P1 | ✅ |
| S9a | docsFingerprint 纳入 ui-demo.html：只改演示文件（三份 markdown 不动）指纹即变化；缺失→存在的增删同样变化 | P0 | ✅ |
| S9b | worker 只新增/修改 ui-demo.html（markdown 不动）的 done 回执能通过「真实变更」核验记账 | P0 | ✅ |
| P1a | buildRefinePrompt / buildRefineWorkerPrompt 含 ui-demo.html 口径与质量门槛（单文件、内联 CSS/JS、无外网依赖、无构建步骤、浏览器直接打开可交互、覆盖布局/交互/状态反馈三要素），旧「ASCII 线框 / 结构示意」必需口径不再出现 | P0 | ✅ |
| P1b | 两处提示词约束文案允许「涉及 UI 可另建约定的 ui-demo.html」，其余禁令（业务源码 / status.json / claim/report / test-report.md / git commit / 保持 accepted / 待确认）逐项保留 | P0 | ✅ |
| CLI | `atb refine next` 下一步行与 REFINE_USAGE 用法文案同步新口径（含 ui-demo.html）；refine-serve 候选原因走新判定 | P1 | ✅ |
| S10（回归） | 存量兼容：已完善（refined）不回溯候选；已冻结批次原因快照不重算；在途领取/回执/指纹核验行为不变 | P1 | ✅ |
