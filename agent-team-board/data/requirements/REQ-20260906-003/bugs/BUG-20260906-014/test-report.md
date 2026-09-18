# 测试报告 — BUG-20260906-014 Codex CLI 无法解析 agent-team-board hooks 的 process 类型

- 时间：2026-09-06T19:20:52.590Z
- 执行者：zcode-batch-003-01
- 测试框架：node:assert 子进程契约实测 + codex 0.153.4 宿主 exec 验证 + npm test 全量回归
- 覆盖率：0%

## 总结

新增 hooks/codex.json（Codex command schema：$PLUGIN_ROOT 引 state-guard file/bash，timeout 秒）并由 .codex-plugin manifest hooks 条目覆盖默认 hooks/hooks.json，Codex 启动不再报 unknown variant process（exec 实证）；state-guard file 模式补 apply_patch patch 文本目标解析，Codex 编辑形态下 status.json 直写与源码保护恢复拦截。ZCode 侧 hooks.json 零改动。新增 9 用例+57 测试文件全绿。已知限制：本机 codex shell 工具因缺 code-mode host fail closed，端到端 hook 触发留人工终审（证据 dispatch/runs/run-20260907-028/verify-codex-host.log）。覆盖率未统计（无行覆盖工具），coverage=0

## 明细

（可粘贴命令输出、失败用例说明等）
