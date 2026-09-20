# 测试报告 — BUG-20260908-022 修改提示词功能去掉

- 时间：2026-09-08T17:47:36.880Z
- 执行者：zcode-batch-018-1
- 测试框架：node:assert/strict + run-all（静态契约 + vm 沙箱）
- 覆盖率：100%

## 总结

「修改提示词」功能整体下线：app.js 删除 editBtnHtml/bindEditButtons/editableStatus/itemDirRel/fetchItemEditPrompt/copyEditPrompt 及卡片与抽屉两处调用，抽屉占位回退简化为 drawerActionsButtonHtml(it)||'—'；style.css 删 .card-edit-btn；core.mjs renameItem/editItem 报错文案改为「直接编辑条目目录 markdown 或另立新单」；删 edit-prompt.test.mjs，edit-content.test.mjs U4/U5 改写为下线契约并新增 C12（TDD 先红后绿）。引入来源 REQ-20260906-011（经 atb list 核验）已写入 README 头部与 design.md。npm test 99 文件 0 失败；验收 grep 功能代码零残留；copyPlain/详情接口/改标题描述均保留。

## 明细

（可粘贴命令输出、失败用例说明等）
