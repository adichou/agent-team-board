# 测试报告 — BUG-20260908-007 impl-scope S1 候选排序偶发翻转：同毫秒创建的条目 id 决胜把 BUG 排在 REQ 前

- 时间：2026-09-08T14:43:02.127Z
- 执行者：zcode-batch-018-2
- 测试框架：node:assert/strict（node scripts/tests/impl-scope.test.mjs + run-all 聚合）
- 覆盖率：100%

## 总结

S1 用例 reqNew 加 backMs 50 时间隔离（reqOld(-3000)<reqNew(-50)<bug(0) 全序确定），产品源码零改动；修复前 20 连跑失败 3 次均为 S1:164 断言，修复后 50 连跑 0 失败，npm test 93 文件全绿；引入来源 REQ-20260906-018（已核验），README 头部已补引入来源行

## 明细

### 改动

- `scripts/tests/impl-scope.test.mjs` S1（第 159 行附近）：`reqNew` 创建加 `{ backMs: 50 }`，附两行注释说明同毫秒竞态与全序推导。业务源码（`scripts/lib/batch.mjs`、`scripts/lib/core.mjs` 等）零改动，S1 断言（第 164 行 `deepEqual [reqNew, bug]`）未弱化、保持同步风格。

### 跑红（修复前，2026-09-08 本机实测）

- `for i in $(seq 1 20); do node scripts/tests/impl-scope.test.mjs > /dev/null 2>&1 || ...; done` → 失败 3/20（FAIL #7/#11/#15）。
- 捕获单次失败输出，失败点与登记一致：
  ```
  ✗ S1 createBatch({ids})：候选=勾选集合且保持规范排序，未勾选不入批
  AssertionError [ERR_ASSERTION]: 候选应为勾选集合，按 需求→bug 规范序
      at scripts/tests/impl-scope.test.mjs:164:12
  6 个用例，失败 1
  ```
  其余 S2–S6 用例均通过。

### 跑绿（修复后）

- 同命令循环 50 次：失败 0/50，退出码恒为 0。
- `npm test`（`scripts/tests/run-all.mjs` 聚合）：共 93 个测试文件，失败 0（「全部通过」）。

### 验收对照（README 验收说明）

1. 改动范围仅 S1 数据构造 ✅；2. 15–50 次循环 0 失败（实测 50 次）✅；3. `npm test` 全绿 ✅；4. S2–S6 行为不变（全量跑绿且未改动）✅；5. S1 保持同步风格、断言未弱化 ✅。

### 引入来源

REQ-20260906-018（impl-scope.test.mjs S1/S2 来源需求，S1 自创建起即背靠背无隔离构造；经 `atb list` 核验在册），详见 design.md「引入来源（源单）」节。
