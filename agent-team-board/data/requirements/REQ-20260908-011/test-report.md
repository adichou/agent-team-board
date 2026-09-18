# 测试报告 — REQ-20260908-011 修改单需支持修改标题和描述。

- 时间：2026-09-08T13:28:58.185Z
- 执行者：zcode-batch-018-1
- 测试框架：Node 原生断言脚本（node:assert/strict + vm 沙箱 + 真实 HTTP/CLI 子进程）
- 覆盖率：90%

## 总结

core 新增 editItem（仅 submitted，标题+描述一次改完，先全量校验再落盘保证原子性，README 需求「## 描述」/Bug「## 现象」节整体替换，空描述写回（待补充），history 一条留痕；renameItem 保留兼容）；server 新增 POST /api/item/:id/content；CLI rename 支持 --desc（- 走 stdin，标题可省略）；前端 uiPrompt 升级双字段 uiEditForm（预填/取消/Esc/遮罩/保存中禁用/失败保留可重试），editItem 预填 README 描述节并提交 /content，无变化前端先拦截；按钮文案消歧：✎ 改标题/描述 + 修改提示词。新增 edit-content.test.mjs 19 用例全绿，同步更新 rename-reject/edit-prompt 被替换契约断言，npm test 全量 89 文件 0 失败。待确认项按 design 默认方案落地（见 design.md 实施记录）。

## 明细

（可粘贴命令输出、失败用例说明等）
