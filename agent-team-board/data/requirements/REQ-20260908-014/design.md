# 设计 — REQ-20260908-014 需求完善批次每一轮上报需在主调度会话中显示单号和标题

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

refine 批次子 Agent 每轮把 `atb refine done/fail` 的回执 JSON 原样返回主调度会话；
`scripts/lib/refine-store.mjs` 的 `finishRefineRun` 生成的回执只含
`{version,batchId,runId,itemId,result,summary|reason}`，没有条目标题；`checkRefineBatch`
的 `current` 与 `listRefineRuns` 的 records 同样缺标题。主调度只能看到单号，需额外查询才能
对应条目含义。

## 方案

在 refine 运行账本与输出协议中补充标题快照（技术选型：沿用现有 run.json 账本，新增一个快照字段）：

1. **run 创建时快照标题**：`newRefineRun` 写入 `run.itemTitle`（来自 item.title）。三个入口：
   - `nextRefineItem`（zcode 领取）传 `item: { id, title: st.title }`（st 已读）；
   - `skipRun`（出局落账）传候选的 `cand.title`；
   - `newCodexRefineRun`（codex 入队）传候选的 `item.title`。
2. **读取 helper `titleOfRun(dataDir, run)`**：优先 `run.itemTitle`，缺失（历史 run）时回退
   `readStatus(resolveItemDir(...))` 实时读条目标题；条目已被删除等读取失败返回 null，不抛错。
3. **输出协议补 title**：
   - `finishRefineRun`：done/failed 回执加 `title: titleOfRun(...)`；
   - `listRefineRuns`：records 每条加 `title`；
   - `checkRefineBatch`：`current` 加 `title`。

影响面：仅 `scripts/lib/refine-store.mjs` 数据层；CLI（atb.mjs）与 server/web 消费这些对象时
为字段新增，不做结构变更，向后兼容。

## 风险与边界

- 标题快照与实时标题可能不一致（完善期间条目被改名）：展示取领取时快照，可接受；回执路径有
  实时回退兜底。
- 载荷体积：title 增量数十字节，`RECEIPT_MAX_BYTES`（2048）校验保留不变，正常远达不到上限。
- 超长标题不做截断（title 由看板创建时已限长），保持原文便于主调度阅读。
- 实施批次（batch.mjs）回执不在本需求范围，不改。

## 实施记录

- 2026-09-08（zcode-batch-015-01）：按上述方案实施，TDD 用例见 test-cases.md。
  改动集中在 `scripts/lib/refine-store.mjs`：
  - `newRefineRun` 快照 `run.itemTitle`；三入口（`nextRefineItem`/`skipRun`/`newCodexRefineRun`）传入标题；
  - 新增内部 helper `titleOfRun`（快照优先 → 实时读条目回退 → null 不抛错）；
  - `finishRefineRun` done/failed 回执、`listRefineRuns` records、`checkRefineBatch` current 均增补 `title`。
  测试：`refine-store.test.mjs` 新增 R11、`refine-cli.test.mjs` R10 追加回执标题断言；
  全量 87 个测试文件失败 0。
