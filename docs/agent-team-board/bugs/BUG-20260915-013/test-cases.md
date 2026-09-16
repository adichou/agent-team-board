# 回归用例

- G2 回归：单条、多条看板已跟踪未暂存修改，真实 porcelain 首行为 ` M `，预检通过；与产品发布判断一致。
- G2 回归：首行看板外修改、混合修改、暂存修改、未跟踪文件阻塞，完整路径反馈。
- 所有新增场景检查远端引用、HEAD、暂存区和文件内容不变，记录执行命令确保无 push/add/commit/stash/reset/checkout。
- G1 干净仓库及 G3–G10 现有真实 Git 发布回归。

- 新增空 stdout 场景，无伪脏路径；新增 MERGE_HEAD/rebase-merge/rebase-apply 三种阻塞回归。
- 验证结果对象 files 仅包含完整 src/repro.txt；既有产品发布 Git 测试独立运行。
