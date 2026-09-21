# 设计 — BUG-20260921-008 main 分支的提交历史只显示 main 分支的，不要和 dev 分支的合并显示

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：BUG-20260920-002（编号已经 `atb list` 核验存在，in-progress「main 分支的 git log 显示需要优化」）
  —— 该单为「选中 main」引入 main∪dev 双支并集口径（`dualBranchScope` / `branchUnionLog`，
  载荷附 heads / mergeBase / side）；BUG-20260921-006 已先把 dev 改回单支，本单把 main（含
  master 回退）也改回单支，并集逻辑整体移除。

## 根因分析

- 数据层：`scripts/lib/build-git.mjs` 的 `branchLog` / `branchSearchLog` 经 `dualBranchScope`
  判定「所选分支 = 主分支解析结果（main / master 回退）且与 dev 两支本地并存」时，改走
  `branchUnionLog`，读取 `git log <main> <dev>` 并集（BUG-20260920-002 引入；BUG-20260921-006
  收窄到仅主分支）。于是浏览 main 时 dev 独有提交（尚未合并入 main 的开发提交）混入显示。
- 前端按载荷驱动（heads / side / mergeBase 存在才渲染并集提示、分支头标签、汇聚点标注），
  根因纯在服务端数据口径，前端无需改动即可恢复单支视图。

## 方案

**开源选型（REQ-20260909-015）**：本修复为既有自研 git 只读读取层（spawnSync 本机 git）的
口径回退与死代码移除，无新增功能面，不引入第三方库（无合适库：仅需删除自有双支并集分支
逻辑；引入开源库反而增加依赖面）。未使用开源库，不创建 licenses.md。

1. `scripts/lib/build-git.mjs`：
   - `branchLog` 删除 `dualBranchScope` / `branchUnionLog` 调用——所有分支（含主分支 main /
     master 回退）一律单支可达集合（等价 `git log <branch>`），响应不再附 heads /
     mergeBase / side；已并入 main 的 dev 提交经合并提交自然可达，仍会出现在 main 视图。
   - `branchSearchLog` 同步删除双支语义：数据集恒为所选分支单支全量，不再按双支 heads 名
     命中 side；选中分支名命中全量的既有口径保留。
   - 整段移除 `dualBranchScope` / `branchUnionLog` 两个函数（死代码不留）。
2. `scripts/server.mjs`：`/api/build/branch-log` 接口注释同步单支口径（BUG-20260921-008）。
3. `scripts/web/build.js`：仅同步过时口径注释；渲染代码按载荷驱动保留双支渲染兼容路径
   （服务端不再下发 heads 后，并集提示 / 分支头标签 / 汇聚点标注自然消失，与 BUG-20260921-006
   对 dev 的处理同法）。i18n 无文案增删（中英文均无需改动）。
4. 测试：新增 `scripts/tests/bug-20260921-008.test.mjs`（B1–B7 后端单支口径 + R1 前端单支载荷
   渲染）；随口径回退同步既有断言——`bug-20260920-002.test.mjs`（B1/B2/B4–B8 并集断言改单支；
   G/R/S/I 组以合成双支载荷继续验证前端兼容路径）、`bug-20260921-006.test.mjs`（B2/B6/B7 的
   main 侧断言）、`req-20260921-002.test.mjs`（B5 双支搜索改单支）。

## 风险与边界

- 行为变化（预期内）：浏览 main 不再看到「dev 独有、未合并」的提交；合并提交与经其并入的
  dev 提交仍按 `git log main` 可达规则显示。main 上搜索 dev 专属主题 / 另一支分支名将零命中。
- `atb commit log`（账本与 git 历史合并的另一命令）与发布模块的 main 读取不受本改动影响。
- 前端双支渲染兼容路径保留（合成载荷可渲染），后续如确认不再需要可另行清理（含
  i18n「并集视图…」条目与 bt-* 样式）——本单不动，避免牵连 BUG-20260921-007 刚落地的翻页
  与配色修复测试。
- 只读改动：不触碰条目状态、不产生 git 提交（report 收口由系统自动提交）。
