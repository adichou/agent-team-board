# 测试报告 — BUG-20260905-001 源码保护的 Bash 守卫把只读 sed 误判为改写意图（读操作被拦）

- 时间：2026-09-05T08:31:03.962Z
- 执行者：codex-bash-sed-guard-0905-3ce0
- 测试框架：node:assert 子进程守卫实测 + 16 套全量脚本回归
- 覆盖率：100%

## 总结

引入来源：REQ-20260901-003 新增 Bash 源码保护时采用宽泛词法 REWRITE_INTENT。现已用引号感知的轻量分段/分词与统一 hasRewriteIntent 区分 sed 只读、原地写入及 w/W/r/e 脚本命令，并仅豁免指向 /dev/null 的输出重定向；cp/mv/rm/chmod/tee 等既有规则保持。TDD Red 精准失败 B1/B4，Green 后 G1–G6 与 B1–B6 全绿；16 个测试脚本、105 个命名用例全量回归通过。本条验收用例覆盖 7/7，项目未配置语句/分支覆盖采集。

## 明细

### Red

- 命令：`node scripts/tests/code-guard.test.mjs`
- 结果：退出码 1；B1“只读 sed 与普通输出变换放行”和 B4“重定向到 /dev/null 放行”失败。
- 失败行为：两组命令都被旧 `REWRITE_INTENT` 当作改写，守卫返回退出码 2；其他写操作断言保持通过。

### Green

- 命令：`node scripts/tests/code-guard.test.mjs`
- 结果：退出码 0；原 G1–G6 与新 B1–B6 共 12 个命名场景全部通过。
- 关键边界：`sed -n`、普通 `s///`、`-e '1,20p'` 放行；GNU/BSD `-i`、`--in-place`、
  `w/W/r/e`（含引号内分号多命令）保持拦截；`>/dev/null`、`2>/dev/null`、`&>/dev/null`、带引号
  `/dev/null` 放行；普通文件重定向及缺失目标保持拦截。

### 全量回归

- 命令：依次执行全部 `scripts/tests/*.test.mjs`。
- 沙箱内首次运行：需要监听临时本机端口的集成测试收到 `listen EPERM 127.0.0.1`，属于运行权限限制。
- 允许本机临时端口后重跑：16 个测试脚本、105 个命名用例全部通过，退出码 0。
- 覆盖率口径：本 Bug 的 test-cases T1–T7 全覆盖（7/7，100%）；未采集项目语句/分支覆盖率。

### 影响面

- `scripts/state-guard.mjs`：以语义判定替换宽泛词法匹配。
- `scripts/tests/code-guard.test.mjs`：新增 B1–B6 回归场景。
- 条目 README/design/test-cases：补齐复现、方案、归因与执行记录。
