# 测试报告 — REQ-20260922-002 发布看板的文档编写页面支持 LICENSE.md

- 时间：2026-09-22T01:08:33.291Z
- 执行者：dev-2
- 测试框架：node:test（分层自研断言脚本）
- 覆盖率：15%

## 总结

A1 单文件 LICENSE.md 纳入发布文档清单：publish-flow 新增 PUBLISH_DOC_SINGLE_KEYS、LICENSE 三态（未编写/待审核/已审核）归默认语言组计数但不锁 canTranslate；不进 AI 总结/翻译（提示词与账本排除）；进 canFinalize/canCommit/完结快照/范围指纹/提交 pathspec；白名单放行 LICENSE.md 拒绝 LICENSE/LICENSE.txt/LICENSE_<lang>.md；前端文件行与审查对话框 LICENSE 页签（单栏、不分语言标签）、完结核对新增开源口径人工项；i18n 中英同步；既有 003/008/010/012 等测试断言随 4×N+1 口径更新，npm test 全量 324 文件仅剩 2 个已知预先存在失败（req-20260918-002 D1、req-doc-entry-20260916-003，与本单无关）

## 明细

（可粘贴命令输出、失败用例说明等）
