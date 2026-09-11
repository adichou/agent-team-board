# 设计 — BUG-20260908-013 Codex 批量完善运行记录混入 zcode 标识

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260908-020（经 `atb list` 核验存在：重构批量流程和任务管理）。
- 归因依据：refine 的 codex 模式与双 Agent 差异化提示词均由 REQ-20260908-020 实现
  （`scripts/lib/refine-store.mjs` 中 `buildRefinePrompt` / `createRefineBatch` 的
  REQ-20260908-020 注释为证）。该实现差异化了两套主调度提示词与批次 `agent` 字段，
  但 `nextRefineItem()` 领取落账仍沿用差异化之前的写死 `mode: 'zcode'`，共享 common
  段的领取命令 `--by zcode-refine-…` 也未按 Agent 拆分——即双 Agent 改造未覆盖
  「领取落账」与「common 段 --by 口径」两处，属同一改造遗漏。

## 根因分析

1. `nextRefineItem()`（scripts/lib/refine-store.mjs 创建 run 处）写死
   `mode: 'zcode'`，未继承批次执行 Agent。同文件 `skipRun()` 按批次口径
   `mode: batch.mode` 落账、`newCodexRefineRun()` 按 `mode: 'codex'` 落账，
   仅「领取」路径口径不一致。
2. `buildRefinePrompt()` 的领取命令行位于 zcode / codex 共享的 common 段
   （`1. 领取：atb refine next --by zcode-refine-<批次尾号>-<序号> …`），
   codex 变体经 `common.slice(6)` 原样带入，导致 codex 主调度提示词指示子会话
   以 zcode 口径 `--by` 领取，`run.owner` 随之带 zcode 标识。

## 方案

1. 领取落账继承批次执行 Agent：`nextRefineItem()` 创建 run 时
   `mode` 取 `batch.agent`（缺省回退 `batch.mode`，兼容无 `agent` 字段的旧批次
   JSON），与 `createRefineBatch` 的 `execAgent` 口径一致。zcode 批次仍
   `'zcode'`，codex 批次落 `'codex'`。
2. 提示词按 Agent 拆分 `--by` 前缀（在 common 段插值，zcode/codex 结构保持一致）：
   - zcode：`--by zcode-refine-<批次尾号>-<序号>`（保持现状不回退）；
   - codex：`--by codex-refine-<批次尾号>-<序号>`。
   codex 前缀定案依据：`newCodexRefineRun()` 既有默认 owner 即 `codex-refine`，
   沿用同一 codex 口径命名，无新造规范（README「待确认」项就此定案）。
3. 测试补断言（tasks-refine.test.mjs 新增用例，标注 BUG-20260908-013）：
   - 临时项目 `createRefineBatch({mode:'codex'})` + `nextRefineItem()` 领取后
     `getRefineRun(runId).mode === 'codex'`；`mode:'zcode'` 批次回归仍 `'zcode'`；
   - `buildRefinePrompt({agent:'codex'})` 不含 `zcode-refine`、含 `codex-refine`；
     `buildRefinePrompt({agent:'zcode'})` 仍含 `zcode-refine`、不含 `codex-refine`。

## 风险与边界

- run.mode 修正后，`scripts/server.mjs` 服务重启恢复对 codex 批次经领取产生的
  reserved run 会按既有 `r.mode !== 'codex'` 分流正确归入 codex 恢复路径
  （按失败落账）——这是本修复期望的行为修正，非新风险。
- `--by` 前缀变化只影响新会话的领取命名，`run.owner` 只作展示与冲突排查用，
  不参与锁/账本的匹配语义（锁按 `runId`/`owner` 精确释放），无存量数据迁移需求。
- `acquireRefineLock({kind:'zcode'})` 的 kind 表示「CLI 领取」路径而非执行 Agent，
  与服务端 codex 后台执行的锁来源区分，本单不改（README 未要求，改了反而扩大面）。
- 回归范围：`atb refine next/done/fail/release/records`、refine 互斥锁、
  出局账（skipRun）、`npm test` refine 相关用例。
