# BUG-20260908-013 Codex 批量完善运行记录混入 zcode 标识

- 状态：accepted（已接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-08T12:13:46.969Z

## 现象

REQ-20260908-020 深测发现（D05，深测报告定级 P2）。mode=codex 创建完善批次后经领取，运行记录 run 的 `mode` 落成 `zcode`；codex 提示词也使用 `--by zcode-refine`。应保持 Agent 标识一致。 复现：node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs。原始结果：同目录 deep-probes.log。

两处缺陷定位（当前源码 scripts/lib/refine-store.mjs）：

- `nextRefineItem()`：领取创建 run 时写死 `mode: 'zcode'`（约 L630），未继承批次执行 Agent（`batch.agent`，缺省回退 `batch.mode`）。对比同文件 `skipRun()` 出局账按 `mode: batch.mode` 落账、`newCodexRefineRun()` 按 `mode: 'codex'` 落账，仅「领取」路径口径不一致。
- `buildRefinePrompt()`：领取命令行 `1. 领取：atb refine next --by zcode-refine-<批次尾号>-<序号> …` 位于 zcode / codex 两套主调度提示词共享的 common 段（约 L283），codex 变体经 `common.slice(6)` 同样带入该行——即 codex 主调度提示词也指示子会话以 `--by zcode-refine-…` 领取。

影响：codex 批次的执行记录（`refine/runs/<runId>/run.json`、`atb refine records`、任务模块「执行记录」及 `/api/refine/current` 的 records 字段）显示执行 Agent 为 zcode，实际由 codex 子会话执行，违反 REQ-20260908-020「两套提示词按 Agent 差异化、分别维护且互不混用」的验收口径；`--by zcode-refine` 还使 `run.owner` 一并带上 zcode 标识，事后核对（refine check 的「当前执行 owner」提示）与认领冲突排查无法区分真实执行 Agent。另 scripts/server.mjs 服务重启恢复按 `r.mode !== 'codex'` 区分处理（约 L983-984），mode 误标会影响重启恢复分类的准确性。

## 复现步骤

方式一：深测夹具（D05 用例，临时项目，不动真实数据）

1. 运行 `node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs`；
2. 查看 D05「codex 领取执行记录应保留 codex Agent」结果：FAIL，`actual: 'zcode'`、`expected: 'codex'`（原始证据 evidence/deep-probes.log）；
3. 用例内部流程：临时项目创建已接受条目 → `createRefineBatch(d, {mode:'codex'})` → `nextRefineItem(d, batchId, {owner:'codex-test'})` 领取成功 → `getRefineRun(d, runId).mode` 读得 `'zcode'`（期望 `'codex'`）。

方式二：提示词检查（无需创建批次）

1. 在仓库根执行：
   `node -e "import('./scripts/lib/refine-store.mjs').then(m=>console.log(m.buildRefinePrompt({projectRoot:'/tmp/x',batchId:'RFB-20260908-009',agent:'codex'})))"`
2. 输出首部为「执行 Agent：codex……」，但「子 Agent 流程」第 1 步仍为 `atb refine next --by zcode-refine-<批次尾号>-<序号> …`——codex 提示词携带 zcode 执行者标识（2026-09-08 当前源码实测复现）。

## 期望行为

- 领取落账继承批次执行 Agent：`nextRefineItem()` 创建的 run，zcode 批次 `run.mode === 'zcode'`、codex 批次 `run.mode === 'codex'`，与 `skipRun()` / `newCodexRefineRun()` 既有口径一致。
- 提示词按 Agent 区分执行者标识：`buildRefinePrompt(agent:'codex')` 输出的领取命令 `--by` 使用 codex 口径的会话标识，不得出现 `zcode-refine` 字样；`buildRefinePrompt(agent:'zcode')` 保持现有 zcode 口径不回退。（codex 侧 `--by` 的具体前缀命名属修复方案，在 design.md 定案；当前无既有规范可引，待确认。）
- Agent 标识全链路一致：批次（batch.mode / batch.agent）、领取运行（run.mode）、主调度提示词 `--by` 口径、执行记录展示四处归属同一 Agent，满足 REQ-20260908-020 双 Agent 差异化、互不混用的要求。

## 验收说明

- 深测夹具复跑：`node docs/agent-team-board/requirements/REQ-20260908-020/evidence/deep-probes.mjs` 中 D05 转 PASS（REQ-20260908-020 深测报告要求 12 例全过为最低复测条件；其余 6 例失败对应 BUG-20260908-010/011/012/014/015，不属本单范围）。
- 代码级断言：临时项目内 `createRefineBatch({mode:'codex'})` + `nextRefineItem()` 领取后 `getRefineRun(runId).mode === 'codex'`；`mode:'zcode'` 批次回归仍为 `'zcode'`；建议在 scripts/tests 补对应断言（现有 tasks-refine.test.mjs T8 只断言两套提示词「有差异」且都含 `atb refine next`，未覆盖 `--by` 前缀与 run.mode 继承，故此前未拦截本缺陷）。
- 提示词断言：`buildRefinePrompt({agent:'codex'})` 输出不含 `zcode-refine`；`buildRefinePrompt({agent:'zcode'})` 仍含 `zcode-refine` 口径。
- 回归：`atb refine next/done/fail/records`、refine 互斥锁、回执协议（≤2KiB）等既有机制不受影响；`npm test`（scripts/tests/run-all.mjs）refine 相关用例全部通过。
