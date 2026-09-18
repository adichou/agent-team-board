# BUG-20260903-003 文件视图暗色模式下滚动条为亮白色，与主题割裂

- 状态：submitted（待人工接受）
- 归属需求：REQ-20260830-002
- 创建：2026-09-03T01:34:15.095Z

## 现象

File Board 视图下，左侧文件树面板（`.file-tree`）与右侧内容区（`.file-viewer`）的纵向滚动条在**暗色模式**下呈现亮白色轨道/滑块，与整体暗色主题明显割裂（2026-09-03 复核 1280px 截图可见，状态视图列内滚动条同样偏亮）。

属 BUG-20260830-002 主题适配的遗漏点：该单适配了 Wunderbaum 的 `--wb-*` 主题变量与图标，但未处理原生滚动条样式。纯视觉问题，不影响功能。

## 复现步骤

1. 系统外观切到深色，打开 Status Board 文件视图；
2. 树内容超出面板高度出现滚动条（本项目树恰好出现）；
3. 观察右侧滚动条为亮白色。

## 根因分析

REQ-20260830-002 引入 File Board 的滚动容器（`.file-tree` / `.file-viewer`）与看板列内滚动（`.col-cards`）时，只对 Wunderbaum 的 `--wb-*` 主题变量与图标做了双主题适配，**未对原生滚动条做任何样式定义**（`style.css` 中无 `scrollbar-*` 规则）。滚动条因此取浏览器默认配色——Chromium/WebKit 默认滑块近亮白，在暗色主题下与面板形成强烈割裂；状态视图列内滚动条同理。纯视觉问题，不影响功能。

## 期望行为

- [x] 暗色/浅色模式下滚动条颜色跟随主题（如 `scrollbar-color` / `::-webkit-scrollbar` 按双主题变量设置）
- [x] 文件树、内容区、看板列内滚动容器一致处理

## 修复方案（2026-09-05）

`scripts/web/style.css` 双通道实现，颜色全部取主题变量，无需逐容器枚举：

1. **双主题变量**：`:root` 与暗色媒体查询各定义 `--scrollbar-thumb` / `--scrollbar-thumb-hover`（亮色取 `--muted` #66748c 系 35%/55%，暗色取 #8b98ad 系 30%/50%，与界面次要色同色系）；
2. **标准属性通道**：`html { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent }`——两属性随继承覆盖**所有**滚动容器（文件树、内容区、看板列、抽屉、代码块、竖屏横滑板），轨道透明透出面板底色；
3. **WebKit 兜底通道**：全局 `::-webkit-scrollbar` 8px + 圆角滑块（同变量）+ 轨道/角透明，覆盖不支持标准属性的旧 Safari/Chromium；支持 `scrollbar-color` 的引擎（Chrome 121+/Firefox/Safari 18.2+）按规范忽略 `::-webkit-*`，两通道取同一变量，双主题自动跟随。

测试：F12 契约用例（`scripts/tests/file-board.test.mjs`）先红后绿；20 组测试回归中 19 组全绿（`default-port.test.mjs` V7 为环境性失败——运行中的 Status Board 实例占用 8888，与本改动无关）。

## 关联（引入来源）

- 引入来源：REQ-20260830-002（File Board 引入树面板与内容区滚动容器时未做暗色滚动条适配）

