# 设计 — BUG-20260913-004 版本的提示词与回答回填，合并入 main 两个按钮位置需要改到左侧列表项目中，参考需求列表的设计。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260913-001（经 `atb list` 核验存在；构建模块实现时两个版本操作按钮渲染在右侧详情底部 `renderDetail` 的 `footer.rel-acts`，入口随选中版本联动，未按需求列表行内操作设计放置）。

## 根因分析

`openAnswerModal` / `openMergeConfirm` 均取 `selVersion()`，按钮因此只能挂在详情底部（先选中才可见可点）；`rel-card` 列表卡片未渲染操作入口，与需求列表「行内操作 + 点击不改选中（`e.target.closest('button')` 即返回）」既有口径不一致；「提示词与回答回填」文案冗长不直观。

## 方案（已定稿，2026-09-13 实施）

- **位置**：`renderVersionList` 每张 `.rel-card` 增加 `.card-acts` 行，内联 `data-ver-answer`「AI 完善」与 `data-ver-merge`「合并入 main / 重试合并入 main」两按钮（参照 `reqRowEl` row-acts 口径：小号按钮 + `aria-label`/`title`）；点击按钮按 `data-ver-*` 打开的弹窗对**按钮所在卡片**的版本生效，`.rel-list` 既有忽略 button 点击的口径保证不改变选中态。
- **移动而非复制**：`renderDetail` 移除 `footer.rel-acts`，详情底部不保留副入口（避免禁用/文案双入口漂移）。
- **文案**：按钮与回填弹窗标题 / aria-label 同步更名「AI 完善」；`i18n.js` 词条 `'提示词与回答回填'` 更替为 `'AI 完善': 'AI refine'`。
- **状态口径逐卡继承**：AI 完善 merging 禁用；合并键 merging / merged / `mergeBusy`（全局）禁用、merged title「已合并入 main」、failed 显「重试合并入 main」。
- **数据流修正**：`copyPrompt` 按 `state.answer.verId`、`doMerge` 按 `state.mergeConfirm?.verId` 定位版本（原先取 `selVersion()`，对非选中卡片操作会落错版本）。
- **开源选型**：未使用开源库（纯既有代码内调整渲染位置与文案，无合适库可复用，引入成本高于自研改动）。

## 风险与边界

- release.js 亦使用 `.rel-acts` 样式类，仅 build.js 停用该类，样式保留不影响发布模块。
- 回填 / 合并确认弹窗、Esc 关闭、toast 等既有行为零回归（全量测试覆盖）。
