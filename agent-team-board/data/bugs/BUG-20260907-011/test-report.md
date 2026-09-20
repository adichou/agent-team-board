# 测试报告 — BUG-20260907-011 文件横幅目录列表会话级缓存：模块切换不重新拉取，外部新增文件不可见

- 时间：2026-09-07T16:43:38.117Z
- 执行者：zcode-batch-009-1
- 测试框架：Node 内置测试 + 契约/VM 沙箱 harness（scripts/tests/file-board.test.mjs，含真实 server 集成）
- 覆盖率：75%

## 总结

新增 refreshBannerLayers：模块切回文件视图时对当前层栈快照逐层后台重拉 /api/fs 更新 entriesByPath 后重建条带；单飞防并发、单层失败保留旧缓存；initFileBoard 幂等直返退役；S1-S3 先红后绿，全量 69 个测试文件 0 失败；引入来源 REQ-20260906-007 已核验并写入 README 关联节

## 明细

（可粘贴命令输出、失败用例说明等）
