# 测试报告 — BUG-20260910-003 详细页面中的说明，方案等内容的呈现没有滚动条，请修复

- 时间：2026-09-10T03:29:21.996Z
- 执行者：zcode-batch-031-3
- 测试框架：node:assert 静态契约测试（S1–S4）+ Electron 离屏实测六场景
- 覆盖率：100%

## 总结

根因：宽屏 .req-split 隐式 grid 行 auto 随抽屉长文档撑高（实测 900px 视口下抽屉 3343px），被 .req-view overflow:hidden 裁剪且祖先链无任何可滚容器。修复：grid-template-rows: minmax(0,1fr) 锁定行高，drawer-body 成唯一滚动容器；窄屏 absolute 与讨论模块复用方无回归，BUG-20260909-018 短文档拉伸不回退。归因 REQ-20260907-004。测试：S1 先红后绿，drawer-height 等全量 137 文件 0 失败。

## 明细

### 1. TDD 静态契约测试（修复前跑红 → 修复后跑绿）

`node scripts/tests/drawer-doc-scroll-20260910-003.test.mjs`

- 修复前：`✗ S1 根因修复：.req-split 行高锁定 minmax(0, 1fr)`（其余 S2–S4 绿，证明既有滚动链/回归项本就在位，缺的只是行高约束）；
- 修复后：S1–S4 全部通过。
- 回归：`drawer-height.test.mjs` D1–D5 通过；全量 `npm test`：**137 个测试文件，失败 0**。

### 2. 离屏 Electron 实测（项目自带 electron 37.2，BrowserWindow show:false 不弹窗；
样本取自本项目看板真实数据，服务 127.0.0.1:8888，macOS darwin 25.6.0 arm64）

修复前（复现，1440×900，REQ-20260910-002「说明」页签）：

- `#drawer` 高 3343px；`.req-split` 行 3357px vs 自身可用 695px；`.req-view`（overflow:hidden）裁剪；
- 祖先链全部不可滚（drawer-body scrollHeight 3213 == clientHeight 3213，程序化滚到 `max = 0`）——
  即「没有滚动条」实为没有滚动容器，内容下半部分不可达。

修复后（同一样本 REQ-20260910-002，待测试档）：

| 场景 | 视口 | drawer-body clientH / scrollH | 滚到底 | 末段可见 | 返回顶部 |
|---|---|---|---|---|---|
| 宽屏 · 说明（README） | 1440×900 | 528 / 3255 | scrollTop 2727 == max | 末条目（引入来源清单末项）top≈811 在视口内 | ✓ |
| 宽屏 · 设计（design.md） | 1440×900 | 528 / 2339 | scrollTop 1811.5 == max | 「不做（README 边界重申）…」top≈789 在视口内 | ✓ |
| 窄屏 · 说明（≤1020px 覆盖式） | 900×820 | 486 / 5017 | scrollTop 4532 == max | 同 README 末段 top≈734 在视口内 | ✓ |
| 宽屏 · 本单 README（中等长度） | 1440×900 | 528 / 1848 | scrollMax 1320 可达 | —（md 拉伸填满 body，BUG-20260909-018 不回退） | ✓ |
| 宽屏 · 基本信息页签 | 1440×900 | 528 / 528 | 无溢出（短内容不产生虚假空白滚动区） | 头部/页签/关闭按钮均在视口内可操作 | ✓ |
| 宽屏 · 讨论模块（.req-split 复用方） | 1440×900 | 详情高 655，底边 876 ≤ 900 | 内容短 scrollMax 0 | 详情不溢出工作区，无回归 | ✓ |

滚动条可见性：修复后长文档下 `drawer-body` `offsetWidth 926 - clientWidth 911 = 15px` 常驻滚动条占位
（全局 `scrollbar-width: thin` + `::-webkit-scrollbar` 主题，Chromium 自定义滚动条非 overlay，
滑块持续可辨识、可拖动；系统自动隐藏偏好只影响原生 overlay 滚动条，本实现不受其影响）。

### 3. 待人工浏览器复核项（自动化未覆盖）

- 深浅色下滑块辨识度、拖动滑块与触控板惯性手感（离屏环境无法感知视觉/手感）；
- 窗口实时拖拽缩放过程中的滚动范围跟随（实测为固定尺寸快照）；
- 验收清单其余条目建议按 README「验收说明」逐项人工勾选。

