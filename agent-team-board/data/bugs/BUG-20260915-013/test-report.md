# 测试报告 — BUG-20260915-013 REL Git 发布 local-precheck 误判看板目录内已跟踪文件为脏（porcelain 首行前导空格被 trim 吃掉）

- 时间：2026-09-15T16:58:47.788Z
- 执行者：zcode-batch-worker-01
- 测试框架：node:assert 真实 Git 集成测试（用例通过率，非代码行覆盖率）
- 覆盖率：100%

## 总结

引入来源 REQ-20260910-029（已 show 核验）；gitCmd 增加 raw 选项，local-precheck 保留 porcelain 首行状态列。TDD 旧实现 4 个回归失败，修复后 REL 20/20、产品发布 Git 7/7 通过；覆盖空输出、单条/多条看板修改、普通/混合/暂存/未跟踪修改、merge/rebase 阻塞，并核对完整 files、HEAD、暂存区、文件内容及远端不变；git diff --check 与语法检查通过。日志见 dispatch/runs/run-20260916-265/{red,green,product-green}.log。100% 表示执行用例通过率，未测量代码行覆盖率。

## 明细

（可粘贴命令输出、失败用例说明等）
