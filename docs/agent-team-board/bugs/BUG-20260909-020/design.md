# 设计 — BUG-20260909-020 app 版本无法按住标题栏进行移动，请修复

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260905-001**「为看板增加 Electron 桌面壳」（编号经 `atb list` 核验真实存在，状态 in-progress）。
  该单决策 `titleBarStyle: 'hiddenInset'` 隐藏原生标题栏（`electron/main.mjs`），但壳层与 web 业务侧
  均未配套声明任何页面拖动区（`-webkit-app-region`），窗口移动能力随原生标题栏一起被移除。
  这不是后续改动引入的回归，而是建壳决策本身缺失配套——归因为源单而非某个中间修复。

## 根因分析

- macOS `hiddenInset` 隐藏原生标题栏后，窗口拖动依赖**页面内容声明的拖动区**
  （CSS `-webkit-app-region: drag`，Electron/Chromium 平台机制：drag 区鼠标事件交给系统用于移动窗口）。
- 全仓 grep（`electron/`、`scripts/`，排除 `node_modules`）`-webkit-app-region` / `app-region` **零命中**：
  壳层唯一注入样式 `TRAFFIC_LIGHT_INSET_CSS`（`electron/shell-css.mjs`）只做交通灯让位
  （`.topbar { padding-left: 78px !important }`，BUG-20260905-003 / BUG-20260909-019 口径），
  web 业务样式 `scripts/web/style.css` 也不含任何 app-region 规则。
- 结论：整页（含视觉上承担标题栏角色的 `.topbar`）不存在任何可拖区 → 按住顶栏拖动窗口纹丝不动。
  窗口其余能力（边缘缩放、交通灯关闭/最小化/缩放）由系统/原生控件提供，不受影响——与用户报告一致。

## 方案

沿 BUG-20260905-003 / BUG-20260909-019 建立的**壳层注入通道**（`webContents.insertCSS`，
`did-finish-load` 时注入、含 Cmd-R 重载），`electron/shell-css.mjs` 新增纯常量
`TOPBAR_DRAG_REGION_CSS`，与让位样式拼接为同一次注入；web 业务代码零改动，浏览器直连不加载。

```css
/* 拖动区：顶栏整体可拖（原生标题栏手感） */
.topbar { -webkit-app-region: drag !important; }
/* 交互控件豁免：项目切换器 / 待处理徽标 /「＋ 新建」及其容器（app-region 为继承属性，
   容器与子元素一并显式声明，防吞点击） */
.topbar .top-actions, .topbar .top-actions * { -webkit-app-region: no-drag !important; }
```

要点与定夺：

1. **拖动区范围**：`.topbar` 整条纳入（README 期望 1 留给本文件的定夺项）——品牌区、标题、路径、
   顶栏空白处均可拖，与原生标题栏手感一致；`.module-nav` 与页面其余区域**不纳入**（README 期望 2 默认口径），
   避免与列表 / 导航 / 搜索交互冲突。
2. **`!important`**：页面样式当前无任何 app-region 竞争声明（验收亦要求业务侧永不引入），normal 声明即可生效；
   但沿 BUG-20260909-019 建立的规范——壳层注入声明一律 `!important`，不依赖注入表与页面 `<link>` 的
   顺序（author origin 同 specificity 竞争下注入表不保证居后），杜绝未来意外压制导致的静默失效。
3. **不包 `@media`**：≤640px 竖屏分支仅改 `.topbar` 的 padding（8px 12px）与换行，元素仍在，
   drag 声明全宽度生效；深浅色外观无分支，无影响。
4. **`#pollState` / `#dataDir` 取舍**（README 期望 5 留档项，结论）：两者位于 `.brand` 内，**纳入拖动区**。
   代价：桌面壳内 `#pollState` 悬停 `title`（实时/离线说明）不再弹出、`#dataDir` 路径文本不可选中复制；
   状态本体不受影响（`● 实时` / `○ 服务离线` 文本与变色实时可见），浏览器直连两者完好。
   理由：原生标题栏文本同样不可选中、无悬停提示，符合平台习惯；若为两者挖洞（no-drag），品牌区会出现
   「拖不动的小洞」，破坏整条拖动手感，得不偿失。
5. **交通灯共存**：交通灯为原生控件不在页面内，不受 app-region 影响；让位 `padding-left: 78px` 规则
   与拖动区规则分别作用，同表注入互不压制。

## 风险与边界

- drag 区会吞区内鼠标事件：已用 no-drag 显式豁免 `.top-actions`（含子元素）；页面其余区域未纳入拖动区，
  无交互回归面。
- 注入失败可见性：沿用 BUG-20260909-019 的 `console.error` 通道，让位与拖动区拼接为一次注入，
  失败统一报错于终端。
- Cmd-R 重载 / 首次加载 / 任意宽度 / 深浅色：`did-finish-load` 重注入 + 规则不包 @media + 无外观分支，均覆盖。
- 浏览器直连零回归：本单不触碰 `scripts/web`（html/css/js），拖动区规则仅存在于壳层注入常量；
  测试补 web 目录静态断言（业务源无 app-region 字样）固化该口径。
- 边界外：双击顶栏最大化、窗口吸附等原生标题栏附加行为不在本单范围（hiddenInset + drag region 下
  由系统决定，未验证不承诺）。
