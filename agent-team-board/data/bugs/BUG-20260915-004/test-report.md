# 测试报告 — BUG-20260915-004 挂起确认面板错误提示透传截断的原始 git 报错，缺少可读原因与处理指引

- 时间：2026-09-15T03:38:49.459Z
- 执行者：zcode-batch-048-035
- 测试框架：node:assert（自研 runner）
- 覆盖率：9%

## 总结

采集侧保头保尾不再拦腰截断（confirm-states clipReasonKeepEnds + confirm-store/batch 上限 200）；展示侧三处统一「琥珀归类结论条+折叠完整原始输出」：classifySuspendReason 覆盖 index.lock 瞬时冲突可重试与未知兜底，i18n 双语；新增 9 例 TDD 用例，npm test 243 文件全绿

## 明细

（可粘贴命令输出、失败用例说明等）
