# 测试报告 — REQ-20260907-011 待接受需求和 Bug 可以由用户自行更改标题。已接受的需求可以驳回变为待接受

- 时间：2026-09-07T23:25:55.966Z
- 执行者：zcode-batch-010-3
- 测试框架：node:native test runner（run-all.mjs 聚合，72 文件）
- 覆盖率：未统计

## 总结

待接受改标题+驳回接受：core.renameItem（仅 submitted，status.title 与文档首行同步+history 留痕）+ TRANSITIONS 新增人工回退边 accepted→submitted；CLI atb rename；POST /api/item/:id/title 与网页流转白名单放行；UI 新增页面内 uiPrompt 输入框、卡片/详情页改标题按钮、详情页驳回接受按钮、接受可撤销。新增 rename-reject.test.mjs 12 用例全绿；联动更新 3 个既有契约测试；npm test 72 文件 0 失败；CLI 冒烟通过

## 明细

（可粘贴命令输出、失败用例说明等）
