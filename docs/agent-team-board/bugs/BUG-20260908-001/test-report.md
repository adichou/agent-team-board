# 测试报告 — BUG-20260908-001 守卫 file 模式不拦新建文件：无锁可经 Write 在插件源码目录新建文件

- 时间：2026-09-08T00:07:07.833Z
- 执行者：zcode-batch-010-1
- 测试框架：node:assert/strict + 子进程实测（scripts/tests/code-guard.test.mjs NF1–NF4）
- 覆盖率：92%

## 总结

file 模式守卫与 Bash 侧同口径：抽公共 realpathAncestralHitsPluginRoot（目标不存在时上溯最近存在祖先 realpath，suffix 段判定落点），denyIfSourceLocked 不再要求 existsSync，tokenRealpathHitsPluginRoot 复用同一实现；docs/ 豁免、插件根外、有效认领锁放行均保持。NF1–NF4 新用例（真实路径/软链别名/多级缺失目录/docs 豁免/锁放行），run-all 75 个测试文件全量回归通过；无锁 cwd 实测新建 scripts/brand-new-file.mjs exit 2 拦截。引入来源：REQ-20260901-003（file 守卫原始实现前置 existsSync，新建场景从未进入判定）

## 明细

（可粘贴命令输出、失败用例说明等）
