# 设计 — BUG-20260923-001 点击人工确认页面的关闭按钮和右上角的叉按钮都无法关闭，只有刷新才能关闭

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260914-001（编号已经 `atb list` 核验存在，状态 done）
- 说明：挂起确认侧拉面板落地时，三个关闭入口（`#confirmPanelClose` 头部 ✕、表单内
  `#confirmPanelCancel` 底部「关闭」、Esc 关闭链中的挂起确认面板层）全部写成
  `if (!confirmSide.busy) closeConfirmPanel()`，注释即「REQ-20260914-001：挂起确认面板层
  （确认中暂不可关闭）」。当时确认是同步请求、busy 只持续数秒，门控无感；后续
  BUG-20260915-008 把开发侧确认 / 核验改为服务端异步任务（前端 `watchConfirmTask` 轮询至
  终态），BUG-20260918-004 又把观察窗口放宽到任务超时口径（默认约 60 分 20 秒），busy
  长期 / 潜在永久为 true，原门控演化为「按钮可点但静默无响应、只能刷新」。
- 佐证：`scripts/web/app.js` 行内注释 `REQ-20260914-001：挂起确认面板层（确认中暂不可关闭）`、
  `REQ-20260914-001：挂起确认面板头部关闭`；两放大单 BUG-20260915-008 / BUG-20260918-004
  均经 `atb list` 核验存在（状态 done）。

## 根因分析

1. **关闭入口被 busy 静默门控**：`closeConfirmPanel()` 本身无条件可用，但三个入口都在调用前
   加了 `if (!confirmSide.busy)`，busy 期间点击被吞掉——按钮不禁用、不提示、无任何反馈。
2. **busy 持续时间失控**：开发侧「确认并继续」自 `confirmContinueAction` 起
   `confirmSide.busy = true`，随后 `await watchConfirmTask(...)` 观察窗口 = 任务超时 + 20 秒
   （服务端默认按 `timeoutMin` ≈ 60 分钟计），期间面板完全不可关；但关闭面板并不会中断
   服务端任务（closeConfirmPanel 仅隐藏面板并丢弃迟到响应，刷新页面等效于关闭），门控在该
   场景没有保护意义。
3. **附带风险成立**：`api()` 基于原生 `fetch`、无超时，分析侧同步确认 / 答案保存等请求悬挂时
   `confirmSide.busy` 永久滞留 true，面板同样无法关闭。

## 方案

前端 `scripts/web/app.js` 修复（服务端任务编排不变——关闭面板本就不影响服务端任务）：

1. **解除三入口 busy 门控**：`#confirmPanelClose`、`#confirmPanelCancel`、Esc 链中的挂起确认
   面板层改为无条件 `closeConfirmPanel()`。已受理的确认 / 核验任务在服务端照常执行，进度与
   终态结论由主轮询（`refreshConfirms` 随 `poll` 刷新任务页卡片）回填；重开面板时
   `renderConfirmForm` 依据服务端任务运行态（`state.confirms.busyId` / `d.task.status ===
   'running'`）推导出正确的忙态与禁用按钮，与实际一致。
2. **busy 生命周期收口**：`closeConfirmPanel()` / `openConfirmPanel()` 复位
   `confirmSide.busy`——关闭或重开后忙标志不再长期 / 永久滞留；面板内动作（保持挂起 / 保存
   草稿 / 确认并继续）记录动作所属面板代（`confirmSide.seq` token），迟到回包在面板已关闭 /
   重开 / 切换条目后不再复位新面板的忙标志、按钮与消息（`refreshConfirms` 等全局刷新保留）。
3. **长观察期止损**：`watchConfirmTask` 增加可选停止谓词，开发侧确认观察期间面板被关闭 / 切换
   即停止轮询（服务端任务不受影响，结论由主轮询回填），不再空转最长 60 分钟。
4. **请求悬挂止损**：面板动作请求（keep / answer / continue）统一经 `confirmReqOpts` 加 60 秒
   客户端超时（`AbortSignal.timeout`，环境不支持时优雅降级为无超时，不阻断动作）；超时按
   「请求超时（60 秒无响应）」可重试错误呈现，`confirmReqErr` 把 `TimeoutError / AbortError`
   归一为人话文案，忙标志与按钮不会因悬挂请求永久停在「进行中」。
5. **文案**：新增动态片段「请求超时（◇ 秒无响应）」进 `scripts/web/i18n.js` 的 EN_DYNAMIC
   （中英同步，BUG-20260912-001 口径）；其余既有文案不变。

**开源选型（REQ-20260909-015）**：本修复为纯前端时序 / 门控逻辑修正，仅使用浏览器原生
`AbortSignal.timeout` 平台能力，未引入第三方库（无合适库的原因：改动点是既有代码内部的
状态门控与请求超时接线，属一次性逻辑修正，引入库反而增加依赖面）。

## 风险与边界

- **迟到回包与重开面板的竞态**：以 `confirmSide.seq` 面板代 token 隔离——旧动作的 finally /
  消息写回仅在同代面板上生效；跨代只保留 `refreshConfirms` / `toast` 等全局副作用，不写面板
  局部状态。分析侧确认成功后的续跑提示词自动复制同样仅在同代面板触发（重开面板本就提供显式
  复制入口，不自动覆盖剪贴板）。
- **超时误报**：60 秒超时只作用于面板动作请求（keep / answer / continue 均为快速落账请求，
  开发侧 continue 是「受理即返回任务句柄」的异步形态）；若服务端稍后实际完成，结论仍由轮询
  回填，超时提示自带「可重试」，与刷新页面的既有语义一致。
- **范围边界**：编辑面板（editSide）/ 人工决策面板（holdSide）的 busy 暂不可关闭行为不在本单
  范围（其 busy 仅覆盖秒级保存请求，未接入长任务观察窗口）；如需对齐应另行登记。
- **Esc 链序不变**：挂起确认面板层仍在编辑 / 决策面板之后、项目面板之前的既有层级，仅去掉
  busy 门控。
