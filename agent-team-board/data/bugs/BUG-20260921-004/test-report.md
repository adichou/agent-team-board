# 测试报告 — BUG-20260921-004 版本计划中的文档预览界面，说明应该改成 README.md

- 时间：2026-09-21T01:34:09.832Z
- 执行者：zcode-batch-059-02
- 测试框架：node:assert/strict
- 覆盖率：4%

## 总结

类型下拉改显示完整文件名（README.md/CHANGELOG.md/FEATURES.md/AGENTS.md，value 保持裸键）并声明 data-i18n-skip 豁免翻译；根因为 i18n 反向词典由抽屉词条 说明:README 生成的逆映射误译 option 裸键，词条本身保留；引入来源 REQ-20260920-003；新增 bug-20260921-004.test.mjs 4 例（词典/渲染/豁免/词条回归），npm test 298 文件全过

## 明细

（可粘贴命令输出、失败用例说明等）
