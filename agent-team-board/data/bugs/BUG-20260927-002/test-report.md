# 测试报告 — BUG-20260927-002 文档与翻译界面的二次边界对话框，底部的关闭按钮无法关闭窗口

- 时间：2026-09-27T15:37:01.128Z
- 执行者：zcode-batch-082-worker1
- 测试框架：node:assert/strict + node:vm
- 覆盖率：8%

## 总结

底部「关闭」无响应根因：bindCommon 用 q('[data-edit-close]') 单绑定，querySelector 只命中 DOM 顺序第一个（头部 ✕），底部按钮从未挂监听；引入来源 REQ-20260924-006 经 atb list 核验。修复为与 data-review-close 同口径的 view.querySelectorAll 循环绑定，底部复用同一 requestEditClose（busy 禁用 / 未保存挂起保护 / 只摘弹窗元素口径不变），不改渲染结构与文案、无 i18n 改动。新增 bug-20260927-002.test.mjs 4 例先红后绿（含真实绑定源码 + 假 view 行为验证），npm test 365 文件 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
