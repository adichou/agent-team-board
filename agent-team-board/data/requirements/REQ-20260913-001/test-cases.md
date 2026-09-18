# 测试用例 — REQ-20260913-001 添加一个构建模块，支持版本管理。模块位置在需求模块和任务模块之间

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 落地：build-store.test.mjs（数据层 B1–B8）、build-serve.test.mjs（服务接口 S1–S10）、build-ui.test.mjs（前端 N1–N8）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B1 | store 创建版本：编号 BLD-YYYYMMDD-NNN 递增；默认名称「版本 YYYYMMDD-HHMM」；draft 态落盘 version.json | P0 | 通过 |
| B2 | store 校验：空条目 / 条目重复 / commit 缺失或非 hash / 名称超长 → AtbError | P0 | 通过 |
| B3 | store 条目增删：add 追加（重复拒绝）、remove 移除；merging/merged 拒绝增删；增删不破坏其余条目 commit | P0 | 通过 |
| B4 | store 名称描述编辑：draft/failed/merged 可改；merging 拒绝；编辑不破坏条目与 commit 关联 | P0 | 通过 |
| B5 | store 合并状态机：draft→merging→merged / failed；failed→merging 重试；非法流转拒绝 | P0 | 通过 |
| B6 | store 列表与读取：listVersions 按创建倒序；readVersion 未知 id 报错 | P1 | 通过 |
| B7 | store 服务重启恢复：merging 版本标记 failed（不自动重跑） | P1 | 通过 |
| B8 | store merge 结果逐条目落 mergedAt / mergeError | P0 | 通过 |
| S1 | /api/build/state 两态：未初始化看板 initialized:false；git 项目含 isRepo/currentBranch/versions | P0 | 通过 |
| S2 | 创建版本：合法 201 落盘；空条目 400；条目无 commit 400；编号不存在看板 400 | P0 | 通过 |
| S3 | 编辑保存：name/description 持久化；再读不丢条目 commit 关联 | P0 | 通过 |
| S4 | 条目增删接口：add/remove 即时生效；重复添加 400；merging 中 409 | P0 | 通过 |
| S5 | candidates：dev 分支提交消息含 REQ-/BUG- 单号 → 候选含该条目与 commit；无提交条目 commits 为空 | P0 | 通过 |
| S6 | 合并入 main 全链路：工作区干净 → merge 成功 main 含所选提交、版本 merged、逐条 mergedAt、切回原分支；重复合并 409 | P0 | 通过 |
| S7 | 合并隔离与互斥：合并在临时工作树执行（脏工作区不阻塞、未提交改动保留不卷入、不切分支）；release git 目标活动运行时 409 互斥 | P0 | 通过 |
| S8 | branches / branch-log：本地与远端（bare remote 推送后）分组返回；branch-log 返回 hash/说明/作者/时间；非 git isRepo:false | P0 | 通过 |
| S9 | fetch/push：fetch --prune 刷新远端列表；push 首推建立上游、远端出现 origin/ 分支；非 git 拒绝 | P0 | 通过 |
| S10 | 非 git 项目写接口（version/merge/push/fetch）明确拒绝；静态 build.js 资源可获取 | P1 | 通过 |
| N1 | 顶栏导航：页签顺序 需求→构建→任务→设置；「构建」按钮在 status 与 runs 之间；默认激活态不受影响 | P0 | 通过 |
| N2 | setView 支持 build：容器显隐、激活态、?view=build 深链直达；enter 触发 ATBBuild.enter | P0 | 通过 |
| N3 | HIDDEN_VIEWS 兜底不回退：oncall/files/marketing/release 旧深链仍回落需求模块且不请求两模块 API；VIEWS 含 build 且既有序列兼容 | P0 | 通过 |
| N4 | 静态契约：index.html 含 #buildView 容器与 build.js 引用（app.js 之前加载）；app.js 含 build 快照接线 | P0 | 通过 |
| N5 | 模块副标题/搜索：MODULE_SUB.build、SEARCH_SCOPE.build=构建、SEARCH_PLACEHOLDER.build 前端过滤接 ATBBuild.setQuery | P1 | 通过 |
| N6 | 快照往返：ATBBuild.snapshot/restoreView 接入 saveViewSnapshot 与 applyViewSnapshot | P1 | 通过 |
| N7 | build.js 行为（vm）：state 汇总渲染版本列表 + 状态 chip；创建侧拉面板全选/全不选与无 commit 跳过提示；回填弹窗解析成功/失败两态 | P1 | 通过 |
| N8 | i18n：「构建」页签与 app.js 新增中文键入 EN 词典（i18n-coverage 保持绿） | P1 | 通过 |
| R1 | 既有测试回归：导航顺序断言（workbench-layout / hide-modules / hide-marketing-release / global-entry-panel / revert-ci-board / global-board / layout-topbar-rail）同步更新后 npm test 全绿 | P0 | 通过 |
