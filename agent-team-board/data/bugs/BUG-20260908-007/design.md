# 设计 — BUG-20260908-007 impl-scope S1 候选排序偶发翻转：同毫秒创建的条目 id 决胜把 BUG 排在 REQ 前

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260906-018 —— `scripts/tests/impl-scope.test.mjs` 文件头注释标注 S1/S2 为该需求（批量实施入口改造：ids 勾选范围）的覆盖用例；S1 自创建起即以「reqNew、bug 背靠背创建且均无 backMs 隔离」构造数据，同毫秒竞态随用例引入。README 现象节已注明非 REQ-20260908-019 引入。
- 排查说明：项目目录非 git 仓库，无法逐 commit 核验 S1 断言的精确引入变更，此点「待确认」；上述归因以测试文件自身注释为准。

## 根因分析

1. 数据构造缺时间隔离：S1（`scripts/tests/impl-scope.test.mjs:155-168`）中 `reqNew`（第 159 行）与 `bug`（第 160 行）连续创建，每个 `mkItem` = `createItem` + 两次 `setStatus`（accepted→planned）磁盘写，两次创建间隔常小于 1ms；`reqOld` 有 `backMs: 3000` 隔离故稳定。
2. 时间戳精度：`core.createItem` 写 `createdAt: new Date().toISOString()`（毫秒精度，`scripts/lib/core.mjs:425`），同毫秒创建 → `createdAt` 字符串相同。
3. 决胜规则放大：`candidateItems` 按 `createdAt` 升序、相同则 `id` 字典序决胜（`scripts/lib/batch.mjs:244-251`）；`BUG-…` < `REQ-…`（B < R），bug 反超 reqNew，`b.candidates` 变为 `[bug, reqNew]`，与断言 `[reqNew, bug]`（第 164 行）不符。
4. 定性：产品排序是确定性全序（tie 时 id 决胜），行为本身无缺陷；偶发翻转完全来自测试数据构造，属测试侧问题。实测：2026-09-08 本机 15 连跑失败 3 次（约 20%）。

## 方案

测试侧最小改动（推荐）：给 `reqNew` 补时间隔离，沿用本文件已有 `backdate`/`backMs` 脚手架（`reqOld` 已在用）：

```js
const reqNew = mkItem(p, 'requirement', '较新需求', { backMs: 50 });
```

推导：`reqOld` 存储时间 = T0−3000ms，`reqNew` = T1−50ms，`bug` = T2（T0 < T1 < T2 为真实创建序），恒有 `T0−3000 < T1−50 < T2`，毫秒级隔离且保持「reqOld < reqNew < bug」语义不变，断言无需改动。

备选（不推荐）：
- 断言前对 createdAt 补确定性间隔：效果等同，但改动点更多。
- 弱化断言为集合比较：会漏掉真实排序回归，禁止。
- 改产品侧排序（如同 createdAt 时按类型加权）：与「最旧优先 = 创建时间升序 → 编号」口径（`scripts/lib/batch.mjs:241-242` 注释，REQ-20260908-010）冲突，且产品行为无缺陷，不做。

## 风险与边界

- S3（`scripts/tests/impl-scope.test.mjs:221-225`）断言 `[A, C]`，A（REQ）与 C（BUG）间隔两个 `mkItem`，理论同类竞态但间隔更大，登记与实测（15 连跑）均未复现；修复时可选评估同样加 backMs，超出本 Bug 登记范围，默认不动。
- S5/S6 只断言单个领取条目，不依赖多候选相对顺序，不受影响。
- 修复不得引入 async/sleep（S1 为同步用例）；不得改动 `scripts/lib/batch.mjs`、`scripts/lib/core.mjs`。
- 真实看板使用中同毫秒创建的两条目由 id 决胜给出稳定排序，用户可见行为一致，无产品面风险。

## 实施记录（2026-09-08，zcode-batch-018-2 / batch-20260908-018）

1. 按方案落地测试侧最小改动：`scripts/tests/impl-scope.test.mjs` S1 的 `reqNew` 加 `{ backMs: 50 }`，并补两行注释说明竞态与全序推导（reqOld(-3000) < reqNew(-50) < bug(0)）；S2–S6 及 `scripts/lib/batch.mjs`、`scripts/lib/core.mjs` 等业务源码零改动。
2. 跑红复现：修复前循环运行 `node scripts/tests/impl-scope.test.mjs` 20 次，失败 3 次（3/20），失败点均为 S1 第 164 行断言（`AssertionError: 候选应为勾选集合，按 需求→bug 规范序`），与登记现象一致。
3. 跑绿验证：修复后同命令循环 50 次 0 失败（0/50，退出码恒为 0）；`npm test`（run-all 聚合）93 个测试文件全部通过、失败 0。
4. 引入来源已在 design「引入来源（源单）」节归因为 REQ-20260906-018（经 `atb list` 核验存在），本次同步在 README 头部元信息区补写 `- 引入来源：` 行。
