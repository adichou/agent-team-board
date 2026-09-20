# BUG-20260908-007 impl-scope S1 候选排序偶发翻转：同毫秒创建的条目 id 决胜把 BUG 排在 REQ 前

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：REQ-20260906-018（impl-scope.test.mjs 的来源需求，S1 自创建起即以 reqNew、bug 背靠背且均无 backMs 隔离构造数据，同毫秒竞态随用例引入；经 `atb list` 核验在册）
- 创建：2026-09-08T07:06:50.892Z

## 现象

scripts/tests/impl-scope.test.mjs S1 断言候选按「需求→bug 规范序」（即创建时间序：reqNew 先于 bug 创建）。candidateItems 排序为 createdAt 升序、相同则按 id 字典序决胜；当 reqNew 与 bug 在同一毫秒内创建（nowIso 毫秒精度），createdAt 相同 → id 决胜使 BUG-2026… < REQ-2026…，bug 反超 reqNew，断言失败。复现率约 30–40%（连跑可见）。属测试数据构造缺时间隔离（reqOld 有 backMs 3000，reqNew/bug 无 backdate），非本需求（REQ-20260908-019）引入；产品代码 tiebreak 行为本身确定。修复建议：给 reqNew 或 bug 加 backMs 分离毫秒，或断言排序前补确定性间隔。登记时未定位引入来源。

## 复现步骤

前置：无需任何看板数据，测试自建临时项目目录（`mkProject()`），跑完自动清理。

1. 进入项目根目录 `/Users/adichou/Documents/src/agent-team-board`。
2. 循环运行 S1 所在测试文件放大偶发概率（单跑一次常通过）：
   ```bash
   for i in $(seq 1 15); do node scripts/tests/impl-scope.test.mjs > /dev/null 2>&1 || echo "FAIL #$i"; done
   ```
3. 观察输出：偶发（本机 2026-09-08 两轮实测：登记时 15 连跑失败 3 次 ≈20%；完善批次复核（zcode-refine-009-17，2026-09-08 晚）15 连跑失败 4 次 ≈27%，两轮失败点均为同一条断言，S2–S6 全绿）出现：
   ```
   ✗ S1 createBatch({ids})：候选=勾选集合且保持规范排序，未勾选不入批
   AssertionError [ERR_ASSERTION]: 候选应为勾选集合，按 需求→bug 规范序
       at scripts/tests/impl-scope.test.mjs:164:12
   ```
   其余用例（S2–S6）不受影响。

失败机理（对应源码）：

1. S1 用例（`scripts/tests/impl-scope.test.mjs:155-168`）连续创建三个条目：`reqOld`（backMs 3000，有隔离）、`reqNew`（第 159 行，无 backMs）、`bug`（第 160 行，无 backMs）。每个 `mkItem`（`scripts/tests/impl-scope.test.mjs:53-62`）= `createItem` + 两次 `setStatus`（accepted→planned）磁盘写，`reqNew` 与 `bug` 之间仅隔这两次写，实际间隔常小于 1ms。
2. `core.createItem` 写入 `createdAt: now`（`const now = new Date().toISOString()`，毫秒精度：`scripts/lib/core.mjs:426`，赋值落在 434 行），两条目可能落在同一毫秒 → `createdAt` 字符串完全相同。
3. `batch.candidateItems` 排序规则：`createdAt` 升序，相同则按 `id` 字典序决胜（`scripts/lib/batch.mjs:244-251`）。
4. 同毫秒时 `BUG-2026…` 字典序小于 `REQ-2026…`（B < R）→ `bug` 反超 `reqNew`，`b.candidates` 实际为 `[bug, reqNew]`。
5. 断言 `assert.deepEqual(b.candidates, [reqNew, bug])`（`scripts/tests/impl-scope.test.mjs:164`）失败。

## 期望行为

- `node scripts/tests/impl-scope.test.mjs` 连续多次运行（≥15 次）应 100% 通过，退出码恒为 0；S1 冻结清单稳定为 `[reqNew, bug]`（即创建时间序：reqNew 先于 bug 创建）。
- 产品侧不改：`candidateItems` 的决胜规则（`createdAt` 升序 → `id` 字典序）是有意设计——同毫秒创建时用 id 保证全序确定，属确定性行为而非缺陷（选单口径见 `scripts/lib/batch.mjs:241-242` 注释，REQ-20260908-010）。不得为迁就测试改动 `scripts/lib/batch.mjs`。
- 修复应落在测试数据构造：沿用本文件已有的 `backdate`/`backMs` 脚手架（`scripts/tests/impl-scope.test.mjs:46-51`，仅回写 `createdAt`）给 `reqNew` 或 `bug` 做时间隔离（如 `reqNew` 加 `backMs: 50`，保证 `reqOld(-3000) < reqNew(-50) < bug(0)` 全序确定），不得依赖"机器慢"或引入真实 sleep。

## 验收说明

1. 改动范围仅 `scripts/tests/impl-scope.test.mjs` S1 用例的数据构造；`scripts/lib/batch.mjs`、`scripts/lib/core.mjs` 等业务源码零改动。
2. 循环运行 `node scripts/tests/impl-scope.test.mjs` 15–50 次，0 次失败、退出码恒为 0。
3. `npm test`（`scripts/tests/run-all.mjs` 聚合执行全部 `*.test.mjs`）全绿。
4. S2–S6 用例行为不变：S2 断言 `[reqOld, bug]` 依赖 `reqOld` 已有的 backMs 3000 隔离，不受影响。
5. S1 用例保持同步风格（不引入 async/sleep）；断言不得弱化（不得改成只比较集合不比较顺序，否则漏掉真实排序回归）。

关联条目（均经 `atb list` 核验存在）：
- REQ-20260906-018：impl-scope.test.mjs 的来源需求（S1/S2 覆盖其 ids 勾选范围）。
- REQ-20260908-010：候选选单口径（planned、创建时间升序）。
- REQ-20260908-019：S2 无上限截断口径；README 现象节已注明本 Bug 非其引入。
