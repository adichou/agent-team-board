# BUG-20260914-020 已合并的版本计划不允许再使用 AI 完善按钮了。

- 状态：accepted（已接受；实际状态以 status.json 为准）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-14T15:21:36.716Z

## 现象

构建模块「版本计划」页签的每张版本卡片内有三个行内操作按钮（AI 完善 / 合并入 main / 删除，BUG-20260913-004 迁入）。其中「AI 完善」按钮的禁用条件**只覆盖 merging 状态**：`scripts/web/build.js` 的 `renderVersionList()`（约 911–924 行，answerBtn 在 913 行）仅当 `v.status === 'merging'` 时输出 `disabled title="合并中，请稍候……"`。于是**已合并（merged）版本的卡片上「AI 完善」按钮仍是可点击状态**，与同一行内另外两个键的锁定口径不一致：

- 「合并入 main」对 merged 已禁用（`disabled title="已合并入 main"`，build.js 914 行）；
- 条目增删 / 换选 commit 对 merging、merged 锁定（前端 `lockItems`，build.js 979 行；数据层 `assertItemsEditable`，`scripts/lib/build-store.mjs` 173–176 行：「版本已合并，条目已锁定（如需调整请新建版本）」）；
- 唯独 AI 完善入口在 merged 态完全放行。

点击 merged 卡片上可用的「AI 完善」按钮，`openAnswerModal`（build.js 514–520 行）无任何状态校验，弹窗正常打开；整个两段式流程（复制提示词 → 粘贴回答 → 解析并预览 → 应用）在 merged 版本上全部可走通——「应用」经前端 `applyParsed`（约 698 行）→ `saveInfo` 封装（约 435–446 行）→ `POST /api/build/version/save`（`scripts/server.mjs` 2138–2143 行）→ 数据层 `buildStore.saveInfo`（build-store.mjs 178–187 行），其后置校验 `assertEditableStatus`（166–170 行）**同样只拦 merging**，merged 版本的名称与描述被直接改写，toast 回显「✓ 已应用回填：版本名称与描述已更新」。

即：一个已合并入 main、条目已锁定的版本，仍可通过 AI 完善按钮改写其版本信息，用户会误以为已合并的版本还能继续完善——与标题要求「已合并的版本计划不允许再使用 AI 完善按钮」相悖。

现状链路（均经源码核实，2026-09-14）：

1. **渲染**：`renderVersionList()`（build.js 约 911–924 行）——answerBtn 禁用条件仅 `merging`；mergeBtn 对 merging / merged / 全局 mergeBusy 禁用；删除键对 merging 禁用（merged 可删，仅移除看板记录）。
2. **入口**：卡片按钮点击绑定（build.js 约 1351 行）→ `openAnswerModal(verId)`（约 514–520 行）——只查版本存在性，不校验状态；无参调用时回落当前选中版本（防御路径同样无状态校验）。
3. **写入**：弹窗「应用」→ 前端 `saveInfo` → `POST /api/build/version/save` → `buildStore.saveInfo` → `assertEditableStatus` 仅拦 `merging`（server.mjs 2027 行注释亦写明「merging 锁定」）。
4. **测试基线**：`scripts/tests/bug-build-ver-card-acts-20260913-004.test.mjs` B2（96–116 行）只断言 merging 的 AI 完善禁用（107 行）与 merged 的合并键禁用（109 行），**未覆盖 merged 的 AI 完善按钮**——修复后需补断言。

## 复现步骤

前置：项目目录运行 `atb serve`（默认端口 8888，`ATB_PORT` 可覆盖），浏览器打开 `http://localhost:8888`，顶栏选中该项目；且构建模块已有一张**已合并（merged）**状态的版本卡片（若无：对任一含 commit 关联条目的 draft 版本走「合并入 main」确认流程，直至其状态变为「已合并」）。

1. 进入「构建」模块，停在默认「版本计划」页签，等待版本列表加载完成。
2. 找到状态为「已合并」的版本卡片，观察其底部行内按钮：「合并入 main」呈禁用（悬停 title「已合并入 main」）、「删除」可用，而「AI 完善」**仍为可点击状态**（悬停 title 为「复制提示词给 Agent，回答直接粘贴回本弹窗自动解析」）——即本 Bug 现象的界面侧。
3. 点击该 merged 卡片的「AI 完善」：弹窗正常打开（标题「AI 完善（BLD-…）」），上段提示词可复制、下段回答框可粘贴。
4. 在回答框粘贴符合约定格式的回答（`版本名称：…` / `版本描述：…`），点「解析并预览」：解析成功，出现可编辑的名称 / 描述预填表单。
5. 点「应用」：出现 toast「✓ 已应用回填：版本名称与描述已更新」，左侧 merged 卡片的版本名称 / 描述已被改写——已合并的版本被 AI 完善成功改写，即本 Bug 现象的完整链路。
6. 对照实验：找一张「合并中（merging）」卡片，其「AI 完善」按钮为禁用态（title「合并中，请稍候……」）；再找一张「计划中（draft）」卡片，AI 完善可用且应用正常——说明锁定口径本应覆盖不可编辑态，唯独漏了 merged。

## 期望行为

- **merged 卡片的「AI 完善」按钮禁用**（`disabled`），并以 title 说明原因（措辞参照同行合并键「已合并入 main」的口径，如「已合并入 main，不允许再 AI 完善」；最终措辞开发阶段定夺，i18n 如需新增词条同步 `scripts/web/i18n.js`）。
- 所有打开 AI 完善弹窗的路径对 merged 版本一律不生效：卡片按钮禁用后天然不可触发；`openAnswerModal` 无参回落当前选中版本的路径同样不弹窗（防御性口径，具体由开发阶段设计定夺）。
- 其余状态零回归：draft / failed 的「AI 完善」维持可用；merging 维持现状禁用（title「合并中，请稍候……」）；弹窗内两段式流程、解析 / 即时校验 / 应用反馈不变。
- merged 版本其余既有口径零回归：合并键禁用（已合并入 main）、条目增删与换选 commit 锁定、删除仅移除看板记录。
- 范围边界（待确认）：merged 版本在右侧详情的名称 / 描述**手动行内编辑**目前是允许的（`saveInfo` 仅 merging 锁定），本单标题只指向「AI 完善按钮」入口，默认不动手动编辑口径，也不收窄 `POST /api/build/version/save` 对 merged 的写入；如需一并锁定另行确认。

## 验收说明

1. **merged 禁用**：已合并卡片的「AI 完善」按钮呈禁用态，悬停 title 说明已合并不可再 AI 完善；点击（鼠标 / 键盘聚焦回车）均不弹窗、无任何请求发出。
2. **状态矩阵回归**：draft / failed 的 AI 完善仍可用（可打开弹窗并完整走通复制 → 解析 → 应用）；merging 维持禁用与「合并中，请稍候……」提示；四状态卡片的合并键 / 删除键口径与现状一致。
3. **防御路径**：当前选中版本为 merged 时，经无参入口（如测试直调 `openAnswerModal()`）也不弹窗（若开发阶段落实该防御口径）。
4. **锁定口径一致**：merged 卡片三个行内键中，AI 完善与合并入 main 均禁用且 title 可解释，删除维持可用；修复后不再出现「已合并版本信息被 AI 完善改写」的路径。
5. **测试同步**：`scripts/tests/bug-build-ver-card-acts-20260913-004.test.mjs` B2 补 merged 的 AI 完善禁用断言（禁用 + title 口径），必要时新增用例覆盖防御路径；`node scripts/tests/run-all.mjs` 全量通过。
6. **外观与壳**：深浅色与 Electron 桌面壳内表现一致；禁用态样式沿用按钮既有 disabled 口径，无新增样式依赖。

## 界面展示

可交互演示：[`./ui-demo.html`](./ui-demo.html)（单文件、内联 CSS / JS、无外网依赖、无构建步骤，浏览器直接打开可交互；数据为模拟，不连真实看板、不发真实请求、不执行真实 git 操作）。

- 界面布局：还原构建模块「版本计划」页签的左侧版本卡片列表（标题 + 状态章 + 单号 / 关联数 / 更新时间 + 行内三键「AI 完善 / 合并入 main / 删除」）与「AI 完善」两段式弹窗（上段只读提示词 + 复制、下段回答粘贴 → 解析预览 → 可编辑表单 → 应用）；右侧为状态矩阵与判定面板，逐状态标注 AI 完善可用 / 禁用及原因。
- 交互行为：一键切换「当前（缺陷）/ 修复后」两种模式对照——缺陷态 merged 卡片的 AI 完善可点击并完整走通改写已合并版本信息（红色标界复现过程）；修复态 merged 的 AI 完善禁用（title 说明），draft / failed 仍可正常使用；卡片可点选，合并 / 删除键给出范围说明反馈；弹窗内解析失败、名称清空即时校验、应用中忙态均有反馈。
- 状态反馈：列表数据状态可切「正常 / 加载中 / 加载失败 / 空」（失败可重试恢复）；toast 呈现复制成功、应用成功等口径；深浅色随系统并可手动切换。

## 关联

- 引入来源：BUG-20260913-004（commit 26fc9de——「提示词与回答回填」更名「AI 完善」并迁入左侧版本卡片时，禁用口径只按 merging 继承，未覆盖 merged）；根源可追溯 REQ-20260913-001 构建模块首版（commit ff5ed18，经 BLD-20260914-001 合并入 main）。归因以 design.md 落定为准。
- 相关：REQ-20260913-006（AI 完善弹窗可编辑回填表单，应用链路口径）、REQ-20260913-004（删除版本——merged 删除仅移除看板记录的锁定语义对照）。
