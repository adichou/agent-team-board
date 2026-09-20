# 测试报告 — REQ-20260916-005 如果 main 分支不存在则使用 master 分支，以兼容历史仓库

- 时间：2026-09-18T06:36:01.939Z
- 执行者：zcode-batch-049-1
- 测试框架：node:test 风格自研 runner（真实临时 git 仓库 + exec 注入 + vm 前端断言）
- 覆盖率：19%

## 总结

主分支解析回退落地：优先 main、仅 master 历史仓库解析为 master，init/合并/发布/同步全链路取解析结果；专项 19 用例全绿，全量 269/270（batch-ui 一例挂于他单 retry-blocked-continue 未提交改动的 batchContinueHtml 未打桩，非本单文件）

## 明细

（可粘贴命令输出、失败用例说明等）
