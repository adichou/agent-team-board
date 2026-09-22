# 测试用例 — REQ-20260922-006 发布版本的版本号改成 x.y.z 格式，发布时间以推送到远端仓库 main 分支的时间为准。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | 数据层：createVersion 缺省自动分配——无历史 version 时首个为 0.1.0；存在 0.1.0 / 0.2.3 时下一个为 0.2.4（major/minor/patch 数值比较取最大 patch+1） | 高 | ✅ |
| D2 | 数据层：createVersion 手填合法 x.y.z 生效；非法格式（20260921-001、1.2、v1.0.0、1.2.3.4）拒绝；与既有计划版本重复拒绝且报错含冲突计划号；删除计划后版本号可复用 | 高 | ✅ |
| D3 | 数据层：recordPushSuccess 写入顶层 releasedAt 且与 release.pushedAt 同刻；同基准 sha 重复推送不重置；基准变化时 releasedAt 随 pushedAt 一并更新 | 高 | ✅ |
| S1 | 服务层：POST /api/build/version 带 version 创建成功落盘；非法/重复返回错误；缺省走自动分配 | 高 | ✅ |
| S2 | 服务层：/api/build/state 返回 version 与 releasedAt；存量（仅 release.pushedAt）回退透出；publish-plan 的 versionNumber 新计划取 x.y.z、存量计划回退 YYYYMMDD-NNN 派生 | 高 | ✅ |
| U1 | 前端契约：列表卡片与详情头部「版本号」用 v.version，无 version 字段回退旧派生；已发布显示「发布于 <时间>」、未发布不显示；产品发布弹窗默认预填 v.version | 高 | ✅ |
| U2 | i18n：新增「发布于」等键中英文同步，无缺漏 | 中 | ✅ |
| R1 | 回归：req-20260920-003（五步流程）与 build-store.test.mjs、build-serve.test.mjs 既有断言不受影响；npm test 全量通过 | 高 | ✅（req-20260920-003 L4 版本号断言按新口径更新：新计划取 x.y.z；全量见交付报告） |
