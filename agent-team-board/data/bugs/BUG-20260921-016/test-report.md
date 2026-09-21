# 测试报告 — BUG-20260921-016 删除下方的描述标签和计划号等标签，把 AI 完善和编辑放在同一行

- 时间：2026-09-21T15:07:54.878Z
- 执行者：BUG-20260921-016
- 测试框架：node:assert + vm 假 DOM 行为测试（仓库自研测试骨架）
- 覆盖率：95%

## 总结

概况页签去冗余：删元信息行（计划号/版本号/目标/来源分支）与「描述」标签行，顶部一行右对齐 bld-plan-acts 操作行「AI 完善+编辑」同排；编辑态编辑键让位、AI 完善保留原位；锁定 title 口径（BUG-20260920-005/REQ-20260921-014）与编辑/AI 完善链路零变化；style.css 移除 desc-block-head/acts、恢复 bld-plan-acts；新增 bug-20260921-016.test.mjs 7 例先红后绿；同步调整 req-20260921-016 T3/T4/S1、req-20260921-013 T3、bug-build-ver-card-acts B1；run-all 319 文件仅 2 个与本单无关既有失败（在途 README/AGENTS 重写）。归因 REQ-20260920-003+REQ-20260921-014+REQ-20260921-016

## 明细

### TDD 过程（先红后绿）

实现前 `node scripts/tests/bug-20260921-016.test.mjs`：T1（元信息行/描述标签仍在）、T3（编辑态 AI 完善未保留原位）、S1（静态契约）3 例红，T2/T4/T5/T6 口径断言现状即绿——红点正是本单待改布局。实现后 7 例全绿：

```
✓ T1 概况布局精简：无元信息行（计划号 / 版本号 / 目标分支 / 来源分支）与「描述」标签行；顶部一行右对齐操作行内「AI 完善」「编辑」同排且先于描述正文
✓ T2 操作行锁定口径不回归：merging 两键禁用且 title 分别说明；推送完成后 AI 完善禁用、编辑仍可用；merged 未推送两键可用
✓ T3 编辑态让位：点「编辑」就地展开名称 + 描述表单，操作行「编辑」键随表单打开消失、「AI 完善」保留原位；取消后两键恢复、表单退出
✓ T4 merging 提示与合并失败信息随布局上移且口径不变：位于操作行之后、描述区附近展示
✓ T5 信息完整性：详情头部仍完整显示计划号、版本号、更新时间；五步导航五步齐全不受布局影响
✓ T6 i18n 词条沿用：被删标签不误删既有键（描述 / AI 完善 / 编辑等仍可全文匹配替换，别的界面在用）
✓ S1 静态契约：renderDetail 概况模板不再产出元信息行；bld-desc-block-head / bld-desc-block-acts 模板与样式移除；.bld-plan-acts 操作行样式恢复

7 个用例，失败 0
```

### 受影响既有断言同步调整（实现后各自全绿）

- `req-20260921-016.test.mjs`：9 例全绿（T3 改为概况顶部操作行断言、T4 改为编辑键让位 / AI 完善保留、S1 CSS 断言随 .bld-plan-acts 恢复反转）。
- `req-20260921-013.test.mjs`：9 例全绿（T3 入口容器 bld-desc-block-head → bld-plan-acts）。
- `bug-build-ver-card-acts-20260913-004.test.mjs`：8 例全绿（B1 同上）。
- `build-plan-edit-req-20260921-014.test.mjs`：10 例全绿（编辑表单链路零回归）。

### 全量 `node scripts/tests/run-all.mjs`

共 319 个测试文件，失败 3，均与本单无关：

- `req-doc-entry-20260916-003.test.mjs`、`req-20260918-002.test.mjs`：稳定失败，断言对象是仓库根 README.md / AGENTS.md——工作区存在未提交的 README/AGENTS 本地重写（git 状态 M README.md / M AGENTS.md，README 净删 128 行），文档契约断言与其不一致；本单未触碰这两个文件，属在途人工改动的中间状态（与上一单 BUG-20260921-015 记录的既有失败相同）。
- `bug-leak-residue-20260914-013.test.mjs`：run-all 首轮失败、单独复跑与其后复验均通过（端口 / 进程清理类偶发）。

### 改动文件

- `scripts/web/build.js`（renderDetail 概况步模板）
- `scripts/web/style.css`（.bld-desc-block-head / .bld-desc-block-acts 移除，.bld-plan-acts 恢复）
- `scripts/tests/bug-20260921-016.test.mjs`（新增）
- `scripts/tests/req-20260921-016.test.mjs`、`scripts/tests/req-20260921-013.test.mjs`、`scripts/tests/bug-build-ver-card-acts-20260913-004.test.mjs`（断言同步）
