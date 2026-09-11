# 设计 — REQ-20260906-018 批量实施入口改造：已接受列多选后进入，移除顶栏按钮

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

顶栏「⚡ 批量实施」按钮与列内容无关，且入口语义与 REQ-20260906-017（批量接受）落地的「列内多选」形态不一致。017 最终形态：待接受列常驻操作栏（全选 / 已选 N / 接受所选），卡片常驻复选框，控件同步不重建卡片。本条目把批量实施入口迁到已接受列，多选采用「模式式」交互（README 明确要求进入/退出多选模式），入口位置与控件样式跟随 017；共用抽屉（REQ-20260906-002 Zcode 批次 / 003 Codex 自动派发）内部功能不回退，仅入口与候选范围改变。

## 方案

### 前端（scripts/web/index.html、app.js、style.css）

- **index.html**：移除顶栏 `#btnBatch` 按钮及 app.js 中对应事件绑定；顶栏不再有任何批量实施入口。
- **已接受列工具栏**（buildColumn('accepted')，位置与结构对齐 017 的 accept-toolbar，位于列头与卡片区之间）：
  - 模式关：显示 `#implEntry`「⚡ 批量实施」按钮（btn primary）。
  - 模式开：显示选择确认条 `#implAll` 全选 + `#implCount`「已选 N」+ `#implGo`「进入批量实施」（0 项禁用并以 title 提示原因）+ `#implCancel`「取消」。
- **卡片复选框**：已接受卡片常驻渲染 `data-impl-id` 复选框（与 017 的 submitted 卡片同构），默认 `display:none`；进入模式给列加 `impl-selecting` 类后显示，其他列不出现。模式切换只 toggle 列类并同步控件，不重建卡片（保持 017 的焦点友好策略与按列增量渲染）。
- **状态**：`state.impl = { mode, selected:Set, colEl, scopeActive, scopeSig }`。
  - 可实施资格 = `status==='accepted' && !owner`（与后端 candidateItems 一致）。
  - 每次看板渲染后 `syncImpl()`：剔除失效勾选（被认领/离开已接受）并 toast「X 已不在可实施状态，已从选择中移除」；同步计数、全选三态、按钮禁用、卡片 selected 态。
- **Esc 链**：批量抽屉 → 新建弹窗 → 详情抽屉 → 退出多选模式（模式是看板态，优先级低于各遮罩层）。「取消」与 Esc 一样退出模式：清空选择、不开抽屉。
- **范围同步（scopeActive）**：点「进入批量实施」时置位，此后勾选集合的任何变化（增删/全选/清空/失效剔除/退出模式）以去重签名增量 POST `/api/dispatch/scope`；退出模式或清空选择推送空集合（服务端清除，恢复默认全部已接受）。切换项目先向旧项目推送清除再重置状态。
- **Zcode 批次页**：多选模式有勾选时，`/api/batch/current` 轮询带 `?ids=`，创建面板显示「本批范围：勾选 N 项」（与未过滤展示可区分，含可入批数避免静默歧义），批次上限输入默认值取勾选数；「创建批次并复制提示词」请求体带 `ids`。既有「未结束批次幂等返回同一批次」语义不变（README 要求不回退）。
- **Codex 自动派发页**：`/api/dispatch/status` 返回 `scope` 时显示「本批范围：勾选 N 项（仅派发勾选条目；清空选择或关闭自动派发后恢复全部已接受）」；waiting 新增 `scope-empty` 文案。

### 后端

- **batch.mjs `createBatch({ids})`**：候选 = 规范候选序（req 优先→创建时间→编号，仅 accepted 未认领）∩ ids；ids 缺省时 limit 取默认，显式集合时 limit 缺省取集合大小（夹 1–100）；勾选集合经资格过滤后为空给明确错误「勾选的条目均不可入批（可能已被认领或离开已接受状态）」。批次账本结构不变。
- **server.mjs**：
  - `POST /api/batch/create` 透传 `body.ids`；
  - `GET /api/batch/current` 支持 `?ids=`（逗号分隔），创建面板 stats（候选/受阻）按集合过滤；
  - `POST /api/dispatch/scope {ids}`：设置/清除项目级派发范围（空数组清除），返回生效 scope。
- **scheduler.mjs**：`S.scope = {ids, at} | null`（内存态，服务重启自然恢复默认）。`setScope(ids)` 归一去重（上限 500）；`selectCandidate()` 仅在范围内选单，范围为空 waiting `{kind:'scope-empty'}`；`status()` 暴露 scope；`disable()`（关闭自动派发）清除 scope——对应 README 的两个恢复默认条件。

### 既有测试更新（随需求一并改）

- `batch-ui.test.mjs` U1、`codex-ui.test.mjs` U1：顶栏按钮断言改为「顶栏无批量实施按钮；入口在已接受列」。

## 风险与边界

- **Codex scope 是服务内存态**：服务重启后恢复默认「全部已接受」。界面以 `/api/dispatch/status` 的 scope 为准明示当前范围，不产生静默歧义；自动派发重启后本就默认关闭待人工开启，风险有限。
- **Zcode 批次幂等**：存在未结束批次时重复创建返回旧批次（既有语义），面板按旧批次展示；README 明示不回退，界面的范围行仍标明当前勾选。
- **勾选与认领竞态**：勾选集合在前端按 board 数据剪枝，批次创建与调度选单在服务端再次核验资格（accepted 未认领），双层过滤，竞态下自然出局。
- **抽屉内既有功能**：批次提示词、执行账本、Codex 预检/开关/停止/恢复/日志的接口与渲染不动，仅新增范围行与 ids 参数。

## 实施记录（2026-09-06）

- **改动文件**：`scripts/web/index.html`（移除 `#btnBatch`）、`scripts/web/app.js`（impl 状态与工具栏、卡片复选框、syncImpl/pushImplScope、Esc 链尾、Zcode/Codex 范围行与 ids 参数）、`scripts/web/style.css`（.impl-toolbar/.impl-check）、`scripts/lib/batch.mjs`（createBatch ids）、`scripts/lib/scheduler.mjs`（S.scope/setScope/选单过滤/disable 清除/status 暴露）、`scripts/server.mjs`（batch/current?ids=、batch/create ids、POST /api/dispatch/scope）。
- **新增测试**：`scripts/tests/impl-entry-ui.test.mjs`（E1–E10，vm 模拟 DOM）、`scripts/tests/impl-scope.test.mjs`（S1–S6，lib+HTTP+假 CLI 调度）；**更新契约**：batch-ui U1、codex-ui U1（顶栏按钮断言反转）、detail-close-btn T3（Esc 链按 018 扩展，closeDrawer 距离阈值放宽并加 exitImplMode 断言）。先红后绿全过。
- **实现修正（TDD 中发现）**：pushImplScope 最初把数组直接当请求体（服务端读 body.ids 为 undefined），改为 `{ids}`；推送失败时回滚 scopeSig 允许下次同步重试。
- **测试稳定性**：impl-scope 早期在用例全过后偶发进程崩溃——残留假 CLI 子进程异步回写 stderr 与 rmSync 临时目录竞态；按 scheduler.test.mjs 惯例改为 `s.stop()` 不删目录，连跑三次稳定。
- **全量回归**：36 个测试文件仅 `detail-close-btn.test.mjs` T2 失败，为已登记存量 BUG-20260906-011（批量抽屉旧内联布局连带），范围外保持不动（与 017 实施时同口径）。
- **浏览器实测**（内置浏览器 + 8888 实服务）：顶栏无批量实施按钮；已接受列「⚡ 批量实施」入口进入多选（15 张卡片出选择框、其他列无）；勾 2 项计数/按钮/卡片高亮正确；进入抽屉后 Zcode 页显示「本批范围：勾选 2 项」、上限默认 2，Codex 页显示范围提示（服务端 scope 确已生效）；Esc 先关抽屉（模式保留）、再 Esc 退出模式且服务端 scope 自动清空。
- **服务重启说明**：8888 服务进程早于本次后端改动，实施完成后已优雅重启加载新代码；按重启恢复语义，本项目 Codex 自动派发恢复为关闭（等待人工重新开启——重启前也因 REQ-018 认领占用而未在派发）。

## 修订记录（2026-09-06 人工反馈：与批量接受交互保持一致）

人工验收反馈「已接受界面的批量实施功能要和批量接受的交互保持一致」——首版采用的「入口按钮 → 进入多选模式 → 选择 → 进入/取消」模式式交互与 017 的常驻形态不一致，按反馈改为**常驻交互**（无模式）：

- **已接受列工具栏常驻**（与待接受列 accept-toolbar 同构同位）：`全选 + 已选 N + 进入批量实施`；删除入口按钮、选择条显隐切换与「取消」。
- **已接受卡片复选框常驻**（与待接受卡片同款 `.accept-check`），无需任何模式开关；卡片选中高亮 `.card.selected` 保留。
- **0 勾选点「进入批量实施」**：以默认范围（全部可实施条目）打开抽屉——按钮不再禁用，避免抽屉（批次创建/执行账本查看）不可达；有勾选时范围=勾选集合，行为与首版一致（scope 推送、ids 建批、失效剪枝、范围行明示均保留）。
- **Esc 链还原**为：批量抽屉 → 新建弹窗/详情抽屉（detail-close-btn T3 契约同步还原；不再有退出模式分支）。
- **附带修复**：创建面板轮询签名（batchSig）未含 `stats`，导致无批次时切换勾选范围统计不刷新、抽屉残留旧范围行/上限值——stats 计入签名，新增 E11 用例覆盖。
- 测试：E1–E10 重写为常驻形态 + E11 新增，先红后绿；全量 37 文件仅存量 BUG-20260906-011(T2) 失败。浏览器复测：常驻工具栏/复选框、勾选→范围行+上限=勾选数、清空→默认范围（候选 11）+上限 20、Esc 关抽屉勾选保留，全部通过。


