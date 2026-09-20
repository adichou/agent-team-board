# 测试报告 — REQ-20260901-003 钩子硬约束插件代码改动：必须先登记并认领条目

- 时间：2026-09-02T10:01:06.582Z
- 执行者：atb-0902-5351
- 测试框架：node:assert 子进程钩子实测（code-guard.test.mjs G1–G6）
- 覆盖率：未统计

## 总结

钩子硬约束插件源码改动完成（按对齐方案 A，state-guard.mjs 内扩展、不新增挂点）：1) 守卫范围=插件根（脚本自身 realpath 解析，兼容软链/缓存，当前缓存软链下即时生效）下根级文件与 scripts/commands/skills/hooks/.zcode-plugin/.codex-plugin/assets，豁免 docs/ 看板目录；2) 放行条件=当前项目看板 .locks/ 存在 24h 内未过期认领锁（复用 claim 锁零新机制）；无锁时 Write/Edit 指向插件源码、Bash 改写类操作（sed/tee/cp/mv/rm/重定向/chmod/perl -pi/python -c）命中插件源码目标（插件根路径或 agent-team-board/<受保护目录>，防误拦其他项目同名相对路径）一律拦并给流程指引；3) 同步修复 BUG-20260901-002 只读误报，并新增「提及≠目标」修正——status.json 拦截要求路径形态 token，写关于守卫的文档/测试不再自阻塞（实施中被 live 钩子实测暴露并修复）；4) SKILL.md 铁律新增第 6 条。TDD：code-guard.test.mjs G1–G6 子进程实测先红后绿全过；提及式文本放行实测 exit 0；九套既有测试回归全绿。开放点取默认（任一有效锁放行全区、锁保留至驳回/过期、BUG-002 一并修复）。版本 0.3.8→0.3.9。

## 明细

（可粘贴命令输出、失败用例说明等）
