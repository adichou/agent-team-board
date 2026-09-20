# 设计 — REQ-20260911-008 去新建 Zcode 或 Codex 会话自动拷贝最新的提示词

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

见 README：任务抽屉头部「去新建 Zcode / Codex 会话」（BUG-20260910-005 引入）原本只跳深链，
提示词需另走「创建时复制 / 重新复制」，两步之间剪贴板易被覆盖。本需求把两步并一步：
点击链接 → 自动复制当前面板最新主调度提示词 → 再触发既有深链；打开后仍人工粘贴发送。

## 方案

纯前端行为接线（`scripts/web/app.js`），不改深链语义、不加后端接口、不动面板提示词分区。

- **新增 `copyPromptAndOpenSession(agent, url)`（async）**，bindBatchDrawer 的 `[data-new-session]`
  处理器在守卫通过、构造深链 URL 后 fire-and-forget 调用：
  1. 取材（与各面板提示词分区、「重新复制」同源）：
     - 批量完善：`state.refine.data.batch.prompt`；
     - 批量 Commit：`state.commit.data.batch.prompt`；
     - 批量开发（含存量 codex 深链面板，待确认项定案见下）：`GET /api/batch/prompt`
       （解析队首批次，不新建批次；存量提示词按 BUG-20260910-001 归一口径）。
  2. 复制完成后才 `location.href = url`（先复制后跳转，保证剪贴板写入发生在用户手势链上；
     zcode 仍 `workspace/open`、codex 仍 `threads/new?path=`，均不带 prompt）。
  3. toast 四分支：成功「✓ 已复制提示词并请求打开 XX（项目）：请在新建会话中粘贴发送」；
     复制失败 / 获取失败（含原因）→ 错误 toast + 回面板「重新复制」补救指引；空态
     「当前面板暂无任务提示词，请先创建任务」。失败/空态深链均照常打开（打开不依赖提示词）。
- **处理器保留在 bindBatchDrawer 内**：守卫（未选项目 / 未检测到宿主 → 同步 toast、不导航不复制）
  与深链 URL 构造原位不动（BUG-20260910-005 零回归口径，workspace-entry W11 契约不变）；
  点击仍不切页签、不重渲染、不动批次与队列，鼠标与键盘 Enter 一致（preventDefault 单一路径）。
- **防重复点击**：模块级 `sessionEntryBusy` 标志，在途点击（等待取材/剪贴板）直接忽略，
  finally 复位；**GET 失败单次尝试不自动重试**（避免重试风暴与重复导航，补救走面板「重新复制」）。
- **title 口径**：正常态链接 title 更新为「自动复制当前面板最新主调度提示词后打开 XX（项目）…」
  （保留 zcode「深链只打开工作区，会话需手动新建」与 codex「不会自动发送」措辞）；
  守卫态 title / 禁用态视觉与位置零改动。
- **i18n**：新增 6 条动态 + 2 条静态词条（`scripts/web/i18n.js` EN / EN_DYNAMIC），
  删除 4 条被替换的旧文案词条；i18n-coverage / i18n-dict 卡点通过。

### 待确认项定案（README「待确认」，开发前口径）

- 复制失败仍触发深链打开（打开是链接本职，失败已显著提示）——按 README 默认口径执行。
- 面板无任务时仍打开会话 + toast 提示先创建任务——按 README 默认口径执行。
- 存量 codex 深链面板（入口已隐藏、代码保留）：**同批量开发口径**（GET /api/batch/prompt），
  理由：该面板语义即批量开发的 codex 变体，与面板既有取材一致、代码最简。
- GET 失败重试：不做自动重试（见上）；防重复点击见 busy 标志。

### 影响面

`scripts/web/app.js`（newSessionLinksHtml title、bindBatchDrawer 处理器、新增 helper）、
`scripts/web/i18n.js`（词条增删）、测试（新增 `session-entry-copy-20260911-008.test.mjs`；
`session-entry-20260910-005` / `workspace-entry-20260910-002` 点击用例异步化适配）。
深链构造、宿主探测状态机、面板提示词分区与「重新复制」均不动。

## 开源选型（REQ-20260909-015）

自研，无新增依赖、未引入开源库：本需求是既有页面内行为接线（复用项目内 `copyDispatchText`
（navigator.clipboard 封装）、`api`、`toast` 与既有深链常量），无成熟通用库可替代该业务耦合逻辑；
引入剪贴板 polyfill 类库收益为零（目标环境为看板常驻浏览器/Electron webview，原生 API 可用，
失败路径已有明确 toast 与人工补救）。

## 风险与边界

- **用户手势与异步剪贴板**：批量开发面板多一次 GET 后再写剪贴板，个别浏览器可能因瞬态激活
  过期使 `navigator.clipboard.writeText` 失败——按设计走「复制失败」错误 toast + 回面板
  「重新复制」补救，不静默、不阻断深链打开；完善 / Commit 面板提示词为同步取材，无此窗口。
- **深链语义承诺不变**：不注入、不自动发送提示词（zcode 只打开工作区、codex 不传 prompt），
  自动化的仅「拷贝到剪贴板」一步；title/toast 均不宣称自动新建/创建会话。
- **无任务/存量批次缺失提示词**：不复制、不报错，深链照常打开并提示先创建任务。
