// 桌面壳注入样式 —— 纯 Node 常量模块（BUG-20260905-003 / BUG-20260909-019）。
// 供 Electron 主进程与测试共用，禁止 import electron（保持可测，同 service.mjs 约定）。
// 背景：macOS hiddenInset 交通灯（关闭/最小化/最大化）悬浮于窗口左上，约占 70px 宽，
// 会遮挡看板顶栏 .brand（logo + 标题 + 数据目录）。经 main.mjs 的 webContents.insertCSS
// 注入下方让位样式，仅为壳层窗口生效；scripts/web 业务代码零改动，浏览器直连不受影响。
// BUG-20260909-019 根因：insertCSS 注入表与页面 <link> 的 style.css 同为 author origin，
// .topbar 规则同 specificity 时不保证排在页面规则之后，实测被 `.topbar { padding: 10px 18px }`
// 压制（注入即失效）。修复：让位声明带 !important——author important 恒胜 author normal，
// 不依赖样式表注入顺序；且不包 @media，保证 ≤640px 竖屏分支（页面 padding 覆盖为 8px 12px）
// 同样让位（该分支仅 padding-left 被 !important 长属性覆盖，其余方向与换行行为不变）。
export const TRAFFIC_LIGHT_INSET_CSS = `
/* 桌面壳交通灯让位（仅 Electron 窗口注入生效，浏览器直连不加载本规则） */
.topbar { padding-left: 78px !important; }
`;

// BUG-20260909-020：hiddenInset 隐藏原生标题栏后，窗口拖动依赖页面声明的拖动区
// （-webkit-app-region: drag，Chromium 平台机制）。全仓此前无任何 app-region 规则，
// 故「按住顶栏移动窗口」完全失效。修复：顶栏 .topbar 整体纳入拖动区（承担标题栏角色，
// 原生手感）；顶栏交互容器 .top-actions（项目切换器 / 待处理徽标 /「＋ 新建」）及其子元素
// 显式 no-drag 豁免——drag 区会吞鼠标事件，且 app-region 为继承属性，容器与子元素一并声明。
// REQ-20260910-012：模块页签上移并入顶栏后，页签组 .module-nav 同样须 no-drag 豁免
// （页签可点击切换模块），页签以外的顶栏空白仍可拖动窗口。
// 声明一律带 !important（沿 BUG-20260909-019 规范：壳层注入不依赖注入表与页面 <link> 的顺序）；
// 不包 @media，≤640px 竖屏分支顶栏同样需要可拖。取舍：#pollState 悬停提示与 #dataDir 文本
// 选择在桌面壳内失效（详见条目 design.md），换取品牌区整块可拖；浏览器直连不加载本规则。
export const TOPBAR_DRAG_REGION_CSS = `
/* 桌面壳顶栏拖动区（仅 Electron 窗口注入生效，浏览器直连不加载本规则） */
.topbar { -webkit-app-region: drag !important; }
.topbar .top-actions, .topbar .top-actions * { -webkit-app-region: no-drag !important; }
.topbar .module-nav, .topbar .module-nav * { -webkit-app-region: no-drag !important; }
`;
