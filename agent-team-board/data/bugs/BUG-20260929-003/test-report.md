# 测试报告 — BUG-20260929-003 发布模块硬编码 main 分支：master 主干项目创建发布即报 git rev-parse 失败

- 时间：2026-09-29T00:46:18.222Z
- 执行者：zcode-batch-090-1
- 测试框架：node:test 风格脚本（assert/strict + 真实临时 Git 夹具）
- 覆盖率：4%

## 总结

build-publish 接入 resolveMainBranch()：冻结 mainSha（新增 frozen.mainBranch 字段）、文档合并核验、条目包含性核验、sync-source 一致性比对、推送 refspec 与远端回验统一按解析出的主分支名（main→master）取用；null 时回退 refs/heads/main 维持既有报错路径；计划文案分支名动态化。新增 bug-20260929-003.test.mjs 4 用例先红后绿，发布链路回归与全量 npm test（383 文件）通过。引入来源：BUG-20260916-001。

## 明细

（可粘贴命令输出、失败用例说明等）
