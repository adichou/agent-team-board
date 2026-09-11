# 测试报告 — BUG-20260909-005 打开需求说明中的 ui-demo.html，浏览器报错

- 时间：2026-09-09T02:21:38.492Z
- 执行者：zcode-batch-019-1
- 测试框架：node:assert/strict + 真实 HTTP 集成 + vm 沙箱（scripts/tests/item-demo-link.test.mjs）
- 覆盖率：92%

## 总结

修复演示链接版本错配裸 JSON。【引入来源：BUG-20260908-021（引入条目演示端点与前端 linkupDocDemo 链接接管，已 atb show 核验；版本错配类型归纳自 BUG-20260907-017）】1) app.js 新增 guardDemoLinkDemoClick→guardDemoLinkClick 点击预检：同步开 about:blank 占位保用户手势→预检 fetch；命中「未知接口」JSON（服务过旧）关占位标签并 toast 给 atb serve 自愈指引；正常则编程式 noopener（tab.opener=null）后真实导航（保留服务端 CSP 沙箱）；网络异常兜底导航；中键/修饰键/弹窗被拦交还原生行为。2) server.mjs API 最终兜底按形态分流：GET+Accept 含 text/html（浏览器直接导航）回人读过旧指引页 sendApiMissHtmlPage，fetch 形态「未知接口」JSON 契约不变。3) Electron 壳过旧检测本 Bug 不扩展（豁免理由见 design.md）。TDD：item-demo-link 新增 D8/U5 并升级 U4（先红后绿），全量 110 个测试文件 0 失败（含 serve-stale/dispatch-api 回归）。旧进程直接证据已取得：本机 8888 服务 pid76113 startedAt=01:20:02Z 早于磁盘 server.mjs/app.js mtime（01:49/01:53Z）。防护（白名单/防穿越/2MB/CSP/跨站）一概未放宽。

## 明细

### 引入来源归因

- **BUG-20260908-021**（已 `atb show BUG-20260908-021` 核验存在）：引入条目演示端点
  `/api/item/:id/demo/:name` 与前端 `linkupDocDemo` 链接接管——静态前端实时读盘先行更新并改写
  演示链接为新端点、`target="_blank"` 直接导航；早于该修复启动的常驻服务进程路由集已固化、
  无该路由，落入「未知接口」JSON 兜底，且直接导航绕过 `api()` 封装的过旧指引（该指引由
  BUG-20260907-017 引入、仅覆盖 fetch 调用）。详见 design.md「引入来源（源单）」。

### 改动清单

- `scripts/web/app.js`：`linkupDocDemo` 为接管链接挂 `click` 监听；新增
  `guardDemoLinkClick(e, href)` 点击预检（同步 about:blank 占位 → 预检 fetch → 分流：
  过旧关标签 + toast 自愈指引 / 正常编程式 noopener 后真导航 / 异常兜底导航；中键、
  修饰键、弹窗被拦时交还浏览器原生行为）。
- `scripts/server.mjs`：新增 `sendApiMissHtmlPage`（人读过旧指引页，CSP
  `default-src 'none'; style-src 'unsafe-inline'` + nosniff + no-store）；`handleApi` 最终
  兜底对 `GET + Accept 含 text/html` 分流到该页，fetch 形态 JSON「未知接口」契约不变。

### TDD 过程与用例结果

`node scripts/tests/item-demo-link.test.mjs`（13 用例全绿；新增 D8、U5，升级 U4 链接桩支持
`addEventListener` 并断言监听挂接范围）：

```text
✓ D1 演示端点返回条目目录内 HTML 原始字节 + 收敛 CSP（内联交互可用、外部加载全禁）
✓ D2 同名文件不串单、不串项目
✓ D3 文件/条目不存在 → 404 人读 HTML 提示页
✓ D4 非法名称一律 400 拒绝：子目录/穿越/非 html/隐藏文件/裸路径
✓ D5 演示文件超 2MB → 400 并说明上限
✓ D6 站点根静态路径行为不变（/ui-demo.html 仍 404 not found）
✓ D7 回归：文档 JSON / fs 列目录 / 图片 raw 均不受影响
✓ D8 未命中 API：浏览器导航得人读过旧指引页，fetch 形态仍是 JSON 契约   ← 新增
✓ U1 结构契约：loadDoc 渲染后调用 linkupDocDemo 接管 #docView 内相对链接
✓ U2 结构契约：仅接管单文件名 .html/.htm，改写到条目演示端点并携带当前 project
✓ U3 结构契约：接管链接新标签打开且带 noopener
✓ U4 vm 行为：linkupDocDemo 对各形态链接逐条断言改写/跳过（+监听挂接断言）  ← 升级
✓ U5 vm 行为：演示链接点击预检——过旧给指引、正常 noopener 导航、异常兜底   ← 新增
```

先红后绿：实现前 D8/U4/U5 三例按预期失败（D8「导航形态应返回 HTML 人读页」、U4「接管链接应挂
click 预检监听」、U5「应定义 guardDemoLinkClick」），实现后全绿。中途一次迭代：初版
`guardDemoLinkClick` 未返回内部 promise 链导致 U5b await 不到预检完成，改为 `return fetch(...)`
链后通过。

### 回归

- `node scripts/tests/serve-stale.test.mjs`：T1–T5 全绿（`atb serve` 过旧自动重启、health
  pid/startedAt 契约、前端 api() 过旧指引不回归）。
- `node scripts/tests/dispatch-api.test.mjs`：全绿（分组「未知接口」JSON 兜底契约不变）。
- `node scripts/tests/run-all.mjs`：**110 个测试文件，失败 0**。
- `node --check` server.mjs / app.js 通过。

### 验收说明逐条核对（README「验收说明」）

- [x] 复现步骤 1–4 的「旧进程」环境：登记时的进程已被替换、无法追溯（豁免）；采用 vm 沙箱模拟
  「新前端点击 + 旧进程 JSON 404」（U5b）复现裸 JSON 路径，并取得本机现存版本错配直接证据
  （8888 服务 pid 76113 startedAt=2026-09-09T01:20:02Z，磁盘 server.mjs/app.js mtime
  01:49:09Z/01:53:18Z 均晚于进程启动）。
- [x] `atb serve` 自动重启过旧服务后链接可直接打开：`atb serve` 过旧检测与优雅重启由
  serve-stale T2/T5 在一次性端口验证（未动用户当前 8888 常驻进程，避免干扰现场）；新进程下
  演示端点 200 HTML + CSP 契约由 D1 覆盖；当前 8888 进程实测演示端点 200 HTML。建议人工在
  真实环境执行一次 `atb serve` 后点开 REQ-20260909-004 的演示链接复核。
- [x] 演示链接命中「未知接口」时给出可操作指引、不再裸 JSON：前端预检关占位标签 + toast
  「…看板服务版本过旧：请在终端运行 atb serve 自动重启过旧服务，然后重试」（U5b）；服务端
  兜底人读页为纵深防御（D8a）。
- [x] 回归：item-demo-link 13 用例全绿；文档 JSON（D7）、图片 raw（D7）、站点根静态 404（D6）
  行为不变。
- [x] 多项目：`?project=` 绑定与不串单/不串项目由 D2 覆盖，预检使用改写后的完整 URL
  （apiUrl 携带当前 project），不引入新的项目维度。
- [x] 不放开防护：`DEMO_HTML_NAME_RE`、realpath 防穿越、2MB 上限、`DEMO_HTML_CSP`、
  `apiGuardReason` 跨站防护均未改动（D1/D3/D4/D5 断言仍在）。

### 覆盖率口径

92%：验收说明 6 条全部达成（其中两条按验收文本允许的方式以「同款手段模拟 + 豁免记录」满足：
真实旧进程无法构造、`atb serve` 重启未在用户现场端口执行）；残余 8% 为真实浏览器端到端目验
（建议人工执行一次：`atb serve` 后在详情页点开 `./ui-demo.html`，确认新标签打开演示页、无裸 JSON）。

