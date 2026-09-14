# 测试用例 — REQ-20260907-003 需求完善：待接受需求与 Bug 批量补全文档，支持 Zcode / Codex 派发

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | 完整性分析：需求 README 缺失/验收标准待补充/说明过简/design 空模板/test-cases 无用例 各给对应缺失原因；Bug 缺现象/复现/期望/验收逐项给原因；关键说明齐全的条目不进候选 | P0 | ✅ |
| R2 | 候选清单：仅 submitted（accepted/done 不进），req 优先 → 创建早 → 编号排序；candidates 携带缺失原因 | P0 | ✅ |
| R3 | 创建批次：冻结候选+缺失原因+文档指纹基线；勾选 ids 过滤范围；无候选报错；zcode 模式生成主调度提示词（含 refine next/done/check 与只改文档约束） | P0 | ✅ |
| R4 | 并发重复派发保护：未结束批次已冻结条目不入新批；队尾候选一致幂等返回（不新建） | P0 | ✅ |
| R5 | 领取：next 预留一项并持 refine 互斥；重复 next（未收尾）被拒；领取时非 submitted → skipped 出局落账；指纹≠基线（人工编辑）→ skipped 出局落账；无可领 → 批次 finished + stop | P0 | ✅ |
| R6 | 完成回执：done 要求 summary；文档未变更（指纹=基线）拒绝；条目已离开 submitted 拒绝；正常补全后落 done、批次计数推进、互斥释放 | P0 | ✅ |
| R7 | 失败回执：fail 需 reason（≤200 字）；落 failed 计数；跳过后续可继续 next | P0 | ✅ |
| R8 | check 协议：≤2KiB；current/counts{total,done,failed,skipped,remaining}/nextAction；全部处理完 → stop+finished | P0 | ✅ |
| R9 | 暂停：pause 后 next 返回 stop=paused；恢复后可继续 | P1 | ✅ |
| R10 | CLI 端到端：refine create → next → （补文档）→ done → check 全链路经 atb.mjs 可跑通；--json 输出机器可读 | P0 | ✅ |
| R11 | 服务接口：/api/refine/candidates 带缺失原因；/api/refine/create（zcode）返回提示词；（codex）CLI 未就绪 400；/api/refine/current 展示批次/计数/记录；/api/refine/pause 生效；codex 模式经假 CLI 逐项执行、文档变更核验后记 done、未变更记 failed | P0 | ✅ |
| R12 | UI 静态契约：待接受选择工具条有「需求完善」入口（#refineGo）；任务模块有 refine 子面板 tab；面板渲染候选清单（含缺失原因）、模式选择、进度计数与逐项记录（文档链接/摘要/失败原因） | P1 | ✅ |
