# 测试报告 — REQ-20260914-007 人工确认完成和版本合并成功后自动提交管理文件，失败时明确提示并支持重试

- 时间：2026-09-15T02:23:51.997Z
- 执行者：zcode-batch-048-032
- 测试框架：node:assert/strict
- 覆盖率：60%

## 总结

确认完成与版本合并两个人工闭环入口自动提交管理记录：新增 lib/mgt-commit.mjs（路径限定提交、暂存不可分离待人工、临时工作树提交 version.json 到 main、commits/mgt 账本持久化失败态、mgt-git-write.lock 串行、noop 幂等）；server 接入 status/merge/state 与 /api/mgt-commit/retry；CLI atb status done 返回 mgtCommit 并新增 atb mgt retry；前端两入口渲染管理记录提交反馈块（提交中/短 SHA/已同步/失败原因+文件+建议+重试）；i18n 词典同步。新增 10 用例全过，全量 241 文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
