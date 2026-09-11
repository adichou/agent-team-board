# 测试用例 — BUG-20260903-004

对应自动化测试：`scripts/tests/claim-msg.test.mjs`（node:assert + 子进程 CLI + 真实 server）。

## C1 claim 成功提示与实际流转一致（主修复）

前置：临时项目，条目已人工接受（accepted）。

1. 子进程执行 `node atb.mjs claim <ID> --by test-session`，退出码 0。
2. 断言 stdout：
   - 包含「状态 in-progress」；
   - 包含「可直接实施」；
   - **不**包含「待对齐」；
   - **不**包含「对齐确认」。
3. 断言 status.json：status=in-progress、owner=test-session。

## C2 存量条目续认提示不谎报流转

前置：条目被直写为存量 pending-alignment（owner=legacy-session）。

1. 同 owner 执行 claim（续认路径，状态不变），退出码 0。
2. 断言 stdout：包含「pending-alignment」，**不**包含「可直接实施」（该条目还需人工放行，不能提示可直接实施）。

## C3 网页端 accepted 流转 403 提示不再指向已取消的对齐确认

前置：临时项目 + 真实 server（独立端口），条目已人工接受。

1. `POST /api/item/<ID>/status {"to":"in-progress"}` → 403（网页端不承担认领，行为不变）。
2. 断言错误信息：
   - 包含「atb claim」（引导走 CLI 认领）；
   - **不**包含「待对齐」「对齐确认」。

## 回归

- `scripts/tests/pending-alignment.test.mjs`（R1–R6 状态机/前端契约）全绿。
- `scripts/tests/actor-name.test.mjs`、`serve.test.mjs` 等既有套件不受影响。
