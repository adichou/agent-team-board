# 测试报告 — BUG-20260914-012 main 分支的推送按钮不需要，请去掉

- 时间：2026-09-14T06:56:11.094Z
- 执行者：zcode-batch-048-BUG-20260914-012
- 测试框架：node:test-style custom scripts/tests/run-all.mjs (229 files) + vm 行为测试
- 覆盖率：100%

## 总结

分支浏览本地分组 main 行不再渲染「推送」按钮（renderBranchesPane 条件省略，行保留可浏览）；服务端不封禁 push（design.md 落定）；关联更新 006/011 测试载荷使 attn 断言基于非 main 分支；新增 4 用例 + 全量 229 文件回归通过

## 明细

### 引入来源归因

引入来源：**REQ-20260913-001**（构建模块引入「分支浏览」子页签，`renderBranchesPane()` 自始对
除当前分支外的所有本地分支渲染「推送」按钮，未对 main 区分；`atb show REQ-20260913-001` 核验
存在，状态 done）。详见 design.md「引入来源（源单）」节。

### 改动

- `scripts/web/build.js`（唯一实现改动）：`renderBranchesPane()` 本地分组渲染对 `main` 行条件
  省略 `data-push` 按钮输出（main 行保留，只读浏览不变；`pushAttn` 高亮条件与其余分支按钮、
  推送确认弹窗 / 执行链路全部不动），附注释引用本 Bug 与「main 归发布模块」口径。
- 新增 `scripts/tests/bug-branch-main-no-push-20260914-012.test.mjs`：U1 多分支（当前 dev）
  main 行无按钮、feat 行按钮属性不变；U2 main 为当前分支现状回归；U3 BUG-20260914-006 空远端
  attn 高亮回归（非 main 分支仍高亮、main 行无按钮）；S1 源码断言推送链路仅收敛渲染条件。
  TDD：修复前 U1/U3 红（U2/S1 为现状回归基线绿），修复后 4 用例全绿。
- 关联断言更新（验收 6 预期内，详见 design.md 实施记录）：核查发现既有测试
  `bug-remote-empty-explain-20260914-006.test.mjs` U2 与 `bug-sync-fetch-push-20260914-011.test.mjs`
  U4 场景一的 `bld-push attn` 断言在 `current=dev, local=['dev','main']` 载荷下实际匹配 main 行
  按钮（与 README 验收 3「基于 dev 分支」的声明不符）；按验收声明意图为两处载荷补非 main 分支
  `feat`（011 U4 失败分支相应 dev→feat），使高亮断言真正基于非 main 分支。
- 服务端口径（README「待确认」项，design.md 落定）：`POST /api/build/push` / `pushBranch()`
  **不封禁 main**，维持通用受限写原语；防绕过 UI 直调接口属服务端治理增强，另行立项。
- 边界场景口径（README 验收 4）：除当前分支外仅剩 main 时，BUG-20260914-011 的空态细分文案已
  说明「本地没有可自动推送的开发分支（main 由发布模块管理，不在此推送）」，不引导找不存在的
  按钮；次要引导句措辞是否调整留人工验收定夺。

### 测试输出

```
$ node scripts/tests/bug-branch-main-no-push-20260914-012.test.mjs
✓ U1 dev+main 双分支（当前 dev）：main 行无「推送」按钮且行保留可浏览，其他分支按钮结构不变
✓ U2 main 为当前分支：以「当前」行渲染、无按钮（现状回归未破坏）；其他分支按钮仍在
✓ U3 BUG-20260914-006 回归：同步成功后远端仍空 → 非 main 分支推送按钮 attn 高亮仍在，main 行无按钮
✓ S1 源码：推送链路仅收敛渲染条件——[data-push] 委托绑定与确认弹窗 / 执行入口保持存在

4 用例，失败 0

$ node scripts/tests/bug-remote-empty-explain-20260914-006.test.mjs   # 8 用例，失败 0
$ node scripts/tests/bug-sync-fetch-push-20260914-011.test.mjs        # 13 用例，失败 0
$ node scripts/tests/run-all.mjs                                       # 共 229 个测试文件，失败 0
```

覆盖率口径：实现改动为 `renderBranchesPane()` 单处条件渲染（main→无按钮 / 其他→按钮两分支），
新测试两分支 + 当前分支现状 + attn 场景 + 链路源码断言全覆盖，改动行为 100% 覆盖。
