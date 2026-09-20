# 设计 — REQ-20260918-001 README.md 按最新代码功能优化并支持中英文切换（新增 README.en.md）

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

- 根 README.md 基线为 2026-09-16（REQ-20260916-003 重写版），此后已落地若干能力未入文档；README 内容受静态契约测试 `scripts/tests/req-doc-entry-20260916-003.test.mjs`（A1–A6）约束，改动须同步维护该测试。
- 用户要求 README 支持中英文切换。仓库现状无英文版 README；本单新增 README.en.md 完整英文对照版，两文件顶部互链实现切换。

## 方案

**文档结构**

1. README.md（中文，保持唯一中文事实源）顶部语言切换行：`中文 | [English](./README.en.md)`；README.en.md 顶部对应：`[中文](./README.md) | English`。
2. README.en.md 为完整英文对照版：章节与 README.md 一一对应（同一信息架构、同一命令与路径事实），仅语言不同；条目编号、模块文件名等专有 token 保持原样。
3. README.md 目录树、按任务类型导航等索引同步补登 README.en.md。

**内容更新点（仅登记已落地能力）**

- 仓库根 `index.html` 产品落地页（REQ-20260916-002）：自包含产品介绍页，含 Status Board 启动与 Electron 说明。
- 构建发布官网目标 Vite+Vue 适配（REQ-20260916-004）：双语材料预检（`src/data/apps.js` 注册 + `content/<产品id>/` 双语成对校验）、productIds 覆盖映射、site-deploy 执行 npm install + build、site-verify SPA fallback 与 zh/en 镜像路由校验、vite base 解析。
- `scripts/lib/migrate-layout.mjs`（`atb migrate` 数据布局迁移）与 `scripts/lib/plugin-pack.mjs`（`atb pack` 插件打包）纳入 lib 模块分组表。
- `scripts/web` 资源补齐：style.css、wunderbaum.css、highlight 双主题 css 等已在库，随 vendored 资源表述更新。
- 测试规模与实测日期更新（以本单跑 `npm test` 实际结果为准，2026-09-18）。

**测试方案（TDD，扩展契约测试为 B 组）**

- B1 中英文切换：README.md 顶部含指向 README.en.md 的切换链接；README.en.md 存在且顶部含返回 README.md 的链接。
- B2 结构对应：README.en.md 与 README.md 逐一映射的章节标题表全部命中；英文版除语言切换行外不含 CJK 字符。
- B3 路径清单扩展：A1 清单加入 README.en.md、scripts/lib/migrate-layout.mjs、scripts/lib/plugin-pack.mjs（先红：清单存在而文件未建/未登记时）。
- B4 内容登记：README.md 提及 index.html 落地页、migrate-layout.mjs、plugin-pack.mjs。
- B5 既有 A1–A6 全部保持通过（章节结构、命令一致性、官网节无链接、无私有信息）。

## 风险与边界

- 双语同步维护成本：英文版为镜像翻译，后续改 README.md 须同步 README.en.md（契约测试 B 组兜底结构对应）；本单不改 AGENTS.md（不新增维护条款）。
- 不改 scripts/web/i18n.js（看板界面国际化与本单无关）；不动进行中条目（BUG-20260916-002）的工作区文件。
- 不写入 planned/submitted 未落地能力（master 回退 REQ-20260916-005、需求页快捷复制 REQ-20260917-001、state-guard 放行 REQ-20260917-002）。
- README.md / README.en.md 位于仓库根，属钩子保护源码，须持有效认领锁后编辑；`atb pack` 不排除根 README，随包分发口径不变。

**开源选型（REQ-20260909-015）**：本单为纯文档与文档契约测试，不引入任何依赖，无需 licenses.md。
