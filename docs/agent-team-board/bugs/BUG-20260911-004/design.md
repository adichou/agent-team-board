# 设计 — BUG-20260911-004 营销模块的概览页面还是有问题，需要 Cmd+R 才能看到数据

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：**REQ-20260910-019**（`atb list` 核验存在，状态 in-progress）。营销模块四页签骨架与
  页签切换（`scripts/web/marketing.js` 的 `setTab()` / `render()` pane 属性）均出自该需求的
  未提交实施产物（git 无历史，文件为工作区新文件），属性错配随骨架一并引入；
  REQ-20260910-020/021 只在既有骨架上追加了后两页签内容。

## 根因分析

`render()` 渲染四个 pane 时写入的属性是 `data-mkt-pane="overview|positioning|channels|review"`
（marketing.js render() 内），而 `setTab()` 切换页签时判定用的是
`p.dataset?.pane !== tab`（对应 `data-pane` 属性，marketing.js setTab() 内）。两者键名不匹配：
`dataset.pane` 恒为 `undefined`，`undefined !== tab` 恒为真，于是**任何一次页签切换都会给全部
四个 pane 加上 `hidden`**，整个内容区变空白。

- 路径一（模块内页签）：点击任意页签 → 全部 pane 隐藏。「渠道与行动」「效果与复盘」首次进入会
  拉取看板 / 效果数据并触发完整 `render()` 自愈，因此这两页看起来正常；但「定位与定价」页与
  返回「概览」后没有任何重绘，内容持续空白，与用户反馈一致。
- 路径二（跨模块重入）：`enter(project)` 同项目重入且已有数据时不重新拉取、`state.rendered`
  已为真也不再 `render()`，DOM 保持最后一次 `setTab` 留下的「全部 hidden」状态，概览仍空白。
- Cmd+R 后整页重新执行 `refresh() → render()`，`render()` 用 `state.tab === 'overview'`
  正确控制 hidden，数据恢复 —— 解释了「刷新后重新出现」。
- 静态阅读漏因：README「已核实依据」只对比了数据流（setTab 不清数据、enter 不重拉），
  未核对 setTab 操作的 DOM 属性与 render 产出的属性是否同名；既有 marketing-ui 测试的
  fake DOM `querySelectorAll()` 恒返回 `[]`，pane classList 切换逻辑从未被覆盖。

修复方案：`setTab()` 改读 `p.dataset?.mktPane`（与 render 写入的 `data-mkt-pane` 同名，
且保持营销模块 `data-mkt-*` 命名空间，不与 app.js / oncall.js 的通用 `data-pane` 查询
（均限定在各自 drawer 容器内）冲突）。

## 方案

**开源选型（REQ-20260909-015）**：本修复为前端一行属性名对齐（dataset 键映射错误），
无合适开源库可替代该业务代码自身的 DOM 状态同步，不引入开源库、不创建 licenses.md。

实施内容：

1. `scripts/web/marketing.js` `setTab()`：`p.dataset?.pane` → `p.dataset?.mktPane`（仅此一处）。
2. 新增回归测试 `scripts/tests/marketing-overview-tab-20260911-004.test.mjs`：
   - U1 静态契约：render 写入 `data-mkt-pane` 与 setTab 读取 `dataset?.mktPane` 必须同名；
   - U2 行为：模块内页签往返（概览 ↔ 定位与定价）后概览 pane 保持可见；
   - U3 行为：经「渠道与行动」「效果与复盘」往返及同项目跨模块重入（enter 不重绘路径）
     后概览 pane 保持可见。测试接缝为 fake DOM 提供 `.mkt-pane` / `.mkt-tab` 节点，
     弥补既有测试 `querySelectorAll() → []` 的覆盖盲区。

验收口径对应 README 验收项：页签往返与跨模块重入后概览数据可见、无需 Cmd+R；
读取中 / 失败 / 空态逻辑本就由 `refresh()` 状态机承担，本次不改动。

## 风险与边界

- 改动仅一行（dataset 读取键），不影响数据流、草稿与保存、快照恢复、项目切换守卫；
  全量 `npm test`（187 个测试文件）通过。
- 未处理（超出本 Bug 范围）：真实浏览器多轮手工验收（README 复现步骤 1–5 的浏览器版本 /
  发生频率记录）仍待人工确认；如后续出现其他渲染竞态按 /bug 另行登记。
