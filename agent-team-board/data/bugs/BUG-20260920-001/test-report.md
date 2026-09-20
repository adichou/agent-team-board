# 测试报告 — BUG-20260920-001 在一个旧目录架构的项目中，点击设置界面提示如下文字，无法进行目录迁移

- 时间：2026-09-20T06:55:30.445Z
- 执行者：zcode-batch-053-2
- 测试框架：node:test 风格自研契约测试（vm 沙箱 + DOM stub）
- 覆盖率：85%

## 总结

旧布局项目设置页整页失败吞掉迁移入口：renderSettingsView 对 /api/dispatch/settings 失败即整页替换并提前 return，丢弃并行布局检测结果。改为 loadDispatchSettings 局部记录失败（state.codex.settingsError），新增「派发设置」独立分区就近显示+重试（#csRetry），迁移卡片照常渲染；布局检测失败不误显「无可迁移数据」。引入来源归因 REQ-20260909-001×REQ-20260916-007（经 atb list 核验）。新增 bug-20260920-001.test.mjs 6 用例（先红后绿）；settings-runparams-removed-20260909-011 T3/T4 契约同步；i18n 中英同步（整页键替换为「派发设置加载失败：◇」）。npm test 全量 287 文件 0 失败。

## 明细

（可粘贴命令输出、失败用例说明等）
