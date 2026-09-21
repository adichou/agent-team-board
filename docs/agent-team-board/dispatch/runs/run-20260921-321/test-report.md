# 测试报告 — BUG-20260921-007 分支浏览提交树翻页修复（run-20260921-321）

- 日期：2026-09-21　执行：zcode-batch-059-06
- 新增测试：`scripts/tests/bug-20260921-007.test.mjs`（TDD 先红后绿，10 例：T 组 treeData 纯函数 4 /
  V 组 vendor 可达性镜像 2 / R 组 vm 渲染交互 3 / S 组静态契约 1）
- 既有测试同步更新 3 处口径（行为有意变化的断言）：`req-20260921-002.test.mjs` T1（断层行续锚）、
  R5（单支单色板长度）；`bug-20260920-002.test.mjs` G1（子集 main 侧最新行锚定 main）
- 全量回归：`npm test` → **302 个测试文件，失败 0**（输出见同目录 test-output.log）
- 覆盖框架：Node 内建 `node:assert/strict` + `vm` 装载前端脚本的自研 runner（与仓库既有测试同构）

## 根因（引入来源 REQ-20260921-002，编号经 atb list 核验）

vendored `@gitgraph/js` 1.4.0 的两个渲染语义与分页 / 搜索子集数据不匹配：

1. `import()` 只渲染「分支 ref 沿首父链可达 ∪ 合并行次父闭包」的提交，其余**静默丢弃**（无异常，
   逃逸 mountTree 同步 try/catch）；旧 `treeData` 只把「页内命中的分支头」转 refs → 第 2 页起页内
   无 ref → 大量丢弃。本仓库实测：并集第 3 页 50/50 全丢（空白），main 单支第 2 页起丢 9/46/1/39…。
2. 泳道色按「分支名在渲染序列首次出现顺序」分配 → 第 2 页起无 ref 恒取 `colors[0]` 蓝（dev 变蓝）；
   且仅一侧在页时该侧占 0 号位、页内交错顺序随翻页跳变。

## 修复（全部在 scripts/web/build.js 适配层，不改 vendor）

1. `treeData` 双支 side 锚定 + 严格同侧显示序链：每侧以「本页该侧最新行」为锚（第 1 页 heads 命中
   行为锚，行为不变），`parents[0]` = 下方最近同侧行（真实父可能跳过交错同侧段行导致不可达），
   真实父保留为附加父（合并 / 分叉曲线保留）；最老 main 行钉 ref 写入序 → 共享历史恒主分支名。
   结构性保证整页提交零丢弃。
2. `treeData` 单支保真 + 页外断层「分支名·n」续锚（镜像 gitgraph 锚链 ∪ 合并闭包语义）；单支
   parents 仍全保真（REQ-20260920-001「不虚构父边」口径零回归）。
3. 泳道配色钉定：双支传 `compareBranchesOrder`（main 恒 0 蓝 `--git-lg0` / dev 恒 1 黄 `--git-lg1`）；
   色板按本页 side 出现排头（仅 dev 在页 → dev 色打头）；单支单色板；深浅色两套跟随系统。
4. `mountTree` 异步渲染保底：import 后注册更晚核查 tick，无 SVG / 圆点数不足（含静默丢弃类故障）
   即降级 `fallbackTreeHtml` 行式列表；成功则补挂高亮 / 选中 / 合并标识。

## 真实数据终验（本仓库，真实 vendor + 修复后 build.js，见 realdata-verify.log）

- union(main∪dev) 50 条/页 8 页 399 条：丢弃 0、配色错误 0（dev 恒黄 / main 恒蓝逐页逐提交核验）
- single(main) 342 条 / single(dev) 347 条全页：丢弃 0
- 20 条/页（20 页）/ 100 条/页（4 页）/ filter 搜索闭包子集（396 条 8 页）：覆盖缺口 0

## 交付文件

1. `scripts/web/build.js`：`dualLogNames` / `laneOrderOf` 新增；`treeData` 重写（双支锚定 + 严格同侧链 /
   单支保真 + 续锚）；`treeTemplate(dark, colors)`；`mountTree` 色板计算 + compareBranchesOrder +
   异步保底核查。
2. `scripts/tests/bug-20260921-007.test.mjs`（新增 10 例）。
3. `scripts/tests/req-20260921-002.test.mjs`、`scripts/tests/bug-20260920-002.test.mjs`：3 处口径断言同步。
4. 条目 `design.md`：引入来源归因（REQ-20260921-002）+ 根因分析 + 方案 + 风险边界。
