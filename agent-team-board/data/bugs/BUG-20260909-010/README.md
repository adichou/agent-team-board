# BUG-20260909-010 新建单带上截图后，在详情界面没有显示截图

- 状态：accepted（已接受；本轮仅完善说明，未实施修复）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-09T05:34:28.382Z

## 现象

在看板「需求」模块新建需求 / Bug 时，弹窗描述下方已出现截图区块（`scripts/web/index.html` 的 `#fShotRow`：添加按钮 `#fShotPick` / 文件选择 `#fShotFile` / 缩略图列表 `#fShotList` / 计数 `#fShotCount`，REQ-20260909-009 交付），选择图片后缩略图正常入列、计数显示 `n / 9`，点「创建」返回成功提示「✓ 已创建 <ID>（待接受）」，全程无任何报错。但打开该单详情（五页签布局：基本信息 / 说明 / 设计 / 测试用例 / 讨论纪要，REQ-20260909-006），切到「说明」页签查看 README：描述节只有文字，**一张截图都没有**——没有图片，也没有「截图 xxx 无法加载」占位，与创建时明确携带了截图的事实不符。

2026-09-09 静态与运行时核实（均可在当前环境复核）：

- **当前磁盘代码链路完整且测试全绿**：`submitNew` 把截图以 `attachments: [{name, dataBase64}]` 随 `POST /api/new` 一次提交（`scripts/web/app.js` 第 2548 行起，附件组装第 2585 行）；服务端转交 `core.createItem`（`scripts/server.mjs` 第 1758 行起，`attachments` 传参第 1770 行；`scripts/lib/core.mjs` 第 504 行）落盘到 `<条目目录>/attachments/` 并在 README 描述（需求）/ 现象（Bug）节末尾按添加顺序追加 `![截图](attachments/<文件名>)` 引用行（core.mjs 第 544–545 行）；抽屉「说明」页签经 `loadDoc`（app.js 第 2376 行）渲染 README，`linkupDocImages`（app.js 第 260 行）把相对 `attachments/` 引用改写到条目附件端点 `/api/item/:id/attachment/:name`（server.mjs 第 1777 行 `itemAttMatch`），点击放大复用 `#oncallLightbox`、加载失败就地替换为占位说明（app.js 第 279–284 行）。`node scripts/tests/item-attachment-store.test.mjs`（S1–S7）、`item-attachment-serve.test.mjs`（V1–V4）、`item-shot-ui.test.mjs`（U1–U7）2026-09-09 实跑全部通过。
- **根因为版本错配（旧服务进程 + 新静态前端），与 BUG-20260909-005 同类**：本机 8888 常驻服务 pid 10988、`startedAt` `2026-09-09T03:59:11Z`（`curl -s http://127.0.0.1:8888/api/health` 可复核），而截图功能 REQ-20260909-009 的条目时间线为：创建 04:27:19Z → 置计划 04:47:02Z → Agent 上报完成 05:29:25Z——**全部代码落盘晚于进程启动**；磁盘 `scripts/server.mjs`、`scripts/web/app.js`、`scripts/lib/core.mjs` 的 mtime 也均晚于 03:59:11Z。静态前端实时读盘（路由集启动时固化、静态文件逐请求读盘的口径见 BUG-20260907-017 归纳），所以用户拿到的是**含截图区块的新弹窗**（能添加截图、能提交），但打交道的**服务进程是旧代码**。
- **旧进程在创建路径上静默丢弃附件（强推断，证据链如下）**：旧 `/api/new` 处理器不认识请求体里的 `attachments` 字段（该传参是 REQ-20260909-009 才加的，server.mjs 第 1770 行），JSON 多余字段被忽略后仍按旧口径 `core.createItem({type, title, description, by})` 创建并返回 201——截图数据无痕丢失，README 不写引用行、不建 `attachments/` 目录，前端与用户都得不到任何错误。数据面佐证：`docs/agent-team-board/` 全树**不存在任何 `attachments/` 子目录**——尽管用户已通过新弹窗提交过截图，附件从未成功落盘一次。
- **旧进程也缺附件读取端点（已实测）**：对运行中的 8888 进程请求 `curl "http://127.0.0.1:8888/api/item/REQ-20990101-999/attachment/a.png?project=<本项目>"`，返回 404 `{"error":"未知接口：GET /api/item/REQ-20990101-999/attachment/a.png"}`（路由兜底，server.mjs 第 1755 行）。即若 README 恰好带图片引用行，抽屉内图片也会加载失败，被 `linkupDocImages` 的错误处理替换为「截图 xxx 无法加载（文件可能被移动、删除或超过 8MB 上限）」占位（app.js 第 279–284 行）——注意 `<img>` 加载不经过 `api()` 封装，拿不到「看板服务版本过旧：请在终端运行 atb serve 自动重启过旧服务」的可操作指引（该指引仅覆盖 fetch 调用，app.js 第 288–301 行）；本单实际连占位都没有，因为附件在创建时就被丢弃、README 里根本没有图片行。
- **自愈通道已存在但需用户触发**：`node scripts/atb.mjs serve` 比对磁盘服务代码 mtime 与 health `startedAt` 判定过旧并自动重启（`scripts/atb.mjs` 第 1123–1197 行，BUG-20260907-017 引入）。Electron 壳的 `ensureService` 只探活复用、无过旧检测（`electron/service.mjs`，BUG-20260909-005 已裁定不扩展）。

待确认（登记时无法核实，修复阶段补）：

- 用户测试用的具体单据与被丢弃的截图内容无法追溯：附件未落盘、测试单可能已删除（待接受单可删），05:32–05:34 窗口内本项目看板仅创建了 BUG-20260909-008/009/010 三条反馈；不排除用户当时给反馈单本身也附了截图（同样被旧进程丢弃）。
- 用户当时经 `atb serve` 还是 Electron 壳打开看板：无法追溯；两条路径均命中「旧进程」前置（Electron 壳探活复用无过旧检测）。
- 旧进程 `/api/new` 忽略 `attachments` 字段为强推断（旧处理器代码已被覆盖无法直接回放）；旁证是全树无 `attachments/` 目录 + 旧进程缺附件路由的实测。复现以 `scripts/tests/serve-stale.test.mjs` 同款 mtime 操纵思路为准，或修复说明记录豁免。
- 首次出现时间：与 REQ-20260909-009 交付（2026-09-09T05:29:25Z 上报）后的首次使用一致（本 Bug 05:34:28Z 登记）。

## 复现步骤

前置条件：一个早于截图功能（REQ-20260909-009）上线的常驻看板服务进程仍在运行——即服务启动于 2026-09-09T05:29 之前且此后未再执行 `atb serve`（当前环境 pid 10988 / startedAt 03:59:11Z 即此状态；无法构造旧进程时，以 `scripts/tests/serve-stale.test.mjs` 同款手段操纵磁盘 mtime 模拟，或在验证说明中记录豁免）。

1. 保持上述旧服务进程运行，打开本项目看板 `http://127.0.0.1:8888/?project=<本项目>`（静态前端实时读盘，页面为新版本，新建弹窗含截图区块）。
2. 「需求」模块 →「＋ 新建」选需求（或 Bug）：填写标题与描述，点「＋ 添加截图」选择 1–2 张图片（或直接 ⌘V 粘贴截图，自动命名 `paste-<时间戳>.<后缀>`），确认缩略图入列、计数显示 `n / 9`。
3. 点「创建」：按钮短暂置「创建中…」，随后 toast 显示「✓ 已创建 <ID>（待接受）」——**无任何错误**，列表出现新单。
4. 点击新单打开详情，切到「说明」页签：README 描述节仅有所填文字，没有任何截图（既无图片也无「无法加载」占位）。对照条目目录：`docs/agent-team-board/requirements|bugs/<ID>/` 下**没有 `attachments/` 子目录**，README 也无 `![截图](attachments/…)` 引用行——附件在创建时被旧进程静默丢弃。
5. 端点缺失形态对照：对运行中的旧进程执行 `curl "http://127.0.0.1:8888/api/item/<任意条目ID>/attachment/a.png?project=<本项目>"`，返回 404 `{"error":"未知接口：…"}`；若给某单 README 手工补一行 `![截图](attachments/a.png)` 再开「说明」页签，图片加载失败被替换为占位文本「截图 a.png 无法加载（文件可能被移动、删除或超过 8MB 上限）」，且无 atb serve 过旧指引。
6. 根因核对：`curl -s http://127.0.0.1:8888/api/health` 记下 pid / startedAt，与 `stat scripts/server.mjs scripts/web/app.js` 的 mtime 对照——磁盘代码新于进程启动即版本错配成立。
7. 自愈对照：终端执行 `node scripts/atb.mjs serve`（提示「看板服务版本过旧…正在自动重启加载新版本…」），刷新页面后重做步骤 2–4：新单创建后条目目录出现 `attachments/` 子目录、README 描述节末尾按添加顺序出现 `![截图](…)` 引用行，详情「说明」页签正常显示截图，点击放大。注意：步骤 4 里已丢附件的存量单不会因此恢复（数据未落盘）。

## 期望行为

- **服务为当前代码时，截图链路完整**（REQ-20260909-009 交付口径）：新建需求 / Bug 携带的截图随单持久化到 `<条目目录>/attachments/`，README 描述（需求）/ 现象（Bug）节末尾按添加顺序追加引用行；详情「说明」页签内正常渲染截图，点击放大（复用 `#oncallLightbox`，点击任意处 / Esc 关闭），加载失败给「无法加载」占位；`node scripts/tests/item-attachment-store.test.mjs`、`item-attachment-serve.test.mjs`、`item-shot-ui.test.mjs` 全绿。
- **版本错配时不得静默丢数据**：服务进程早于截图功能时，带附件的创建请求应被明确拒绝或给出可操作指引（如提示运行 `atb serve` 自动重启过旧服务后重试），而不是 201 成功 + 截图无痕丢失。具体收敛方式（服务端版本握手拒绝 / 前端创建前预检 / 仅维持文档指引）由修复阶段在 design.md 定夺，可参照 BUG-20260909-005 对演示链接「未知接口」加预检指引的先例；不得为支持截图放开既有防护（附件后缀白名单、单张 8MB、防穿越、张数上限 9、附件端点 CSP/nosniff/no-store）。
- `atb serve` 既有的过旧自动重启行为保持不回归；Electron 壳「探活复用」口径维持 BUG-20260909-005 裁定（不扩展过旧检测，如需壳内无感自愈另立需求）。
- 已丢附件的存量单：本 Bug 修复不承诺找回（数据从未落盘，不可恢复）；补救由人工重建单或手动放置 `attachments/` 文件并补 README 引用行。是否提供「重新上传截图」入口（现状「✎ 修改」仅编辑标题 / 描述，无附件重传能力）待确认，由修复阶段评估范围。

## 验收说明

- [ ] 在「服务进程早于截图功能上线」的环境重做复现步骤 2–4，先确认能观察到「创建成功但详情无截图、无任何报错」（无法构造旧进程时，以 `scripts/tests/serve-stale.test.mjs` 同款 mtime 操纵模拟版本错配，或在修复说明中记录豁免）。
- [ ] 执行 `node scripts/atb.mjs serve` 自动重启过旧服务并刷新页面后：新建带截图的需求与 Bug 各一单——`attachments/` 子目录落盘、文件字节与提交一致、README 引用行按添加顺序齐全；详情「说明」页签按顺序显示截图，点击放大、Esc / 点击任意处关闭。
- [ ] 版本错配下的丢数据路径收敛：带附件的创建请求打到旧进程不再静默成功（明确报错或给出 atb serve 指引），所选实现与（如豁免）理由记录在 design.md；`<img>` 加载失败占位文案口径不回归（app.js 第 279–284 行）。
- [ ] 回归：`npm test`（`node scripts/tests/run-all.mjs`）全绿，重点 `item-attachment-store.test.mjs`（S1–S7，含 S5 无附件旧口径、S6 「✎ 修改」不丢图片行）、`item-attachment-serve.test.mjs`（V1–V4，含 V4 旧调用兼容）、`item-shot-ui.test.mjs`（U1–U7）。
- [ ] 多项目：`?project=` 正确绑定，A 项目条目截图不串 B 项目；跨项目切换后「说明」页签图片仍指向当前项目条目目录。
- [ ] 不为修复放开既有防护：附件后缀白名单（png/jpg/jpeg/gif/webp/svg/ico/bmp/avif）、单张 8MB、张数上限 9、防穿越文件名校验、附件端点 CSP/nosniff/no-store 全部保持（`item-attachment-serve.test.mjs` V3 断言不回归）。

## 界面展示

- 布局：详情抽屉页签式布局（REQ-20260909-006）——头部（条目编号 / 关闭按钮 / 标题）+ 五页签（基本信息 / 说明 / 设计 / 测试用例 / 讨论纪要）+ 内容区；截图位于「说明」页签 README 描述（需求）/ 现象（Bug）节末尾，以内联图片块呈现。演示页内置「现状（缺陷：附件被丢弃）/ 现状（变体：端点缺失占位）/ 期望（修复后）」三场景切换，另含创建弹窗回放（截图区块 + 提交反馈）。
- 交互：页签点击切换（文档页签首次激活显示「加载中…」后回填内容）；截图点击放大（lightbox，点击任意处 / Esc 关闭）；演示页可「重放创建流程」观察 现状（toast 成功但详情无图）与 期望（toast 成功且详情有图）的差异。
- 状态反馈：正常态（期望：描述文字 + 截图按添加顺序显示）、缺陷态 A（创建成功但描述节纯文字、无图无占位）、缺陷态 B（图片行存在但加载失败 → 「截图 xxx 无法加载（文件可能被移动、删除或超过 8MB 上限）」占位，无版本过旧指引）、加载态（页签切换「加载中…」）、空态（无截图单的描述节纯文字）五类状态切换。深浅色适配未做（可选项）。

可交互演示：[./ui-demo.html](./ui-demo.html)（单文件、无外网依赖，浏览器直接打开；内置「现状（缺陷）/ 期望（修复后）」场景切换与创建流程回放，演示用内联 SVG 假图模拟截图内容）。

## 关联

- 截图功能引入：REQ-20260909-009（新建条目的描述支持截图——弹窗截图区块、`/api/new` attachments、`GET /api/item/:id/attachment/:name`、`linkupDocImages`；本 Bug 出现在其交付后的使用路径上，磁盘代码本身经测试链路完整）。
- 版本错配类型归纳与 `atb serve` 过旧自愈：BUG-20260907-017（`scripts/tests/serve-stale.test.mjs`）。
- 同类先例（新前端 + 旧进程落「未知接口」）：BUG-20260909-005（演示链接裸 JSON，已修复为预检 + atb serve 指引；本 Bug 的 `<img>` 路径与创建静默丢数据是其未覆盖的相邻面）。
- 详情页签布局：REQ-20260909-006（五页签，「说明」页签即 README 渲染入口）。
