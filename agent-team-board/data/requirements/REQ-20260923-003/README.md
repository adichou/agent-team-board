# REQ-20260923-003 md-rich mermaid 图表配色随看板深浅色外观自适应

- 状态：submitted（待人工接受）
- 创建：2026-09-23T12:49:45.205Z

## 描述

文档预览的 mermaid 渲染目前 initialize 只按外观切 theme dark/default，而发布文档内写死的 %%{init}%% 指令强制 base 主题灰字配色，在深色模式下图表偏暗难读。方案：1 md-rich.js initialize 增加 themeVariables 深浅两套适配——节点透明底（保持无底色要求）、文字与连线颜色随外观取亮/深两档、子图描边随外观切换，外观判定在每次渲染时读取；2 移除 README.md 与 DESIGN.md 内全部 %%{init}%% 写死配色指令，看板随外观自适应，GitHub 等外部渲染走 mermaid 默认主题。TDD：参照 BUG-20260923-002 的测试方式先红后绿。

## 验收标准

- [ ] （待补充）
