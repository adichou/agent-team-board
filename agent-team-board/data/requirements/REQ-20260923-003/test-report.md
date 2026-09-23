# 测试报告 — REQ-20260923-003 md-rich mermaid 图表配色随看板深浅色外观自适应

- 时间：2026-09-23T14:17:52.330Z
- 执行者：zcode-batch-067-1
- 测试框架：node:test 风格分层测试（run-all.mjs 聚合）
- 覆盖率：90%

## 总结

mermaid 配色外观自适应：md-rich.js initialize 新增 themeVariables 深浅两套（透明底+亮/深两档文字连线边框、靛蓝贴近品牌色），外观每次渲染现读；根 README/DESIGN 移除全部 5 处 %%{init}%% 写死配色，外部渲染走默认主题；新增 5 例先红后绿，全量 339 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
