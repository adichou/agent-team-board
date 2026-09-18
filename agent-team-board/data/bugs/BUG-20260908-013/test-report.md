# 测试报告 — BUG-20260908-013 Codex 批量完善运行记录混入 zcode 标识

- 时间：2026-09-08T15:30:31.933Z
- 执行者：zcode-batch-018-14
- 测试框架：node:assert 脚本测试（run-all 全量回归 + 深测夹具）
- 覆盖率：100%

## 总结

nextRefineItem 领取落账 mode 改继承 batch.agent（回退 batch.mode），codex 批次不再误标 zcode；buildRefinePrompt 领取命令 --by 前缀按 Agent 拆分（zcode-refine / codex-refine）。新增 T11/T12 用例先红后绿；深测 D05 转 PASS；全量 95 文件 0 失败。

## 明细

- 修复前（红）：新增 T11/T12 单测在旧实现上失败——T11 `codex 批次领取落账应为 codex`
  （实际 `'zcode'`）、T12 `codex 提示词不得出现 zcode-refine 执行者标识`；深测 D05 FAIL
  （`actual: 'zcode'`、`expected: 'codex'`，原始证据见 README 复现步骤与
  `docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.log`）。
- 修复后（绿）：
  - `node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs`：D05 **PASS**
    （TOTAL 12 / PASS 10 / FAIL 2；D06、D12 分属 BUG-20260908-014/015，不在本单范围）。
  - `node scripts/tests/tasks-refine.test.mjs`：12 个用例全部通过——新增
    T11（codex 批次 `createRefineBatch({mode:'codex'})` + `nextRefineItem()` 领取后
    `getRefineRun(runId).mode === 'codex'`；独立临时项目 zcode 批次回归仍 `'zcode'`）、
    T12（`buildRefinePrompt({agent:'codex'})` 不含 `zcode-refine`、含
    `codex-refine-<批次尾号>-<序号>`；`agent:'zcode'` 仍含 `zcode-refine` 口径、不含 `codex-refine`）。
  - README 复现方式二复核：`buildRefinePrompt({agent:'codex'})` 输出「子 Agent 流程」第 1 步为
    `atb refine next --by codex-refine-<批次尾号>-<序号> …`，全串无 `zcode-refine` 字样。
  - `node scripts/tests/run-all.mjs`：**95 个测试文件，失败 0**（含 refine-cli / refine-store /
    refine-serve / refine-reaccept / refine-claim-baseline / tasks-refine 等全部 refine 用例）。
- 改动面：`scripts/lib/refine-store.mjs` 两处——`nextRefineItem()` 创建 run 的
  `mode: batch.agent || batch.mode`（与 skipRun/newCodexRefineRun 口径对齐，兼容无 agent
  字段旧批次 JSON）、`buildRefinePrompt()` common 段 `--by` 前缀按 agent 插值
  （codex 口径 `codex-refine` 与 newCodexRefineRun 默认 owner 一致）；互斥锁、
  done/fail/release 回执、出局账、records 展示均未改动。
- 归因：引入来源 REQ-20260908-020（双 Agent 差异化实现时领取落账与 common 段 --by
  未同步差异化），详见 design.md。
