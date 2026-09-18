# 设计 — BUG-20260911-003 发布模块界面的新建发布按钮点击无反应，右上角的正常

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260910-029**（经 `atb list` 核验真实存在，状态 in-progress）。发布模块前端首版
  （`scripts/web/release.js`）即在工具栏与空态卡重复输出 `id="relNewBtn"`，且 `bindCommon()` 以
  `view.querySelector('#relNewBtn')` 只绑定文档序首个节点。REQ-20260910-030（Electron）仅在空态追加
  指引文案，未触及入口渲染与绑定（run-20260911-187 报告「空态 electron 指引」佐证空态卡先于该单存在）。
  仓库仅一次初始化提交、该文件未提交，无法定位具体 commit，以条目实现记录与源码现状核验。

## 根因分析

- `render()` 在无发布运行时（`!runs.length`）同时输出：工具栏按钮与空态卡按钮，两处 id 相同。
- HTML 规范要求 id 在文档内唯一；重复时 `querySelector('#relNewBtn')` 只返回文档序首个（工具栏按钮，
  innerHTML 中工具栏在空态块之前）。`bindCommon()` 仅为该节点挂 click 监听，空态入口因此无任何监听，
  点击静默无反应；右上角入口正常——与用户反馈完全一致。
- 既有 `release-ui.test.mjs` 的 vm 接缝按「选择器 → 惰性单节点」模拟 DOM，`querySelector` 永远返回同一个
  自动创建的节点，掩盖了「重复 id 只绑首个」的真实浏览器路径，故 U5 空态用例未发现本缺陷。

## 方案

- 空态卡按钮改用独立 id `relEmptyNewBtn`（工具栏保留 `relNewBtn`：style.css 的
  `.release-toolbar #relNewBtn` 定位与既有测试接缝均依赖它）。
- `bindCommon()` 提取 `openNewPanel()`（维持既有默认：目标类型 git、sourceBranch 取当前分支，不随目标
  筛选联动），对 `#relNewBtn` 与 `#relEmptyNewBtn` 各绑定同一动作——id 唯一化后两入口等价，一次点击
  只渲染一个面板；打开/关闭纯前端状态切换，不产生任何请求副作用（测试 T2 断言零 POST）。
- 测试（`scripts/tests/release-empty-new-btn-20260911-003.test.mjs`）：新增忠实接缝——按 innerHTML 内 id
  出现顺序登记节点，`querySelector` 返回文档序首个、`querySelectorAll` 返回全部，与真实浏览器语义一致，
  复现并守护双入口绑定路径（T1/T2 行为、T3 唯一 id 契约、T4 非空态回归、T5 ui-demo 离线自包含）。

**开源选型（REQ-20260909-015）**：未引入开源库——修复仅涉及本仓库 2 处既有代码路径（模板 id 改名 +
重复绑定），无第三方库可复用场景；自研理由：改动量与语义风险远低于引入 DOM/测试库（项目无 jsdom 依赖，
vm 接缝为既有约定）。未创建 licenses.md（未使用开源库）。

## 风险与边界

- 不改变面板字段、默认值与后续流程（保存草稿 / 预检 / 计划确认启动均不动）；仅绑定层修复。
- 不修改/删除用户未提交改动；不自动 commit。ui-demo.html 为需求阶段产物、已覆盖缺陷/修复对比，未改动。
- 回归范围：release 系列测试（ui/electron/sub-generic/apple/git/serve/store）与全量 186 个测试文件通过。
- 真实浏览器实机验证（鼠标 + 键盘、刷新/切筛选后持续有效）留待人工按 README 验收清单确认。
