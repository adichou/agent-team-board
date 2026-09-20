# 测试报告 — REQ-20260830-001 根据当前会话所在项目自动切换看板项目

- 时间：2026-08-29T17:04:25.059Z
- 执行者：terminal
- 测试框架：node:http 集成测试（真实起服务）+ 内置浏览器实测
- 覆盖率：未统计

## 总结

单服务多项目完成：所有数据 API 支持 ?project=<项目根绝对路径>（校验绝对路径且存在，非法 400），未传时用默认项目（注册表首项，首启以启动目录播种，单项目旧用法不变）；项目注册表 ~/.agent-team-board/projects.json（ATB_REGISTRY 可覆盖），?project= 首次命中或 POST /api/register 自动登记，/api/health 返回 projects 与 defaultProject；前端顶栏新增项目下拉（URL ?project= 与 localStorage 双同步，切换即整板重拉、关闭抽屉），未初始化项目保留初始化引导（带 project 调 /api/init）；/board 命令与 SKILL.md 改为打开项目深链，不同会话各自的 /board 自动定位各自项目。TDD：新增 scripts/tests/multi-project.test.mjs（M1–M8，真实拉起 server 随机端口+临时注册表，先红后绿全过；本机 node 17 无全局 fetch，测试用 node:http）；浏览器实测 M9 通过（深链直达、切换器整板切换、未初始化引导+初始化成功）；layout.test.mjs 回归仍绿。版本 0.1.1。

## 明细

（可粘贴命令输出、失败用例说明等）
