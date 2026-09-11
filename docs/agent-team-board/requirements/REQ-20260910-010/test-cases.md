# 测试用例 — REQ-20260910-010 项目管理中，提供自动检测不存在的目录并支持一键移出所有不存在的目录

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

自动化：`scripts/tests/missing-dir-detect-20260910-010.test.mjs`（真实起 server，随机端口 + 临时注册表 + 临时项目；另含前端静态契约与 ui-demo 离线检查）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | `POST /api/project/scan` 逐项分类：存在目录=exists；已删除（ENOENT）=missing；断开符号链接=missing；路径处变成文件=missing（reason 说明）；统计 summary 计数正确 | P1 | 通过 |
| S2 | scan 对 stat 权限错误（父目录无执行权限 EACCES）返回 state=error 并附原因，不判为 missing、不纳入批量候选；注册表不被 scan 改写（只读、幂等） | P1 | 通过 |
| S3 | scan 参数/态边界：空注册表返回空列表与零计数；scan 不受 ?project= 隐式登记影响，不把已移出项目注册回来 | P1 | 通过 |
| S4 | 单项移出放宽：`/api/project/remove` 可移出「目录已不存在」的注册项（旧实现 400），注册表落盘、removed 标记、磁盘数据不受影响；未注册路径仍 400 | P1 | 通过 |
| B1 | `/api/project/remove-missing` 批量移出：仅移出仍为 missing 的候选，注册表与 removed 标记同步落盘；projects/defaultProject 与 health 一致；磁盘需求文档保留 | P1 | 通过 |
| B2 | 确认时重新核实：确认前目录恢复存在 → skipped（已恢复）；候选已被移出（不在注册表）→ skipped；不扩大范围——注册表内不在候选中的项目原样保留 | P1 | 通过 |
| B3 | 状态无法确定（EACCES 归类）与非法请求处理：error 态候选不作为不存在移出（skipped）；paths 非数组/为空/含相对路径 → 400，注册表不变 | P1 | 通过 |
| B4 | 批量移出后轮询不隐式恢复：访问已移出项目数据仍可读，health/projects 不包含；重新导入（register）可恢复且 removed 标记清除 | P1 | 通过 |
| F1 | 前端静态契约：检测条（#projScanBar/#projScanSummary/#projScanBtn/#projRemoveMissingBtn）与批量确认区（#projBatchConfirm/#projBatchOk/#projBatchCancel）存在；打开面板自动检测（openProjPanel → 扫描调用）；行内文字状态（检测中/存在/不存在/检测失败）非仅颜色区分 | P1 | 通过 |
| F2 | 前端交互契约：批量按钮计数（N）与禁用条件（检测中/检测失败/无候选/busy）；确认区列完整路径与「仅移出列表」语义文案；取消不变更；结果分项汇报（成功/跳过（原因）/失败（路径）），失败不显示全部成功；busy 纳入批量按钮与确认按钮禁用；完成后刷新列表与切换器；当前项目被移出沿用剩余首项/无项目空态逻辑；请求走 /api/project/scan 与 /api/project/remove-missing | P1 | 通过 |
| F3 | 样式契约：检测摘要与按钮可换行（小屏）、候选路径不截断（overflow-wrap:anywhere）、行状态可辨识 | P2 | 通过 |
| F4 | ui-demo.html 离线自包含：内联 CSS/JS、无外链/外网依赖，覆盖检测、确认/取消、移出结果与正常/空/加载/失败场景关键词 | P2 | 通过 |
| R1 | 回归：project-manage-20260910-005 与 multi-project 全量通过（单项移出/初始化/导入/切换语义不回退） | P1 | 通过 |
