# 测试报告 — BUG-20260928-014 发布执行不应切换工作区到 main 分支

- 时间：2026-09-28T15:25:05.649Z
- 执行者：zcode-batch-088-2
- 测试框架：node:test 风格脚本（assert/strict + 真实临时 Git 夹具）
- 覆盖率：3%

## 总结

sync-source 删除 git checkout main，本地校验改为只读 ref 比对（rev-parse refs/heads/main === 冻结 mainSha，错误信息不变），清洁检查/原子推送/ls-remote 回验原样保留；plan steps[0] 文案同步为不切换分支口径。新增 bug-20260928-014.test.mjs 3 用例（成功/拦截/中途失败后工作区分支与 HEAD 均不变）先红后绿；相关 build-publish 测试与 npm test 全量（377 文件）通过。引入来源：BUG-20260916-001。

## 明细

（可粘贴命令输出、失败用例说明等）
