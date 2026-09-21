# 测试报告 — BUG-20260921-011 刷新时顶部的项目切换组件异常，没有显示数据，尺寸变小，导致模块页签位置变化，需修复

- 时间：2026-09-21T12:44:42.777Z
- 执行者：BUG-20260921-011
- 测试框架：node:assert + vm 提取真实函数 + 假 DOM（仓库自研测试骨架）
- 覆盖率：14%

## 总结

项目选择器四态修复：state.projectsState 状态机（loading/ok/empty/error）+ setProjectList 统一入口；renderProjectSel 任何状态不隐藏——加载中显示「加载项目中…」/已知项目名（加载中…）并禁用，空态「暂无项目」占位，失败态「加载失败，点此重试」且选择器即重试入口（onProjectSelChange error 态重拉，不切换项目不冒充空态）；boot 在 health 等待前首帧渲染占位、数据一到即渲染；index.html 静态首帧占位 option+disabled；.project-sel 固定 200px（≤640px 自适应+min-width:120px），刷新期间顶栏不塌缩、模块页签不横移；i18n 新增 4 静态+1 动态词条过 coverage 卡点；URL>上次选择>服务端默认优先级不变。归因 REQ-20260830-001（引入）+REQ-20260910-012（放大）。新增测试 bug-20260921-011.test.mjs 14 例先红后绿；i18n 五套/multi-project/view-tabs-right 回归全过；npm test 314 文件仅 2 个与本单无关的既有失败（工作区未提交 README/AGENTS 重写，预留快照已含，属在途发布文档工作）

## 明细

（可粘贴命令输出、失败用例说明等）
