# REQ-20260918-001 README.md 按最新代码功能优化并支持中英文切换（新增 README.en.md）

- 状态：accepted（已接受）
- 创建：2026-09-18T03:12:57.275Z

## 描述

背景：根 README 基线停在 2026-09-16（REQ-20260916-003 重写版），此后已落地的功能未入文档。目标：1) 优化 README.md 反映当前已落地功能——仓库根 index.html 产品落地页（REQ-20260916-002）、构建发布官网目标 Vite+Vue 适配（REQ-20260916-044 之 REQ-20260916-004：apps.js 注册与双语材料预检、SPA 回退与站内链接校验、vite base 解析）、atb migrate 数据布局迁移与 plugin-pack 打包模块（REQ-20260916-007）、scripts/web 样式与树表资源补齐、测试规模更新；仅登记已落地能力，不写入仍在计划中的条目（如 master 回退、需求页快捷复制提示词、state-guard 放行口径调整）。2) 支持中英文切换：README.md 与新增 README.en.md 顶部互相链接（中文 | English），README.en.md 为完整英文对照版且内容与中文版同步；目录树补登 README.en.md。3) 同步维护契约测试 scripts/tests/req-doc-entry-20260916-003.test.mjs（A1 声明路径存在性含新文件与路径清单更新、章节结构断言保持，另补双语切换断言），先红后绿；npm test 全量通过。边界：不改 scripts/web/i18n.js（本单纯文档）、不改 AGENTS.md 与 SKILL.md。

## 验收标准

现状核实（2026-09-19）：根 README.md（135 行，中文）无语言切换行、README.en.md 不存在；README.md 第 90 行的 index.html 指 scripts/web/ 看板前端骨架，仓库根产品落地页 index.html（318 行，REQ-20260916-002）与 scripts/lib/migrate-layout.mjs、scripts/lib/plugin-pack.mjs 均已存在但 README 未登记——与下方目标项一一对应。

### 一、README.md 内容更新（仅登记已落地能力）

- [ ] 登记仓库根 `index.html` 产品落地页（REQ-20260916-002）：自包含产品介绍页（含 Status Board 启动与 Electron 说明），表述须与 scripts/web/index.html（看板前端骨架）明确区分，不混淆两处 index.html。
- [ ] 登记构建发布官网目标 Vite+Vue 适配（REQ-20260916-044 之 REQ-20260916-004）：`src/data/apps.js` 产品注册与 `content/<产品id>/` 双语成对预检、productIds 覆盖映射、site-deploy 执行 npm install + build、site-verify 的 SPA 回退与 zh/en 镜像路由校验、vite base 解析。
- [ ] 「scripts/lib 模块分组」表纳入 `scripts/lib/migrate-layout.mjs`（`atb migrate` 数据布局迁移）与 `scripts/lib/plugin-pack.mjs`（`atb pack` 插件打包）。
- [ ] 「scripts/web 界面」vendored 资源表述补齐（style.css、wunderbaum.css、highlight 双主题 css 等已在库文件）。
- [ ] 测试规模与实测日期更新，以本单 `npm test` 实际结果为准（不沿用 2026-09-16 旧数字）。
- [ ] 不写入未落地 / 进行中能力：master 回退（REQ-20260916-005）、需求页快捷复制提示词（REQ-20260917-001）、state-guard 放行口径调整（REQ-20260917-002）。

### 二、中英文切换

- [ ] README.md 顶部含切换行：`中文 | [English](./README.en.md)`；README.en.md 顶部对应：`[中文](./README.md) | English`。
- [ ] README.en.md 为完整英文对照版：章节结构与 README.md 一一对应（同一信息架构、同一命令与路径事实），条目编号、模块文件名等专有 token 保持原样；除语言切换行外不含 CJK 字符。
- [ ] README.md 目录树补登 README.en.md（在 README.md 同级）。
- [ ] README.en.md 中出现的命令、路径、端口等事实与中文版完全一致（事实同源，仅语言不同）。

### 三、契约测试（TDD，先红后绿）

- [ ] 扩展 `scripts/tests/req-doc-entry-20260916-003.test.mjs` 为 B 组：B1 双语互链切换；B2 英文版章节映射表全部命中且（除切换行外）无 CJK；B3 A1 路径清单加入 README.en.md、scripts/lib/migrate-layout.mjs、scripts/lib/plugin-pack.mjs 且逐一真实存在；B4 README.md 登记根落地页 / migrate-layout / plugin-pack；B5 既有 A1–A6 断言全部保持通过。
- [ ] 扩展后的测试先在实现前跑红（切换链接缺失、README.en.md 不存在、清单未含新路径），实现后跑绿；`npm test` 全量通过。

### 四、边界遵守

- [ ] 不改 scripts/web/i18n.js（看板界面国际化与本单无关）、不改 AGENTS.md 与 SKILL.md、不引入任何依赖（无需 licenses.md）。
- [ ] README.md / README.en.md 位于仓库根属受保护文档，实施时须持有效认领锁（`atb claim`）后编辑。

## 界面展示

本单为纯文档需求，用户可见的「界面」是 README.md / README.en.md 在代码托管平台与 Markdown 渲染器中的呈现效果，交互演示见 [./ui-demo.html](./ui-demo.html)（单文件、无外网依赖、浏览器直接打开可交互）。

**界面布局**（README 渲染视图）：

- 文档第一行为语言切换行：中文版为 `中文 | [English](./README.en.md)`（「中文」为当前语言纯文本、另一侧为链接），英文版镜像为 `[中文](./README.md) | English`。
- 切换行下方依次为主标题（Agent Team Board / 智能体团队看板）、导语、正文各章节；两语言版章节一一对应（三栏协作体系 / 目录与模块职责 / 环境与运行方式 / 关键机制索引 / 官网·用户文档·支持 / 按任务类型导航 / 使用与初始化），目录树中 README.en.md 与 README.md 同级并列。

**交互行为**：

- 点击切换行的「English」链接 → 跳转渲染 README.en.md（英文版）；点击英文版切换行的「中文」链接 → 跳回 README.md。当前语言侧为纯文本不可点击，另一侧为链接，实现所见即所在语言的明示反馈。
- 目录树与按任务类型导航中的 README.en.md 链接可点击进入英文版。

**状态反馈**：

- 正常态：双语文件均存在，两侧切换链接均可往返，渲染各自语言内容。
- 实施前（本单未完成时）：README 无切换行、README.en.md 不存在，访问 `./README.en.md` 返回 404——即本单要消除的缺失态。
- 失败态（契约测试 B 组拦截）：README.en.md 章节与中文版不对应（映射未全命中）或英文版含漏译 CJK 字符时，契约测试跑红阻止合入；ui-demo.html 提供「注入缺失章节」演示该失败反馈。

ui-demo.html 内提供「实施前 / 实施后」对照开关、中英文切换、章节映射校验面板（通过 / 失败状态切换）与切换时的加载指示，用于直观演示上述布局、交互与状态反馈。
