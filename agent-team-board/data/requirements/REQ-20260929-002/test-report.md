# 测试报告 — REQ-20260929-002 发布模块删除 Web App 构建目标，不再校验任何构建目标

- 时间：2026-09-29T03:59:52.750Z
- 执行者：zcode-batch-091-1
- 测试框架：node:test 风格自研聚合（真实临时 Git 夹具 + 前端 vm 假 DOM）
- 覆盖率：14%

## 总结

纯删减落地：删除 BPUB 全部执行阶段（sync-source/webapp-build/webapp-verify/site-deploy/site-verify）、profile 构建识别与本机回验服务；inputs 收敛为本地只读 refs（不要求远端与官网配置）；start=token 校验→recordReleaseConfirm（confirmedAt+releasedAt 取确认时点，落账失败即发布失败可重试）→run 即 succeeded，新发布无 stages/targets/directories、全程无 git push；publishedByBld/assertUnpublished 迁至 build-store（并集口径保存量 succeeded 不回退）；前端删发布步两动作区与未配置官网禁用/前往设置，二次确认弹窗展示服务端计划（1 条）；i18n 死键中英同步清理并新增计划键；新增 14 例测试，更新 17 个既有测试，npm test 384 文件全绿

## 明细

（可粘贴命令输出、失败用例说明等）
