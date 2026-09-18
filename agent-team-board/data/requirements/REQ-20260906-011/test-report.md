# 测试报告 — REQ-20260906-011 待接收和已接收的需求和 bug 要提供修改按钮，将用户要修改的内容整理成提示词复制到剪贴板

- 时间：2026-09-07T06:14:22.022Z
- 执行者：zcode-batch-005-1
- 测试框架：node:assert + node:vm 行为测试
- 覆盖率：未统计

## 总结

待接受/已接受的需求与Bug在卡片与详情抽屉提供「修改」按钮：点击拉取条目详情与全部现状文档，组装修改提示词（单号/标题/类型/状态/目录/约束/修改要求占位/四反引号围栏文档全文）复制到剪贴板；不冒泡、防重入、失败可重试；新增 scripts/tests/edit-prompt.test.mjs 6用例先红后绿，全量58测试文件0失败；顺手修复 copyPlain 降级临时节点泄漏

## 明细

新增自动化测试 `scripts/tests/edit-prompt.test.mjs`（先红后绿）：

```text
✓ C1 待接受/已接受有按钮，其他状态没有（卡片与详情一致）
✓ C2 卡片点击复制完整提示词且不冒泡打开详情
✓ C3 详情抽屉按钮同样复制；Bug 只带存在的文档
✓ C4 文档含三反引号时用四反引号围栏，内容完整
✓ C5 拉取与反馈期间防重入，反馈后恢复可再复制
✓ C6 拉取失败 / 剪贴板失败：报错并恢复可重试
```

全量回归（node scripts/tests/run-all.mjs）：共 58 个测试文件，失败 0。

改动面：`scripts/web/app.js`（新增「修改按钮」小节：editableStatus / editBtnHtml / bindEditButtons /
itemDirRel / fetchItemEditPrompt / copyEditPrompt；cardEl 头部与 renderDrawer 操作区接线；
copyPlain execCommand 抛错时临时文本域改 try/finally 清理）、`scripts/web/style.css`（`.card-edit-btn`
与单号复制按钮同规格 + 成功态）。后端复用 `GET /api/item/:id` 与 `GET /api/item/:id/doc/:name`，未改动。

真实浏览器（明暗主题、窄窗口、键盘焦点）未实测，待人工复核。
