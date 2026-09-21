# 设计 — BUG-20260921-006 分支浏览中 dev 分支只需要显示 dev 分支的提交就行，请修改

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：BUG-20260920-002（已 `atb list` 核验：in-progress「main 分支的 git log 显示需要优化」）。
  该单把 `dualBranchScope` 判定为「所选分支为主分支解析结果**或 dev**」均走 main ∪ dev 双支并集，
  使 dev 视图混入 main 独有提交与并集专属 UI。

## 根因分析

`scripts/lib/build-git.mjs` 的 `dualBranchScope(root, ref)`（BUG-20260920-002 引入）在
`ref === mainBranch || ref === DEV_BRANCH` 且两支本地引用并存时返回 `{ main, dev }`，
`branchLog` / `branchSearchLog` 据此改走 `branchUnionLog` / 并集搜索——读取
`git log <main> <dev>` 的并集（含 dev 不可达、仅 main 可达的版本合并提交），响应附
`heads` / `mergeBase` / 逐提交 `side`。前端（`scripts/web/build.js` renderBranchesPane /
fallbackTreeHtml / treeData）按「载荷含 heads（≥2）」渲染并集专属元素（并集提示行、
main 分支头标签、Merge-base / 汇聚点标注、并集计数）。因此选中 dev 时数据集与 UI 均为双支口径。

## 方案

**修复**：`dualBranchScope` 收窄判定——仅 `ref === 主分支解析结果`（优先 main、仅 master 回退
master）时返回并集范围；dev 及其余分支一律返回 `null` 走既有单支口径（`git log dev`，响应不带
heads / mergeBase / side）。`branchLog` 与 `branchSearchLog` 共用该判定，故列表 / 提交树 /
分页计数 / 搜索（filter 与 highlight 两模式）自动一致收窄为 dev 单支；前端按载荷驱动，dev 载荷
无 heads 后并集提示 / main 头标签 / merge-base 标注自然消失，与其他非主支分支表现一致，前端无
功能改动（仅同步注释）。main / master 选择的并集口径与既有 BUG-20260920-002 验收不回归。
文案无增删（并集提示词条仍服务 main 视图），i18n 词典无需改动。

**测试**：新增 `scripts/tests/bug-20260921-006.test.mjs`（B1–B7 后端真实临时仓库：dev 单支
集合 / 总数 / 无并集字段、main 不回归、搜索双模式数据集、分页与空白关键词、dev 已全并入型、
master 回退型；R1 vm 渲染 dev 单支载荷无并集专属 UI）。同步更新既有断言：
`bug-20260920-002.test.mjs` B2（原「main/dev 对称性」改为 dev 单支 + main 不回归）与 B4（dev
搜索作者命中 5→4、无 heads）；`req-20260921-002.test.mjs` B5 断言消息措辞（fixture dev ⊇ main，
集合不变）。

**开源选型（REQ-20260909-015）**：自研（本单为既有实现的一处判定收窄与测试同步，无新能力引入，
无合适库可复用；引入成本高于自研）。未引入开源库，不创建 licenses.md。

## 风险与边界

- main / master 视图保持并集（用户报告仅针对 dev；如需 main 也改单支另行登记）。
- 只读语义不变：不切换工作区分支、不改引用与文件；分页 / 搜索双模式 / 刷新 / 加载空失败态 /
  提交选中详情均保持。
- `ui-demo.html`（登记时已建）演示缺陷与期望对照，验收时人工核对。
