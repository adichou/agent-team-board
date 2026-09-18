# BUG-20260909-005 打开需求说明中的 ui-demo.html，浏览器报错

- 状态：in-progress（修复已实施，待人工确认；见 design.md / test-report.md）
- 归属：独立 Bug（引入来源见 design.md）
- 引入来源：BUG-20260908-021（引入条目演示端点与前端 `linkupDocDemo` 链接接管：新前端把演示链接改写到新端点并新标签直接导航，早于该修复启动的常驻服务进程缺该路由，落入「未知接口」JSON 兜底，且直接导航绕过 `api()` 的过旧指引）
- 创建：2026-09-09T00:20:37.197Z

## 现象

在看板打开 REQ-20260909-004 需求详情，点击 README「界面展示」节的 `[./ui-demo.html](./ui-demo.html)` 链接，新标签页未渲染演示页，而是显示一段裸 JSON 错误：

```json
{
    "error": "未知接口：GET /api/item/REQ-20260909-004/demo/ui-demo.html"
}
```

新标签的实际地址已是改写后的演示端点形态（`http://127.0.0.1:8888/api/item/REQ-20260909-004/demo/ui-demo.html?project=<本项目>`，默认端口 8888），即前端链接接管生效、命中了正确 URL；报错来自服务端路由未命中后的兜底 `sendJson(res, 404, { error: '未知接口：…' })`。

2026-09-09 静态核实（均可在当前源码复核）：

- 该 GET 路径与当前代码的演示端点正则完全匹配（`scripts/server.mjs` 第 1748 行 `demoMatch`，`^\/api\/item\/([^/]+)\/demo\/([^/]+)$`，`?project=` 在 pathname 之外不影响匹配）；按当前代码该请求会返回 200 HTML 而非「未知接口」。`node scripts/tests/item-demo-link.test.mjs` 当前全部通过（含端点行为与前端改写结构契约 D1–U4）。
- 「未知接口」是路由兜底文案（`scripts/server.mjs` 第 1798 行附近及 handleApi 各分组尾部）；唯一能让这个精确路径得到该 404 的情形，是常驻服务进程的代码早于演示端点（BUG-20260908-021 修复引入）——路由集在进程启动时固化，而静态前端实时读盘（`scripts/server.mjs` 第 1209–1224 行 health 注释，BUG-20260907-017 归纳的版本错配类型）：新前端 `linkupDocDemo`（`scripts/web/app.js` 第 185 行起）把链接改写到新端点，旧进程没有该路由，落入「未知接口」。
- 前端 `api()` 封装对「未知接口」类 404 会补「看板服务版本过旧：请在终端运行 atb serve 自动重启过旧服务，然后刷新页面」的指引（`scripts/web/app.js` 第 199–206 行），但仅覆盖 fetch 调用；演示链接是 `target="_blank"` 直接导航（`scripts/web/app.js` 第 193–195 行，noopener），绕过该封装，用户看到的就是裸 JSON。服务端面向「浏览器直接导航」的人读提示页（`sendDemoHtmlPage`，`scripts/server.mjs` 第 252 行、第 1792–1796 行）只覆盖演示路径形态非法的场景，且同样只存在于新代码中，旧进程里没有。
- 自愈通道已存在但需用户触发：`atb serve` 会比对磁盘代码 mtime 与 health `startedAt` 判定服务过旧并自动重启（`scripts/atb.mjs` 第 1100–1180 行，BUG-20260907-017）。Electron 壳的 `ensureService` 只探活复用、无过旧检测（`electron/service.mjs` 第 36–60 行）。
- 演示文件本身存在：`docs/agent-team-board/requirements/REQ-20260909-004/ui-demo.html`（REQ-20260909-004 README 第 70 行为该相对链接，约定出自 REQ-20260908-021）。

待确认（登记时无法核实，修复阶段补；2026-09-09 修复阶段核实结果）：

- 旧进程直接证据：**已取得**——本机 8888 常驻服务 pid 76113、startedAt `2026-09-09T01:20:02Z`，磁盘 `scripts/server.mjs`（01:49:09Z）/`scripts/web/app.js`（01:53:18Z）mtime 均晚于进程启动，「旧进程 + 新前端」版本错配真实存在。报错当时的进程已被替换（当前进程演示端点实测 200 HTML），登记时刻 pid/startedAt 无法追溯（豁免）；复现以 vm 沙箱模拟「新前端点击 + 旧进程 JSON 404」（测试 U5b）。
- 用户当时经 `atb serve` 还是 Electron 壳：无法追溯；两条路径均在覆盖面内（前端预检对任意来源的过旧进程生效）。
- 首次出现时间：无法追溯；与 BUG-20260908-021 交付（2026-09-08T17:24Z）后的使用路径一致。
- Electron 壳「探活复用」是否需要同等过旧检测：**本 Bug 不扩展**（豁免理由见 design.md「方案」第 3 点：复用外部服务时壳不拥有其生命周期，自动重启与复用语义相悖；`atb serve` 自愈 + 前端指引已覆盖本场景，壳内无感自愈可另立需求）。

## 复现步骤

前置条件：一个早于演示端点上线的常驻看板服务进程仍在运行（例如服务启动后 `scripts/server.mjs`/`scripts/web/` 又被更新，未再执行 `atb serve`；或经 Electron 壳探活复用了旧进程——其复用路径无过旧自动重启）。该前置属强推断，登记时未在真实旧进程上直接复现，待确认。

1. 保持上述旧服务进程运行，打开本项目看板：`http://127.0.0.1:8888/?project=%2FUsers%2Fadichou%2FDocuments%2Fsrc%2Fagent-team-board`（静态前端实时读盘，页面为已含链接接管的新版本）。
2. 进入「需求」模块，打开 REQ-20260909-004 详情，查看 README「界面展示」节。
3. 点击 `./ui-demo.html` 链接（新标签打开）。
4. 新标签地址为 `/api/item/REQ-20260909-004/demo/ui-demo.html?project=…`，页面显示 `{"error": "未知接口：GET /api/item/REQ-20260909-004/demo/ui-demo.html"}`，无任何可操作指引。
5. 对照验证（区分「文件缺失」与「路由未命中」）：新进程下同一路径返回演示 HTML。可在终端执行 `node scripts/atb.mjs serve`（触发过旧检测自动重启），刷新后重做步骤 2–3，链接应正常打开；`curl -s http://127.0.0.1:8888/api/health` 可查看当前进程 pid/startedAt 用于核对版本新旧。

## 期望行为

- 在需求详情点击 `./ui-demo.html` 链接，应在新标签直接打开当前项目、当前条目目录下的演示 HTML（CSP 沙箱、no-store，现有端点行为），不出现「未知接口」JSON。演示文件真实存在（`docs/agent-team-board/requirements/REQ-20260909-004/ui-demo.html`），看板不得要求用户手动找文件。
- 版本过旧的自愈指引不应因「新标签直接导航」而丢失：演示链接打开路径上命中「未知接口」类错误时，用户应得到可操作反馈（如提示运行 `atb serve` 自动重启后重试），而非裸 JSON。具体实现取向前端预检、服务端人读提示页还是其他方式，由修复阶段在 design.md 定夺，但不得为支持演示放开既有访问保护（文件名白名单、realpath 防穿越、2MB 上限、CSP 收敛、跨站防护，见 BUG-20260908-021 验收口径）。
- `atb serve` 既有的过旧自动重启行为保持不回归；Electron 壳等「探活复用」路径是否需要同等过旧检测，待确认，由修复阶段评估范围。

## 验收说明

- [ ] 在服务进程早于演示端点上线的环境复现步骤 1–4，先确认能观察到本 Bug 的裸 JSON 报错（无法构造旧进程时，以 `scripts/tests/serve-stale.test.mjs` 同款手段操纵 mtime 模拟版本错配，或在修复说明中记录豁免）。
- [ ] 执行 `node scripts/atb.mjs serve` 自动重启过旧服务并刷新页面后，点击 REQ-20260909-004 README 的 `./ui-demo.html` 链接可直接打开演示页，交互可用，无「未知接口」。
- [ ] 演示链接命中「未知接口」类错误时，新标签/页面给出可操作指引（如运行 `atb serve` 后重试），不再是无指引的裸 JSON；若修复方案权衡后不改此处，须在修复说明中记录豁免理由（待确认）。
- [ ] 回归：新进程下 `node scripts/tests/item-demo-link.test.mjs` 全部通过；文档 JSON（`/api/item/:id/doc/:name`）、图片 raw、站点根静态路径 404 行为不变。
- [ ] 多项目：`?project=` 正确绑定，切换项目后演示链接仍指向当前项目条目目录，不串单、不串项目。
- [ ] 不为修复放开既有防护：文件名白名单（`DEMO_HTML_NAME_RE`）、realpath 防穿越、2MB 上限、CSP（`DEMO_HTML_CSP`）、跨站防护（`apiGuardReason`）均保持。

## 关联

- 复现条目：REQ-20260909-004（README 含 `./ui-demo.html` 链接，条目目录有该文件；非引入来源）。
- 演示端点与前端链接接管：BUG-20260908-021（本 Bug 报错出现在其修复交付后的使用路径上）；链接约定源头：REQ-20260908-021。
- 版本错配类型归纳与 `atb serve` 自愈：BUG-20260907-017（`scripts/tests/serve-stale.test.mjs`）。
