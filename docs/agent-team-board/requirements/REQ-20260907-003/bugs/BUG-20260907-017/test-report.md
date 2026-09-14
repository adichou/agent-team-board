# 测试报告 — BUG-20260907-017 使用该功能报错。请修复

- 时间：2026-09-08T00:02:27.513Z
- 执行者：zcode-batch-010-01
- 测试框架：node:test（serve-stale T1-T5 端到端+静态契约）
- 覆盖率：100%

## 总结

根因：常驻看板服务进程（02:51 启动）路由集固化，REQ-20260907-003 新增 /api/refine/* 未加载而静态前端已更新，新前端调用旧服务 404「未知接口」报错；且 atb serve 探活一律复用无法自愈。修复：health 暴露 pid/startedAt；atb serve 检测磁盘服务代码新于服务（或 health 无 startedAt）时 SIGTERM 优雅自动重启（health.pid 缺省回退 lsof，失败给手动指引）；前端 api() 对「未知接口」错误附 atb serve 重启指引。新增 serve-stale.test.mjs T1-T5（含用户现场复刻：无 startedAt 旧服务被定位替换）先红后绿，全量 75 测试文件 0 失败

## 明细

（可粘贴命令输出、失败用例说明等）
