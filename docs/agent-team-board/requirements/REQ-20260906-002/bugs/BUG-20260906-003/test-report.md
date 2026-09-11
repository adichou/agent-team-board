# 测试报告 — BUG-20260906-003 Zcode 失败待核对仍释放项目锁允许其他入口继续实施

- 时间：2026-09-06T15:36:50.062Z
- 执行者：zcode-batch-002-2
- 测试框架：node:test 风格自研聚合（node:assert/strict，scripts/tests/run-all.mjs）
- 覆盖率：未统计

## 总结

修复失败待核对仍释放项目锁：引入来源 REQ-20260906-002（finishRun 对 failed+safeToContinue=false 也无条件 releaseImplLockIf，经 atb list 核验存在）。scripts/lib/batch.mjs：finishRun 在 failed 且不可继续时不再释放 .locks/impl.lock，改为 holdImplAttention 标记 attention/attentionReason（项目暂停），acquireImplLock 前置 assertNoImplAttention 拦截其他批次开工；pauseBatch 恢复领取（暂停→恢复）时解除本批 attention 占用；checkBatch needs_attention notice 附恢复指引。scripts/lib/core.mjs：assertNoImplConflict 先检 attention（原锁属主本人也不放行），新增导出 assertNoImplAttention 供批次层共用。回归 TC-1/TC-2 先红后绿（batch-core.test.mjs 新增 BUG-20260906-003 小节），Z24b 旧断言按新契约同步改写；Z-A3 验收探针复刻 + 真实 CLI 全流程复核通过（dispatch/runs/run-20260906-008/）；全量 npm test 43 文件仅 detail-close-btn.test.mjs T2 存量失败（已由 BUG-20260906-011/012/013/016/017/018 跟踪，与本修复无关）。

## 明细

（可粘贴命令输出、失败用例说明等）
