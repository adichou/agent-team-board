# 测试用例 — REQ-20260901-005 认领者统一显示会话名（不再缺省 terminal）

> 方案见 design.md（**待对齐**）。对齐确认后，N1–N5 先跑红再实现跑绿；N6 静态契约。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| N1 | 显式命名优先：claim --by xxx 后 owner == xxx | P0 | ✓ |
| N2 | 缺省名可读且不再产生裸 terminal：格式 `前缀-MMDD-4位随机`，≠ terminal | P0 | ✓ |
| N3 | 同进程缺省名稳定（缓存复用，一次调用一个名字） | P1 | ✓ |
| N4 | ATB_AGENT_NAME 环境变量作为缺省名前缀生效 | P1 | ✓ |
| N5 | 认领锁文件 owner 与 status.owner 同源一致 | P0 | ✓ |
| N6 | SKILL.md 与 dev.md 写明会话名格式约定与主动命名要求 | P0 | ✓ |


## 执行记录（2026-09-01）

- `node scripts/tests/actor-name.test.mjs` N1–N6 全绿（先红后绿：N2/N4/N6 初跑失败）。
- 实现：core.mjs 新增 resolveActorName（显式 → ZCODE/CLAUDE_SESSION_ID → 可读缺省名 `前缀-MMDD-hex4`，
  进程内缓存、crypto 随机后缀、ATB_AGENT_NAME 注入前缀），actor() 走新解析；claim/report/锁 owner 天然同源。
- 文档：SKILL.md「会话调度规则」与 dev.md 阶段一第 3 步写入会话名约定（--by 语义名优先、全小写连字符）。
- 历史旧值（含裸 terminal）按验收 3 不迁移，保留可追溯。
