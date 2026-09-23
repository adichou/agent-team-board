# 测试用例 — REQ-20260923-003 md-rich mermaid 图表配色随看板深浅色外观自适应

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/req-20260923-003.test.mjs`（vm + 假 DOM + mermaid 桩，模式参照 BUG-20260923-002）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 深色套 themeVariables：沙箱注入 matchMedia matches:true，initialize 带 themeVariables 且 primaryTextColor=#d1d5db、primaryBorderColor=#a5b4fc、primaryColor=transparent，theme=dark | 高 | 红 → 绿 |
| 2 | 浅色套 themeVariables：缺省沙箱（无 matchMedia），primaryTextColor=#475569、primaryBorderColor=#818cf8、primaryColor=transparent，theme=default | 高 | 红 → 绿 |
| 3 | 两套全量对照：共有项 clusterBkg / edgeLabelBackground 均 transparent；深色 lineColor=#94a3b8、clusterBorder=#374151、titleColor=#e5e7eb，浅色 lineColor=#9ca3af、clusterBorder=#e2e8f0、titleColor=#334155 | 中 | 红 → 绿 |
| 4 | 外观判定每次渲染时读取：同一上下文翻转 matchMedia 结果后重渲染，两次 initialize 的 theme/themeVariables 随之切换 | 中 | 红 → 绿 |
| 5 | 发布文档无写死配色：根 README.md、DESIGN.md 不匹配 /%%\{init/（外部渲染走 mermaid 默认主题） | 高 | 红 → 绿 |
| 6 | 回归：BUG-20260923-002 既有用例与 npm test 全量不受影响 | 高 | 绿 |
