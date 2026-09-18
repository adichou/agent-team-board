# 设计 — REQ-20260907-003 需求完善：待接受需求与 Bug 批量补全文档，支持 Zcode / Codex 派发

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

实施批次（batch.mjs）与 Codex 自动派发（scheduler）都只处理 accepted 条目；submitted 条目常因
README 缺失 / 验收标准「（待补充）」/ design 空模板 / test-cases 无用例而无法直接接受，需要人工逐条补文档。
本需求把「补文档」也做成可派发的批量任务，但性质是**文档完善**而非实施：全程不动条目状态机。

## 方案

### 总体形态（对齐 Oncall 模式，REQ-20260907-001）

独立账本 `<dataDir>/refine/`（与实施账本 dispatch/、咨询账本 oncall/ 完全隔离，**不占 impl.lock**，
可与 Zcode 批次/Codex 实施并行；完善只编辑条目 markdown，不碰业务源码）：

```
refine/
├── settings.json                     计数器（batch/run 独立序列，.locks/refine-id.lock 互斥）
├── batches/RFB-YYYYMMDD-NNN/batch.json   冻结候选：[{id,type,title,reasons,baseline}] + prompt + 状态
└── runs/<runId>/run.json             执行账本（zcode/codex 共用；codex 另有 events.jsonl/stderr.log/prompt.md/final-message.md）
```

### 模块划分

- `scripts/lib/refine-store.mjs`（新增）：完整性分析、候选、批次/运行账本、提示词、核对协议。
- `atb refine …`（atb.mjs 新增子命令树）：create / next / done / fail / release / check / summary / pause / records。
- `server.mjs`：`/api/refine/*`（candidates / create / current / pause）+ Codex 逐项后台执行器
  （镜像 oncall runner：每项目并发 1 的串行队列，复用 codex-adapter.startCodexExec 与失败分类）。
- UI（web/）：待接受选择工具条新增「需求完善」入口（`#refineGo`，复用 `data-select-id` 多选）；
  任务模块新增第三个子面板 tab `data-bmode="refine"`（复用批量实施面板交互与样式）。

### 完整性分析（analyzeItemDocs）

- 需求：README 缺失 / 含「（待补充）」/ 正文过简（<30 字）/ design 缺失或空模板 / test-cases 无用例行。
- Bug：README 缺失 / 缺「现象」「复现（兼容重现）」「期望」「验收」任一节。
- 输出 `reasons[]`；空即完整，不入候选。候选 = submitted ∩ 不完整，req 优先 → 创建早 → 编号。

### 冻结与保护

- 创建时快照每项 `baseline`（README/design/test-cases 内容 sha1 指纹）+ 缺失原因；
- 未结束完善批次已冻结的条目不再进入新批（并发重复派发保护）；队尾候选一致 → 幂等返回；
- `refine.lock`（Infinity，无超时接管）：next 预留 → 回执收尾全程持有，同一时间至多一个完善执行；
- 领取校验：非 submitted → 记 `skipped`（状态变化出局）；指纹≠基线 → 记 `skipped`（人工编辑出局）；
- 完成校验（zcode `refine done` 与 codex 结算共用）：条目仍 submitted 且指纹≠基线（确有变更），
  否则拒绝；失败回执 reason ≤200 字。

### 状态与计数

- 批次：prepared / running / paused / finished（沿用批量实施文案）。
- 运行：reserved → done | failed | skipped | interrupted；done/failed/skipped 记入已处理，remaining = 候选 − 已处理。
- `check`（主调度最小核对，≤2KiB）：current / counts{total,done,failed,skipped,remaining} / nextAction(continue|stop) / notice。

### 提示词契约

- zcode 主调度（buildRefinePrompt）：逐轮派一个子 Agent；子 Agent 流程 =
  `atb refine next --by zcode-refine-<批次尾号>-<序号>` → 直接编辑条目 markdown（未知事实写「待确认」）→
  `atb refine done <runId> --summary "<要点>"`；主会话 `atb refine check` 收短回执。
- codex 单项（buildRefineWorkerPrompt）：条目、目录、缺失原因、同样的只改文档约束；最终回复作为摘要。
- 两类提示词都显式禁止：claim/report、写 test-report.md、改业务源码、git commit、改动条目状态。

## 风险与边界

- 完整性判定是启发式（保守多报不漏报的关键缺失），「说明过简」阈值 30 字为经验值；已完整条目不强制入批。
- 指纹只能证明「内容变了」，不能证明「补对了」；完成仅表示文档有变更，接受与否仍由人工判断（不冒充开发完成）。
- refine.lock 无超时接管：worker 异常退出后需 `atb refine release <runId>` 或暂停后由人工核对释放，
  与实施互斥锁的「异常走人工核对」口径一致。
- Codex 模式不做模型配置快照/续跑（与实施调度器不同）：失败即记 failed 展示原因，人工重新创建批次即可，账本更简单。

## 实施记录

- 2026-09-07（zcode-batch-007-1）：按上述方案实施，TDD 全绿（npm test 64 个测试文件 0 失败）。
  - 新增 `scripts/lib/refine-store.mjs`：完整性分析（analyzeItemDocs）、候选（refineCandidates）、
    文档指纹（docsFingerprint）、批次/运行账本（RFB-/run- 独立序列，`refine/` 目录与 .gitignore）、
    冻结与幂等（createRefineBatch）、领取互斥与出局落账（nextRefineItem/skipRun）、
    回执校验（finishRefineRun/releaseRefineRun）、check/summary/records 协议、
    zcode 主调度与 codex 单项提示词（buildRefinePrompt/buildRefineWorkerPrompt）、
    codex 运行构造与事件账本（newCodexRefineRun/appendRefineEvent）、settleRefineBatch。
  - `scripts/atb.mjs`：新增 `refine create/next/done/fail/release/check/summary/pause/records` 子命令树（--json 支持）与 USAGE。
  - `scripts/server.mjs`：新增 codex 逐项后台执行器（每项目串行、与 zcode 子 Agent 共用 refine.lock、
    锁忙 5s 重试、执行前复核、完成后核验文档变更、重启按失败落账 recover）与
    `/api/refine/{candidates,create,current,records,pause}` 端点。
  - `scripts/web/`：选择工具条新增 `#refineGo`（需求完善）入口；任务模块新增 `data-bmode="refine"` 子面板
    （候选清单+缺失原因、执行模式/开发人员、创建复制提示词、进度计数、执行记录文档链接/摘要/失败原因、暂停/下一批）；
    style.css 配套 `.refine-cands/.refine-cand/.refine-lack/.rs-refine-*`。
  - `scripts/tests/fixtures/fake-codex.mjs`：新增 `refine-ok`（按提示词条目目录补全 README）与
    `refine-noop`（不改文档，验证 no-doc-change 失败）两种行为模式。
  - 测试：`scripts/tests/refine-{store,cli,serve,ui}.test.mjs`（对应 test-cases.md R1~R12）。
