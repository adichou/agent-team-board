# 设计 — BUG-20260918-003 确认留痕 confirmations.md 属应用数据，应迁至 runtime 不进 git

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260914-001（挂起确认机制建立时，把 confirmations.md 人读留痕放条目目录随 data/ 进 git；相关演进：REQ-20260916-007 确立 data/runtime 分离口径）

## 根因分析

- 留痕写入点错位：`renderConfirmDoc()`（confirm-states）与 `renderDecisionsDoc()`（hold-states）
  把人读留痕写进 `<itemDir>/confirmations.md` / `decisions.md`——位于 data/（进 git），而事实源
  （confirms.json / holds.json）本就在 runtime/。应用数据被放进了用户数据目录。
- 自指循环：留痕在 git 可见域 → 每次声明 / 核验 / 作答 / 确认重写留痕 = 工作区新增未提交变更 →
  指纹基线被迫「留痕后再取」（declare / verify 各带一次补正）→ 确认闭环后还要一笔管理记录 doc 提交收口，
  且他条目目录路径被 `owningItemIdOf` 归属排除，迁移删除无法随本单收口。

## 方案

1. **留痕迁 runtime**（与事实源同域）：
   - `runtime/confirms/confirmations/<ID>.md`（confirm 机制，confirm-states.mjs 的
     `confirmationsDocFile()` 为唯一路径口径）；
   - `runtime/holds/decisions/<ID>.md`（hold 机制，hold-states.mjs 的 `decisionsDocFile()`）；
   - 渲染签名去掉 itemDir 参数（不再需要条目目录）；声明 / 核验的指纹基线补正随之简化为单次落账
   （runtime 为 git 忽略域，写入不污染基线）。
2. **条目文档口径**：`core.orderedDocs()` 过滤 confirmations.md / decisions.md（`TRACE_DOC_NAMES`）——
   详情文档页签与全局搜索（searchDocs 同源）不再出现；readDoc 不受影响。
3. **出库迁移归因**：`git-flow.owningItemIdOf()` 把这两个文件名解析为板级共享（owner=null，与旧
   status.json 出库同口径）——他条目目录下这两个文件的删除随执行迁移的单 doc 组自动提交，
   主题带迁移单单号；不新增任何进 git 的终态标记文件。
4. **提示口径**：CLI（refine hold / hold declare / hold resume）与前端（hold 卡片运行行、确认完成
   二次确认文案 + i18n EN/EN_DYNAMIC 双语同步）从「条目目录 decisions.md」改为 runtime 路径。
   管理记录自动提交与「重试提交」入口已随 BUG-20260918-002 下线，本 Bug 无需再动。
5. **历史出库迁移**：现存 6 个条目的 confirmations.md 一次性移入 runtime（内容原样保留），
   删除由方案 3 随本单收口提交；不重写历史提交（用户拍板保留历史）。

**开源选型（REQ-20260909-015）**：无引入开源库——改动为纯 Node 内置 fs/path 的文件写入位置与
路径常量调整，无第三方库可复用的场景；自研即最小实现。

## 风险与边界

- **完成判定口径（用户拍板）**：clone 后重建时，「git 历史中存在带该条目单号的提交」即视为已完成，其余视为待接受；不区分「已上报」与「已人工确认完成」，也**不为此新增进 git 的终态标记文件**。本 Bug 的迁移只需把 confirmations.md / decisions.md 出库至 runtime，不得引入新的入库文件。
