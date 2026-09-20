# 测试报告 — REQ-20260916-007 用户数据和应用数据要分离，commit 只需提交用户数据，应用数据不用 commit

- 时间：2026-09-17T16:40:07.247Z
- 执行者：zcode-batch-048-50
- 测试框架：node:assert（自研 runner，data-layout/layout-migration/plugin-pack 等分块顺序全量 267 文件）
- 覆盖率：100%

## 总结

用户/应用数据分离落地：项目根 agent-team-board/{data,runtime} 新布局（status.json 迁 runtime/status、计数器/锁/账本全入 runtime、根 .gitignore 仅一条整目录忽略）；本仓库存量 git mv 迁移完成；新增 atb migrate 一键迁移（CLI + 设置页 /api/layout/state、/api/migrate）；mgt-commit 整改（确认完成只提交 data/ 留痕、version.json 入库下线）；atb pack 打包排除口径；守卫/server/SKILL/AGENTS/README/i18n 同步；收尾补修 12 处旧布局陈旧测试断言、req-disc/oncall-store 缺失导入、growth-store 提示词路径、release-electron .gitignore 豁免与 pidOnPort LISTEN 过滤加固；全量 267 测试文件通过。

## 明细

（可粘贴命令输出、失败用例说明等）
