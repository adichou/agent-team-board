# 测试报告 — BUG-20260901-002 守卫 Bash 模式误报：命令文本提及看板目录与状态文件名即被拦

- 时间：2026-09-05T09:07:51.151Z
- 执行者：atb-0905-6f67
- 测试框架：node:assert 契约测试（子进程实测 state-guard 双模式）
- 覆盖率：100%

## 总结

核验确认修复已随 REQ-20260901-003 落地：bash 模式规则①改为「路径形态 /status.json + agent-team-board + 真实改写意图」三条件同时满足才拦，纯文字提及与只读命令放行。本次不改守卫代码，补 F1–F3 回归：F1 复现原始误报形态（atb new/report 描述文本含看板目录与 status.json 字样）放行；F2 只读命令路径形态提及放行；F3 原攻击样例（echo 重定向/sed -i/tee/rm 写 status.json）仍拦，拦截能力不回退。code-guard.test.mjs 15/15 通过；全量 19 套件 18 绿，唯一失败 portrait-board P6 属 REQ-20260903-002 在途工作（zcode-board-portrait-redesign 今日认领），与本条无关未触碰。归因：引入来源未定位（初版守卫启发式，排查过程见 README 关联节）；修复归属 REQ-20260901-003。文档：补 test-cases.md、design.md 实施记录，README 填复现步骤/期望行为并加关联节。

## 明细

（可粘贴命令输出、失败用例说明等）
