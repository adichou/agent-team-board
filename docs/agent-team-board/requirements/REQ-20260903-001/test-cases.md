# 测试用例 — REQ-20260903-001 取消对齐流程，需求须写清 UI/交互设计

> R1–R6 由 `scripts/tests/pending-alignment.test.mjs`（改造为回退语义）覆盖。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | 状态机回退：accepted→in-progress 恢复；pending-alignment 移出主流程（accepted 无进入边）但存量可人工放行 | P0 | ✓ |
| R2 | claim 直达 in-progress（owner+锁+history）；异 owner 冲突保留 | P0 | ✓ |
| R3 | 钩子拦截收回：status in-progress 放行；accepted/done 仍拦 | P0 | ✓ |
| R4 | server 流转与 board 数据正常；submitted→in-progress 仍拒 | P0 | ✓ |
| R5 | 前端回四列：无待对齐列/对齐按钮/紫色变量；accepted 提示恢复 | P0 | ✓ |
| R6 | dev.md 单阶段化（无阶段一/implement）；req.md + SKILL 含 UI/交互设计前置 | P0 | ✓ |

## 执行记录（2026-09-03）

- R1–R6 全绿（先红后绿）。十一套测试回归全绿（pending-alignment 改造为回退语义、layout 回四列契约、traceability 兼容新措辞）。
- 存量迁移：待对齐条目经人工放行（对齐确认按钮在本次前端移除前最后一次使用）；dev.md 压缩成果（BUG-20260902-001）不受影响（3156 字节仍达标）。
- REQ-20260831-001 的交付被本需求实质回退，其条目保持 in-progress 历史，不删数据。
