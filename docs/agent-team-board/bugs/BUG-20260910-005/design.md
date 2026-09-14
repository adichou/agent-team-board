# 设计 — BUG-20260910-005 打开 XX 工作区改为去新建 XX 会话

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260910-002（经 `atb list` 核验存在，in-progress）。该需求把两端入口实现为
  提示词分区底部的「打开 Zcode 工作区 / 打开 Codex 工作区」按钮；用户原始反馈（要求入口在
  「批量开发」页签旁、以「去新建 XX 会话」超链接呈现并携带当前项目目录）未按位落实，形成本 Bug。

## 根因分析

- REQ-20260910-002 实现时将入口挂在提示词分区底部工具行（`workspaceOpenRowHtml`），
  入口位置（反馈要求在一级页签旁）、形态（要求文字超链接而非按钮）与文案（「去新建 XX 会话」）
  均与原始反馈不一致；且探测态只有「未知/明确缺位」两档，缺少「正在检测」「检测失败可重试」
  的可见状态，未知态直接回落为可点按钮。
- Zcode 侧能力边界：官方深链仅 `zcode://workspace/open?path=`（打开/聚焦工作区，无会话创建
  参数），未核实到可自动新建会话的通道；此前 title 已注明需手动新建，本次迁移必须保留该口径，
  不得因文案改为「去新建 Zcode 会话」而宣称深链会自动新建会话。

## 方案

**开源选型（REQ-20260909-015）**：未引入开源库。理由：无合适库——本修复为既有纯前端渲染/
绑定代码内的入口迁移与三态（探测中/已知/失败）展示，全部由现有 vanilla JS + CSS 变量实现，
无外部依赖诉求；引入库成本高于自研。

实现要点（scripts/web/app.js / style.css）：

1. **位置与形态迁移**：`renderBatchDrawer` 头部在 `nav.batch-modes`（批量完善/批量开发页签）
   之后渲染 `newSessionLinksHtml()`；入口为 `<a class="ws-entry-link">` 文字超链接
   （「去新建 Zcode 会话」「去新建 Codex 会话」），CSS 下划线链接样式与页签胶囊区分、留出间距；
   原 `workspaceOpenRowHtml` 及提示词分区底部两按钮整体删除，不重复出现。
2. **状态机**（state.workspaceApps 补 probing/failed）：探测中/首帧未知显示「正在检测」，
   不把未知当未检测到；探测成功置 loaded 渲染链接（未检测到的端禁用 + 可见「（未检测到）」
   说明，title 留「非默认路径」余地）；探测失败（通道故障 ≠ 未安装）显示失败说明 +
   「重新检测」（force 重试）+ 手动打开指引；探测异步进行，不阻断页签与提示词复制。
   探测结束（成功/失败）各重渲染一次刷出最终态。
3. **交互**：统一 `data-new-session` 绑定，preventDefault 后按**点击时**的 `state.project`
   构造深链（zcode → `workspace/open?path=`、codex → `threads/new?path=`，全量
   encodeURIComponent，不传 prompt），鼠标与键盘（Enter 触发 click）同路径；点击不切页签、
   不重渲染、不动批次与队列；未选项目/未检测到时点击仅 toast 说明原因、不导航；成功触发只
   toast「已请求打开…」（浏览器无法确认外部应用启动结果，不宣称会话创建成功）。
4. **Zcode 能力口径**：title/提示明确「深链只打开工作区，会话需手动新建并粘贴提示词」，
   不宣称自动新建；Codex 走 threads/new 落新会话输入框，同样不自动发送。

## 风险与边界

- Zcode 真实新建会话通道仍未核实：本修复只保证入口/状态/口径正确，`workspace/open` 是否
  落到新会话需实机验证（见 test-report 人工项）；受限口径已如实告知手动新建步骤。
- 深链宿主探测仍只覆盖 macOS 默认安装路径（`/Applications/ZCode.app`、`/Applications/ChatGPT.app`，
  见 dispatch.mjs `detectWorkspaceApps`）；非默认路径/非 macOS 在禁用态留有说明与手动指引，
  探测范围扩展留待后续需求。
- 未检测到入口「禁用保留 + 可见说明」为本次取舍（README 待确认项）；如人工验收倾向隐藏，
  只需调整 `newSessionLinksHtml` 渲染分支，状态机与绑定不受影响。
- 浏览器无法感知外部 app 启动结果：所有成功提示均限定「已请求打开」，避免误导。
