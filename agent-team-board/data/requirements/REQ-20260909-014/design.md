# 设计 — REQ-20260909-014 需求模块详细页面的说明，设计，测试用例文档支持右键菜单“讨论”

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

需求详情抽屉五页签布局（REQ-20260909-006）下，说明 / 设计 / 测试用例三份文档以渲染态展示在
`#docView`，无视觉行号。用户就某段内容找 Agent 讨论时，要么走 REQ-20260909-003「文档讨论」成套
流程（仅 README.md、要先「开始讨论」生成编号），要么去文件模块查源码复制行号——都绕开了正在阅读
的位置。本需求补一个免流程的轻量右键入口：右键文档内容 →「讨论」→ 把 所选文字（或落点）+ 文档
路径 + 源码行号复制到剪贴板，粘贴到任意会话即用。

## 方案

纯前端实现，改动仅 `scripts/web/app.js`（主逻辑）+ `scripts/web/style.css`（菜单样式），不动后端、
不写文件、不改状态机。

### 1. 源行标注（渲染态 → 源码行的映射基础）

- `loadDoc` 渲染后调用 `annotateDocLines(view, res.content)`：对 `#docView` 顶层块级元素按序与
  `parseDocBlocks(md)` 解析出的 1 基源行块 1:1 配对，直接在元素上写 `data-doc-start / data-doc-end /
  data-doc-kind`（不包 wrapper div，零布局影响）。缓存（docCache）改存标注后的 HTML，页签缓存回填
  自动保留标注。
- `parseDocBlocks` 适配自 req-disc.js `parseBlocks`（README 待确认项「复用或抽公共」的结论：**复制
  副本到 app.js 而不改 req-disc**——req-disc 的解析语义服务于其阅读模式，本需求需按下述 CommonMark
  化增强才能与 marked 顶层节点稳定对齐，改公共函数会波及 REQ-20260909-003 行为）。增强点：
  松散列表跨空行合并同类同族行；吸收缩进续行 / 嵌套栅栏；段后未缩进**懒续行**并入列表 / 引用块；
  围栏按**开栏记号长度**收束（```` 内含 ``` 不误闭）；引用跨空行分块（marked 渲染为两个
  blockquote）；有序 / 无序**异族列表相邻**分块。
- `docBlockMatches` 配对校验：渲染元素文本（仅留字母数字）应是块源文本的**子序列**（marked 只删改
  标记不改字符顺序）。一旦失准**立即停止标注**——失准区域右键不弹菜单，绝不给错行号（宁缺勿错）。
- 对齐率验证：对仓库 447 份真实条目文档（requirements + bugs 的 README/design/test-cases），
  `parseDocBlocks` 块数与真实 marked 顶层节点数 **447/447 全部一致**。

### 2. 右键入口与菜单

- `document` 级 `contextmenu` 委托绑定一次（`#docView` 随抽屉轮询重建，绑子节点会失效）：落点在
  `#docView` 内、需求单（`type === 'requirement'`）、当前文档页签就绪（`state.drawer.doc === tab`，
  天然排除 未创建/加载中/失败态）且能解析出引用时 `preventDefault` 弹菜单；其余一律放行浏览器原生
  右键。
- 菜单 `openDocCtxMenu`：单例 fixed 浮层（.doc-ctx-menu，面板变量体系 --panel/--border/--shadow，
  无新配色），单项「💬 讨论」；右 / 下溢出视口时向左 / 上内收。收起通道：点外部（pointerdown 捕获）/
  Esc（捕获且 stopPropagation，不连带关抽屉）/ 任意滚动（捕获，含文档区内部滚动）/ resize；
  `renderDrawer` / `activateDrawerTab` / `closeDrawer` 主动收起（DOM 已重建 / 切页签 / 关抽屉）。
  打开期间不阻止滚动与文字选择。

### 3. 引用组装与复制

- 打开菜单时即快照引用信息（点击会清除文档选区，不能点击时再取）；点「讨论」→ `copyPlain`
  （navigator.clipboard 优先 + execCommand 降级）→ 成功 toast `已复制 引用：<文档> 第 x–y 行`；
  失败 toast + `uiCopyBox` 页内自绘只读文本域（全选态）供手动复制——**不用 window.prompt**
  （IAB 内同步弹窗会冻结页面，同 uiConfirm 自绘原因）。
- 行号映射：有选中时，两端都落在已标注块内才用选区；单块段落 / 围栏代码内按换行精确到行
  （`docSelLines`，同 req-disc `onReaderSelect` 口径，围栏偏移首行 ```）；跨块或列表 / 表格等富文本
  取**覆盖块的行范围**（可确定的范围，不拒绝复制）。无选中时取右键落点块的行范围。
- 复制文本格式（自包含，Agent 不打开看板也能定位）：

  ```
  REQ-20260909-014 / design.md 第 3–8 行
  文档：<项目根>/docs/agent-team-board/requirements/REQ-20260909-014/design.md
  原文：
  <所选文字原文>          ← 无选中时无本节
  ```

### 影响面

- `loadDoc`：渲染后加标注、缓存改存标注后 HTML（渲染语句与 `docCache[name] = html` 契约保留，
  drawer-tabs-20260909-006 / item-demo-link / item-shot-ui 既有断言不变）。
- `renderDrawer` / `activateDrawerTab` / `closeDrawer`：各加一行 `closeDocCtxMenu()`（其 vm 桩在
  drawer-tabs-20260909-014 测试补 `closeDocCtxMenu: () => {}`）。
- 新增样式 `.doc-ctx-menu` / `.doc-ctx-item`（style.css 末尾，含 :focus-visible）。
- 不新增后端 API、不写任何文件 / 记录、不生成讨论编号；与 REQ-20260909-003「文档讨论」并存互不影响。

## 待确认项结论（README「待确认」逐条）

1. **复制文本格式**：附单号（首行 `单号 / 文档名 第 x–y 行`）；路径用**绝对路径**（同 req-disc 引用
   复制的 docPath 拼法，Agent 可直接按路径打开）；无选中时**不附**原文快照（目标口径 3 明确「无选中
   时为路径 + 行号」）。
2. **范围**：仅需求详情抽屉（README 默认口径，Bug 单不启用）；**test-report.md 附加页签包含**（同一
   `#docView` 渲染路径，行为零差异，一并覆盖三份文档一致的验收口径）。
3. **映射实现**：复制 `parseBlocks` 副本到 app.js 做 CommonMark 化增强（见方案 1，不改 req-disc 原
   函数）；跨块 / 列表表格内选择**复制可确定的行范围**（整块覆盖），不提示改选。
4. **链接 / 图片右键**：放行原生菜单（保留复制链接地址 / 存图能力；演示链接与截图放大走左键不受影响）。
5. **菜单形态**：单项「💬 讨论」带图标、无快捷键提示；空态（未创建/加载中/失败）**不弹菜单**（落点
   无已标注内容即放行原生，等效不可用反馈且实现无特判）。

## 风险与边界

- **配对失准兜底**：极端 markdown 形态（如 raw HTML 块被 marked 拆成多节点）可能使顺序配对失准；
  `docBlockMatches` 子序列校验检测到即停止标注，该区域右键回退原生菜单——不会出现错行号。
  仓库全部 447 份真实文档实测块数与 marked 顶层节点 100% 对齐。
- **懒续行近似**：列表 / 引用块后的未缩进段落行按 CommonMark 懒续行并入；仅当上一吸收行是围栏收束行
  时不并入（彼时 marked 会结束列表）。真实文档全量验证通过。
- **Electron / IAB**：壳层无右键菜单注册，页面菜单即最终行为；菜单纯前端浮层无异步态。
- **回归面**：npm test 124 个测试文件全绿（含本条目新增 doc-ctx-discuss-20260909-014 17 项断言）；
  文档页签按需加载 / 缓存回填 / 演示链接 / 相对截图接管契约断言均未改动语义。

## 实施记录

- 2026-09-09（zcode-batch-027-1）：TDD 先红后绿。新增
  `scripts/tests/doc-ctx-discuss-20260909-014.test.mjs`（T1–T10，17 项断言：parseDocBlocks 纯函数
  vm 测试、annotateDocLines 配对与失准守卫、docSelLines 精确行映射、buildDocRef 组装、右键入口 /
  菜单收起 / 复制链路 / 样式静态契约、真实 marked 顶层节点数对齐）；app.js 新增「文档页签右键
  『讨论』」小节（14 个函数）与 loadDoc 标注接线、三处关菜单收口；style.css 新增菜单样式。
  真实文档对齐核查脚本（447/447）结果记录于 test-report.md。
