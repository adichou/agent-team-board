# 测试报告 — REQ-20260921-016 版本计划列表中的操作按钮优化

- 时间：2026-09-21T13:58:06.042Z
- 执行者：REQ-20260921-016
- 测试框架：node:assert + vm 加载真实 build.js + 假 DOM（仓库自研测试骨架）
- 覆盖率：9%

## 总结

列表卡片精简：移除 card-acts 操作行与合并(含失败重试)/创建并预检/查看发布记录三键模板；删除键迁卡片标题行右端(quiet/aria-label/merging+mergeBusy 禁用口径原样，长名 strong title 提示，bld-card-title 可伸缩换行)；AI 完善自概况顶部 bld-plan-acts 迁入描述块头部 bld-desc-block-acts、紧邻编辑左边，锁定口径(merging/已推送禁用带原因、merged 未推送可用)与编辑键 merging 规则原样；合并/创建并预检/发布记录仍在详情对应步骤(唯一入口)，data-ver-release-view 按钮与死绑定移除(openReleaseTab 保留)；CSS 换样式，i18n 补 1 遗漏词条。新增 req-20260921-016.test.mjs 9 例先红后绿；适配 8 个既有测试文件口径；npm test 317 文件仅 3 个与本单无关预存失败(README/AGENTS 在途改写 2 个+端口残留抖动 1 个单独运行通过)，构建模块相关 17 个测试文件全部通过

## 明细

覆盖口径说明：上「覆盖率」字段记录的是新增测试用例数（9 例，非百分比）——本仓库前端测试
为 vm 加载真实 build.js + 假 DOM 行为断言，无行覆盖率工具。

新增 `scripts/tests/req-20260921-016.test.mjs`（TDD：实现前 7 例跑红，实现后 9/9 通过）：

```
✓ T1 列表精简：卡片不再渲染 AI 完善 / 合并入 main（含失败重试）/ 创建并预检 / 查看发布记录，card-acts 操作行整体移除无留白
✓ T2 删除迁卡片标题行右端：每张卡片删除键位于自身标题行（.t 内、名称之后），quiet 危险弱化；长名称带完整名 title 提示；状态禁用口径不回归
✓ T3 详情概况描述头：头部右侧「AI 完善」紧邻「编辑」左边（bld-desc-block-acts 内两键顺序固定）；bld-plan-acts 顶部操作行移除
✓ T4 编辑表单并存：表单打开两入口随描述块替换隐藏、取消恢复；编辑键 merging 禁用与 pushed 可用规则不变；AI 完善锁定口径不回归
✓ T5 切换版本不串单：两入口随选中版本换绑；AI 弹窗版本号与提示词对新版本；删除确认仍按目标卡片版本打开
✓ T6 合并 / 创建并预检 / 发布记录仍在详情对应步骤（合并步主按钮、正式发布步创建并预检 + 发布记录区），列表不再重复入口
✓ T7 空态：无版本 / 未选择时无悬空 AI 完善 / 编辑 / 删除 / 合并 / 发布入口，详情显示选择引导
✓ T8 i18n：本次仅迁移位置不新增文案，沿用词条均在词典（AI 完善 / 编辑 / 删除 / 各禁用说明）
✓ S1 静态契约：renderVersionList 不再产出合并 / 发布 / AI 入口与 card-acts；data-ver-release-view 按钮与绑定移除；其余 data-ver-* 绑定保留；CSS 标题行删除右端对齐 + 描述头操作组、移除 bld-plan-acts / rel-card card-acts
```

既有回归适配（口径随本单迁移到详情步骤入口核验，8 个文件全部通过）：

- `req-20260921-013.test.mjs`（9/9）：T2 卡片四键断言改为「合并/发布迁出、删除迁标题行保留」；
  T3 概况入口位置改断言描述块头部（AI 完善 → 编辑 顺序）。
- `bug-build-ver-card-acts-20260913-004.test.mjs`（8/8）：B1/B2 合并键状态口径改在详情合并步
  主按钮核验（setup 补 /api/build/publish-plan mock，currentBranch=dev）。
- `bug-20260920-005.test.mjs`（7/7）：U1 同上（merged 未推送可用 / pushed 禁用带原因 /
  merging 勿重复触发 / failed 重试文案）。
- `bug-build-ver-published-chip-20260917-001.test.mjs`（7/7）：P3 卡片合并/发布键断言改移除断言；
  P5「查看发布记录」绑定断言改移除断言、data-ver-release（正式发布步）绑定保留。
- `build-release-card-items-search-20260915-003.test.mjs`（11/11）：R1 卡片发布键改移除断言；
  R2 状态口径改经 relCreateBtnHtml 模板 + 直调守卫 / openReleaseTab 就地激活核验；
  R7 重试恢复断言改 data-ver-id；R10 静态契约改「renderVersionList 不渲染发布按钮、
  relCreateBtnHtml 渲染」。
- `build-ui.test.mjs`（17/17）：N9a 删除键位置断言改标题行内名称之后、card-acts 移除断言。
- `bug-build-merge-click-feedback-20260920-006.test.mjs`（8/8）：M2/M4/M5 双入口断言收敛为
  详情合并步唯一入口（执行中切换版本同因禁用、完成后恢复）；S1 模板断言改单模板。
- `product-release-ui.test.mjs`（5/5）：H1「查看发布记录」入口断言改为「发布记录」就地展示区。

相关模块回归（与本单实现面相关，全部通过）：`req-20260921-015`（11/11）、
`bug-build-merge-scope-removal-20260921-014`（5/5）、`bug-release-tab-inplace-20260915-014`（19/19）、
`build-publish-20260916-001`（PASS）、i18n 四件（coverage/dict/runtime/wiring 全部通过）。

全量 `npm test`（317 个测试文件）失败 3 个，均与本单无关（已核实）：

- `req-20260918-002.test.mjs` / `req-doc-entry-20260916-003.test.mjs`：断言根 README.md / AGENTS.md
  文档契约（三栏协作体系章节、语言切换行、命令登记），而工作区中这两个文件正被其他在途单
  （BLD-20260920-001 发布文档重写）未提交改写（`git status` M README.md / M AGENTS.md，
  本单未触碰这两个文件），属预存失败。
- `bug-leak-residue-20260914-013.test.mjs`：全量并发运行时的端口残留抖动，单独运行「全部通过」。
