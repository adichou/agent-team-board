# 测试报告 — REQ-20260910-026 全选和全不选使用图标，去掉文字，然后把操作按钮和开始完善按钮放在同一行

- 时间：2026-09-10T12:45:43.171Z
- 执行者：zcode-batch-031-32
- 测试框架：node（npm test / run-all.mjs 聚合，assert+vm 模拟 DOM）
- 覆盖率：5%

## 总结

全选/全不选图标化：去文字仅 ☑/☐，aria-label+title 语义保留，等宽 .req-caption .btn.icon-act；新增 #captionActions 同行容器（nowrap+margin-left:auto）绑定批量动作组与「开始完善/开始开发」，宽度不足整组换行兜底；行为零变化；S1 静态断言同步修正；新测试 T1-T5 全绿，全量 172 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
