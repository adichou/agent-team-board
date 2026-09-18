# 测试报告 — BUG-20260917-002 收口自动提交对已整体暂存的删除路径 git add -A 报 pathspec fatal，提交被毒死

- 时间：2026-09-18T18:57:45.125Z
- 执行者：zcode-batch-049-004
- 测试框架：node
- 覆盖率：未统计

## 总结

commitPaths 的 pathspec 无匹配跳过改为结构化判定（磁盘存在或 git ls-files --error-unmatch 命中索引），不再依赖英文错误文案：实测 zh_CN locale 下 git 2.49 fatal 已本地化为「致命错误：路径规格…未匹配任何文件」，21fc312 的英文正则失配导致收口/确认补交连环挂起；无匹配路径跳过 add 由 commit --only 以 HEAD 记录收录删除，可匹配路径的 add 失败照常上抛不吞错（errorFull 口径不回退）。新增 bug-20260917-002.test.mjs 4 例（B4 本地化用例修复前跑红）：核心复现删除被收录、index.lock 真实错误如实 failed 挂起且确认闭环补齐不重复、补交 include 计入同现场收录、zh_CN 本地化收口成功；全量 npm test 275 文件 0 失败，覆盖率未统计。归因引入来源 REQ-20260911-009（部分修复关联 REQ-20260916-007）。

## 明细

（可粘贴命令输出、失败用例说明等）
