# 测试用例 — BUG-20260909-005 打开需求说明中的 ui-demo.html，浏览器报错

> 修复阶段补充（TDD，先跑红后实现）。测试载体：`scripts/tests/item-demo-link.test.mjs`
> 新增 D8（服务端兜底人读化）与 U5（前端点击预检），并同步调整 U4 的链接对象桩以支持
> `addEventListener`。回归依赖既有 D1–D7、U1–U4 与 `scripts/tests/serve-stale.test.mjs`、
> `scripts/tests/dispatch-api.test.mjs`。

## D8 服务端：API 未命中兜底按请求形态分流（浏览器导航人读、fetch 保持 JSON 契约）

- **D8a** GET 未命中 API 路径（如 `/api/brand-new-endpoint`）且 `Accept` 含 `text/html`
  （浏览器直接导航形态）→ 404 + `text/html` 人读指引页，文案含「版本过旧」与 `atb serve`
  自愈指引，附「返回看板」链接；CSP 收敛（`default-src 'none'` + `style-src 'unsafe-inline'`）+ nosniff + no-store。
- **D8b** 同一路径以 fetch 形态请求（不携带 `Accept: text/html`，node http 缺省）→ 404 +
  `application/json`，`error` 以「未知接口：」开头——API 消费方契约不变（`api()` 的
  过旧提示逻辑不受影响）。
- **D8c** 演示路径既有分流不变：`/api/item/:id/demo/*` 形态错误仍回 400 人读提示页
  （非「未知接口」），正常演示仍 200 HTML（由既有 D1–D4 回归覆盖）。

## U5 前端：演示链接点击预检（guardDemoLinkClick，vm 沙箱行为级）

- **U5a 结构**：`linkupDocDemo` 为每个接管链接挂 `click` 监听并调 `guardDemoLinkClick`；
  未接管链接不挂监听（U4 一并断言）。
- **U5b 过旧**：预检 fetch 得 404 JSON `{"error":"未知接口：…"}` → `preventDefault`、
  关闭 about:blank 占位标签（用户不会看到裸 JSON 新标签）、错误 toast 含「版本过旧」与
  `atb serve` 指引、占位标签不被导航。
- **U5c 正常**：预检 2xx（text/html）→ 占位标签先 `opener = null`（编程式 noopener，
  等效既有 `rel=noopener` 防护）再真实导航到演示端点（浏览器加载服务端带 CSP 沙箱的响应），
  不关标签、不 toast。
- **U5d 兜底**：预检 fetch 网络异常 → 仍导航占位标签（行为与旧版直开等价：人读提示页或演示页）。
- **U5e 弹窗拦截**：`window.open('about:blank')` 返回 null → 不 `preventDefault`，
  交还浏览器原生 `target=_blank` 导航。
- **U5f 非普通左键**：中键/带修饰键点击不拦截（保留浏览器原生新标签行为）。

## 回归口径（对应 README 验收说明）

- `node scripts/tests/item-demo-link.test.mjs` 全绿（含既有 D1–D7、U1–U4 与新增 D8、U5）。
- `node scripts/tests/serve-stale.test.mjs` 全绿（`atb serve` 过旧自动重启不回归；health
  pid/startedAt 契约不变）。
- `node scripts/tests/dispatch-api.test.mjs` 全绿（分组「未知接口」JSON 兜底契约不变）。
