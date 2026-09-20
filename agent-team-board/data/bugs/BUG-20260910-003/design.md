# 设计 — BUG-20260910-003 详细页面中的说明，方案等内容的呈现没有滚动条，请修复

> 由 Agent 在 /dev 开发前补充，人可随时批注。
> 2026-09-10 zcode-batch-031-3 实施时补全：根因已实测定位，修复已落地。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- **引入来源：REQ-20260907-004（看板整体布局优化：统一导航、三类新建入口与列表工作区）**
- 编号经 `atb list` 核验真实存在（2026-09-10，REQ-20260907-004 已完成）。
- 归因依据：`scripts/web/style.css` 中 `.req-split > .drawer` 规则注释明确标注宽屏 split 常驻右栏布局由
  REQ-20260907-004 引入（「REQ-20260907-004：需求详情在宽屏为 split 右侧常驻栏（非覆盖抽屉）」）。
  该网格自建立起只有 `grid-template-columns`，从未对行高施加约束（隐式 `auto` 行随内容增长），
  结构性缺陷（详见下方根因）由此埋下；后续条目（REQ-20260908-005 窄屏覆盖层、REQ-20260909-006
  详情页签化、BUG-20260909-018 抽屉高度利用）均未触及行尺寸。BUG-20260909-018 的 README 亦自述
  「抽屉本身是撑满工作区高度的」——该判断在长内容下不成立，属于对隐式 auto 行的误解而非新引入。
- 排查过程备注：仓库 git 历史已压缩为单个初始化提交（`0f84698`），无法用逐提交 diff 定位；
  归因基于现存 CSS 注释谱系（各条目改动均留有编号注释）、BUG-20260909-018 同期文档佐证与
  当前代码实测，非编造。

## 根因分析

**离屏 Electron（项目自带 electron 37，BrowserWindow show:false）实测复现，2026-09-10，1440×900 视口，
REQ-20260910-002「说明」页签（README 渲染后约 3173px 高）：**

- `#drawer`（宽屏 split 常驻右栏，`position: static` 网格项）实测高度 **3343px**（视口仅 900px）；
- `.req-split` 网格行高 3357px，而 `.req-split` 自身可用高度 695px（`flex:1 + min-height:0`）——
  **隐式 grid 行为 `auto`，按内容（抽屉内长文档）取高，无任何上限**；
- 溢出部分被 `.req-view { overflow: hidden }` 直接裁剪；
- 自 `#docView` 向上的祖先链（doc pane → drawer-body → #drawer → .req-split → #reqView → body）
  **没有任何元素可滚**（overflow-y 全为 visible/hidden；drawer-body 虽有 `overflow-y: auto`，
  但其自身高度已随内容撑到 3213px，无溢出可言；程序化 `scrollTop = 999999` 实测 `max = 0`）。

即：宽屏下抽屉列高度不受工作区约束，长文档把网格行撑高后超出部分被静默裁掉——
「没有滚动条」的真实含义是**没有滚动容器**，内容下半部分完全不可达，与原始截图（正文超出下缘、
右侧无滑块）一致。窄屏（≤1020px）抽屉为 absolute + top/bottom:0（REQ-20260908-005），
天然有确定高度，不受本根因影响。

先前怀疑并被排除的方向：`.drawer-body` 缺 overflow 声明（实际已有 auto + flex:1 + min-height:0）、
macOS 系统自动隐藏滚动条（实测为布局塌陷，非滚动条显示偏好问题）。

## 方案

**CSS 单点修复（自研，无新增依赖）**：`.req-split` 显式声明 `grid-template-rows: minmax(0, 1fr)`，
把网格行锁定为工作区高度：

- `minmax(0, …)` 的 **min 0** 是关键：纯 `1fr` 等价 `minmax(auto, 1fr)`，auto 最小值仍按内容计，
  长文档照旧撑爆；min 0 后行高恒等于 `.req-split` 的确定高度（来自 `flex:1 + min-height:0`）；
- 抽屉列随之获得确定高度，既有滚动链接管：`.drawer-body`（`overflow-y: auto` + `flex:1` +
  `min-height:0`）成为唯一滚动容器，头部/页签栏在其外保持固定；
- 窄屏不受影响（抽屉 absolute 定位不参与行尺寸，列表列同享确定行高、内部 `.req-list` 照常滚动）；
  讨论模块 `.disc-view .req-split` 复用同一规则同步受益；
- BUG-20260909-018 的短文档拉伸填满（doc pane / `.md` 均 `flex:1`）不受影响，实测短内容
  `scrollHeight == clientHeight`，不产生虚假空白滚动区。

**开源选型（REQ-20260909-015）**：本修复为一行 CSS 布局约束（grid 行尺寸语义），属浏览器内建布局
能力，无对应可引入的开源库需求；自研理由：无合适库（纯 CSS 标准属性即可解决）。
未引入任何开源库，不创建 licenses.md。

**测试（TDD，先红后绿）**：新增静态契约测试 `scripts/tests/drawer-doc-scroll-20260910-003.test.mjs`
（S1 根因约束 / S2 滚动链 / S3 BUG-20260909-018 不回退 / S4 窄屏不回退，与 `drawer-height.test.mjs`
同款 CSS 解析器）；S1 在修复前跑红、修复后跑绿。另以离屏 Electron 实测六组场景取证（详见 test-report.md）。

## 风险与边界

- `.req-split` 行为从内容自适应改为锁定工作区高度：列表栏（`.req-list-wrap`）在宽屏从「随内容收缩」
  变为「恒满工作区高度」（带边框底色的面板框）。列表内部本就有 `flex:1 + min-height:0 +
  overflow-y:auto` 滚动，功能无变化，视觉上边框底色恒撑满——与详情栏、讨论模块一致，属改善而非回退；
  `drawer-height.test.mjs` D1–D5 全部保持通过。
- 极窄/极矮窗口：行高锁定后抽屉不溢出工作区，正文始终可滚到达，符合验收「窗口高度缩小后仍可阅读全文」；
- 空内容/加载失败态不受影响（drawer-empty 为 flex 居中，自然填满）；
- 不触碰窄屏覆盖式抽屉定位、遮罩、REQ-20260908-005 口径与讨论模块自有 body 布局
  （`.oncall-drawer .drawer-body`），`oncall-ui` / `discussion-*` 等相关测试全量通过。
