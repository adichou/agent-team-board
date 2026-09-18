# 测试报告 — REQ-20260908-007 提供终端可直接运行的 shell 命令

- 时间：2026-09-08T02:14:28.929Z
- 执行者：zcode-batch-012-01
- 测试框架：node:assert/strict + run-all.mjs
- 覆盖率：85%

## 总结

新增 bin/atb POSIX 包装器（穿透符号链接定位插件根、exec node atb.mjs、参数透传）与 atb cli install|uninstall|status 子命令（--to 指定目标目录以避开全局 --dir 旗标；缺省自动选 PATH 中可写候选目录；幂等、外来文件拒绝覆盖/删除；不依赖看板数据目录）；USAGE/SKILL.md/README 同步。新增 cli-shell.test.mjs 12 用例先红后绿，全量回归 80 个测试文件 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
