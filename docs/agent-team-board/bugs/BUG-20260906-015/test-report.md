# 测试报告 — BUG-20260906-015 state-guard PLUGIN_ROOT 多解析一层：docs 豁免永不生效，无锁时条目 markdown 误被拦截

- 时间：2026-09-06T16:25:39.751Z
- 执行者：zcode-batch-002-01
- 测试框架：Node 原生 assert + 子进程实测（scripts/tests/run-all.mjs）
- 覆盖率：95%

## 总结

修复 state-guard.mjs PLUGIN_ROOT 多上跳一层：改为从 scripts/ 仅上跳一层，docs/ 豁免恢复生效且保护范围收敛回插件根；code-guard.test.mjs 新增 P1-P4 回归（豁免放行/同级不误拦/仍拦源码/真实软链形态），全套 43 个测试文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
