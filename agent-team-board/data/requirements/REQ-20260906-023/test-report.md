# 测试报告 — REQ-20260906-023 批量实施的批次最多保留 100 个，超出的删除最旧的

- 时间：2026-09-06T17:42:07.109Z
- 执行者：zcode-batch-003-01
- 测试框架：Node.js 自研测试套件（node:assert/strict，node scripts/tests/*.test.mjs）
- 覆盖率：90%

## 总结

lib/batch.mjs 新增 BATCH_RETENTION_MAX=100 与 pruneBatches()：按 createdAt/batchId 序保留最新 100 个批次目录、删除更旧批次，在途（未收尾运行）批次跳过保护、单批删除失败不中断；createBatch 新建成功后自动触发并在返回值携带 pruned，幂等返回不触发；atb batch create 输出清理摘要、--json counts 增 pruned 字段。TDD：batch-core.test.mjs 新增 R23-01~05（删最旧/不超不删/在途保护/真实路径 100~102 批次始终≤100/幂等不触发+pruned 清单），先红后绿；插件全量 46 个测试文件 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
