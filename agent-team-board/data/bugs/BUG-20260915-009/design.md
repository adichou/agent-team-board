# 设计 — BUG-20260915-009 需求模块的 AI 开发和 AI 分析按钮，点击后要分别精准跳到任务模块中的 AI 开发和 AI 分析的页面

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260909-007（已接受 / 已计划列表头快捷按钮按档跳「AI 分析 / AI 开发」，编号经
  `atb list` 核验存在）。缺陷为组合性：快捷入口经 `gotoRuns`（任务模块页面化，REQ-20260907-004 引入）
  仅置 mode，落地呈现依赖 `refreshRefine` / `refreshBatch` 内的 `renderBatchDrawer`；两处签名剪枝
  （refine 面板链路随 REQ-20260907-003 引入、develop 分支同法）在数据稳态时提前 return 不重渲染，
  落地停留在离开前残留的另一子面板。git 历史为单次 squash 提交（6f2ead6）无法按提交细分，归因以
  代码内 REQ 标注与既有测试文件（scripts/tests/lane-quick-entry-20260909-007.test.mjs）为准。

## 根因分析

- 离开任务模块时 `setView` 仅隐藏 `#runsView`，`#batchDrawer` 保留最后一次渲染的子面板 HTML；
- `gotoRuns(mode)` 正确设置 `state.batch.mode`，但落地呈现依赖 `refreshBatch()` → `refreshRefine()` /
  批量开发分支内的 `renderBatchDrawer()`；数据稳态时签名剪枝命中（`if (sig === state.refine.sig) return;`
  / `if (sig === state.batchSig) return;`）提前返回，不触发重渲染 → 残留的另一子面板（错误页签高亮 +
  错误内容）成为落地页；
- 首次进入（签名初值空）与目标面板数据变化时签名必然不同、正常渲染，与「间歇性出现」的观察一致；
- 手动点页签走无条件 `renderBatchDrawer()`，故手动切换始终有效。

## 方案

- 修复（已实施）：`gotoRuns` 在 `setView('runs')` 之前按当前 mode 无条件 `renderBatchDrawer()` 一次——
  进入任务模块的瞬间即呈现目标子面板（目标页签高亮 + 面板内容；无缓存数据时面板自身呈现
  「加载中…」，满足 README「进入时呈现正确子面板不得依赖数据是否变化」）；随后的 `refreshBatch()`
  数据刷新仍走既有轮询与签名剪枝（不打断面板内输入），手动页签切换与完善徽标 / 全局总览共用
  `gotoRuns` 链路同步受益。
- 开源选型（REQ-20260909-015）：纯前端导航时序修复（进入时一次强制渲染，改动 5 行含注释），无开源库
  可替代（涉及本项目私有渲染 / 剪枝状态机），自研；未引入开源库，不创建 licenses.md。

## 风险与边界

- `gotoRuns` 仅由显式导航入口触发（快捷按钮 / 完善徽标 / 全局总览跳转 / Codex 存量深链），触发时用户
  不在任务面板内输入，进入时的一次重渲染不会打断输入；二级页签记忆（`state.batch.pane` /
  `state.refine.pane`）不重置，渲染后恢复原分区。
- 轮询签名剪枝完全保留（测试 R5 静态契约守护）：数据刷新仍由签名驱动，轮询频率与请求面不变。
- 纯导航口径不变：无 `/api/batch/create`、`/api/refine/start` 等创建 / 启动请求，无确认弹窗（R4 断言）。
