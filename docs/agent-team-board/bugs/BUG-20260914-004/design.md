# 设计 — BUG-20260914-004 已经纳入版本的条目不应该再出现在其他版本的关联列表或新建版本的关联列表中

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260913-001（经 `atb list` 核验存在，状态 done——构建模块「版本管理」需求的原始实现）。
  构建模块落地时，候选接口 `GET /api/build/candidates` 与前端两选单只做了条目存在性 / commit
  关联维度，后续 BUG-20260913-001 又补了「仅 done」收窄，但「已被版本占用」维度自始缺失；
  数据层 `normalizeItems` 的去重也只针对同一版本内（existingIds 为本版本已有集合），跨版本重复
  一律放行——同一条目及其 commit 可同时挂在多个版本计划上。

## 根因分析

- **数据层无跨版本唯一性约束**：`scripts/lib/build-store.mjs` `createVersion / addItems` 只做
  格式校验与同版本内去重，无「条目至多纳入一个版本」的不变量，脏数据可经任意入口写入。
- **候选接口无占用维度**：`scripts/server.mjs` `GET /api/build/candidates` 仅过滤 done，不看
  `builds/versions/` 下任何版本的 items，占用状态（draft/merging/merged/failed 任一）均不影响候选。
- **前端过滤口径不全**：`scripts/web/build.js` `openCreatePanel()` 不过滤占用；`openAddPanel()`
  的 `have` 集合仅取当前版本自身 items，其他版本的占用不排除。
- 三层同时缺失 → 前端可勾选、接口可提交、数据层可落盘，重复挂载畅通无阻。

## 方案

采用与 BUG-20260913-001 相同的「数据源头收窄 + 前端防御过滤 + 写路径兜底」三层口径：

1. **数据层（不变量兜底，所有调用方同口径）**：`build-store.mjs` 新增导出
   `occupiedItemMap(dataDir, { excludeVersionId })`（itemId → 占用版本 id，覆盖
   draft/merging/merged/failed 任一状态的版本）与内部 `assertNotOccupied()`；
   `createVersion` 在分配编号前、`addItems` 在落盘前校验，跨版本重复纳入抛
   `AtbError`：「条目 X 已纳入版本 BLD-YYYYMMDD-NNN，不可重复纳入」（HTTP 400）。
   `addItems` 排除目标版本自身——条目已在本版本中的重复添加仍走既有
   「已在本版本中，不可重复添加」口径，不改变既有报错语义。被拒绝的创建不占当日编号序列。
2. **候选接口（源头收窄）**：`GET /api/build/candidates` 在 done 过滤后再排除已占用条目；
   响应新增 `totalDone`（占用过滤前的 done 条目总数），供前端区分空态。
3. **前端（防御过滤 + 空态区分）**：`build.js` 新增纯函数 `occupiedItemIds(versions)`
   （由 `state.data.versions` 求占用集合，导出供测试），`openCreatePanel / openAddPanel` 在
   done 过滤基础上再排除占用条目（添加面板保留本版本 `have` 排除，不回归既有口径）；
   面板空态按 `totalDone` 区分：「无 done 条目」（原文案）与「已完成的条目均已纳入版本计划：
   可从『计划中 / 失败』版本移出条目，或删除版本后重新纳入」（新文案；响应缺 totalDone 的
   旧缓存回落原文案）；两面板 scope 副标题同步改为「未纳入任何版本」口径。
4. **占用释放口径（与既有语义一致，未改）**：`removeItems`（draft/failed 允许）与
   `deleteVersion`（draft/failed/merged 可删）自然释放占用，条目重新回到候选——由既有
   REQ-20260913-004 / 数据层行为保证，本轮只加验证用例不改动逻辑。
5. **测试**：新增 `scripts/tests/bug-build-candidate-occupied-20260914-004.test.mjs`
   （11 用例：接口收窄 B1/B6、四状态占用 B2、创建/添加兜底 B3/B4、释放 B5、数据层 D1、
   前端防御过滤与空态 F1~F4）；同步修正编码了旧口径的两处既有断言
   （`build-serve.test.mjs` S5/S11、`build-ui.test.mjs` N7b——原断言「已纳入版本的条目仍在候选」
   即本 Bug 缺陷行为，按新口径改为「不出现 / 防御过滤」）。

**开源选型（REQ-20260909-015）**：未引入开源库。本次为纯 Node 核心模块（fs/Map/Set）上的
数据口径修复，无合适且必要的第三方库（候选如 schema 校验库也无法表达「跨目录数据占用」
这类业务不变量），自研成本低于引入与维护依赖的成本，故未新增依赖、不创建 licenses.md。

## 风险与边界

- **存量脏数据不迁移**：修复前已同时挂在多个版本的条目保持原状（不自动去重，避免误删用户的
  版本计划）；新口径只阻止新的重复纳入。如需清理，走人工「移出 / 删除版本」路径。
- **merged 版本持续占用**：merged 条目锁定不可移出（既有语义），条目保持不再候选，除非删除该
  版本记录——与 README 期望口径一致。
- **前端防御过滤的数据源**：`state.data.versions` 为面板打开时的已加载快照；面板打开期间他端
  新建版本造成的占用由服务端写路径兜底（提交时 400，错误行内提示），不会写入脏数据。
- **旧版服务 + 新前端（或反之）**：候选响应缺 `totalDone` 时前端空态回落原文案、过滤仍以
  `state.data.versions` 为准；新版服务 + 旧前端时写路径仍被兜底拒绝，不产生新脏数据。
- **并发窗口**：两个请求同时提交同一未占用条目仍可能先后落盘（文件级无锁，与既有
  writeJsonAtomic 口径一致）；实际看板为单人操作流，风险可忽略，出现时可手动移出修复。
