# 测试用例 — REQ-20260907-002 批量实施批次关联开发人员：调度会话命名与看板展示

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | core：createBatch 带 developer → 账本记录 developer 字段，提示词含「请将当前会话名改为：<batchId>-<开发人员>。」一行 | P0 | 通过（batch-core） |
| D2 | core：不填 developer → 账本 developer=null，提示词与现状逐字一致（不含会话名指令），不回归 | P0 | 通过（batch-core） |
| D3 | core：developer 超 30 字符 / 含换行被 AtbError 拒；首尾空白被裁剪后入账本 | P0 | 通过（batch-core） |
| D4 | core：batchSummary 携带 developer；手工删掉账本 developer 字段（模拟存量批次）摘要仍正常返回（展示层回退未指定） | P1 | 通过（batch-core） |
| D5 | CLI：`batch create --dev 张三` 端到端 → 提示词含命名指令、summary 显示开发人员；不填时 create/summary/check/next 正常且显示「未指定」 | P0 | 通过（batch-cli） |
| D6 | serve：create 接受 developer 并在响应回显；current 的 batch/queue 带 developer；developer 超 30 字符 → 400；无批次时 stats.gitUser 可获取（非 git 项目为 null 亦可） | P1 | 通过（batch-serve） |
| D7 | UI 静态契约：创建区有 #batchDev 输入（maxlength 30、localStorage `atb.batch.dev` 记忆与 gitUser 预填）；运行面板显示开发人员并回退「未指定」；排队批次行展示开发人员 | P1 | 通过（batch-ui） |
