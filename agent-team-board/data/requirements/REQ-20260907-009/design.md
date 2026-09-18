# 设计 — REQ-20260907-009 选择可操作项只显示当前选择状态的条目

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

- BUG-20260907-016 将第四行筛选条恢复为五档（无「全部」），当时决策为
  「筛选只影响列表展示，选择可跨档位，选中不可见条目通过工具条计数与切档查看」。
- 实际使用中跨档全选导致「已选 N 项」计数与当前屏幕所见严重不一致，
  用户提出本需求：一键全选只覆盖当前筛选档内可见的可操作条目。

## 方案

纯前端改动，两个文件：

1. `scripts/web/app.js`
   - 新增 `operableInCurrentLane()`：`submittedItems()` 与 `implCandidates()`
     （两者均已叠搜索范围）合并后按 `laneOf(it) === state.reqFilter` 过滤，
     返回当前档内可操作条目。
   - 新增具名函数 `selectOperable()`（原「选择可操作项」点击处理器主体抽出）：
     pending 保护不变；将 `state.acceptance.selected` / `state.impl.selected`
     **整体替换**为当前档内条目（submitted 入待接受集合，accepted 未认领入
     可实施集合），随后沿用 `syncAcceptance()` + `syncImpl(false)` + `pushImplScope()`。
     抽具名函数同时让 vm 测试可直接调用，替代原先「等价集合语句模拟」的脆弱写法。
   - `syncAcceptance()` 中 `#selectOperable` 禁用条件由跨档统计
     （`eligible.size === 0 && implCandidates().length === 0`）改为
     `operableInCurrentLane().length === 0`：按钮可用性 = 点击结果非空。
2. `scripts/web/index.html`
   - `#selectOperable` 的 title 去掉「可跨筛选档位」，改为
     「仅当前筛选档可见条目，叠搜索范围」。

影响面：

- 手动勾选、轮询剪枝（资格仍为跨档的待接受 / 已接受未认领）、切档保留勾选、
  「清除选择」、批量接受 / 需求完善 / 进入批量实施入口语义均不变。
- BUG-20260907-015 回归（仅可实施条目时全选入口可用）在「已接受」档主场景
  依旧成立；其在「待接受」档下的表现随本需求变为禁用（该档无可操作条目，
  禁用即新契约），对应测试场景随需求演进更新。

## 风险与边界

- 后端无改动；不涉及 status.json / API 变更。
- 既有测试 `scripts/tests/impl-entry-ui.test.mjs` E3 的等价模拟断言随新契约
  改写为直接调用 `selectOperable()`，并补「切档保留手动勾选」防回退用例。
