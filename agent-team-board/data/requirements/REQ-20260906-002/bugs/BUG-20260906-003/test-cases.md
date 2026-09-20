# 测试用例 — BUG-20260906-003 Zcode 失败待核对仍释放项目锁允许其他入口继续实施

回归用例落在 `scripts/tests/batch-core.test.mjs`（与 REQ-20260906-002 批次核心测试同文件）；
既有用例 Z24b 的「失败应收尾释放互斥」断言按本修复的新契约同步改写。

## TC-1 失败且 safeToContinue=false：保留项目实施占用，其他入口一律被拒（对应验收探针 Z-A3）

1. 隔离项目建 A、B（均 accepted）；建批；`nextItem` 预留 A（owner=batch-worker）并 `claim`。
2. `finishRun(result=failed, safeToContinue=false)` 后：
   - `impl.lock` 仍在，且带 `attention: true` 与 `attentionReason`（回归点：修复前锁被删除）；
   - 他人 `core.claim(B)` 被拒，报「项目已暂停…核对」；
   - 原锁属主本人 `core.claim(B)` 同样被拒（不得绕过失败待核对暂停）；
   - Codex `acquireProjectLock` 返回 `{ok:false}` 且 holder.attention=true；
   - B 保持 accepted 未被并行派发。
3. 人工恢复（`pauseBatch(true)` 后 `pauseBatch(false)`）：恢复前占用保持，恢复后
   `impl.lock` 解除，`nextItem` 可继续派发 B。

## TC-2 可继续场景不误伤：failed+safe=true / blocked（默认安全）/ reported 照常释放占用

1. 三个候选依次以 failed（显式 safe=true）、blocked（不带 safeToContinue）、reported 收尾。
2. 每次收尾后 `impl.lock` 均应释放（不因本修复收紧而卡死正常流转）。

## 既有用例改写

- Z24b：failed+safeToContinue=false 后由「应释放互斥」改为「应保留 attention 占用，
  人工 暂停→恢复 后解除」。

## 判定

- 上述用例全部通过 `node scripts/tests/batch-core.test.mjs`；
- 全量 `npm test` 不出现新的失败（存量失败仅 detail-close-btn.test.mjs T2，已由
  BUG-20260906-011/012/013/016/017/018 跟踪，与本修复无关）；
- Z-A3 验收探针复刻（dispatch/runs/run-20260906-008/）+ 真实 CLI 全流程复核通过。
