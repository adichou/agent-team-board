# 测试用例 — REQ-20260908-025 完善文档指纹算法版本化，避免基线口径不一致导致误报

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

新增测试文件：`scripts/tests/refine-fingerprint-version.test.mjs`（F1~F6，利用注册表真实 v1/v2 口径模拟事故序列）；既有 refine-store / refine-claim-baseline / refine-reaccept / refine-serve / refine-cli / refine-ui / tasks-refine 指纹相关用例作回归（形态兼容预期不改即绿）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| F1 | 指纹自带版本：`docsFingerprint` 返回 `v2:<40hex>` 形态；`docsFingerprintAt(dir, v)` 按版本口径返回裸哈希，未登记版本抛错 | P0 | ✅ |
| F2 | 四处冻结点统一记录版本：创建/吸收/重排队/领取落盘的 `candidates[].baseline` 均为 `v2:` 前缀形态（领取重冻结把存量裸基线就地升级） | P0 | ✅ |
| F3 | 按基线版本重算比对（事故主场景）：v1 口径冻结基线 → 算法演进为当前 v2 → 未编辑（含仅新增 v2 才纳入的 ui-demo.html）判定一致（done 仍拒绝），编辑 v1 覆盖文件判定不一致（done 可记） | P0 | ✅ |
| F4 | 存量裸哈希兼容：裸 v1 哈希 / 裸 v2 哈希基线在 v2 代码下未编辑均判一致（不误报出局），真编辑判不一致 | P0 | ✅ |
| F5 | 真人工编辑语义回归：同版本（v2）口径领取后人工改文档 → `docsUnchangedSince` 判已变更（precheck 出局方向、settle changed 方向）；非法形态基线判已变更；未登记版本前缀判已变更 | P0 | ✅ |
| F6 | 事故序列端到端：裸基线在途批次（模拟 RFB-20260908-010 场景）在版本化代码上领取 → 补全文档 → done 记账，全程无「冻结后文档已被人工编辑，基线失效」类 skipped | P0 | ✅ |
