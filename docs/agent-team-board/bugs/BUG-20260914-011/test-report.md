# 测试报告 — BUG-20260914-011 和远端同步是指先 fetch，然后 push，确保本地和远端的记录一模一样

- 时间：2026-09-14T06:44:25.141Z
- 执行者：zcode-batch-048-BUG-20260914-011
- 测试框架：node:assert/strict + vm（项目既有自研用例 runner）
- 覆盖率：13%

## 总结

和远端同步改为 fetch --all --prune 后推送除 main 外全部本地分支（main 归发布模块，与 012 口径一致）：build-git 新增 syncRemote 逐分支收集结果不强推；/api/build/fetch 换 /api/build/sync；前端两步汇总 toast + 空态按推送结果细分；i18n 新增 3 词条；新增 13 用例，005/006/build-serve 断言随语义更新，run-all 228 文件全过

## 明细

（可粘贴命令输出、失败用例说明等）
