# 测试用例 — REQ-20260910-029 新增发布模块：Git 远端与 Apple App Store 发布流水线

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | store：创建草稿（git/apple 配置校验）；web/storage 类型拒绝创建（保留扩展枚举不可执行） | 高 | ✅ 通过 |
| S2 | store：运行 ID 递增、阶段初始 pending、项目间数据隔离（两临时项目互不可见） | 高 | ✅ 通过 |
| S3 | store：同目标并发互斥（活动运行存在时 start/precheck 拒绝；另一目标不受影响）；重试/取消不受互斥限制 | 高 | ✅ 通过 |
| S4 | store：重试只重跑失败/中断阶段（已完成阶段与证据不动）；取消置 pending 为 canceled、保留已完成证据 | 高 | ✅ 通过 |
| S5 | store：远端地址脱敏（user:pass@ 剥离）；sku-map 持久化与复用；服务重启中断标记（running → failed/interrupted，不自动重跑） | 高 | ✅ 通过 |
| G1 | Git：干净仓库真实推送成功（临时 bare 远端），verify 比对远端实际 OID 与冻结 OID 一致 | 高 | ✅ 通过 |
| G2 | Git：未提交修改 → 本地预检阻塞并引导回提交功能（不自动 add/commit/stash；远端未被推送） | 高 | ✅ 通过 |
| G3 | Git：无 remote → 冻结阶段明确阻塞；detached HEAD → 预检阻塞 | 高 | ✅ 通过 |
| G4 | Git：落后 / 分叉 → 获取远端阶段分别阻塞（不自动改写历史），文案区分 | 高 | ✅ 通过 |
| G5 | Git：受保护分支 → 阻塞并展示 PR/MR 入口（配置 protectedBranches） | 高 | ✅ 通过 |
| G6 | Git：质量检查失败 → 阻塞不推送，远端 ref 不变；检查命令与退出码入证据 | 高 | ✅ 通过 |
| G7 | Git：标签冲突（远端已有不同指向标签）拒绝覆盖；同 OID 标签不重复推送 | 高 | ✅ 通过 |
| G8 | Git：分支+标签同批 atomic，远端 `receive.advertiseAtomic=false` 时阻塞说明（真实 bare 远端配置模拟） | 高 | ✅ 通过 |
| G9 | Git：只推选定引用（其他分支 / 其他标签不受影响）；非快进被拒（并发远端更新不覆盖历史） | 高 | ✅ 通过 |
| G10 | Git：网络响应丢失恢复 —— 真实推送已到远端但客户端报超时 → verify 先查询远端判成功，不盲目重推 | 高 | ✅ 通过 |
| A1 | Apple：多 target 匹配歧义要求显式选择（不误选）；SKU 首次收集默认 Bundle ID 并持久化，后续复用 | 高 | ✅ 通过 |
| A2 | Apple：凭据缺失 → 环境阶段明确阻塞给配置指引；凭据内容 / 私钥不进入运行记录或日志 | 高 | ✅ 通过 |
| A3 | Apple：资料与合规问题逐项列举（截图规格 / 隐私清单 / 加密声明）；材料只留摘要与指纹 | 高 | ✅ 通过 |
| A4 | Apple：构建产物记录路径 / 摘要 / 源 OID / 构建身份（可追溯到源提交）；重复版本 build 可检测 | 高 | ✅ 通过 |
| A5 | Apple：上传后等待处理，仅 VALID 继续；INVALID 展示原因失败；等待超时保持可恢复（非失败） | 高 | ✅ 通过 |
| A6 | Apple：重试先查询已有上传（适配器计数：不重复上传）；审核数据阶段不重复创建版本（复用已建版本） | 高 | ✅ 通过 |
| A7 | Apple：审核数据回验后停在 waiting-manual 并提供 ASC 后台链接；模块从不调用最终提审接口（适配器计数为 0） | 高 | ✅ 通过 |
| A8 | Apple：跟踪状态区分 待审核/审核中/被拒（保留原因）/待开发者发布（不可提前完成）/处理中/已上线（仅此标成功）；被拒后修订新运行关联原运行 | 高 | ✅ 通过 |
| H1 | serve：state 两态（未初始化看板 initialized:false）；草稿创建 / 保存 / 详情 / 列表；未知运行 404 | 高 | ✅ 通过 |
| H2 | serve：precheck 只读不推送（远端 ref 不变）；start 后互斥生效（同目标第二个 start 拒绝）；跨项目隔离；服务重启恢复不重复执行 | 高 | ✅ 通过 |
| H3 | serve：retry / cancel / refresh / sku / targets 接口行为；响应内远端地址已脱敏；release.js 静态可访问 | 高 | ✅ 通过 |
| U1 | ui 契约：「发布」页签位于营销与设置之间；#releaseView 容器与 release.js 引入（app.js 之前） | 高 | ✅ 通过 |
| U2 | ui 契约：app.js VIEWS/setView/快照/项目切换重置接线；style.css 分栏 + 窄屏上下排列 + CSS 变量 | 高 | ✅ 通过 |
| U3 | ui 行为：运行列表 + 筛选 + 详情四页签；新建面板类型选择（web/storage 置灰「首期未开放」）与动态字段 | 高 | ✅ 通过 |
| U4 | ui 行为：草稿保存 / 预检 / 计划确认后启动（先展示计划再授权）；重试 / 取消 / 刷新按钮按状态出现 | 高 | ✅ 通过 |
| U5 | ui 行为：空态（无运行引导 + 无 remote / 无 ASC 凭据配置指引）、加载态、失败红显原因、等待人工（ASC 入口）| 高 | ✅ 通过 |
| D1 | ui-demo.html 离线可开（无外部网络引用）且覆盖验收所列布局与状态切换 | 中 | ✅ 通过 |

测试文件与执行方式（均为零依赖 Node 自包含测试，沿用项目约定）：

- `node scripts/tests/release-store.test.mjs`（S1–S5）
- `node scripts/tests/release-git.test.mjs`（G1–G10，真实临时 bare 远端集成）
- `node scripts/tests/release-apple.test.mjs`（A1–A8，模拟适配器状态 / 故障 / 调用计数）
- `node scripts/tests/release-serve.test.mjs`（H1–H3，真实 HTTP 服务 + 临时 Git 远端 + 服务重启恢复）
- `node scripts/tests/release-ui.test.mjs`（U1–U5、D1，静态契约 + vm 行为）
- 全量回归：`npm test`（181 个测试文件全部通过）
