# 设计 — BUG-20260909-005 打开需求说明中的 ui-demo.html，浏览器报错

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：**BUG-20260908-021**（已 `atb show BUG-20260908-021` 核验真实存在，状态 in-progress 待人工确认）
  ——该修复引入了条目演示端点 `/api/item/:id/demo/:name` 与前端 `linkupDocDemo` 链接接管：静态前端
  实时读盘先行更新，把 README 里的 `./ui-demo.html` 改写到新端点并 `target="_blank"` 直接导航；
  而早于该修复启动的常驻服务进程路由集已固化、没有该路由，请求落入「未知接口」JSON 兜底，且直接
  导航不经前端 `api()` 封装（BUG-20260907-017 引入的过旧指引只覆盖 fetch 调用），用户在新标签看到
  的就是无指引的裸 JSON。版本错配类型本身由 BUG-20260907-017 归纳（路由启动时固化 vs 前端实时读盘）。

## 根因分析

三层叠加（均为静态核实，行号为修复时点）：

1. **版本错配（类型根源）**：常驻服务进程路由集在启动时固化，静态前端（`scripts/web/`）每次请求
   实时读盘——代码更新后旧进程缺新路由，新前端却已引用（BUG-20260907-017 归纳，`/api/health`
   暴露 pid/startedAt 供 `atb serve` 判旧）。
2. **链接形态放大**：`linkupDocDemo`（`scripts/web/app.js`）改写后的演示链接是 `target="_blank"`
   直接导航，绕过 `api()` 封装——`api()` 对「未知接口」类 404 会附「看板服务版本过旧：请在终端
   运行 atb serve…」指引，但只覆盖 fetch 调用；直接导航命中旧进程兜底时，用户只看到
   `{"error":"未知接口：…"}` 裸 JSON，无任何可操作反馈。
3. **自愈通道需用户触发且入口缺失**：`atb serve` 的过旧自动重启（比对磁盘 mtime 与 health
   startedAt）已存在，但报错页面上没有指向它的指引（演示端点自己的人读提示页只覆盖路径形态非法
   场景，且同样只存在于新代码中）。

**直接证据（修复阶段核实，回应 README「待确认」）**：本机 8888 端口常驻服务 pid 76113、
startedAt `2026-09-09T01:20:02Z`，磁盘 `scripts/server.mjs` mtime `01:49:09Z`、`scripts/web/app.js`
mtime `01:53:18Z` 均晚于进程启动约 29–33 分钟——「旧进程 + 新前端」版本错配在本机真实存在、可持续
复现。报错当时的进程已被替换（当前进程启动晚于 BUG-20260908-021 交付，演示端点实测 200 HTML），
登记时刻的 pid/startedAt 已无法追溯（豁免说明）；复现采用 serve-stale 同类手段：以 vm 沙箱模拟
「链接改写后的新前端点击 + 旧进程 JSON 404 响应」（U5b），并保留真实服务端集成断言（D8）。

## 方案

只有静态前端保证永远最新（旧进程代码无法追溯修改），因此**前端点击预检为主修复**，服务端兜底
人读化为纵深防御：

1. **前端（`scripts/web/app.js`）**：新增 `guardDemoLinkClick(e, href)`，`linkupDocDemo` 为每个
   接管链接挂 `click` 监听：
   - 仅拦截普通左键（中键/修饰键/已 prevented 不动，保留浏览器原生行为）；
   - 点击时**同步** `window.open('about:blank', '_blank')` 占位（保住用户手势，避免异步后再开窗
     被弹窗拦截；拿不到占位标签则不 `preventDefault`，交还原生 `target=_blank` 导航）；
   - 预检 `fetch(href)`：
     - 2xx → `tab.opener = null`（编程式 noopener，等效既有 `rel=noopener` 防护）后真实导航——
       由浏览器加载服务端带 CSP 沙箱的响应，**不用** `document.write` 注入（那会丢失响应头 CSP）；
     - 命中「未知接口」类 JSON 404（服务过旧）→ 关闭占位标签（不给用户留裸 JSON 新标签），
       错误 toast 给出与 `api()` 同口径的自愈指引（运行 `atb serve` 后重试）；
     - 网络异常等其他结果 → 兜底直接导航占位标签（服务端人读提示页/演示页，与旧版直开等价）。
   - 代价：正常路径演示文件被请求两次（预检 + 导航），本地 no-store、≤2MB，可忽略。
2. **服务端（`scripts/server.mjs`）**：`handleApi` 最终兜底对「浏览器直接导航形态」（GET 且
   `Accept` 含 `text/html`；fetch 默认 `Accept: */*`）返回人读 HTML 过旧指引页
   （`sendApiMissHtmlPage`：说明接口未命中 + 可能版本过旧 + `atb serve` 自愈 + 返回看板；
   CSP `default-src 'none'; style-src 'unsafe-inline'` + nosniff + no-store，与 `sendDemoHtmlPage`
   同口径）。意义：**从本版起**运行的进程未来变旧时，任何直接导航的链接（含演示链接在新前端的
   预检兜底路径）都降级为人读指引页而非裸 JSON；fetch 形态 JSON 契约不变。
3. **Electron 壳范围（README「待确认」评估，本 Bug 不扩展）**：`electron/service.mjs` 的
   `ensureService` 探活复用确无过旧检测，但复用外部服务时壳不拥有其生命周期（`stopService`
   明确不 kill 复用实例），自动重启他人服务与「终端已起服务时 GUI 直连不冲突」的复用语义相悖，
   且需处理并发重启竞态；`atb serve` 自愈通道 + 前端预检指引已覆盖本 Bug 场景。如需壳内无感
   自愈，另立需求（豁免记录）。

## 风险与边界

- **防护一概不放宽**：`DEMO_HTML_NAME_RE` 白名单、realpath 防穿越、2MB 上限、`DEMO_HTML_CSP`、
  跨站防护（`apiGuardReason`）全部原样；演示页仍只能经端点加载（享受响应头 CSP 沙箱）。
- **noopener 等效保持**：`tab.opener = null` 后再导航，演示页 `window.opener === null`，与
  `rel=noopener noreferrer` 同口径（U5c 断言）。
- **JSON 契约不变**：fetch 形态（无 `Accept: text/html`）的「未知接口」JSON 原样返回，
  `dispatch-api.test.mjs` 等既有断言不回归；分组兜底（`/api/fs` 等）不动，仅最终兜底分流。
- **人读兜底页的判定面**：仅 `GET + Accept 含 text/html`，与浏览器地址栏/`target=_blank` 导航的
  请求特征一致；本插件前端 `api()` 的 fetch 不显式带该 Accept，不受影响。
- **预检竞态**：预检与真实导航之间演示文件被删除/变更，导航结果即最新状态（人读 404 提示页），
  无一致性风险（只读端点）。
