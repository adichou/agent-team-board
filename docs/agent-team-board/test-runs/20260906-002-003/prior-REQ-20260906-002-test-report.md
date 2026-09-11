# 测试报告 — REQ-20260906-002 Zcode 批量实施：轻量主调度、每单新子 Agent 与文件化回执

- 时间：2026-09-06T05:19:40.477Z
- 执行者：zcode-batch-dispatch
- 测试框架：node:test 自研聚合（run-all）+ 浏览器实测
- 覆盖率：75%

## 总结

落地 Zcode 批量实施全链路：lib/batch.mjs 共用批次/运行账本（冻结候选、依赖策略与环校验、≤2KiB 回执与核对协议、幂等与防重放）；core.claim 项目实施互斥（impl.lock，手工/批次共用、别名路径不可绕）、report 运行关联；atb batch create/next/check/summary/pause/records 与 run receipt/release 子命令；server 批次/策略接口绑定 project；看板顶栏批量实施抽屉（创建/提示词/重复制/暂停/记录分页/待启动与执行中严格区分/失联待核对）与条目详情批量执行设置。新增 batch-core/cli/serve/ui 四个测试文件覆盖 Z01–Z16、Z20–Z24（23 用例组全绿），假 worker 连续 10 项端到端通过；浏览器实测创建→执行中→暂停→依赖保存→360px。与并行实施的 REQ-20260906-003 完成 policies.json 结构对齐并记录协调边界。未验证：Z17/Z18/Z19（需真实 Zcode 主会话人工见证）、360px 截图（IAB 捕获故障，几何校验替代）。回归 33 文件仅 detail-close-btn T2 预置红灯（REQ-20260906-005 范围）。

## 明细

（可粘贴命令输出、失败用例说明等）
