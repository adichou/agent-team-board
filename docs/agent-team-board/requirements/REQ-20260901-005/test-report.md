# 测试报告 — REQ-20260901-005 认领者统一显示会话名（不再缺省 terminal）

- 时间：2026-09-01T06:45:33.306Z
- 执行者：atb-0901-0d7b
- 测试框架：node:assert 集成测试（core 直调）
- 覆盖率：未统计

## 总结

认领者统一显示会话名完成（按对齐方案 A+B）：core.mjs 新增 resolveActorName——优先级为显式 --by / API 参数 → ZCODE_SESSION_ID/CLAUDE_SESSION_ID → 可读缺省名（前缀-MMDD-4位hex随机，crypto 生成，进程内缓存复用；前缀由 ATB_AGENT_NAME 注入如 zcode/codex，缺省 atb），裸 terminal 不再产生；actor()/claim/report 及认领锁 owner 同源走新解析。SKILL.md 会话调度规则与 dev.md 阶段一第 3 步写入会话名约定：主动 --by 语义名（全小写连字符，如 zcode-fileboard），多会话并行可区分。历史旧值不迁移（保留可追溯）。TDD：新增 actor-name.test.mjs N1–N6 先红后绿全过；七套既有测试回归全绿。版本 0.3.5→0.3.6。

## 明细

（可粘贴命令输出、失败用例说明等）
