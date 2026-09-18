# 设计 — BUG-20260914-012 main 分支的推送按钮不需要，请去掉

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260913-001（构建模块引入「分支浏览」子页签，`scripts/web/build.js` 的
  `renderBranchesPane()` 自始对除当前分支外的**所有**本地分支行渲染「推送」按钮，未对 main
  区分——`atb show REQ-20260913-001` 核验存在，状态 done）。该需求落定「发布是推送远端，
  构建是本地集成分支」语义时未同步收敛 main 行的推送入口；后续 BUG-20260914-011 在服务端
  `syncRemotes()` 落实「推送排除 main（main 归发布模块）」口径时，也未触及单分支推送按钮的
  UI 渲染条件，遗留本缺陷。

## 根因分析

`renderBranchesPane()`（scripts/web/build.js）「本地」分组渲染逻辑：

```js
const local = (b.local || []).filter((x) => x !== b.current).map((x) => `…
  <button … class="btn small quiet bld-push…" data-push="${esc(x)}" …>推送</button>…`)
```

过滤条件只有 `x !== b.current`（当前分支以「当前」行渲染、无按钮），对分支名不做任何区分，
main 在非当前分支时逐行获得与其他开发分支相同的「推送」按钮。而项目既有口径已明确 main
推远端归发布模块受控动作（REQ-20260913-001 语义边界；`build-git.mjs` `syncRemotes()` 推送时
跳过 main，注释「main：发布模块受控推送」；`git-flow.mjs` `ensureMainBranch` 补建 main 只建
分支不推送），该按钮成为绕开发布治理的多余入口。属渲染条件缺失，非数据层或服务端问题。

## 方案

**改动点（仅 UI 渲染条件）**：`renderBranchesPane()`「本地」分组渲染时，`main` 行不再输出
`data-push` 按钮（main 行本身保留，点击查看提交记录的只读浏览语义不变）；其余分支渲染、
`pushAttn` 高亮条件（BUG-20260914-006）、推送确认弹窗与执行链路全部不动。

**服务端是否封禁 main（README 期望行为「待确认」项，在此落定）**：**不封禁**，
`POST /api/build/push` / `build-git.pushBranch()` 维持通用受限写原语现状。理由：

1. 本 Bug 现象与验收均以「UI 入口移除」为准（README 验收 6 亦预期改动范围仅 build.js）；
2. `pushBranch()` 是与 UI 解耦的通用推送原语（推送确认框的「更新已有远端分支」等提示均依赖
   其通用性），服务端按分支名封禁属 API 契约变更，牵连面大于本 Bug；
3. 防「绕过 UI 直调接口推 main」属服务端治理增强，如需要应另登记需求单独评估，不与本 UI
   修复混做（与本 Bug 一并登记会突破验收 6 的改动范围口径）。

**边界场景口径（README 验收 4「待确认」项）**：除当前分支外本地仅剩 main 时，空远端引导
已由 BUG-20260914-011 的细分文案覆盖——同步后 `remoteSyncedEmptyHint()` 明确说明「本地没有
可自动推送的开发分支（main 由发布模块管理，不在此推送）」，不会引导用户去找不存在的按钮；
未同步时的既有文案以引导「⟳ 和远端同步」为主。本 Bug 不再改动该文案；「可在上方『本地』
分组推送分支」次要引导句是否随 main 按钮移除调整措辞，留人工验收时定夺（口径已可解释，
不阻塞）。

**开源选型（REQ-20260909-015）**：无合适库的原因——单行模板字符串的条件渲染改动，引入任何
前端渲染库的成本与依赖远高于自研两处条件表达式；未引入开源库，不创建 licenses.md。

## 实施记录

- 测试先行：新增 `scripts/tests/bug-branch-main-no-push-20260914-012.test.mjs`（vm 行为测试，
  载荷注入复用 BUG-20260914-006 测试的 setup 模式）——U1 多分支（当前 dev）main 行无按钮 /
  feat 行按钮属性不变；U2 main 为当前分支现状回归；U3 BUG-20260914-006 空远端 attn 高亮回归
  （非 main 分支仍高亮、main 行无按钮）；S1 源码静态断言推送链路仅收敛渲染条件。跑红后实现转绿。
- 实现：`renderBranchesPane()` 本地分组 map 内按 `x === 'main'` 条件省略按钮输出，附注释
  引用本 Bug 与「main 归发布模块」口径。
- **关联断言更新（验收 6 预期内）**：核查发现 README 验收 3「其 bld-push attn 断言基于 dev
  分支」与验收 6「现无针对 main 行推送按钮的断言」均与代码事实不符——`bug-remote-empty-explain-
  20260914-006.test.mjs` U2 与 `bug-sync-fetch-push-20260914-011.test.mjs` U4 场景一的载荷均为
  `current: 'dev', local: ['dev', 'main']`，其 `bld-push attn` 断言实际匹配的是 **main 行**的按钮
  （dev 为当前分支本就无按钮）。修复后按验收 3 的声明意图补非 main 开发分支 `feat` 使断言真正
  基于「dev/feat 等非 main 分支的推送按钮」：006 U2 载荷 local 补 `feat`；011 U4 场景一载荷补
  `feat` 并将失败分支 dev → feat（「高亮为重试出路」语义成立）。两文件其余用例未动。
- 回归：`node scripts/tests/run-all.mjs` 全量 229 个测试文件通过（0 失败）。

## 风险与边界

- i18n：按钮文案「推送 / Push」词条仍被 dev 等分支使用，无新增词条（README 期望行为 4）；
  main 行少一个文本节点不影响整句键词典。
- 回归面：仅分支行渲染；提交记录懒加载、同步按钮、远端分组渲染均不受影响（测试 U2/U3 及
  既有 `bug-remote-empty-explain-20260914-006` / `bug-sync-fetch-push-20260914-011` 回归覆盖）。
- 直调 API 推 main 仍可行（服务端不封禁，见方案落定），属有意保留的通用原语能力，防绕过
  治理另行立项。
