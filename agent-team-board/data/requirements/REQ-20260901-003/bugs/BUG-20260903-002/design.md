# 设计 — BUG-20260903-002 认领锁永不清理，源码守卫被长期放行

## 根因分析（归因）

**引入来源：REQ-20260901-003（源码守卫）**（README「关联」节已写明，`atb show` 核验存在）。
守卫方案 A 的两个设计点叠加导致守卫被架空：

1. **锁生命周期只增不减**：`core.mjs` 中认领锁仅在「人工驳回（done→in-progress）」时释放；
   `report()`（上报待人工确认）与「确认完成（in-progress→done）」均不释放 ⇒ `.locks/` 持续积累残留锁
   （本看板实际积累 20+ 把）。
2. **放行判定与开发状态脱钩**：`state-guard.mjs` 的 `hasValidClaimLock()` 只检查「项目看板存在 24h 内
   的锁文件」，不校验锁是否对应真实在办会话 ⇒ 只要近 24h 有任何人认领过，所有会话都能改源码，
   源码保护长期失效。

## 方案（按 README 修复方向）

1. **收紧锁生命周期（core.mjs）**：
   - `report()`：上报即视为停止开发（进入待人工确认），释放 `<ID>.lock`；条目仍为 in-progress，
     原认领者可随时 `atb claim <ID>` 续认补锁继续开发（同 owner 放行路径既有）。
   - `setStatus()`：新增 in-progress→done（人工确认完成）释放认领锁；done→in-progress（驳回）原有
     清理保留。
2. **守卫放行条件保持不变（state-guard.mjs 仅补注释说明锁生命周期）**：「存在未过期（24h）认领锁」。
   锁生命周期收紧后，「有锁=确有会话在开发中」重新成立，无需改放行逻辑。
3. **存量清理：新增 `core.pruneLocks(dataDir, { apply })` 与 CLI `atb prune-locks [--dry-run]`**：
   - 保留：条目 in-progress 且锁新鲜（<24h）的认领锁；新鲜 `config.lock`（计数器互斥锁，30s 过期）。
   - 删除：不在办条目（submitted/accepted/done）的锁、孤儿锁（条目不存在）、>24h 过期锁、过期
     `config.lock`。
   - 非 `<REQ|BUG>-YYYYMMDD-NNN` 形态的 `.lock` 跳过不动。

## 影响面

- `scripts/lib/core.mjs`（report 释放锁 / setStatus 确认完成释放锁 / pruneLocks）
- `scripts/atb.mjs`（prune-locks 子命令 + USAGE）
- `scripts/state-guard.mjs`（仅注释）
- 新增 `scripts/tests/lock-lifecycle.test.mjs`（L1–L8）
- 本看板 `.locks/`：已执行一次 `atb prune-locks`，清理 20 把残留锁，保留 9 把在办新鲜锁。

## 测试（TDD）

- test-cases.md L1–L8 先跑红（6 红：释放逻辑缺失 ×3、pruneLocks 缺失 ×2、CLI 缺失 ×1），
  实现后跑绿。
- `code-guard.test.mjs` 回归全绿（G1–G6、B1–B6、F1–F3）。
- `npm test` 共 20 个测试文件，仅 `default-port.test.mjs` V7 失败——本机看板服务正占用 8888 导致的
  环境性缺陷（V6 遇占用跳过、V7 却无条件断言 8888 空闲），与本次改动无关，已登记 BUG-20260905-002。

## 风险与边界

- report 释放锁后若需继续改源码：原会话 `atb claim <ID>` 续认补锁即可（守卫随即放行）。
- `report()` 不校验 owner 是既有行为（任何会话可上报 in-progress 条目），跨会话上报会释放原认领者的
  锁——超出本单范围，未改动。
- 会话异常退出（如 kill -9）残留的锁仍靠 24h 过期兜底或手动 `atb prune-locks`；正常流程
  （report / 确认完成 / 驳回）不再产生残留。
