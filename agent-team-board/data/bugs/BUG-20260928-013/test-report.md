# 测试报告 — BUG-20260928-013 发布流程删除官网 content/ 双语成对内容文件的强制检查

- 时间：2026-09-28T15:12:02.836Z
- 执行者：zcode-batch-088-1
- 测试框架：node:assert/strict 自定义用例
- 覆盖率：13%

## 总结

删除发布流程对官网 content/<产品id>/ 双语成对内容文件的强制检查：siteMaterials 不再检查/指纹 changelog、faq、support、docs（apps.js 注册保留），verifySite 删除 changelog/docs 内联检查（docs 路由移除，faq/support/changelog 路由保留）；测试改写/新增 5 用例（P3/P4/N1/P7/V1），vite 13 用例与 001 5 用例全绿，npm test 376 文件失败 0；归因 REQ-20260916-004（已核验）

## 明细

（可粘贴命令输出、失败用例说明等）
