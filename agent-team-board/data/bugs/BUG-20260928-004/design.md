# 设计 — BUG-20260928-004 发布界面布局优化

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260920-003（已核验：`atb list` 存在该条目；`git log -S "bld-site-prompt" -- scripts/web/build.js` 唯一命中提交 58bfd1e「feat: 构建和发布流程整改。 REQ-20260920-003」，即 `renderReleaseFlowPane` 引入常驻展开的官网提示词 textarea；后续 REQ-20260926-002 五步重排沿用该形态，未随 REQ-20260921-007 折叠口径收敛）

## 根因分析

「动作二 · 官网资料更新」的官网提示词是低频只读长文本（约十行），但自 REQ-20260920-003 引入起就以 `<textarea class="bld-site-prompt" rows="7" readonly>` 常驻完全展开渲染在发布步中：提示词只在首次复制时需要查看，却把官网同步状态标签、「立即检测」按钮与检测证据推到折叠线以下，拉长「发布」步纵向空间。REQ-20260921-007 已为同型的「AI 总结 / AI 翻译提示词」建立 `<details class="bld-docs-prompt-box">` 默认折叠口径（摘要行 + 按需展开），官网提示词未随同收敛，两处同型不同口径。属呈现层布局问题，不涉及数据与服务逻辑。

## 方案

**开源选型（REQ-20260909-015）**：动手自研前先评估是否有成熟、维护中的开源库，优先复用——以依赖方式引入
（Node/Web 项目走 npm，Apple 平台走 SPM / CocoaPods），禁止复制开源库源码进项目仓库；仅当库无包分发渠道
且确需使用时才允许 vendor（内嵌源码），须在 licenses.md 标注复制范围与原因。License 只用开源友好白名单：
MIT / Apache-2.0 / BSD-2-Clause / BSD-3-Clause / ISC / 0BSD / Unlicense；GPL / LGPL / AGPL / SSPL 等
强传染许可及 License 不明的库禁止引入。自研须写明理由（三选一）：引用了哪些库 / 无合适库的原因 /
引入成本高于自研的原因。引入开源库须在条目目录维护 licenses.md（库名 / 版本 / 引入方式 / License / 仓库地址），
未使用开源库的条目不创建该文件。

本项自研理由：无合适库——改动是原生 HTML `<details>/<summary>` 折叠语义与既有 CSS 类复用（零依赖、零 JS 交互新增），引入任何前端库的成本与风险均高于自研；未引入开源库，不创建 licenses.md。

实施（纯前端静态契约层，2 文件）：

1. `scripts/web/build.js` `renderReleaseFlowPane`：`p.sitePrompt` 分支改为 `<details class="bld-docs-prompt-box bld-site-prompt-box">`（复用 REQ-20260921-007 折叠盒样式，附加 `bld-site-prompt-box` 标识类便于测试定位），`<summary>` 摘要行说明用途与复制口径（默认折叠、点击展开查看全文、复制后在官网仓库会话粘贴执行、提交消息须含完整计划号）；textarea（readonly、`bld-site-prompt` 类不变，复制 handler 继续从其取值）与「复制官网提示词」按钮移入折叠区内。不带 `open` 属性 → 默认收起，刷新 / 重新进入发布步仍默认折叠（不记忆展开状态，按 README 默认口径）。官网同步状态标签、「立即检测」、检测证据 / 原因 / 时间行与底部口径说明保留在折叠区外（收起态同屏可达）。未配置官网仓库 fallback 分支文案不变，不渲染折叠区。
2. `scripts/web/i18n.js`：新增摘要行 EN 词条；顺带补齐同块「未配置官网仓库：先在设置中配置官网仓库根目录。」此前缺失的 EN 词条（BUG-20260912-001 中英文同步，原仅中文展示）。

不改：`buildSiteWritingPrompt` 输出、复制链路（handler 与成功 / 降级 toast 文案）、官网同步检测逻辑、推送门禁。

## 风险与边界

- `<details>` 折叠态下 textarea 仍在 DOM 中，`data-pf-copy-site` 复制 handler 读 `.bld-site-prompt` 值不受影响（展开后复制与收起态经按钮复制均可达；按钮在折叠区内，收起时不可点，与验收「展开后复制按钮可达」一致）。
- 纯静态布局收敛，无数据迁移、无服务端改动；「且改为可选」按 README 口径实现为「查看全文可选（按需展开）」，整步可选口径留待人工确认（README 期望行为末条）。
- 回归面集中在发布步呈现：req-20260926-002 等前端静态契约测试全量通过。
