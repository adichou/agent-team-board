# 设计 — REQ-20260906-007 文件看板的目录树要改成横幅呈现，参考 codex 的文件右侧面板

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

- 现状：`#fileView` = 左 `#fileTree`（Wunderbaum 懒加载树，REQ-20260830-002）+
  竖向 `#fileSplitter` 拖拽调宽（REQ-20260906-004）+ 右 `#fileViewer`（hljs 高亮）。
- 痛点：深层级纵向占用高、缩进层级感过深；与 codex 文件面板（面包屑 + 分层横幅
  条带）的浏览习惯不一致。

## 方案

### 布局（scripts/web/index.html）

```
#fileView（纵向 flex，column）
  #fileBanner.file-banner（flex:none）
    nav#fileCrumb.file-crumb      —— 面包屑：项目根 › docs › agent-team-board › …（每段 button 可点）
    #bannerStack.banner-stack     —— 层级条带堆栈（overflow-y:auto，max-height 限高）
      .banner-row ×N              —— 每层一条：横向 chips（overflow-x:auto）
        .fchip.dir / .fchip.file  —— 目录 / 文件 chip（button，含 mask 矢量小图标）
  #fileViewer.file-viewer（flex:1 占满剩余，保留 hljs 高亮）
```

- 页面不再加载 `wunderbaum.umd.min.js`、`wunderbaum.css`、`splitter.js`；
  `fileTree` / `fileSplitter` DOM 移除。
- vendor 文件与 splitter.js 本体**保留在 web/ 目录不删除**（项目当前无版本控制，
  不可逆删除交给人工决定；未被引用即不加载）。

### 状态机（新模块 scripts/web/banner.js，UMD 双通道，参照 splitter.js 先例）

浏览器挂 `window.ATBBanner`（app.js 之前加载），Node 测试走 `module.exports`：

- `openLayer(layers, dirPath)`：进入目录。dirPath 已在层栈中 → 截断到该层（含）；
  否则追加为最深层。返回新层栈（不可变更新）。
- `truncateTo(layers, dirPath)`：面包屑回跳，截断到该层（含）。
- `crumbOf(layers)`：派生面包屑段数组 `[{ name, path }]`，首段为项目根（''）。
- `DEFAULT_PATH = 'docs/agent-team-board'`：默认展开路径（与旧树 expandDefaultPath 一致）。
- `ROOT_LABEL` 语义：根层显示项目短名（由 app.js 注入 label）。

### 渲染与交互（scripts/web/app.js）

- `state.banner = { layers: [{ path: '', label, entries }], activeFile: null }`，
  `state.tree` / splitter 系列（applyTreeWidth / storeTreeWidth / loadTreeWidth /
  resetTreeWidth / reclampTreeWidth / initFileSplitter / expandDefaultPath /
  TREE_ROOT_KEY）全部移除。
- `initFileBoard()`：幂等；加载根层后按 `DEFAULT_PATH` 逐层展开（沿用 /api/fs）。
- `renderBanner()`：整段重建 `#fileCrumb` + `#bannerStack`（层栈浅、重建成本可忽略，
  与看板轮询无耦合——文件视图不参与 2 秒轮询重渲染）。
- chip 点击用 `#fileBanner` 上的一次事件委托：目录 chip → `openDirLayer`（截断/
  追加 + 拉取 + `scrollIntoView` 滚入视野）；文件 chip → `openFile`（保留）+ 选中态。
- 面包屑段点击 → `truncateTo` + 重渲染。

### 样式（scripts/web/style.css）

- `.file-view` 改 `flex-direction: column`；`.file-banner`、`.file-crumb`、
  `.banner-stack`（max-height 限高 + overflow-y）、`.banner-row`（overflow-x）、
  `.fchip`（主题变量配色，`.active` 取 `--primary` 半透明，风格对齐
  `--wb-active-color` 旧值）。
- 移除 `.file-tree`、`.file-splitter` 系列、`body.splitting` 与全部
  `div.wunderbaum` 覆盖规则；F12 滚动条主题规则与树无关，保留。
- 目录/文件小图标沿用 mask 矢量方案（复用旧树 folder / file-earmark 的 SVG data-uri）。

## 风险与边界

- **退役已验收功能**：REQ-20260906-004 分隔条与 REQ-20260830-002 树主题随之退役
  （REQ-004 尚 in-progress）。对应契约测试处理：file-board F10/F11/F13 删除，
  F7 改写并加「不再引用 wunderbaum/splitter」退役守卫；file-splitter S1–S4 保留
  （splitter.js 纯函数仍在，测试仍有效），S5–S7 改为退役守卫。
- 深目录多层条带堆叠：`banner-stack` 限高 + 纵向滚动，文件内容区不被挤压；
  新条带 `scrollIntoView` 自动滚入。
- 大目录横向溢出：条带 `overflow-x: auto`，chip `flex:none`。
- 安全：chip 名与路径均走 `esc()`；目录跳转路径由层栈拼接 `/api/fs` 返回的
  entry.name，不引入新的注入面；后端越界 400 防护（F3）不变。
