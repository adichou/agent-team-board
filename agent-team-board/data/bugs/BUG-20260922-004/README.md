# BUG-20260922-004 确认记录被并发写回退：已确认（resolved）的提交挂起被旧进程滞留任务覆盖回 waiting 并抹掉 confirmed 事件

- 状态：submitted（待人工接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-22T12:57:36.440Z

## 现象

现象：REQ-20260921-007 的提交挂起确认第 2 轮于 2026-09-22 12:18:26 由看板确认成功（confirmed：0 组补交、核验通过、恢复队列，状态 resolved，CLI confirm show 读盘可见）；12:15:43 服务重启曾中断一个运行中的核验任务（task-interrupted：结果未落账）。随后 12:24:38 出现新的 confirm-rejected（board）事件且记录回退 waiting，12:18:26 的 confirmed 事件从 events 中消失（读取口径：agent-team-board/runtime/confirms/confirms.json）。疑似服务重启后旧进程的异步确认任务（npm test 复验回调）持过期内存副本回写，丢失更新覆盖 resolved 状态。影响：队列恢复被回滚，再次暂停认领；人工需重复确认。需要定位：确认任务的进程生命周期与记录回写是否存在读-改-写竞态；resolved 后的重复确认应幂等拒绝而非复活 waiting。

## 复现步骤

1. 看板对某条目的提交挂起触发「确认并继续」任务（异步测试复验运行中，入口已装载 waiting 记录副本）。
2. 服务重启：新进程恢复核对把任务账本标记 interrupted 并留痕 task-interrupted；旧进程滞留的异步任务继续运行。
3. 人工经看板（新进程）确认成功：记录 resolved、confirmed 事件落盘、队列恢复。
4. 旧进程滞留任务测试复验返回（失败路径），携过期内存副本整体写回 confirms.json。
5. 观察：记录回退 waiting、confirmed / task-interrupted 事件消失、出现新的 confirm-rejected (board)；
   队列恢复被回滚，认领再次暂停（修复前可稳定复现，见测试 C1/S1）。

## 期望行为

1. 滞留任务的过期内存副本不得整体写回：await 测试期间记录已被并发更新（确认 resolved / 重启留痕 /
   归档重开新一轮）时，写回前重读最新记录——过期即拒绝，绝不把 resolved 回退成 waiting、不抹掉并发事件。
2. resolved 后的重复确认幂等拒绝（幂等成功返回），不复活 waiting；重复核验同样幂等跳过，不覆写已闭环记录。
3. 记录仍 waiting 同轮时，核验/确认结论以最新记录为基座合并落账，并发留痕事件全保留。
4. 旧进程滞留回调不得把任务账本从 interrupted 复活成 done/failed（进程生命周期与账本代际一致）。
