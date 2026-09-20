# 测试报告 — BUG-20260907-013 状态守卫误拦：无锁时以重定向日志方式启动/引用插件脚本的命令被判为改写源码

- 时间：2026-09-07T16:58:57.834Z
- 执行者：zcode-batch-009-1
- 测试框架：node:test(assert)+子进程实测
- 覆盖率：100%

## 总结

守卫 bash 模式第(4)检查改为写目标语义关联：新增 rewriteTargetTokens 提取重定向/tee/cp/mv/rm/chmod/sed -i/perl -pi/find 写动作的落盘目标并逐一 realpath 判定是否插件源码，插件路径仅作读取/执行/遍历来源时放行；目标不可静态解析（内联代码/sed w 脚本/残缺命令）回退段级保守拦截。判例演进：node <SRC> >/tmp、cp <SRC> /tmp、find …-fprint /tmp 改放行。code-guard 35 用例全绿（新增 C1-C3），run-all 70 文件回归 0 失败，无锁冒烟三场景符合预期。引入来源：REQ-20260901-003（已核验存在，README 关联节归因）。

## 明细

（可粘贴命令输出、失败用例说明等）
