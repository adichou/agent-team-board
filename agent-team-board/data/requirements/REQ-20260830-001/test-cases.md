# 测试用例 — REQ-20260830-001 根据当前会话所在项目自动切换看板项目

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> M1–M6、M7/M8 由 `scripts/tests/multi-project.test.mjs` 覆盖（真实起服务 + 临时项目 + 临时注册表）；M9 为浏览器实测。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| M1 | `/api/health` 无参数可用，返回 `projects` 列表与 `defaultProject`（首启含启动目录项目） | P0 | ✓ |
| M2 | `/api/board?project=A` 与 `?project=B` 返回各自项目的条目（A、B 数据不同） | P0 | ✓ |
| M3 | `?project=C`（未初始化项目）→ `initialized:false` 不报错；`POST /api/init?project=C` 后 `initialized:true` | P0 | ✓ |
| M4 | 状态流转带 project 作用于对应项目：A 项目条目 accepted，B 项目同名状态不受影响 | P0 | ✓ |
| M5 | 非法 project（相对路径 / 不存在路径）→ HTTP 400 且错误信息明确 | P0 | ✓ |
| M6 | `POST /api/register {path}` 登记后出现在 health 的 projects（写入注册表文件） | P1 | ✓ |
| M7 | 前端具备项目切换：index.html 含项目选择器；app.js 所有 API 调用带 project 参数、localStorage + URL 同步 | P1 | ✓ |
| M8 | `/board` 命令与 SKILL.md 指引打开 `?project=<项目根>` 深链 | P1 | ✓ |
| M9 | 浏览器实测：`?project=A` 直显 A；下拉切换到 B 数据整板变化；未初始化项目显示初始化引导且可完成初始化；顶栏项目标识清晰 | P0 | ✓ |

## 执行记录（2026-08-30）

- M1–M8：`node scripts/tests/multi-project.test.mjs` 全绿（先红后绿：初跑 8 项全失败——server 尚无 project 参数）。测试真实拉起 server（随机端口 + ATB_REGISTRY 临时注册表 + 临时项目），非 mock。
- M9：内置浏览器实测通过——深链 `?project=` 直达对应项目；顶栏下拉切换到另一项目后 URL、数据目录、整板数据同步切换；未初始化项目显示引导卡片，点击「初始化」成功变为空四列看板（toast 反馈）。
- 兼容性：不带 project 参数时默认项目 = 注册表首项（首启以启动目录播种），单项目旧用法不变；curl 验证默认项目返回本项目数据。
- 已知取舍：两项目计数器独立、编号可能相同（各项目各自 REQ-…-001），隔离判据用数据目录与标题（测试 M2 备注）。
