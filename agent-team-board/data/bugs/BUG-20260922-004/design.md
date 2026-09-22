# 设计 — BUG-20260922-004 确认记录被并发写回退：已确认（resolved）的提交挂起被旧进程滞留任务覆盖回 waiting 并抹掉 confirmed 事件

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：**BUG-20260915-008**（核验/确认异步化）。verify / continue 改为异步跑 `npm test` 后，
  确认记录在函数入口一次装载进内存，跨分钟级 await 后整体写回（`saveConfirmRecord` 整体替换），
  读-改-写窗口从「同步阻塞、同进程事件循环冻结不可能交错」变为「await 期间任意并发写入都会被
  旧副本整写覆盖」。机制骨架（记录整写回）自 REQ-20260914-001 即存在，但实际可触发的并发窗口
  （含服务重启后旧进程滞留回调回写）由 BUG-20260915-008 引入。两编号均经 `atb list` 核验存在。

## 根因分析

事故时间线还原（confirms.json events 为证）：

1. 12:15:43 服务重启。旧进程有一个运行中的确认任务（continue，测试复验阶段）：它在入口装载了
   `state=waiting` 的记录副本；新进程启动时 `recoverConfirmTasks` 把任务账本标记 interrupted 并
   留痕 `task-interrupted`（该留痕是独立读-改-写，正确落盘）。
2. 12:18:26 人工经看板（新进程）确认成功：新进程的任务以最新盘面记录闭环，落 `confirmed` 事件、
   `state=resolved`、恢复队列。
3. 12:24:38 旧进程滞留的异步任务测试复验返回，携 12:15 前的过期内存副本走失败路径：
   `saveConfirmRecord` **整体替换**盘面记录——`resolved` 被回退成 `waiting`，12:18:26 的
   `confirmed` 事件连同 12:15:43 的 `task-interrupted` 留痕一并被抹掉，并写入过期的
   `confirm-rejected (board)` 事件。队列恢复被回滚，认领再次暂停。

两处缺陷：

- **记录回写读-改-写竞态（丢失更新）**：`verifyCommitConfirm` / `confirmCommitContinue` 在
  `await testRunner`（真实 `npm test`，分钟级）期间持有入口装载的内存副本，写回时不重读、不比对、
  无条件整体替换——任何并发写入（新进程确认、重启留痕、归档换轮）都被覆盖。
- **任务账本复活**：`startConfirmTask` 的 `touch` 闭包同样无条件落盘；旧进程滞留回调在恢复逻辑
  标记 interrupted 之后仍会把任务账本从 interrupted 复活成 done/failed，掩盖「结果未落账」事实。
- 附带：resolved 后重复核验（verify）没有幂等口径，会把核验结果覆写到已闭环记录上。

## 方案

**自研（无引入库）**：守卫属本仓库自有文件账本（confirms.json / tasks.json）的业务一致性逻辑，
无合适开源库可替代（不涉及数据库/锁库场景，引入反而增加依赖面）；未创建 licenses.md。

1. **confirm-store 过期写回守卫（核心）**——`verifyCommitConfirm` / `confirmCommitContinue`
   的全部写回点（成功 / 失败 / 核验落账）先重读盘上最新记录做三方判定（`staleWriteBackReason`）：
   - 记录缺失、轮次或声明时间已变（归档重开新一轮）→ 过期拒绝，不写回（不覆盖新一轮现场）；
   - 状态已离开 waiting（resolved / cancelled / closed-done）→ 过期拒绝：**resolved 幂等成功返回**
     （重复确认幂等拒绝，绝不复活 waiting），其余终态返回明确拒绝原因；
   - 仍 waiting 同轮 → **以盘上最新记录为基座合并写回**：本任务新增事件（装载长度之后的增量）
     追加到最新事件尾部，并发留痕（task-interrupted / kept / terminal-supplement）全保留；
     verify / supplement / state 等本任务字段叠加其上。
   - 入口幂等补齐：verify 对已 resolved 记录幂等跳过（不再覆写已闭环记录）。
2. **server 任务账本过期进程守卫**——`startConfirmTask` 的 `touch` 落盘前核对盘上任务：
   taskId 已被新任务替换、或状态已离开 running（重启恢复标记的 interrupted）→ 只更新内存视角、
   不落盘；旧进程滞留回调不再复活/覆盖任务账本。
3. 顺序语义保持：合并写回只影响「谁覆盖谁」，单任务串行场景（同进程内无并发）结果与原实现一致，
   既有验收口径（verify 字段 / resolved / 补交留痕 / 阶段回调 / 互斥 / 重启恢复）零变化。

**测试（TDD，先红后绿）**：`scripts/tests/bug-20260922-004.test.mjs` 5 用例——C1 核心竞态复现
（滞留 continue 期间人工确认恢复：不回退 waiting / 不抹 confirmed / 幂等拒绝）、C2 合并写回
（并发 task-interrupted 留痕不丢）、C3 换轮守卫（新一轮现场不被旧副本覆盖）、C4 入口幂等
（resolved 后重复核验不再覆写）、S1 双服务进程复现「旧进程滞留回调」（任务账本不复活成 done、
留痕不被抹、核验结论合并落账）。

## 风险与边界

- 合并写回以「仍 waiting 同轮」为前提，轮次与声明时间（declaredAt）共同作为代际标识；同轮内
  并发方对 verify/指纹基线的刷新会被本任务结果覆盖（本任务基于人工确认时所见内容，属可接受口径），
  但状态与事件流永不回退、永不丢失。
- 过期拒绝不写事件到已终态记录（避免过期进程再写盘面）；拒绝原因经任务账本 result 呈现。
- tasks.json 守卫可能让「旧进程任务确实完成且记录仍 waiting」的场景账本保持 interrupted——
  此时确认记录已合并落账核验结论（事实正确），账本提示重新核验只是保守口径，无数据损失。
- 互斥（同条目 running 任务）仍以任务账本为准，跨进程并发触发会各自执行，由本守卫保证最终
  写回安全；不引入文件锁（与 holds/refine/dispatch 既有口径一致，避免新原语）。
