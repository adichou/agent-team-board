
## REQ-20260907-001 Oncall 咨询看板：咨询单创建、批量/单条派单回复，富文本与截图展示，支持 zcode 与 codex
## 验收标准

- [ ] （待补充）

# 测试用例 — REQ-20260907-001 Oncall 咨询看板：咨询单创建、批量/单条派单回复，富文本与截图展示，支持 zcode 与 codex

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | 数据层：创建咨询单生成 ASK-YYYYMMDD-NNN 独立序列，状态 pending，question.md 落盘 | P0 | ✅ |
| S2 | 数据层：派单（zcode/codex）记轮次 mode/staff/dispatchedAt 并转 answering；回传 answer 落 rounds/N/answer.md 转 answered | P0 | ✅ |
| S3 | 数据层：追问 ask 追加轮次并把 answered 拉回 pending；失败 failRound 记 error 转 failed；failed 可重派回 answering | P0 | ✅ |
| S4 | 数据层：附件白名单（png/jpg/webp…放行、exe/sh 拒绝）、大小 ≤8MB、文件名净化防穿越 | P0 | ✅ |
| S5 | 数据层：listTickets 按状态过滤；客服人员 >30 字符拒绝；dispatches 派单账本记录 mode/staff/ids | P1 | ✅ |
| C1 | CLI：oncall new/list/show/ask/answer 全链路；answer 从文件回传后 show 可见回答内容 | P0 | ✅ |
| C2 | CLI：oncall dispatch（zcode）生成主调度提示词：含会话命名指令「oncall-YYYYMMDD-<客服>」、每单 answer 受控回传命令；未填客服显示「未指定」且不阻塞 | P0 | ✅ |
| H1 | HTTP：POST /api/oncall/ticket 创建（含 base64 附件）；GET board/详情/round/attachment 字节端点（MIME 白名单 + nosniff） | P0 | ✅ |
| H2 | HTTP：POST ask 追问；POST dispatch zcode 返回提示词并写账本；GET dispatch/records；非法参数 400 | P0 | ✅ |
| H3 | HTTP：/api/oncall/board 返回 codexReady；未配置 CLI 的项目 codexReady=false | P1 | ✅ |
| D1 | codex 派发：fake-codex（ok 模式）后台执行后 final-message 自动回传 → 状态 answered、回答落位、by 含客服人员 | P0 | ✅ |
| D2 | codex 派发：auth-error 失败 → 状态 failed、轮次 error 记录；redispatch 可重派 | P0 | ✅ |
| D3 | codex 派发：串行逐单执行（两单依次回传，不并行）；不占用 .locks/impl.lock | P1 | ✅ |
| U1 | 前端：顶栏「Oncall」tab 与需求/文件同款切换；视图容器与抽屉骨架；oncall.js 已引入 | P0 | ✅ |
| U2 | 前端：新建表单（标题/正文/截图上传与粘贴）；批量派单（模式选择+客服人员输入记忆 atb.oncall.staff）；codex 未就绪隐藏入口 | P0 | ✅ |
| U3 | 前端：列表卡片字段（单号/标题/状态/模式徽标/时间/轮数）、状态筛选、空态引导 | P1 | ✅ |
| U4 | 前端：详情 Markdown 渲染（marked+sanitize）、附件内联与点击放大（lightbox）、每轮标注模式/时间/来源、问询追问输入 | P0 | ✅ |
| I1 | 隔离：core.listItems 不含 ASK（REQ/BUG 列表与 /dev next 选单不受影响）；oncall 派单不产生/占用 impl.lock；现有看板测试无回归 | P0 | ✅ |


## REQ-20260907-002 批量实施批次关联开发人员：调度会话命名与看板展示
## 验收标准

- [ ] 看板创建区可填开发人员（记忆上次值，首次可预填 git user.name），CLI `atb batch create --dev <名称>`；创建后 batch.json 记录 developer 字段
- [ ] 填写开发人员时主调度提示词含「请将当前会话名改为：<batchId>-<开发人员>」指令；未填时提示词与既往一致（不加指令/缺省名）
- [ ] 看板批次面板（含排队批次）与 batch summary 展示开发人员；存量批次无字段显示「未指定」，账本不迁移
- [ ] 开发人员超 30 字符或含换行/控制字符被拒（CLI die / API 400），拒绝不产生批次副作用
- [ ] 不填写时 create / batch check / next / summary 与看板展示均正常；现有 batch-cli / batch-serve / batch-ui 及全量测试无回归

# 测试用例 — REQ-20260907-002 批量实施批次关联开发人员：调度会话命名与看板展示

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | core：createBatch 带 developer → 账本记录 developer 字段，提示词含「请将当前会话名改为：<batchId>-<开发人员>。」一行 | P0 | 通过（batch-core） |
| D2 | core：不填 developer → 账本 developer=null，提示词与现状逐字一致（不含会话名指令），不回归 | P0 | 通过（batch-core） |
| D3 | core：developer 超 30 字符 / 含换行被 AtbError 拒；首尾空白被裁剪后入账本 | P0 | 通过（batch-core） |
| D4 | core：batchSummary 携带 developer；手工删掉账本 developer 字段（模拟存量批次）摘要仍正常返回（展示层回退未指定） | P1 | 通过（batch-core） |
| D5 | CLI：`batch create --dev 张三` 端到端 → 提示词含命名指令、summary 显示开发人员；不填时 create/summary/check/next 正常且显示「未指定」 | P0 | 通过（batch-cli） |
| D6 | serve：create 接受 developer 并在响应回显；current 的 batch/queue 带 developer；developer 超 30 字符 → 400；无批次时 stats.gitUser 可获取（非 git 项目为 null 亦可） | P1 | 通过（batch-serve） |
| D7 | UI 静态契约：创建区有 #batchDev 输入（maxlength 30、localStorage `atb.batch.dev` 记忆与 gitUser 预填）；运行面板显示开发人员并回退「未指定」；排队批次行展示开发人员 | P1 | 通过（batch-ui） |


## REQ-20260907-003 需求完善：待接受需求与 Bug 批量补全文档，支持 Zcode / Codex 派发
## 验收标准

1. **候选筛选**：提供文档完整性分析——待接受（submitted）的需求按 README 缺失 / 关键说明不全（验收标准待补充、说明过简）/ design 空模板 / test-cases 无用例 判定；Bug 按 README 缺失 / 缺现象 / 缺复现 / 缺期望 / 缺验收说明 判定。候选清单按「需求优先 → 创建早优先」排序，逐项展示缺失原因。
2. **入口与交互**：待接受列复用既有选择工具条，新增「需求完善」入口；任务模块复用批量实施面板交互，新增「需求完善」子面板：启动前展示候选清单与缺失原因、执行模式（Zcode 主调度逐项派子 Agent / Codex 后台逐项独立会话）与开发人员输入；创建时冻结所选范围（含缺失原因与文档指纹基线）。
3. **Zcode 模式**：生成主调度提示词（复制到 Zcode 本项目新会话）；子 Agent 经 `atb refine next` 领取一项 → 直接编辑条目 markdown 补全文档（未知事实写「待确认」）→ `atb refine done --summary` 回执；主会话以 `atb refine check` 最小核对（≤2KiB）。
4. **Codex 模式**：看板服务为每个候选项后台启动独立 codex exec 会话（逐项串行），事件/错误落盘；结束后由服务核验文档确实变更再记完成，未变更/执行异常记失败并展示原因。
5. **结果展示**：面板展示批次状态、进度计数（完成/失败/出局/待处理）、逐项执行记录（条目文档链接、摘要、失败原因）。
6. **不冒充开发**：全程条目保持 submitted；不调用 claim/report、不写 test-report.md、不触发「待人工确认完成」标记；提示词明确只编辑条目目录下 markdown、不写业务源码、未知事实标「待确认」。
7. **并发与保护**：完善批次与实施批次账本隔离（不占实施互斥锁，可与实施并行）；同一时间至多一个完善执行（refine 互斥锁）；重复创建排除未结束完善批次已冻结条目且队尾候选一致时幂等返回；领取时条目已离开待接受 → 该项出局落账；冻结后文档被人工编辑（指纹不符）→ 该项出局落账；完成回执要求文档内容相对基线确有变更且条目仍为待接受。
8. **CLI**：`atb refine create|next|done|fail|release|check|summary|pause|records` 子命令可用（`--json` 输出机器可读形态）。

# 测试用例 — REQ-20260907-003 需求完善：待接受需求与 Bug 批量补全文档，支持 Zcode / Codex 派发

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | 完整性分析：需求 README 缺失/验收标准待补充/说明过简/design 空模板/test-cases 无用例 各给对应缺失原因；Bug 缺现象/复现/期望/验收逐项给原因；关键说明齐全的条目不进候选 | P0 | ✅ |
| R2 | 候选清单：仅 submitted（accepted/done 不进），req 优先 → 创建早 → 编号排序；candidates 携带缺失原因 | P0 | ✅ |
| R3 | 创建批次：冻结候选+缺失原因+文档指纹基线；勾选 ids 过滤范围；无候选报错；zcode 模式生成主调度提示词（含 refine next/done/check 与只改文档约束） | P0 | ✅ |
| R4 | 并发重复派发保护：未结束批次已冻结条目不入新批；队尾候选一致幂等返回（不新建） | P0 | ✅ |
| R5 | 领取：next 预留一项并持 refine 互斥；重复 next（未收尾）被拒；领取时非 submitted → skipped 出局落账；指纹≠基线（人工编辑）→ skipped 出局落账；无可领 → 批次 finished + stop | P0 | ✅ |
| R6 | 完成回执：done 要求 summary；文档未变更（指纹=基线）拒绝；条目已离开 submitted 拒绝；正常补全后落 done、批次计数推进、互斥释放 | P0 | ✅ |
| R7 | 失败回执：fail 需 reason（≤200 字）；落 failed 计数；跳过后续可继续 next | P0 | ✅ |
| R8 | check 协议：≤2KiB；current/counts{total,done,failed,skipped,remaining}/nextAction；全部处理完 → stop+finished | P0 | ✅ |
| R9 | 暂停：pause 后 next 返回 stop=paused；恢复后可继续 | P1 | ✅ |
| R10 | CLI 端到端：refine create → next → （补文档）→ done → check 全链路经 atb.mjs 可跑通；--json 输出机器可读 | P0 | ✅ |
| R11 | 服务接口：/api/refine/candidates 带缺失原因；/api/refine/create（zcode）返回提示词；（codex）CLI 未就绪 400；/api/refine/current 展示批次/计数/记录；/api/refine/pause 生效；codex 模式经假 CLI 逐项执行、文档变更核验后记 done、未变更记 failed | P0 | ✅ |
| R12 | UI 静态契约：待接受选择工具条有「需求完善」入口（#refineGo）；任务模块有 refine 子面板 tab；面板渲染候选清单（含缺失原因）、模式选择、进度计数与逐项记录（文档链接/摘要/失败原因） | P1 | ✅ |


## REQ-20260907-004 看板整体布局优化：统一导航、三类新建入口与列表工作区
## 验收标准

- [ ] 顶栏右侧仅一个统一新建入口，在四个模块均可新建需求、Bug、讨论单。
- [ ] 栏目按讨论、需求、任务、文件排列；设置是辅助入口；需求模块仍包含需求与 Bug 两种条目。
- [ ] 页面第三行没有重复标题，副标题与当前模块搜索框同区；第四行仅保留适用的状态筛选等上下文控件。
- [ ] 移除列表/看板切换控件；初次进入和刷新需求模块都显示列表，旧布局偏好不会恢复看板模式。
- [ ] 面向用户的 Oncall、咨询单、执行中心分别统一为讨论、讨论单、任务；Bug 类型标识保留。
- [ ] 讨论用于项目问题、方案沟通与持续讨论，列表、详情、创建、继续讨论、空态和反馈文案一致。
- [ ] 三类新建成功均定位到对应模块新条目；验证错误和请求失败保留输入、明确提示，可重试且不重复提交。
- [ ] 搜索作用于当前模块，可与状态筛选叠加；清空搜索恢复结果，零结果有明确空态。
- [ ] 宽屏列表与详情并排，窄屏可进入详情并返回原列表；筛选、选中项和阅读上下文合理保留，无内容遮挡。
- [ ] 现有需求/Bug 状态流转、详情文档、批量操作、讨论附件与派单、任务管理、文件预览和设置能力可达。
- [ ] Zcode/Codex 派发沿用现有行为，错误在对应条目或任务附近可见；布局调整不改业务状态规则。
- [ ] 1024、736、360 像素宽度及深浅主题下主要操作可达，键盘可操作，文字和控件不重叠。


## 界面与交互说明

1. 第一行：产品标识、当前项目和项目切换入口位于左侧；「新建」固定在右侧，打开同一创建表单，通过类型选择需求、Bug、讨论。按类型展示现有必需字段，保留 Bug 关联需求、讨论富文本与截图等现有能力。
2. 第二行：固定顶栏导航「讨论 → 需求 → 任务 → 文件」，突出当前模块；设置作为行末辅助入口。无旧深链时默认进入需求列表；旧模块深链仍可访问对应内容。
3. 第三行：不显示模块大标题，仅展示一句副标题，右侧放该模块搜索框。需求示例「从想法到验收，跟进每一项工作」；讨论示例「把项目讨论留在对应的上下文里」。搜索提示说明搜索对象；窄屏允许同一区域内自然换行。
4. 第四行：需求保留状态筛选及数量反馈；其他模块仅保留适用筛选。取消原搜索区域和列表/看板切换按钮，不保留无内容的占位行。
5. 主工作区：需求列表主要展示标题、编号、类型、状态、负责人及时间；选择后右侧显示详情，文档页签、前后条切换和动作位于详情上下文内。批量动作随勾选出现，禁用条件与原因清楚，避免将全部操作堆在全局顶栏。
6. 讨论采用列表与对话详情；任务集中呈现执行记录、批次、队列与对应操作；文件采用树与阅读区域，提供原有预览/源码能力。设置独立组织配置。各模块沿用现有业务功能，统一间距、层级、选中态和反馈位置。
7. 新建时必填项校验在表单内展示；提交中防止重复点击；成功关闭弹窗、显示成功反馈，并进入需求或讨论模块定位新条目。失败保留已填写内容；取消不创建条目。
8. 加载、空列表、筛选零结果和失败状态分开呈现；局部请求失败提供明确提示与重试入口。切换模块、打开/返回详情和轮询更新不无故清空用户输入与阅读位置。

## 范围与兼容

本需求是整体界面重构，涵盖四个模块及设置，不仅调整顶栏文案。已登记的批量需求完善 REQ-20260907-003 独立实施，本需求不重复实现其业务流程。讨论基于既有 REQ-20260907-001 能力优化语义和布局。

面向用户的名称更新不强制重命名内部 API、数据目录、ASK 编号或历史单据；旧链接及历史记录应保持兼容。demo 为布局和交互参考，其示例数据、模拟创建、模拟派发不可代替真实接口与完整业务能力。

## 已确认演示

- [交互演示（HTML 片段）](./layout-demo.html)
- [界面设计与实施边界](./design.md)
- [验收用例](./test-cases.md)

# 验收用例

以下用例待开发阶段执行，当前不代表已通过。

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| UI-01 | 首次进入、刷新、带旧看板偏好进入 | 默认需求列表；四行层级符合 README，无重复标题、搜索和模式切换 |
| UI-02 | 依次切换讨论、需求、任务、文件 | 顺序及高亮正确，各模块功能可达，设置为辅助入口 |
| UI-03 | 遍历列表、详情、弹窗、空态和提示 | 统一使用需求、讨论、讨论单、任务；保留 Bug 类型 |
| UI-04 | 从不同模块分别新建需求、Bug、讨论单 | 使用正确字段与接口，成功反馈并定位对应模块新条目 |
| UI-05 | 空标题、请求失败、重复点击、取消创建 | 就地提示、输入保留、防重提交；取消无新增 |
| UI-06 | 各模块输入搜索、叠加筛选、清空、无匹配 | 结果与数量一致，零结果明确，第三行搜索可用 |
| UI-07 | 打开详情、切页签、前后切换、关闭并返回 | 内容和动作正确，上下文保留 |
| UI-08 | 多选、取消选择及执行批量动作 | 上下文工具条随选择变化，条件与反馈正确，业务状态规则不变 |
| UI-09 | 讨论附件、富文本、继续讨论及两种派发 | 原有能力可用，新文案一致，失败可处理 |
| UI-10 | 任务队列、暂停/续跑、记录、关联条目 | 原有能力可达，反馈定位清楚 |
| UI-11 | 文件树、预览/源码、设置及项目切换 | 功能不退化，项目数据隔离 |
| UI-12 | 旧深链和历史 ASK 单据 | 可打开对应内容，无破坏性迁移 |
| UI-13 | 1024/736/360 宽度、深浅主题、键盘操作 | 无遮挡或重叠，主要动作可达，窄屏详情可返回 |
| UI-14 | 加载失败、空数据、轮询更新 | 加载/空态/错误明确，不无故丢失输入及阅读位置 |

## 自动化契约用例（workbench-layout.test.mjs）

结构 / 文案 / 接线可在零依赖静态断言中覆盖的部分；视觉与多尺寸核验仍按 UI-13 人工执行。

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| W1 | 四行层级 | index.html 依次含 .topbar → .module-nav → .page-head（副标题 + 模块搜索）→ 模块内容；topbar 不再含搜索框与视图切换 |
| W2 | 模块导航顺序与辅助入口 | 第二行按钮为 讨论 → 需求 → 任务 → 文件，末位「设置」带辅助样式类；无独立 Oncall 字样入口 |
| W3 | 需求默认列表 | view-tab 默认激活 status；无列表/看板切换控件；app.js 无 board-tabs/scrollToCol 看板机制 |
| W4 | 需求工作区 | .req-split 宽屏双栏（列表 + 详情并排）；#drawer 位于 req-split 内；窄屏单列 + 详情返回按钮 |
| W5 | 状态筛选 | 需求视图 #filterBar 含 全部/待接受/已接受/开发中/待确认/已完成 带计数，点击过滤列表 |
| W6 | 统一新建 | #btnNew 打开同一弹窗；类型含 需求/Bug/讨论单；讨论单走 /api/oncall/ticket 并带附件上传与粘贴；Bug 保留归属需求 |
| W7 | 新建导航与防重 | 三类创建成功进入对应模块并定位；提交中禁用；失败保留输入（不 closeModal） |
| W8 | 模块搜索 | 第三行 #searchInput 按模块更新占位符（需求/讨论/任务/文件）；讨论与任务为前端过滤；设置视图无搜索框 |
| W9 | 更名 | oncall.js 面向用户文案统一为 讨论/讨论单；不重命名 API 路径与 ASK 编号 |
| W10 | 任务模块 | setView 支持 runs；批量面板渲染进任务视图容器；无 batchMask 遮罩 |
| W11 | 设置模块 | setView 支持 settings；渲染项目派发默认值并保存至 /api/dispatch/settings |
| W12 | 深链兼容 | view 参数支持 status/files/oncall/runs/settings，旧值照常 |

## 受影响既有契约测试的同步更新

布局重构后以下测试按本需求新形态更新断言（保持原测试意图，不改业务断言）：
view-tabs-right / view-tabs-style（切换栏移至第二行模块导航）、portrait-board（竖屏看板横滑改为列表单列）、
confirm-lane（列拖拽改为列表行状态展示）、layout（.board 五列网格改为列表工作区）、
topbar-overflow（顶栏无搜索后仍不溢出）、global-search-ui（搜索移至第三行）、
impl-entry-ui / batch-ui（已接受工具条与批量抽屉改为选择工具条与任务视图）、oncall-ui（更名讨论）。

## 缺陷回归用例（impl-entry-ui.test.mjs E3 扩展，BUG-20260907-015）

`#selectOperable`「选择可操作项」的禁用条件曾只统计待接受 eligible（submittedItems），
REQ-20260907-004 选择工具条把按钮语义扩展为「待接受 + 已接受未认领」两类后未同步，
导致没有待接受条目、只有可实施条目（典型如「已接受」筛选档）时全选入口被误禁用。
修复后两类候选任一非空即可用，两类都空才禁用；接受中（pending）仍禁用。

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| S1 | 待接受为 0、存在已接受未认领条目（syncImpl → syncAcceptance） | `#selectOperable` 可用（disabled=false），可全选进入批量实施 |
| S2 | S1 场景下执行等价全选集合逻辑（submittedItems + implCandidates） | 可实施集合选中全部未认领 accepted，待接受集合为空，不抛错 |
| S3 | 既有边界保持：待接受与可实施两类都为 0 时禁用；接受中禁用；仅待接受非空时可用 | disabled 判定与修复前一致（不回归 A1/A5/E3 既有断言） |

## 缺陷回归用例（refresh-default-view.test.mjs，BUG-20260907-002）

boot() 曾对默认 status 视图跳过 setView，导致手动刷新需求界面 `#reqView` 保持 hidden 无数据；
修复后 boot 对解析视图统一调用 setView。行为测试加载完整 app.js（vm + 模拟 DOM，含 boot() 执行）。

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| R1 | 默认需求视图手动刷新（无 view 参数） | `#reqView`/`#board` 立即可见，列表渲染条目，副标题初始化，不显示空态 |
| R2 | boot 后 setView 往返 runs ↔ status | 视图显隐正确，数据不因往返丢失 |
| R3 | 深链其他模块刷新后切回需求 | 深链模块可见（W12 不回归），切回后列表可见 |
| R4 | 首轮服务离线（/api/board 失败） | 视图容器仍初始化，显示初始化空态引导而非整页空白 |
| R5 | 静态契约：boot 无条件 setView(viewParam) | boot 段不得按 `viewParam !== 'status'` 分支跳过 setView |



## REQ-20260907-005 待确认改为待测试。已完成界面去掉待确认按钮。
## 验收标准

- [ ] 需求筛选第五档、列表行状态标签、详情页角标统一显示「待测试」。
- [ ] confirming 档提示（tooltip / 详情页 notice）改为「等待人工测试」语义。
- [ ] 已完成（done）条目：列表行与详情页不再出现「待测试」角标，详情页不再出现
      「⚑ Agent 已上报完成…请人工确认」提示；下属 Bug 已完成同样不出现角标。
- [ ] 非 done 条目行为不回归：上报未确认条目仍显示「待测试」角标与提示。
- [ ] 相关测试（confirm-lane 等）更新后通过，npm test 全量通过。

# 测试用例 — REQ-20260907-005 待确认改为待测试。已完成界面去掉待确认按钮。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 改名契约：LANE_LABEL/筛选档文案 confirming 为「待测试」，STATE_LABEL 状态机文案不回归 | P0 | ✅ |
| T2 | 列表行：上报未确认（in-progress+agentCompletedAt）状态标签显示「待测试」，tooltip 为等待人工测试语义 | P0 | ✅ |
| T3 | 已完成列表行：done+agentCompletedAt 不渲染「待测试」角标（无 class="flag" 非 warn 角标） | P0 | ✅ |
| T4 | 详情页头部：done 条目无「待测试」角标、无「⚑ Agent 已上报完成…请人工测试」notice；上报未确认条目两者保留 | P0 | ✅ |
| T5 | 详情页下属 Bug：done Bug 无角标，上报未确认 Bug 显示「待测试」角标 | P1 | ✅ |
| T6 | 全量回归：confirm-lane / workbench-layout / detail-close-btn 及 npm test 全套通过 | P0 | ✅ |

说明：T1–T5 落在 scripts/tests/confirm-lane.test.mjs（T1/T3(旧)/T6(旧) 为 REQ-20260906-013
既有用例的断言更新），T2/T4/T5 为本条目新增；workbench-layout W5、detail-close-btn T1
为受影响既有断言的文案同步。T6 由 npm test 聚合回归。


## REQ-20260907-006 去掉全部需求的过滤条件
## 验收标准

- [ ] 需求模块不再渲染状态筛选条：index.html 无 `#filterBar`，app.js 无
  `REQ_FILTERS` / `renderFilterBar` / `reqFilter` / `applyReqFilter`，
  style.css 无 `.filter-bar` / `.filter-chip` / `.filter-count`。
- [ ] 列表展示全部需求与 Bug，各状态条目均可见；不再有点击 chip 过滤列表的交互。
- [ ] 第三行模块搜索仍按关键词过滤列表；零结果空态文案只提搜索不提筛选。
- [ ] 列表行状态标签、tooltip、详情页、勾选/批量工具条行为不回归
  （`laneOf` 派生分类保留用于行状态展示）。
- [ ] 讨论模块自身筛选不受影响（`oc-filter` 机制保留）。
- [ ] 相关契约测试同步更新，`npm test` 全部通过。

# 测试用例 — REQ-20260907-006 去掉全部需求的过滤条件

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 专属测试：`scripts/tests/req-filter-removed.test.mjs`；同步更新 5 个既有契约测试。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 静态契约：index.html 无 `#filterBar`；app.js 无 `REQ_FILTERS`/`renderFilterBar`/`reqFilter`/`applyReqFilter`；style.css 无 `.filter-bar`/`.filter-chip`/`.filter-count` | 高 | ✅ |
| T2 | 行为：`visibleItems()` 返回全部条目（各状态均含，不再按 lane 过滤） | 高 | ✅ |
| T3 | 行为：搜索仍过滤列表；零结果空态文案只提搜索不提「筛选」 | 高 | ✅ |
| T4 | 行状态展示保留：`laneOf`/`LANE_LABEL` 不回归（confirm-lane T2/T3 行标签断言保留） | 高 | ✅ |
| T5 | 讨论模块筛选不受影响：oncall.js `oc-filter` 机制保留 | 中 | ✅ |
| T6 | 既有契约测试同步更新（workbench-layout W5、confirm-lane T3/T5、pending-alignment R5、view-tabs-style V3、refresh-default-view 初始 hidden 集合） | 高 | ✅ |
| T7 | `npm test` 全量回归通过 | 高 | ✅ |


## REQ-20260907-007 删除详细页面的一键派单功能，派单只能通过批量实施
## 验收标准

- [ ] 详情抽屉不再出现「一键派发」区与「派发给 zcode / 派发给 codex」按钮。
- [ ] 前端不再残留一键派单函数与 `[data-dispatch]` 绑定；`copyDispatchText` 保留。
- [ ] `POST /api/dispatch/codex/item` 返回 404（未注册），且不创建任何执行记录。
- [ ] 调度器不再暴露 `dispatchItem`；自动派发（tick / startRunForItem）行为不变。
- [ ] 批量实施入口（批次创建、批次提示词、批量执行）不受影响。
- [ ] 相关静态契约与集成测试更新为「一键派单已移除」并通过；全量测试通过。

# 测试用例 — REQ-20260907-007 删除详细页面的一键派单功能，派单只能通过批量实施

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | 前端契约：app.js 不再有 `dispatchPrompt`/`dispatchBtnHtml`/`flashDispatchBtn`/`launchCodex`/`launchZcode`，无「派发给 zcode/codex」按钮文案，无 `[data-dispatch]` 事件绑定 | P0 | 通过（dispatch.test.mjs） |
| R2 | 保留契约：`copyDispatchText`（navigator.clipboard）保留，批量实施提示词复制不受影响 | P0 | 通过（dispatch.test.mjs） |
| R3 | 样式契约：style.css 不再含 `.dispatch-row`/`.dispatch-btn` | P1 | 通过（dispatch.test.mjs） |
| R4 | 服务端契约：server.mjs 不注册 `/api/dispatch/codex/item`、不调用 `dispatchItem`；旧 `.command`/`open` 链路移除的回归断言保持 | P0 | 通过（dispatch-launch.test.mjs U3） |
| R5 | 调度器契约：scheduler 不再暴露 `dispatchItem`（`typeof s.dispatchItem === 'undefined'`），tick 保留 | P0 | 通过（scheduler.test.mjs D21） |
| R6 | 集成：`POST /api/dispatch/codex/item` 返回 404，且不产生任何执行记录（runs.total === 0），条目状态不改写 | P0 | 通过（dispatch-launch.test.mjs I1、dispatch-api.test.mjs T7） |
| R7 | 回归：批量实施提示词复制链路（`copyDispatchText` 调用点）与任务模块 `gotoRuns` 正常；全量测试通过 | P0 | 通过（npm test：65 文件失败 0） |


## REQ-20260907-008 讨论视图精简：删除头部说明区，状态筛选与需求栏样式统一并去掉「全部」
## 验收标准

- [ ] （待补充）

# 测试用例 — REQ-20260907-008 讨论视图精简：删除头部说明区，状态筛选与需求栏样式统一并去掉「全部」

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 静态契约：oncall.js 无头部（oncall-head / 新建讨论单 / #ocNew 均不出现）；style.css 无 .oncall-head / .oc-filter 死规则 | P0 | 通过 |
| T2 | 行为：渲染后无「全部」chip，缺省选中「待回复」（filter-chip active），chips 为 filter-chip + filter-count 结构，计数正确 | P0 | 通过 |
| T3 | 行为：存在失败单时渲染「失败」filter-chip（带 oc-failed 修饰与计数）；无失败单时不渲染 | P1 | 通过 |
| T4 | 行为：列表按当前筛选档过滤（无 all 分支）；零条目空态文案指向顶栏「＋ 新建」 | P0 | 通过 |
| T5 | 回归：req-filter-removed T5 断言随契约更新（oc-filter → filter-chip）；oncall-ui / 需求栏筛选相关测试全绿 | P0 | 通过 |

实现文件：`scripts/tests/oncall-view-lean.test.mjs`（T1–T4）；
`scripts/tests/req-filter-removed.test.mjs` T5 同步更新断言。


## REQ-20260907-009 选择可操作项只显示当前选择状态的条目
## 验收标准

- [ ] 在「待接受」档点击「选择可操作项」：仅勾选当前档可见的待接受条目，
      不再顺带勾选已接受未认领条目。
- [ ] 在「已接受」档点击「选择可操作项」：仅勾选当前档可见的已接受未认领条目，
      不再顺带勾选待接受条目。
- [ ] 在「开发中 / 待测试 / 已完成」档：当前档无可操作条目时按钮禁用。
- [ ] 搜索范围叠加语义保持：全选只作用于搜索可见行。
- [ ] 手动勾选跨档保留行为不回退：切档不清空已勾选集合。
- [ ] 按钮悬停提示（title）不再宣称「可跨筛选档位」，与新行为一致。

# 测试用例 — REQ-20260907-009 选择可操作项只显示当前选择状态的条目

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 载体：`scripts/tests/impl-entry-ui.test.mjs`（E3 场景随新契约演进 + 新增 N 组用例）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| N1 | 「待接受」档点击选择可操作项：仅勾选待接受条目，不含已接受未认领（旧跨档全选为 4 项，新行为 1 项） | P0 | 待跑 |
| N2 | 「已接受」档点击：仅勾选已接受未认领条目，不含待接受条目 | P0 | 待跑 |
| N3 | 「开发中 / 待测试 / 已完成」档：当前档无可操作条目，按钮禁用 | P0 | 待跑 |
| N4 | 禁用条件随档收窄后 BUG-20260907-015 主场景不回退：仅可实施条目（无待接受）在「已接受」档入口可用 | P1 | 待跑 |
| N5 | 手动勾选跨档保留不回退（BUG-20260907-016）：勾选后仅切档（renderBoard）不清空集合；全选替换语义保持 | P1 | 待跑 |
| N6 | 静态契约：title 不再含「可跨筛选档位」，按钮语义文案更新 | P1 | 待跑 |


## REQ-20260907-011 待接受需求和 Bug 可以由用户自行更改标题。已接受的需求可以驳回变为待接受
## 验收标准

- [ ] submitted 状态的需求 / Bug（独立与归属）可通过网页与 CLI 更改标题；
      `status.json.title` 与条目目录下各 markdown 文档首行标题同步为新标题，history 留痕。
- [ ] 非 submitted 状态（accepted / in-progress / done）不允许改标题，明确报错。
- [ ] 新标题校验与创建时一致：非空、不超过 120 字；与原标题相同视为无意义操作，明确报错。
- [ ] accepted → submitted 驳回可用（网页与 CLI），history 留痕；语义为人工回退，与
      done → in-progress 同级。
- [ ] in-progress / done 不能直接驳回回 submitted（状态机保持既有单向主干，仅新增
      accepted → submitted 一条人工回退边）。
- [ ] 网页：待接受卡片与详情页提供「改标题」入口；已接受详情页提供「驳回接受」按钮，
      且接受操作新增撤销（撤销接受 = 驳回回待接受）。
- [ ] 「修改（提示词）」「需求完善」等既有入口不受影响；全部既有测试保持通过。

# 测试用例 — REQ-20260907-011 待接受需求和 Bug 可以由用户自行更改标题。已接受的需求可以驳回变为待接受

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | core.renameItem：submitted 需求改标题成功，status.title 更新、history 留痕、README/design/test-cases 首行同步 | P0 | 通过 |
| R2 | core.renameItem：submitted Bug（独立与归属需求）同样可改标题且 README 首行同步 | P0 | 通过 |
| R3 | core.renameItem：accepted / in-progress / done 状态拒绝改标题并报错 | P0 | 通过 |
| R4 | core.renameItem：空标题、超 120 字、与原标题相同均拒绝 | P1 | 通过 |
| R5 | core.setStatus：accepted → submitted 驳回成功，history 留痕 | P0 | 通过 |
| R6 | core.setStatus：in-progress / done → submitted 拒绝（不可跳级驳回） | P0 | 通过 |
| R7 | server：POST /api/item/:id/title 改标题成功；非 submitted 返回错误；boardTransitionAllowed 放行 accepted → submitted 并拒绝 in-progress → submitted | P0 | 通过 |
| R8 | CLI：atb rename 子命令登记于 usage 并调用 core.renameItem | P1 | 通过 |
| U1 | UI：submitted 卡片与详情页渲染「改标题」按钮；renameItem 提交 POST /api/item/:id/title 并刷新 | P0 | 通过 |
| U2 | UI：详情页 accepted 状态渲染「驳回接受」按钮；ACTION_LABEL/ACTION_UNDO 覆盖 accepted → submitted（接受可撤销） | P0 | 通过 |
| U3 | UI：非 submitted 状态不渲染改标题按钮；uiPrompt 为页面内异步对话框（不用同步 window.prompt） | P1 | 通过 |

执行文件：`scripts/tests/rename-reject.test.mjs`（core 集成 + 真实服务 HTTP + CLI/UI 静态与沙箱契约，
模式对齐 actor-name / dispatch-api / pending-accept-inline / accept-ui 既有测试）。

## 执行记录

- 2026-09-08 TDD 红：12 用例失败 11（R8 的 usage 断言中 `core.renameItem(` 在实现前即存在一处误匹配，
  其余全红）；实现后绿：12/12 通过。
- 联动更新三个既有契约测试（契约演进，非掩盖回归）：
  - `drawer-undo.test.mjs` T2：接受操作撤销映射按 REQ-20260907-011 新增 accepted → submitted；
  - `pending-alignment.test.mjs` R1：TRANSITIONS.accepted 断言补入人工回退边 'submitted'；
  - `pending-accept-inline.test.mjs` T4：紧凑按钮样式断言适配 `.card-accept-btn, .card-rename-btn` 选择器组。
- 全量回归：`npm test` 72 个测试文件失败 0（execution-verifier 曾出现一次偶发时序失败，
  单独执行与全量复跑均通过，与本改动无关——本改动未触碰 report/核对链路）。


## REQ-20260907-012 已接受的需求或 Bug 不要在列表界面或详细内容界面显示已接受便签，应呈现是否已进入批次
## 验收标准

- [x] 已接受条目卡片不出现「已接受」chip；显示「已入批次」（在未结束批次 candidates 中）或「未入批次」。
- [x] 详情抽屉「状态」字段同样不显示「已接受」，显示批次进入状态；操作说明 notice 不再以「已接受。」开头，并按入批与否给出对应指引。
- [x] 已入批次悬停可见批次号与批次状态；未入批次悬停有操作指引。
- [x] 非已接受条目（待接受/开发中/待测试/已完成）在列表与详情的展示不受影响。
- [x] `/api/board` 与 `/api/item/:id` 对 accepted 条目返回 `batchEntry`（未入批为 null，非 accepted 不附加）；批次 finished 后不再算已入批次。
- [x] 列表内容签名包含批次进入状态，入批/出批后无需手动刷新即可更新。

# 测试用例 — REQ-20260907-012 已接受的需求或 Bug 不要在列表界面或详细内容界面显示已接受便签，应呈现是否已进入批次

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1 | 已接受且入批（未结束批次 candidates 含该编号）：列表卡片不出现「已接受」chip，显示「已入批次」，title 含批次号与批次状态 | P0 | 通过 |
| L2 | 已接受且未入批：列表卡片显示「未入批次」，不出现「已接受」chip；`batchEntry` 字段缺失时同样兜底为「未入批次」 | P0 | 通过 |
| L3 | 非已接受条目（待接受/开发中/待测试/已完成）卡片状态 chip 不受影响 | P0 | 通过 |
| L4 | 详情抽屉：已接受条目「状态」字段显示「已入批次/未入批次」而非「已接受」；已入批悬停含批次号 | P0 | 通过 |
| L5 | 详情抽屉操作说明 notice 不再以「已接受。」开头；入批→提示等待批次派发（含批次号），未入批→提示 /dev 认领或勾选入批 | P1 | 通过 |
| L6 | 列表渲染签名包含 batchEntry：入批/出批后轮询重绘（源码级断言） | P1 | 通过 |
| S1 | `batchEntryIndex`：入未结束批次→返回 {batchId,status}；未入批→无条目；批次 finished→不再计入；多批次取最早 | P0 | 通过 |
| S2 | `/api/board` 与 `/api/item/:id`：accepted 条目附带 batchEntry（未入批为 null）；in-progress 条目不附带 | P0 | 通过 |

- 前端用例（L1–L6）：`scripts/tests/accepted-batch-entry.test.mjs`（vm 沙箱，card-flag-dedup.test.mjs 同法）。
- 服务/数据用例（S1–S2）：同文件内集成段（真实起 server + 临时项目，multi-project.test.mjs 同法）。
- 回归：`npm test` 全量 73 个测试文件 0 失败（含 card-flag-dedup、pending-alignment、confirm-lane、workbench-layout 等 UI 契约）。


## REQ-20260907-013 支持当前已有批次执行中时，可以创建新批次。没在执行中的新批次可以被删除。
## 验收标准

- [ ] 当前批次未结束（执行中/暂停/待启动）时，看板 Zcode 批次面板提供「排队新批次」入口，创建成功后新批次排到队尾并即时出现在排队列表
- [ ] 有批次在途执行时创建新批次仍成功入队（CLI/API，回归 REQ-20260906-025 口径）
- [ ] 删除排队中（未执行）批次：账本目录移除、队列位次前移、下一批次自动成为队首且可正常领取
- [ ] 删除有在途运行的批次被拒绝（CLI 非 0 / API 400），错误指明在途运行
- [ ] needs_attention 批次不可删除（提示先人工核对恢复）
- [ ] 已结束（finished）批次可删除；删除不存在的批次报「找不到批次」
- [ ] 看板：排队列表项与当前批次（无在途时）均有删除入口，操作前有确认框，删除后界面即时刷新

# 测试用例 — REQ-20260907-013 支持当前已有批次执行中时，可以创建新批次。没在执行中的新批次可以被删除。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| C1 | core：批次有在途运行（nextItem 预留未收尾）时 createBatch 成功，新批排队尾（执行中创建回归） | P1 | 通过 |
| D1 | core：删除排队中（未执行）批次——账本目录移除、unfinishedBatches 缩短、后续位次前移 | P1 | 通过 |
| D2 | core：删除有在途运行的批次被拒绝，错误含在途 runId；收尾后可删且 runs 记录保留 | P1 | 通过 |
| D3 | core：删除 needs_attention 批次被拒绝（提示先人工核对恢复） | P1 | 通过 |
| D4 | core：删除已结束（finished）批次成功；删除不存在批次报「找不到批次」 | P1 | 通过 |
| D5 | core：删除队首未执行批次后，下一批次成为队首且 nextItem 可直接领取（防抢解除） | P1 | 通过 |
| D6 | serve：POST /api/batch/delete 删除排队批次成功；在途批次 / 不存在批次返回 400 | P1 | 通过 |
| D7 | cli：atb batch delete <ID> 成功退出 0 且提示；在途批次与缺参报错；needs_attention 拒绝 | P1 | 通过 |
| D8 | ui：静态契约——执行中面板「排队新批次」按钮复用创建流程；排队列表项与当前批次删除入口、uiConfirm 确认、/api/batch/delete 调用 | P1 | 通过 |

实施说明：测试文件 `scripts/tests/batch-delete.test.mjs`（9 用例全通过）；`npm test` 全量 74 个测试文件回归 0 失败。修复过程发现并改正一处实现笔误（`batchesDir(dataDir, batchId)` 多传参导致误删整个 batches 根目录），由 D1/D5/D6/D7 用例捕获。


## REQ-20260908-001 任务看板的批次记录上，需要显示每个单的标题，放到单号的后面
## 验收标准

- [ ] `/api/batch/records`（及 `/api/batch/current` 的 `records`）每条记录包含 `title` 字段，值为对应条目标题；条目缺失时为空串且接口不报错。
- [ ] 批次记录列表单号后面渲染条目标题，超长截断、悬停显示全文。
- [ ] 任务搜索按标题可命中批次记录。
- [ ] 既有批次记录接口字段（runId/itemId/owner/result/reason/reportRef/at）不受影响。

# 测试用例 — REQ-20260908-001 任务看板的批次记录上，需要显示每个单的标题，放到单号的后面

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | listRuns 记录带 title：创建带标题条目入批并产生运行（reported 收尾）后，records 中该条记录 `title` 等于条目标题 | P0 | 通过（batch-core） |
| T2 | listRuns 容错：条目目录被删除后调用 listRuns 不抛错，记录 `title` 为空串 | P0 | 通过（batch-core） |
| T3 | listRuns 兼容：既有字段 runId/itemId/owner/result/reason/reportRef/at 原样保留（字段级断言） | P1 | 通过（batch-core） |
| T4 | recordsHtml 静态契约：单号后渲染标题（`shortOwner(r.title …)` 且带 title 属性悬停全文） | P0 | 通过（batch-ui U15） |
| T5 | recordsHtml 搜索：过滤数组包含 `r.title`，按标题关键字可命中批次记录 | P1 | 通过（batch-ui U15） |

T1–T3 位于 `scripts/tests/batch-core.test.mjs`（用例名 REQ-20260908-001），T4–T5 位于 `scripts/tests/batch-ui.test.mjs`（U15）。
全量回归：`node scripts/tests/run-all.mjs` 76 个测试文件全部通过。


## REQ-20260908-002 所有列表提供排序功能。已完成的需求或 bug 默认只显示最新的 100 项，其他的需要通过搜索获取
## 验收标准

- [ ] 需求视图五档列表均可按五种键排序，默认「最新更新」降序（最新活跃在最上）。
- [ ] 已完成档默认（未搜索时）只显示最新 100 项，计数行展示 `100 / N` 与搜索引导；其余档不截断。
- [ ] 搜索期间不截断：搜索命中集合作用于已完成档全量条目，更早条目可被搜索获取。
- [ ] 讨论视图列表可按四种时间键排序，默认「最新更新」。
- [ ] 排序选择本地记忆，非法存储值回退默认。
- [ ] 排序与截断不影响既有交互（行点击开详情、勾选批量接受 / 批量实施、增量重绘）。
- [ ] `npm test` 回归全绿。

# 测试用例 — REQ-20260908-002 所有列表提供排序功能。已完成的需求或 bug 默认只显示最新的 100 项，其他的需要通过搜索获取

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/list-sort.test.mjs`（vm 沙箱加载 app.js 首段 / oncall.js + 静态契约断言）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 需求排序比较器 `sortReqItems`：五种键各验证方向（最新更新/最早更新/最新创建/最早创建/单号升序），同值回退单号稳定序，不改入参数组 | P0 | 通过 |
| T2 | 需求列表默认排序：`visibleItems()` 在已完成档默认按更新时间降序（最新活跃在最上），切键生效 | P0 | 通过 |
| T3 | 已完成档默认截断 100：150 条 done 条目渲染 100 行，计数为 `100 / 150` 且含搜索引导文案；其他档（130 条待接受）不截断、计数无 x / y | P0 | 通过 |
| T4 | 搜索期间不截断：搜索词非空（含结果未到）时已完成档全量参与过滤，第 101 位老条目仍可命中 | P0 | 通过 |
| T5 | 排序控件契约：`#reqSort` 五选项 + 默认 `updated-desc`；change 绑定重排并写 localStorage；非法存储值回退默认、合法值参与默认渲染 | P1 | 通过 |
| T6 | 签名重绘：排序键纳入列表内容签名，数据不变切键仍触发 `replaceChildren` 重渲染 | P1 | 通过 |
| T7 | 讨论列表排序：默认最新更新在前；`setSort` 切最早更新/创建升序后按新键重排；选择记忆 localStorage 并在新会话生效 | P0 | 通过 |
| T8 | 讨论排序控件契约：筛选条含 `.oc-sort` 排序下拉，四键选项，默认最新更新；`.sort-select` 样式存在 | P1 | 通过 |
| T9 | 回归：`npm test`（run-all.mjs）77 个测试文件全部通过 | P0 | 通过 |

TDD 执行：T1–T8 先跑红（8/8 失败：函数/控件/排序/截断均未实现），实现后跑绿（8/8 通过）；
T9 全量回归通过（含既有顺序敏感断言无回归）。


## REQ-20260908-003 支持待接受的需求删除
## 验收标准

- [ ] submitted 需求 / Bug（独立与归属）可通过网页与 CLI 删除：条目目录整体移除，
      看板列表与详情不再出现，其余条目不受影响，单号计数器不回退。
- [ ] 非 submitted 状态（accepted / in-progress / done）删除被拒绝，明确报错且目录完好。
- [ ] 需求存在下属 Bug 时删除被拒绝，错误信息指明先处理下属 Bug；下属 Bug 删除或移走后
      可删除该需求。
- [ ] 不存在 / 非法单号删除报明确错误。
- [ ] 网页：待接受卡片与详情页提供「删除」按钮；点击弹页面内 danger 确认，确认后调
      `DELETE /api/item/:id` 并刷新列表；详情页正展示被删条目时自动关闭抽屉；
      非 submitted 条目不渲染删除按钮。
- [ ] API：`DELETE /api/item/:id` 仅受理 submitted；受既有 `/api/*` 跨站防护（Origin/Host）约束。
- [ ] CLI：`atb delete <ID>` 登记于 usage；仅 submitted 可删，输出删除结果。
- [ ] 全部既有测试保持通过。

# 测试用例 — REQ-20260908-003 支持待接受的需求删除

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | core：submitted 需求删除——目录移除、listItems 不再出现、其余条目与计数器不受影响 | P0 | 通过 |
| D2 | core：submitted Bug（独立与归属需求）删除——各自目录移除，宿主需求完好 | P0 | 通过 |
| D3 | core：非 submitted（accepted / in-progress / done）删除被拒绝，目录完好 | P0 | 通过 |
| D4 | core：需求有下属 Bug 时删除被拒绝并指引先处理；下属 Bug 删除后需求可删 | P0 | 通过 |
| D5 | core：不存在 / 非法单号报 AtbError | P1 | 通过 |
| D6 | server：DELETE /api/item/:id——submitted 成功且看板列表不再含该条目；accepted 拒绝 400；未知单号 400 | P0 | 通过 |
| D7 | CLI：usage 登记 atb delete、分发 delete 子命令并调用 core.deleteItem（静态契约） | P1 | 通过 |
| U1 | UI 静态：submitted 卡片与详情页渲染删除按钮（仅在 submitted 条件分支内），提交走 DELETE /api/item/:id | P0 | 通过 |
| U2 | UI 静态：deleteItem 用页面内 danger uiConfirm（不用 window.confirm），删除成功后刷新并关闭被删条目抽屉 | P0 | 通过 |
| U3 | UI 沙箱：确认后发一次 DELETE 请求；取消确认不发请求 | P0 | 通过 |


## REQ-20260908-004 回退 CI 看板
## 验收标准

- [ ] 顶栏模块导航回到「讨论 / 需求 / 任务 / 文件」+ 末位「设置」，无「CI」页签与 CI 视图
- [ ] `/api/ci/*` 全部接口移除（请求落到未知接口 404）
- [ ] `scripts/lib/ci-store.mjs`、`scripts/web/ci.js`、`scripts/tests/ci-board.test.mjs` 三个文件删除
- [ ] 端口解析恢复 `ATB_PORT > 8888`，不读写 server.json；EADDRINUSE 直接提示退出（无绑定重试）
- [ ] `node scripts/tests/revert-ci-board.test.mjs` 全部通过
- [ ] `npm test` 全量回归零失败

# 测试用例 — REQ-20260908-004 回退 CI 看板

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | CI 专属文件已删除：lib/ci-store.mjs、web/ci.js、tests/ci-board.test.mjs 不存在 | P0 | 通过（revert-ci-board T1） |
| T2 | index.html 无 CI 页签（data-view="ci"）、无 #ciView、无 /ci.js 引用 | P0 | 通过（revert-ci-board T2） |
| T3 | app.js VIEWS/MODULE_SUB 无 ci、全文件无 ATBCi/ciView 引用 | P0 | 通过（revert-ci-board T3） |
| T4 | server.mjs 无 ci-store import、无 /api/ci/ 路由、无 selfRestart/ATB_BIND_RETRY/ATB_SERVER_CONFIG/writeServerConfig；端口解析为 ATB_PORT \|\| DEFAULT_PORT | P0 | 通过（revert-ci-board T4） |
| T5 | style.css 无 .ci- 样式残留 | P1 | 通过（revert-ci-board T5） |
| T6 | 回归：npm test 全量零失败（workbench-layout W2/default-port V1 契约同步更新） | P0 | 通过（80 文件 0 失败） |

TDD 执行记录：revert-ci-board.test.mjs 先于回退编写并跑红（5/5 失败），回退实施后跑绿（5/5 通过）。


## REQ-20260908-005 详情页面高度不要超过列表，要低于状态筛选行
## 验收标准

- [ ] 窄屏（≤1020px）详情抽屉定位基准为需求工作区（`.req-view`），顶边低于状态筛选行，高度与列表区一致，不再全视口高。
- [ ] 窄屏遮罩 `#mask` 与详情同域（工作区内），状态筛选行及其以上不被压暗、不被拦截点击。
- [ ] 宽屏列表 + 详情并排布局、滑入动画与「← 返回」入口行为不变。
- [ ] 现有布局契约测试（layout / workbench-layout 等）不回归。

# 测试用例 — REQ-20260908-005 详情页面高度不要超过列表，要低于状态筛选行

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> D1–D5 由 `scripts/tests/drawer-height.test.mjs` 静态契约覆盖；M1 为人工视觉核验。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | 窄屏（≤1020px）详情抽屉不再 `position: fixed` 全视口高，媒体块内为 `position: absolute`（`top/right/bottom: 0`，宽度上限不变） | P0 | 通过 |
| D2 | 定位基准：`.req-view` 提供 `position: relative`（抽屉顶边对齐工作区顶 = 状态筛选行下沿，高度与列表区一致） | P0 | 通过 |
| D3 | 遮罩同域：`#mask` 位于 `#reqView` 内，窄屏媒体块内为 `position: absolute; inset: 0`（状态筛选行及其以上不被压暗/拦截） | P0 | 通过 |
| D4 | 回归：窄屏滑入动画与返回入口不动（`translateX(100%)`、`.has-item { transform: none }`、`.drawer-back { display: inline-flex }`） | P1 | 通过 |
| D5 | 回归：宽屏 `.req-split > .drawer` 仍为 `position: static` 常驻右栏（并排等高布局不受影响） | P1 | 通过 |
| M1 | 人工：≤1020px 宽度打开任一条目详情，抽屉顶边低于状态筛选行、高度不超过列表；筛选行可点击切档；宽屏并排无变化（人工执行） | P1 | 待人工 |


## REQ-20260908-006 详情页面的操作按钮要改成横向布局
## 验收标准

- [ ] `.drawer-actions-center` 操作按钮横向一行排列（flex-direction: row），整体水平居中
- [ ] 横向布局下按钮不被压缩（flex: none），窄屏放不下时整按钮换行而非挤压变形
- [ ] 「1 / N」序号与按钮在行内垂直居中对齐，不换行断开
- [ ] 既有契约不回退：notice 独立成行在操作行上方（drawer-nav D1）、两翼导航与禁用态样式（D4）不变

# 测试用例 — REQ-20260908-006 详情页面的操作按钮要改成横向布局

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| H1 | CSS 静态：`.drawer-actions-center` 改横向（flex-direction: row、水平居中 justify-content、允许 wrap） | P0 | 通过 |
| H2 | CSS 静态：行内 `.btn` 不被压缩（flex: none）且文案不折行（white-space: nowrap），防挤压变形 | P0 | 通过 |
| H3 | CSS 静态：容器行内垂直居中（align-items: center）、`1 / N` 序号不断行 | P1 | 通过 |
| H4 | 回归：模板结构不动——notice 仍在 `.drawer-actions` 之前独立成行，中栏仍为按钮 + 序号（drawer-nav D1/D4 继续跑绿） | P0 | 通过 |
| B1 | 浏览器实测：待接受详情页「接受 / 改标题 / 删除」一行横排居中，两翼导航对齐，窄屏整按钮换行 | P1 | 待人工 |


## REQ-20260908-007 提供终端可直接运行的 shell 命令
## 验收标准

- [ ] 仓库存在可执行 `bin/atb`（POSIX sh），直接运行与经符号链接运行均能转交 atb.mjs
      （`--help` 正常输出，数据子命令参数原样透传）。
- [ ] `atb cli install --to <目录>` 创建符号链接且幂等；已有外来文件时拒绝覆盖、原文件不动。
- [ ] `atb cli uninstall --to <目录>` 仅删除指向本插件的链接；外来文件拒绝删除；未安装幂等。
- [ ] `atb cli status` 正常输出安装状态；cli 子命令无需看板数据目录即可运行。
- [ ] USAGE / SKILL.md / 插件 README 同步出现 `atb cli install` 用法。
- [ ] `npm test` 全量通过（新增测试文件先跑红后跑绿）。

# 测试用例 — REQ-20260908-007 提供终端可直接运行的 shell 命令

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/cli-shell.test.mjs`

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | `bin/atb` 存在、带 shebang、有执行位 | 高 | ✅ |
| T2 | 直接运行 `bin/atb --help`：退出 0，输出 atb 主用法（包装器能定位插件根并转交 node） | 高 | ✅ |
| T3 | 经符号链接运行（临时目录 `ln -s <插件根>/bin/atb tmp/atb` 后执行）：退出 0、输出用法——模拟安装到 PATH 的形态 | 高 | ✅ |
| T4 | 链接形态下参数透传：`tmp/atb new req 标题` 在临时项目中真实创建条目（数据命令可用） | 高 | ✅ |
| T5 | `cli install --to <临时目录>`：退出 0、创建符号链接、realpath 指向本插件 `bin/atb`；链接形态调用 `atb list` 可用 | 高 | ✅ |
| T6 | install 幂等：重复 install 同目录退出 0、输出 `= 已安装` 样式、链接不变 | 中 | ✅ |
| T7 | install 拒绝覆盖外来文件：目标位置预置普通文件 / 指向他处的链接 → 非 0 退出、原文件不动 | 高 | ✅ |
| T8 | `cli uninstall --to <临时目录>`：删除已装链接；再次 uninstall 幂等（退出 0、`= 未安装` 样式） | 中 | ✅ |
| T9 | uninstall 拒绝删外来文件：目标为普通文件 → 非 0 退出、文件保留 | 高 | ✅ |
| T10 | `cli status`：退出 0，输出包装器路径与候选目录状态行（无需看板数据目录，在未 init 的临时目录可运行） | 中 | ✅ |
| T11 | 主 USAGE / SKILL.md 出现 `atb cli install` 用法（帮助文档同步） | 中 | ✅ |
| T12 | `cli` 子命令不需要看板数据目录：在未 init 的临时目录执行 install/status 不因缺数据目录报错 | 中 | ✅ |


## REQ-20260908-009 去掉 bug 单的归属需求选项，默认都是独立 Bug，然后需要在 Bug 单的设计说明书中明确表明引入问题的源单是什么
## 验收标准

- [ ] `atb new bug "标题" --req <REQ-ID>` 报错退出，提示 Bug 一律独立、源单写 design.md；`atb new bug "标题"` 正常创建。
- [ ] `core.createItem` 对 bug 传 `parent` 抛 AtbError；新建 Bug `status.parent === null`、目录在顶层 `bugs/`。
- [ ] 新建 Bug 生成 README.md 与 design.md；README 不再有「归属需求」行；design.md 含「引入来源」节与三选一填写指引（REQ-/BUG- 编号 / 未定位（排查过程：…）/ 登记时暂空）。
- [ ] `POST /api/new` type=bug 带 `parent` 返回 400 错误提示；Web 新建表单不再出现归属下拉、不提交 parent 字段。
- [ ] 存量归属 Bug（目录在 `requirements/*/bugs/`）仍可被 list/show/resolveItemDir 读取；`atb move <BUG-ID> --req|--standalone` 行为不变。
- [ ] CLI 帮助（USAGE）与 SKILL.md 中 `new bug` 用法描述同步去掉 `--req`，改述为「一律独立 Bug，引入来源写 design.md」。
- [ ] 新增测试覆盖上述行为，既有测试全量通过（构造存量归属 Bug 的用例改走 `moveBug`）。

# 测试用例 — REQ-20260908-009 去掉 bug 单的归属需求选项，默认都是独立 Bug，然后需要在 Bug 单的设计说明书中明确表明引入问题的源单是什么

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| B1 | CLI：`atb new bug "x" --req <REQ>` 退出非 0，报错含「独立」与「引入来源」指引 | P0 | 通过 |
| B2 | CLI：`atb new bug "x"` 正常创建，`--parent` 同样报错；help 文案不再出现 `--req` 创建归属用法 | P0 | 通过 |
| B3 | core：`createItem({type:'bug', parent})` 抛 AtbError；不带 parent 创建后 `status.parent === null`、目录在顶层 `bugs/` | P0 | 通过 |
| B4 | core：新建 Bug 生成 README.md 与 design.md；README 无「归属需求」行；design.md 含「引入来源」节及「未定位（排查过程」指引 | P0 | 通过 |
| B5 | server：`POST /api/new` type=bug 带 parent 返回 400；不带 parent 正常 201 | P1 | 通过 |
| B6 | web：index.html 无 `fParent`，app.js 提交体不含 parent 字段 | P1 | 通过 |
| B7 | 兼容：`createItem` 独立 + `moveBug --req` 构造的存量归属 Bug 可被 resolveItemDir/list 读取；`moveBug --standalone` 可改回独立 | P1 | 通过 |
| B8 | SKILL.md：new bug 用法不再宣传 --req，改述一律独立 + 引入来源（附加文档同步用例） | P1 | 通过 |

新增测试文件：`scripts/tests/bug-standalone-origin.test.mjs`（8 用例全绿）。
同步调整的既有测试：`batch-core.test.mjs` Z03、`item-delete.test.mjs` D2/D4、`rename-reject.test.mjs` R2、
`search-api.test.mjs`（构造归属 Bug 改走 `createItem` 独立 + `moveBug`）；`traceability.test.mjs` R2/R4、
`workbench-layout.test.mjs` W6（归因落点与新表单行为的契约随规范演进更新）。
全量回归：`node scripts/tests/run-all.mjs` 82 个测试文件全部通过。


## REQ-20260908-010 批量实施应改名为批量开发，方案应优化为提供一个已计划的状态分类，按照已计划的单自动串行处理。
## 验收标准

- [ ] 界面（顶栏按钮、任务模块、toast/提示语）与项目文档中「批量实施」文案均改为「批量开发」，无残留旧称误导（`scripts/web/` 下 `grep` 不再出现面向用户的「批量实施」字样；历史需求文档与批次账本旧数据不要求回改）。
- [ ] 已接受条目可在详情页单个「改为已计划」；操作后 `status.json` 状态变为已计划（新状态值命名以 design 为准），看板列表、筛选档、状态标签同步更新。
- [ ] 已计划且未进入开发中的条目可勾选批量「移出计划」，全部变回已接受；批量操作有结果反馈（成功/失败清单，对齐批量接受的 `acceptResult` 区域）。
- [ ] 已进入开发中（in-progress）的条目无法被移出计划：不可勾选或操作被拒绝并给出明确原因。
- [ ] 任务模块提供「开发启动」按钮，启动前可选择 zcode 或 codex 模式；未选择时不可启动。
- [ ] 开发启动后按「最旧优先」从已计划队列串行取单：被处理单状态流转为开发中，占用项目实施互斥（同一项目同时只有一个实施任务，与手工 `/dev` 互斥）；处理完上报后自动取下一项。
- [ ] 「实时获取」：调度器运行期间新改为已计划的条目无需重启即可被后续取到（不再受 Zcode 批次旧模型「创建时冻结候选快照」限制；冻结快照模型的去留见 design 待确认项）。
- [ ] 状态机守卫不变的部分继续成立：只有人能接受/确认完成；Agent 不能自行把条目置为已计划或移出计划（`scripts/state-guard.mjs` 拦截清单同步覆盖新状态的人工专属流转）。
- [ ] 存量兼容：升级后既有条目（submitted/accepted/in-progress/done）与未结束批次账本不受破坏；老数据无需迁移即可正常展示与流转。
- [ ] 完整状态链路可走通：已接受 → 已计划 → 开发中 → 待测试 → 已完成；已计划 → 已接受（移出计划）回退可用。

## 边界与不做的事

- 不改变「只有人能接受需求与确认完成」的铁律；已计划档不改变 report 后等待人工验收的语义。
- 需求完善（REQ-20260907-003，submitted 层面）不在本需求范围内。
- 「已计划」与依赖策略（`policies.json` 的 `dependsOn`）的关系沿用现有规则：依赖未满足的已计划单暂不派发，不自动降级。

# 测试用例 — REQ-20260908-010 批量实施应改名为批量开发，方案应优化为提供一个已计划的状态分类，按照已计划的单自动串行处理。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 状态流转合法边：accepted → planned（人工）、planned → in-progress（claim 认领即实施）、planned → accepted（移出计划）均成功，`pushHistory` 留痕 | P0 | 通过（planned-state S1） |
| 2 | 状态流转非法边：planned → done、planned → submitted、submitted → planned 均被 `TRANSITIONS` 拒绝并报「非法流转」 | P0 | 通过（planned-state S2） |
| 3 | `claim()` 接受 planned 条目：认领后状态变 in-progress、占用项目实施互斥锁（他人/他调度器认领同项目被拒，锁属主放行） | P0 | 通过（planned-state S3） |
| 4 | 单个置计划 UI：已接受条目详情页出现「改为已计划」按钮，点击后免二次确认，卡片与详情状态标签即时变「已计划」 | P1 | 通过（planned-state S10 + drawer 既有回归） |
| 5 | 批量移出计划 UI：已计划档勾选 ≥2 项（均未进入开发中）→「移出计划」→ 全部变回已接受，`acceptResult` 区域展示成功清单 | P0 | 通过（planned-state S11） |
| 6 | 移出计划保护：勾选集合中含 in-progress 条目时，该条不可勾选（或操作被拒绝）并提示「已进入开发中，不能移出计划」；其余成功项不受影响 | P0 | 通过（planned-state S11：in-progress 无选择框且 removeFromPlan 过滤） |
| 7 | 批量移出计划含失败项时：成功/失败分列反馈，不因单项失败回滚全部（对齐批量接受行为） | P1 | 通过（removeFromPlan 逐条 catch，对齐 acceptItems） |
| 8 | 开发启动按钮：任务模块可选 zcode / codex 模式；未选模式时启动按钮不可用；启动后按钮切换为停止/暂停后续 | P0 | 通过（planned-state S12） |
| 9 | 最旧优先取单：构造多个 planned 条目（创建时间不同），启动后第一个被处理的单为创建时间最早者；处理完上报释放占用后自动取下一最旧项 | P0 | 通过（planned-state S5/S6；scheduler D1 更新为纯创建时间序） |
| 10 | 实时获取：调度运行中把新的 accepted 条目置为 planned，无需重启/新建批次，当前项完成后该新条目被后续取到 | P0 | 通过（planned-state S6：nextItem 吸收新置计划条目） |
| 11 | 处理中状态反馈：被取到的单状态变「开发中」（in-progress），任务面板「当前条目」展示其编号与执行器 | P1 | 既有批次/执行面板行为保留（batch current/records 回归通过） |
| 12 | 队列已空：所有 planned 处理完（或无 planned）时展示等待提示（等待已计划条目），不创建虚假执行记录 | P1 | 通过（planned-state S13 文案 + scheduler D2 空队列不派发回归） |
| 13 | 选单口径收敛：`atb list --json` 候选、Zcode 调度、Codex 调度对新口径一致——planned 可派，accepted 不再被自动派发（手工 `/dev <id>` 对 planned 可用；对 accepted 的行为按 design 定案验证） | P0 | 通过（planned-state S5/S13；手工 claim accepted 仍合法，属人工兜底通道） |
| 14 | state-guard 守卫：无认领锁时 Agent 执行 `atb status <ID> planned`（或写 status.json 改 planned）被拦截，退出码 2 且提示人工专属操作指引 | P0 | 通过（planned-state S4） |
| 15 | state-guard 放行：有效认领锁期间开发类操作不被误拦（回归） | P1 | 通过（code-guard.test.mjs 既有回归全绿） |
| 16 | 改名检查：`scripts/web/index.html` 与 `scripts/web/app.js` 面向用户的文案无「批量实施」残留（grep 校验）；代码内部标识符（implGo、/api/batch/*）不受影响、接口回归通过 | P1 | 通过（planned-state S16） |
| 17 | 筛选档与标签：需求列表出现「已计划」档（或按定案的档位划分），planned 条目出现在对应档；五档排序/搜索/勾选行为（REQ-20260908-002、BUG-20260907-016 回归）不破坏 | P1 | 通过（planned-state S9/S17 + list-sort/impl-entry-ui 更新后回归） |
| 18 | 存量兼容：升级前已存在的 accepted / in-progress / done 条目与未结束批次账本在升级后正常展示、可继续流转/跑完；老 `status.json` 无需迁移 | P0 | 通过（pending-alignment/batch-* 回归；未结束批次剩余 accepted 候选按「出局」收尾，需人工置计划后走新流程，见 design 实施记录） |
| 19 | 依赖策略回归：`dependsOn` 未满足的 planned 条目暂不派发并提示依赖阻塞（BUG-20260906-005 口径），依赖完成后自动可派 | P1 | 通过（scheduler D1 依赖用例随口径更新后回归） |
| 20 | 端到端链路：已接受 → 已计划 → 开发启动（codex 模式）→ 开发中 → report（待测试）→ 人工确认完成，全链状态与看板展示正确 | P0 | 通过（planned-state S7/S8：API 置计划→claim→report→/api/board 展示） |
| 21 | 需求完善（REQ-20260907-003）回归：submitted 层面的完善批次不受新状态影响 | P2 | 通过（refine-* 测试回归全绿） |

自动化落点：新增 `scripts/tests/planned-state.test.mjs`（S1–S17 覆盖上表），并同步更新既有
`scheduler.test.mjs`、`impl-entry-ui.test.mjs`、`impl-scope.test.mjs`、`batch-*.test.mjs`、
`pending-alignment.test.mjs` 等对旧「accepted 选单」口径的断言为新「planned 选单」口径。

说明：

- 用例 9 的「最旧」按创建时间定义；「需求优先于 Bug」规则是否保留待 design 定案（见 design.md 待确认项），定案后补充对应断言。
- 用例 8、11 的 zcode 模式只验证「提示词就绪/待启动」状态与复制流程；Zcode 会话真实运行不作为自动化断言（复制成功 ≠ 启动成功，见 `docs/agent-team-board/batch-execution.md` §3）。
- 用例 14、15 依赖 `scripts/state-guard.mjs` 的拦截清单同步更新，先于 UI 放开实现（见 design.md 风险）。


## REQ-20260908-011 修改单需支持修改标题和描述。
## 验收标准

- [ ] 待接受（submitted）需求与 Bug（独立与归属）可通过网页在同一个编辑弹窗中修改标题与描述；保存后 `status.json.title`、条目全部文档首行、README 对应描述章节三处一致更新，history 留痕。
- [ ] 仅改描述（标题不变）可保存成功，不触发「新标题与原标题相同」报错；仅改标题（描述不变）行为与既有改标题一致。
- [ ] 标题校验与创建时一致（非空、不超过 120 字）；标题与描述均无变化时明确提示无变化，不发写请求。
- [ ] 非 submitted 状态不出编辑入口，后端同口径二次校验并明确报错（与 `core.renameItem` 现口径一致）。
- [ ] 描述写回：需求写 README「## 描述」节、Bug 写「## 现象」节（Bug 口径如调整以 design 确认项为准）；章节缺失时明确报错，不模糊写入其他位置。
- [ ] 界面按钮文案完成优化并消歧：编辑入口文案明确覆盖标题 + 描述，与复制修改提示词的按钮不再混淆；卡片与详情抽屉两处同步更新（最终文案以人工确认为准）。
- [ ] CLI 与网页同口径（若确认纳入 CLI 描述参数）。
- [ ] 「修改（提示词）」「删除」「接受 / 驳回」等既有入口与交互不受影响；全部既有测试保持通过。

# 测试用例 — REQ-20260908-011 修改单需支持修改标题和描述。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| C1 | core：submitted 需求同时改标题 + 描述成功——status.title、README/design/test-cases 首行、README「## 描述」节全部同步，history 一条留痕且 note 可追溯变更 | P0 | ✅ edit-content.test.mjs C1 |
| C2 | core：submitted Bug（独立与归属）改描述写回 README「## 现象」节，其余小节（复现步骤等）不受影响 | P0 | ✅ edit-content.test.mjs C2 |
| C3 | core：仅改描述（标题不变）保存成功，不触发「与原标题相同」报错 | P0 | ✅ edit-content.test.mjs C3 |
| C4 | core：仅改标题（描述不变 / 未传）行为与既有 renameItem 一致 | P1 | ✅ edit-content.test.mjs C4 |
| C5 | core：标题与描述均无变化（或均未传）拒绝，明确提示无变化，不写盘 | P1 | ✅ edit-content.test.mjs C5 |
| C6 | core：标题非法（空 / 超 120 字）拒绝，且描述不落盘（原子性，不得只改一半） | P0 | ✅ edit-content.test.mjs C6 |
| C7 | core：accepted / in-progress / done 状态拒绝编辑并报错（与 renameItem 同口径） | P0 | ✅ edit-content.test.mjs C7 |
| C8 | core：README 缺「## 描述」/「## 现象」节（被人工删改）时明确报错，不做模糊写入 | P1 | ✅ edit-content.test.mjs C8（含标题不落盘的整单拒绝断言） |
| C9 | core：描述清空提交——按 design 确认的空描述口径一致生效（默认写回「（待补充）」占位） | P2 | ✅ edit-content.test.mjs C9 |
| C10 | server：POST /api/item/:id/content 合法更新返回 200 与最新 status；非 submitted、非法参数返回 4xx/错误信息 | P0 | ✅ edit-content.test.mjs C10 |
| C11 | CLI：`atb rename` 旧用法回归不受影响；描述参数（若确认纳入）与网页同口径生效 | P1 | ✅ edit-content.test.mjs C11（含 `--desc -` stdin 多行子进程实测；旧用法回归另见 rename-reject R8） |
| U1 | UI：submitted 需求与 Bug 的卡片、详情抽屉渲染编辑入口；非 submitted 不渲染 | P0 | ✅ edit-content.test.mjs U1 |
| U2 | UI：编辑弹窗双字段预填当前标题与描述（经 /api/item/:id/doc/README.md 拉取截取）；取消 / Esc / 遮罩关闭不发请求 | P0 | ✅ edit-content.test.mjs U2（静态 + 沙箱） |
| U3 | UI：保存期间按钮禁用防重复提交；成功 toast + 列表与抽屉刷新；失败 toast 报错且弹窗输入保留可重试 | P0 | ✅ edit-content.test.mjs U3（静态 + 沙箱，含服务端报错 onSubmit 抛错可重试） |
| U4 | UI：按钮文案消歧断言——编辑入口文案 / aria-label 覆盖「标题 + 描述」语义，与「修改提示词」按钮文案可区分（最终文案以人工确认为准） | P1 | ✅ edit-content.test.mjs U4（采用文案：「✎ 改标题/描述」+「修改提示词」，见 design 实施记录） |
| U5 | 回归：「修改提示词」「删除」「接受 / 驳回」既有交互不受影响，rename-reject 等既有测试全部保持通过 | P0 | ✅ edit-content.test.mjs U5 + run-all 全量（89 文件 0 失败；rename-reject / edit-prompt 断言随本需求 UI 契约同步更新，core/CLI 断言未动） |

执行文件：`scripts/tests/edit-content.test.mjs`（本需求新增，19 用例）；
另按新 UI 契约同步更新 `rename-reject.test.mjs`（U1/U3 前端函数与端点断言：renameItem→editItem、/title→/content、uiPrompt→uiEditForm）与
`edit-prompt.test.mjs`（按钮文案「修改」→「修改提示词」），core 层 R1–R8 与既有行为断言保持原样并通过。


## REQ-20260908-012 Bug 单的说明文档中，针对引入来源单的描述需放置开头
## 验收标准

- [ ] 修复阶段归因落位：Bug README 头部元信息区（「归属需求」行之后、「创建」行之前）含 `- 引入来源：…` 行，样式同 BUG-20260907-017；正文根因分析与 test-report 中的来源详述照旧（REQ-20260830-004 要求不变）。
- [ ] `skills/agent-team-board/SKILL.md`「数据规范」不再表述为「写入 Bug README 末尾『关联（引入来源）』节」，改为写入开头头部行；末尾「关联」节降级为补充关联（其他相关条目）的可选位置，不再是引入来源的强制落点。
- [ ] `commands/bug.md` 末尾提示与 `commands/dev.md` TDD 第 4 步同步改为「写入 Bug README 开头头部 `- 引入来源：` 行」口径；三选一、atb 核验、未定位附排查、禁止编造、登记不填等语义原样保留。
- [ ] `scripts/tests/traceability.test.mjs` 断言同步：R2/R4 改为断言「开头/头部」口径（不再要求「末尾/关联节」表述），新增对正例样例 BUG-20260907-017 头部来源行的守护断言；R1（登记不填）、R3（根因与 test-report 归因）、R5（老样例存在性）、R6（未泄漏到 /req /board）保持通过。
- [ ] 全量测试 0 失败（`node scripts/tests/run-all.mjs`）；本需求为纯流程文档 + 契约测试口径变更，运行时代码零改动（推荐不改 `scripts/lib/core.mjs` 的 bugReadme 登记模板，见 design.md）。
- [ ] 存量 Bug 单（如 BUG-20260908-001 仅在末尾「关联（引入来源）」节有来源）是否回填来源行至开头：**待确认**（人工定夺；缺省仅对新修复的 Bug 生效，不强制改历史文档）。
- [ ] UI 观感验收：在 Status Board（`atb serve` 网页或 Electron 壳）打开按新规范修复的 Bug 条目，切「说明」tab，不滚动即见头部 `- 引入来源：…` 行；前端运行时代码（`scripts/web/app.js`、`scripts/web/style.css`）零改动。

# 测试用例 — REQ-20260908-012 Bug 单的说明文档中，针对引入来源单的描述需放置开头

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> T1–T5 由 `scripts/tests/traceability.test.mjs`（静态契约，在 REQ-20260830-004 既有 R1–R7 上迭代）覆盖；T6 为全量回归；T7 为运行时零改动守护。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| T1 | 正例守护：BUG-20260907-017 README 头部元信息区含 `- 引入来源：REQ-20260907-003` 行，且位于「归属需求」行之后、「创建」行之前（新增断言） | P0 | 通过（R5b） |
| T2 | SKILL.md 数据规范口径：不再含「README 末尾『关联（引入来源）』」表述；改为要求来源写入 README 开头头部 `- 引入来源：` 行（样式见 BUG-20260907-017），并写明末尾「关联」节仅为可选补充关联 | P0 | 通过（R4） |
| T3 | commands/bug.md 提示：指引改为「修复时在 Bug README 开头头部补写 `- 引入来源：…`」；登记阶段不填来源的语义（R1）原样保留 | P0 | 通过（R1+同步） |
| T4 | commands/dev.md 第 4 步：归因写入开头头部行；三选一 / atb list 核验 / REQ-\/BUG-YYYYMMDD-NNN 格式 / 未定位附排查过程 / 禁止编造 / 根因与 test-report 写明来源等 REQ-20260830-004 既有断言（R2/R3）不弱化、保持通过 | P0 | 通过（R2/R3） |
| T5 | traceability.test.mjs 更新后全绿：R2/R4 改「开头/头部」口径并新增 T1 正例断言；R5（老样例 BUG-20260830-001 存在性）、R1/R3/R6 原样通过；SKILL.md / dev.md 不再出现「末尾『关联（引入来源）』」措辞（防旧口径回潮的反向断言） | P0 | 通过（7/7） |
| T6 | 回归：全量 `node scripts/tests/run-all.mjs` 0 失败；req.md / board.md 仍不含引入来源要求（R6 不变） | P0 | 通过（89 文件 0 失败） |
| T7 | 运行时零改动守护：`scripts/lib/*.mjs`、`scripts/server.mjs`、`scripts/web/**` 无 diff（推荐方案不改 `bugReadme()` 登记模板；若人工确认采用占位行备选方案，本条改为校验模板头部含 `- 引入来源：（修复阶段补写）` 占位行） | P1 | 通过（采纳推荐方案，运行时零改动，经 mtime 核验） |


## REQ-20260908-013 讨论单的问题正文改为可选，如果用户没有填则复制标题作为正文。
## 验收标准

- [ ] 统一新建弹窗类型选讨论（ASK）时，问题正文留空可提交成功，不再出现「讨论单的问题正文不能为空」拦截；创建成功 toast、跳转讨论模块并定位新单的既有行为不变。
- [ ] 留空创建后 `oncall/tickets/ASK-…/question.md` 内容为标题文本；详情抽屉第 1 轮问题区显示标题；派单提示词（buildOncallWorkerPrompt）「当前待答问题（第 1 轮）」为标题文本。
- [ ] 填写了正文时行为完全不变：正文原样落盘 question.md，不被标题覆盖（回归）。
- [ ] 纯空白正文（空格 / 换行）按留空处理，同样回退标题。
- [ ] 标题必填与 ≤120 字校验保持（TITLE_MAX_CHARS，scripts/lib/oncall-store.mjs）；标题为空仍被拒绝。
- [ ] CLI `atb oncall new --title <标题>` 不带 `--question` / `--question-file` 可创建成功且正文为标题；带正文时行为不变（是否同步放开 CLI 待确认，默认同步）。
- [ ] 截图附件（选择 / 粘贴）可与留空正文组合使用，附件照常落盘并显示在第 1 轮。
- [ ] 追问正文必填口径不变；`askTicket`「追问正文不能为空」与网页追问校验不受影响。
- [ ] 既有测试全部保持通过；app.js 标签 / placeholder 文案调整涉及的静态断言（如 scripts/tests/workbench-layout.test.mjs、oncall-ui 系列）同步更新。

# 测试用例 — REQ-20260908-013 讨论单的问题正文改为可选，如果用户没有填则复制标题作为正文。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | store：createTicket 不传 question / 传空串——创建成功，question.md 内容为标题文本，meta 状态 pending、轮次结构正常（scripts/lib/oncall-store.mjs） | P0 | ✓ oncall-store S6 |
| S2 | store：question 为纯空白（空格 / 换行 / 制表符）——按留空处理，question.md 同样回退标题 | P0 | ✓ oncall-store S6 |
| S3 | store（回归）：question 非空——question.md 原样落盘，不被标题覆盖（对齐 oncall-store.test.mjs 既有 S1 断言口径） | P0 | ✓ oncall-store S6b + 既有 S1 |
| S4 | store（回归）：标题为空仍抛「标题不能为空」；标题超 120 字仍抛「标题过长」——正文可空不放松标题校验 | P0 | ✓ oncall-store S6b |
| S5 | store：留空正文 + 附件组合——question.md 为标题，附件照常落盘并进第 1 轮 rounds[0].attachments | P1 | ✓ oncall-store S6c |
| S6 | store：buildOncallWorkerPrompt 对留空创建的单——「当前待答问题（第 1 轮）」后为标题文本，不为空行 | P1 | ✓ oncall-store S6c |
| S7 | store（回归）：askTicket 追问正文为空仍抛「追问正文不能为空」，追问口径不受影响 | P0 | ✓ oncall-store S6b |
| H1 | server：POST /api/oncall/ticket 只传 title（question 缺省 / 空串）返回 200 与新单 meta；详情 GET /api/oncall/ticket/:id 第 1 轮 question 为标题（scripts/server.mjs） | P0 | ✓ oncall-serve H4 |
| C1 | CLI：`atb oncall new --title <标题>` 不带 --question / --question-file 创建成功，`atb oncall show` 第 1 轮问题为标题；带 --question 时行为不变（scripts/atb.mjs） | P1 | ✓ oncall-cli C3 |
| U1 | UI 静态：app.js 不再含「讨论单的问题正文不能为空」拦截；讨论类型正文标签 / placeholder 含「可留空」语义（最终文案以确认为准） | P0 | ✓ oncall-question-optional U1 |
| U2 | UI：统一新建弹窗类型选讨论、正文留空提交——成功创建，toast「✓ 已创建 ASK-…（待回复）」，进入讨论模块并 reveal 定位新单；详情抽屉第 1 轮显示标题作为问题 | P0 | ✓ oncall-question-optional U2（vm 沙箱；抽屉展示经 oncall-serve H4 数据 + 既有 roundHtml 渲染验证） |
| U3 | UI（回归）：正文填写时创建、附件上传 / 粘贴、需求与 Bug 类型描述可留空创建均不受影响 | P1 | ✓ oncall-question-optional U3 + workbench-layout W6/W7 |
| R1 | 回归：scripts/tests/oncall-store / oncall-cli / oncall-serve / oncall-ui / workbench-layout 既有测试全部保持通过（涉及文案的静态断言随实现同步更新） | P0 | ✓ run-all：90 个测试文件 0 失败（既有静态断言未受文案调整影响，未需改动） |

执行文件建议：store / CLI / server 用例分别并入或对齐 `scripts/tests/oncall-store.test.mjs`、`oncall-cli.test.mjs`、`oncall-serve.test.mjs` 既有模式（真实临时数据目录 + 真实服务 HTTP）；UI 用例按 `workbench-layout.test.mjs` 的源码静态断言与沙箱口径新增。


## REQ-20260908-014 需求完善批次每一轮上报需在主调度会话中显示单号和标题
## 验收标准

- [ ] `atb refine done <RUN-ID> --summary …` 回执 JSON 含 `itemId` 与 `title`，title 为条目标题。
- [ ] `atb refine fail <RUN-ID> --reason …` 回执同上。
- [ ] `atb refine check` 的 `current` 对象、`atb refine records` 的每条记录均含 `title`。
- [ ] 回执与 check 载荷仍 ≤2048 字节；条目已删除或历史运行无标题快照时 `title` 为 null，命令不报错。
- [ ] 现有 refine 行为（领取互斥、指纹变更校验、暂停/恢复、release）不回归。

# 测试用例 — REQ-20260908-014 需求完善批次每一轮上报需在主调度会话中显示单号和标题

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 数据层（R11）：done 回执含 itemId 与 title（=条目标题） | P0 | ✅ |
| 2 | 数据层（R11）：failed 回执含 title；check.current 与 records 记录均含 title | P0 | ✅ |
| 3 | 数据层（R11）：条目被删除后 records.title 为 null 不报错；回执/check 载荷 ≤2048 字节 | P1 | ✅ |
| 4 | CLI（R10 追加断言）：`refine done` 输出的回执 JSON 行含 `"title":"…"`（与条目标题一致） | P0 | ✅ |
| 5 | 回归：refine-store / refine-cli / refine-serve 既有用例全部保持通过 | P1 | ✅ |

> 执行记录：先写 R11 与 R10 追加断言跑红（回执无 title），实现后跑绿；
> 全量 `node scripts/tests/run-all.mjs` 87 个测试文件失败 0（首轮 impl-scope 偶发超时失败，
> 单独复跑与全量复跑均通过，与本改动无关）。


## REQ-20260908-015 需求完善功能只需完善说明文档即可，设计文档是开发时需要写的。说明文档需要有 UI 设计，需要有界面展示。
## 验收标准

- [ ] `analyzeItemDocs` 对 requirement 不再输出 `design 缺失` / `design 仅模板` / `test-cases 缺失` / `test-cases 无用例`；README 三项判定（描述、验收标准、说明过简）与 Bug 四项判定（现象 / 复现 / 期望 / 验收）行为不变（回归）。
- [ ] README 已完整的 submitted 需求不再因 design/test-cases 模板态被列入完善候选：`refineCandidates`、`atb refine next`、`/api/refine/candidates` 三处口径一致。
- [ ] 涉及 UI 的需求（判定口径见 design.md）README 缺「界面展示」时产生明确缺失原因（如「涉及 UI 需界面展示」）；README 已含「界面展示」节但为空 / 占位（如仅「（待补充）」）时同样视为待补充。
- [ ] `buildRefinePrompt` / `buildRefineWorkerPrompt` / `atb refine next` 输出指引改为：需求只补 README（描述 + 验收标准；涉及 UI 需含界面布局、交互行为、状态反馈与界面展示），不再出现补 design/test-cases 的要求；Bug 指引（现象 / 复现步骤 / 期望行为 / 验收说明）不变。
- [ ] commands/req.md 步骤 2 与 SKILL.md 相应条目（数据规范、铁律 5）同步「界面展示」要求。
- [ ] refine 相关测试（refine-store / refine-cli / refine-serve / refine-ui 等）按新口径更新并全部通过；fake-codex 夹具输出语句与新口径一致。
- [ ] 存量已冻结完善批次不受影响：`candidates[].reasons` 为创建时快照不回溯重算，在途运行的回执与指纹核验行为不变（见 design.md 兼容性节）。

# 测试用例 — REQ-20260908-015 需求完善功能只需完善说明文档即可，设计文档是开发时需要写的。说明文档需要有 UI 设计，需要有界面展示。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | store：requirement 夹具 README 完整（描述 + 验收标准合计 ≥30 字）、design 仅模板、test-cases 无用例——`analyzeItemDocs` 返回 complete=true，reasons 不含 design/test-cases 任何原因（scripts/lib/refine-store.mjs） | P0 | ✅ S1/S2 用例 |
| S2 | store：requirement 目录缺 design.md / test-cases.md 文件——同样不影响 complete 判定，不再报「design 缺失」「test-cases 缺失」 | P0 | ✅ S1/S2 用例 |
| S3 | store（回归）：requirement README 描述仅「（待补充）」/ 验收标准仅编号占位 / 描述+验收合计 <30 字——仍分别报「README 描述待补充」「验收标准待补充」「README 说明过简」 | P0 | ✅ S3 用例（含 R1 回归） |
| S4 | store（回归）：Bug 四项判定不变——缺现象 / 缺复现 / 缺期望 / 缺验收与说明过简照旧报原因；Bug 侧不引入界面展示判定 | P0 | ✅ S4 用例（含 R1 回归） |
| S5 | store：requirement 描述节含 UI 关键词（如「按钮」「弹窗」）且 README 无「界面展示」节——reasons 含「涉及 UI 需界面展示」 | P0 | ✅ S5 用例（词表 11 词逐词断言） |
| S6 | store：README 已含「界面展示」节但正文仅「（待补充）」占位——reasons 含「界面展示待补充」；节内有 ASCII 线框等实质内容时不报 | P0 | ✅ S6 用例（占位/线框/误判兜底三态） |
| S7 | store：描述不含 UI 关键词的非 UI 需求（纯流程类）——无「界面展示」相关原因（关键词启发式不误伤的代表性样本，按 design.md 定案词表补齐边界样本） | P1 | ✅ S7 用例（另 S5 固化全词表边界） |
| S8 | store：`refineCandidates` 只收 README 不完整的 submitted 需求；README 完整、design 仅模板的条目不入候选；排序口径（req 优先 → 创建早 → 编号）不变 | P0 | ✅ S8 用例（R2/R10c 亦覆盖） |
| S9 | store（回归）：`docsFingerprint` 仍覆盖 README/design/test-cases 三文档；`refine done` 在 worker 仅修改 README.md 后回执成功（指纹变化即通过核验）；三文档均未改时仍拒绝记完成 | P0 | ✅ S9 用例（未改拒绝由 R6 覆盖） |
| S10 | store（回归）：存量冻结批次 `candidates[].reasons` 快照不重算——创建于旧口径的批次其候选原因文案保持原样，收尾与核对（checkRefineBatch）行为不变 | P1 | ✅ S10 用例（手改账本模拟旧口径快照） |
| P1 | prompt：`buildRefineWorkerPrompt` / `buildRefinePrompt` 文案断言——含「界面展示」与「只补 README」口径，不再出现「/design/test-cases」补全要求；Bug 半句（现象/复现步骤/期望行为/验收说明）保留 | P0 | ✅ P1 用例 |
| C1 | CLI：`atb refine next` 对 README 完整（design 模板态）的 submitted 需求不再发放，跳过并继续找下一个候选；输出「下一步」指引行与新口径一致（scripts/atb.mjs） | P1 | ✅ R10c 用例（create 无候选报错 + 下一步行断言） |
| H1 | server：`/api/refine/candidates` 响应中 requirement 的 reasons 不含 design/test-cases 原因；涉及 UI 缺界面展示的条目 reasons 含新原因（scripts/server.mjs 完善面板数据源） | P1 | ✅ R11 扩展（refine-serve.test.mjs） |
| F1 | fixture：fake-codex 夹具输出语句（scripts/tests/fixtures/fake-codex.mjs L307）更新为新口径，codex 完善相关测试（refine-serve / codex 路径）不破 | P1 | ✅ refine-serve codex 全链路通过 |

结果（2026-09-08，zcode-batch-016-1）：`node scripts/tests/refine-store.test.mjs`、`refine-cli.test.mjs`、`refine-serve.test.mjs`、`refine-ui.test.mjs` 全部通过；全量 `scripts/tests/run-all.mjs` 87 个测试文件失败 0（dispatch-api 曾一次偶发失败，单独与整体各重跑两次均通过，未触及本次改动路径）。


## REQ-20260908-017 创建完单后直接返回列表即可
## 验收标准

- [ ] 统一新建弹窗创建需求或 Bug 成功后：弹窗关闭、停留在需求模块列表，不自动打开该单详情抽屉（宽屏并排右栏不加载该单，窄屏不滑出覆盖式抽屉）。
- [ ] 统一新建弹窗创建讨论单成功后：弹窗关闭、进入讨论模块列表，不自动打开该讨论单详情抽屉。
- [ ] 创建成功仍 toast「✓ 已创建 <单号>（待接受 / 待回复）」；列表随创建立即刷新，新单在默认筛选档（需求「待接受」/ 讨论「待回复」）与默认排序「最新更新」下位于列表顶部，列表计数 +1。
- [ ] 创建前后用户的筛选档、排序、搜索词、勾选状态保持不变；此前手动打开的其他条目详情不被切换或强制关闭。
- [ ] 看板打开期间经 CLI（`/req`、`/bug`、`atb new`）创建的单：列表在一个轮询周期（2 秒）内自动刷新出新单，但不自动跳转详情、不弹「已定位新建条目」提示。
- [ ] 手动点击列表中的新单仍能正常打开详情抽屉，详情内文档页签与操作不回退。
- [ ] 创建失败行为不变：弹窗保留已填内容与附件、toast 提示错误、可重试；提交中按钮禁用防重复点击。

## 界面与交互说明

### 界面布局（不变，仅列创建链路相关结构）

入口与区域保持现状（`scripts/web/index.html`）：

- 顶栏右侧「＋ 新建」按钮（`#btnNew`）→ 统一新建弹窗（`#modalWrap`，REQ-20260907-004：需求 / Bug / 讨论三类同一表单，按类型切换字段）。
- 需求模块（`#reqView`）：宽屏（>1020px）为列表与详情并排；窄屏（≤1020px）详情为覆盖式抽屉（`drawerOverlayMode()`，`scripts/web/app.js` 1941-1943 行）。
- 讨论模块（`#oncallView`）：列表 + 覆盖式详情抽屉（`#oncallDrawer`）。

```
创建时（弹窗浮于当前视图之上）              创建后（返回列表，不弹详情）
┌────────────────────────────────┐    ┌────────────────────────────────┐
│ ▦ 看板 ●  data-dir    [＋ 新建] │    │ ▦ 看板 ●  data-dir    [＋ 新建] │
│ 讨论|需求|任务|文件      设置     │    │ 讨论|需求|任务|文件      设置     │
│ (待接受 3)(已接受 5)…  [排序 ▾]  │    │ (待接受 4)(已接受 5)… [排序 ▾]  │
│ ┌──── 需求列表 ─────┐┌───────┐ │    │ ┌──── 需求列表 ─────┐┌───────┐ │
│ │ … 原有条目 …       ││ 详情   │ │    │ │ ● REQ-YYYYMMDD-NNN ││ 选择  │ │
│ │                   ││ (空态/ │ │    │ │   新单标题 [待接受] ││ 左侧  │ │
│ │                   ││ 旧条目)│ │   │ │ … 原有条目 …        ││ 列表  │ │
│ └───────────────────┘└───────┘ │    │ └───────────────────┘└───────┘ │
│    ┌─ 新建条目（浮层）─┐        │    │  ✓ 已创建 REQ-YYYYMMDD-NNN     │
│    │ 类型 标题 描述    │        │    │    （待接受）      ← toast     │
│    │     [取消][创建] │        │    └────────────────────────────────┘
│    └─────────────────┘         │     详情抽屉不自动打开；新单置顶可见
└────────────────────────────────┘
```

### 交互行为

1. 点「＋ 新建」打开弹窗，选择类型（需求 / Bug / 讨论）、填写标题与描述（讨论单正文必填、支持截图附件），点「创建」。
2. 创建成功：弹窗关闭 → 若当前不在对应模块则切换到该模块（需求单 / Bug → 需求；讨论单 → 讨论）→ 列表刷新，新单按当前筛选与排序插入（默认档下位于顶部）→ toast 成功提示。**不调用 `openDrawer` / `reveal`，不发生跳转。**
3. 讨论单创建成功后停留讨论列表（不再 `reveal` 打开详情）；需求 / Bug 创建成功后停留需求列表（不再 `openDrawer`）。
4. CLI 路径：轮询只负责刷新列表（`detectNewItem` 的基线登记保留以防误跳），检测到新单不 `openDrawer`、不 toast「已定位新建条目」。
5. 创建后人工点击列表中新单行，照常打开详情抽屉，详情能力与现状一致。

### 状态反馈

- 提交中：按钮文字「创建中…」且禁用，防重复提交（现状保留）。
- 成功：toast「✓ 已创建 <单号>（待接受）」/「✓ 已创建 <单号>（待回复）」；列表计数 +1 并即时刷新。
- 失败：弹窗不关闭，保留已填标题 / 描述 / 附件，toast「创建失败：<原因>」，可重试（现状保留）。

### 界面展示

- 新单在列表中的行展示与既有条目一致：单号、标题、状态 chip（需求 / Bug 为「待接受」，讨论单为「待回复」）、时间等，无新增字段。
- 宽屏右侧详情栏在未手动选择时保持空态引导「选择左侧列表中的条目查看详情」；窄屏列表不被抽屉遮挡。

# 测试用例 — REQ-20260908-017 创建完单后直接返回列表即可

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 修订 REQ-20260906-016 的自动导航：三类单创建成功后只关弹窗、进模块、刷列表、toast，不再自动打开详情 / 跳转。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| A1 | 基线播种：首轮 poll 只登记全部 id，不导航、不弹提示（保留原 REQ-20260906-016 基线机制） | 高 | 通过（new-item-nav N1） |
| A2 | CLI 新建检测：poll 出现新 REQ → 列表数据刷新（state.board 更新），不 openDrawer、不弹「已定位新建条目」 | 高 | 通过（new-item-nav N2） |
| A3 | 多条新单：全部登记进基线，无任何导航；后续轮询不补跳 | 高 | 通过（new-item-nav N3） |
| A4 | 无新单：数据变化不改变已打开抽屉，仅常规刷新（既有行为不回退） | 高 | 通过（new-item-nav N4） |
| A5 | 弹窗路径（需求/Bug）：创建成功后关闭弹窗、toast 成功、停留在需求模块（setView('status')）、poll 刷新列表，不调用 openDrawer；失败时弹窗保留、报错、不导航、按钮可重试 | 高 | 通过（new-item-nav N5） |
| A6 | 弹窗路径（讨论单）：创建成功后关闭弹窗、toast、进入讨论模块并 poll 刷新讨论列表，不调用 reveal 打开详情（REQ-20260908-013 U2 同步修订） | 高 | 通过（oncall-question-optional U2） |
| A7 | 护栏/边界：弹窗打开期间轮询不导航；关闭后不补跳；切换项目基线重置、既有条目不算新建 | 中 | 通过（new-item-nav N6/N7） |
| A8 | 静态契约：poll 接线 detectNewItem 仅登记基线、不调 openDrawer；submitNew 不含 openDrawer(st.id)/reveal；switchProject / btnInit 重置基线保留；ATBOncall 不再暴露 reveal | 高 | 通过（new-item-nav N8、workbench-layout W7） |
| M1 | 浏览器人工验收：宽屏创建后右栏保持空态/旧条目，窄屏不滑出抽屉；筛选/排序/搜索/勾选不变 | 中 | 待人工 |
| M2 | 浏览器人工验收：CLI 路径 2 秒内列表出新单、无跳转提示；手动点新单照常打开详情 | 中 | 待人工 |


## REQ-20260908-018 已接受列表要要支持批量移入计划
## 验收标准

- [ ] 「已接受」档列表行有常驻复选框，勾选/取消不打开详情；勾选跨档保留、
      叠搜索时只作用于搜索可见行（与待接受/已计划勾选同契约）。
- [ ] 选择工具条出现「移入计划（N）」按钮：N=0 禁用，进行中禁用并显示
      「移入中…」；合并计数升级为「待接受 X · 已接受 Y · 已计划 Z」。
- [ ] 点击「移入计划」先弹页面内二次确认，取消不发任何请求。
- [ ] 确认后对每条已接受勾选 POST `/api/item/<ID>/status` `{to:'planned'}`，
      逐条进度与完成反馈（成功/失败计数 + 失败清单），单项失败不回滚整批，
      请求绑定当前项目。
- [ ] 非已接受条目（待接受/已计划/开发中等）混入调用时被资格过滤，不发请求。
- [ ] 轮询剪枝：勾选单离开已接受状态后自动从勾选集合移除并 toast 提示。
- [ ] 「清空选择」清空已接受勾选；「选择可操作项」在已接受档全选本档可见
      已接受条目，其他档行为不回退。
- [ ] 切换项目时已接受勾选随其他勾选一并重置。
- [ ] 既有单条「改为已计划」详情按钮、批量接受、批量移出计划、进入批量开发
      行为不回退；状态机与服务端接口不变（accepted→planned 仍为人工专属，
      Agent 置计划仍被守卫拦截）。

# 测试用例 — REQ-20260908-018 已接受列表要要支持批量移入计划

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 静态契约：#selectionBar 有 #planAdd「移入计划」按钮；已接受行渲染 data-plan-id 复选框，待接受/已计划/开发中行不渲染；selectOperable title 覆盖「已接受」 | P0 | ✅ |
| 2 | 复选框交互：点击不冒泡打开详情；change 增删 state.plan.selected；pending 时禁用 | P0 | ✅ |
| 3 | 工具条合并计数升级：勾选后显示「已选 N 项（待接受 X · 已接受 Y · 已计划 Z）」；#planAdd 随已接受勾选数显示（N）并在 0 时禁用 | P0 | ✅ |
| 4 | 批量移入计划：二次确认一次（含条数与单号）；逐条 POST /api/item/<ID>/status {to:'planned'} 且绑定当前项目；完成反馈「成功 N 条」 | P0 | ✅ |
| 5 | 资格过滤：待接受/已计划/开发中单混入 moveToPlan 不发请求并提示无可移入条目；重复 id 去重 | P0 | ✅ |
| 6 | 取消确认不发任何请求；pending 期间防重入 | P1 | ✅ |
| 7 | 单项失败不回滚：某条 POST 失败进 failures，成功计数与其余成功单不受影响，结果区分列呈现 | P1 | ✅ |
| 8 | 轮询剪枝：勾选单离开已接受状态后 syncPlan 自动移出勾选并 toast；切档不清空勾选（跨档保留） | P1 | ✅ |
| 9 | 选择可操作项/清空选择：已接受档全选本档可见已接受条目；其他档不回退；清空选择同时清空已接受勾选；切换项目重置已接受勾选 | P1 | ✅ |

> 用例 1-9 的自动化实现：`scripts/tests/plan-batch-move.test.mjs`
> （vm 模拟 DOM 模式，沿用 accept-ui / planned-state 前端测试脚手架）。
> 服务端 accepted→planned 边、守卫人工专属、批次实时队列拾取后置计划单
> 分别由既有 planned-state.test.mjs S1/S4/S6/S7 覆盖，本需求不重复建设。


## REQ-20260908-019 批量执行去掉上限的设置
## 验收标准

- [ ] `createBatch` 候选=范围全量冻结（无截断），新批次记录不含 `limit` 字段；`BATCH_LIMIT_*` 常量删除
- [ ] `atb batch create --limit 10` 非零退出并提示上限设置已移除；不带 `--limit` 正常创建
- [ ] `/api/batch/create` 忽略 `body.limit`（不再 400 越界校验），响应与 `/api/batch/current` 响应不含 `limit`
- [ ] Web 创建面板无「批次上限」输入框，创建请求体不含 `limit`，运行视图状态行不再显示上限
- [ ] 勾选 ids 范围语义不变：空集报错、已被认领项剔除、按规范序全量入批
- [ ] 存量兼容：旧批次 `batch.json` 含 `limit`、旧 `settings.json` 含 `defaults.batchLimit` 时读写与展示不受影响
- [ ] 相关文档（SKILL.md CLI 速查、batch-execution.md）同步更新，不再提及批次上限
- [ ] 全量测试通过（node scripts/tests/run-all.mjs）

# 测试用例 — REQ-20260908-019 批量执行去掉上限的设置

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| Z02a-r | 无上限创建：3 候选全量冻结入批；新批次记录无 `limit` 字段；候选不变时重复创建幂等；冻结后新增条目入只含新条目的排队批次 | P0 | 通过 |
| Z02d-r | 上限设置已移除：`createBatch` 忽略多余 `limit` 入参（0/101 不再抛「上限」错）；存量 `defaults.batchLimit` 不再被读取；`BATCH_LIMIT_*` 常量删除 | P0 | 通过 |
| S2-r | 勾选范围语义不变：空集/非法 ids 报错、已被认领项剔除、勾选集合全量入批（无截断）、记录无 limit | P0 | 通过 |
| Serve-r | `POST /api/batch/create`：`body.limit`（0/101）被忽略不再 400，响应不含 `limit`；`GET /api/batch/current` 响应不含 `limit` | P0 | 通过 |
| UI-r | 创建面板无「批次上限」输入框（`#batchLimit` 不存在）；创建请求体不含 `limit`；运行视图状态行不显示「上限」 | P0 | 通过 |
| 兼容-r | 旧 `settings.json` 含 `defaults.batchLimit`：创建不受影响；设置保存（codex T1）不再补写 `defaults.batchLimit` 且共用计数器保留 | P1 | 通过 |
| 回归-r | 连续批次假 worker 流程（create→next→claim→report→receipt→check，Z07）、幂等排队（Z06/queue/delete）、依赖受阻（BUG-20260906-001 系列）等既有行为不回归 | P0 | 通过 |

对应测试文件与用例映射（均已更新并通过）：

- `scripts/tests/batch-core.test.mjs`：Z02a 改写（全量冻结 + 无 limit 字段 + 新增条目入下一批）；Z02d 改写（忽略 limit 入参/残留配置；常量删除断言）；BUG-20260906-001 系列去掉 `limit: 1` 入参（单候选场景不依赖截断）。
- `scripts/tests/batch-cli.test.mjs`：Z06 新增 CLI `--limit` 非零退出并提示「已移除」；Z07 去掉 `--limit 10`。
- `scripts/tests/impl-scope.test.mjs`：S2 改写（无 limit 断言、勾选全量入批）。
- `scripts/tests/batch-serve.test.mjs`：原 0/101 → 400 断言改为「忽略并照常创建 + 响应无 limit」；current 响应无 limit；创建请求去 limit。
- `scripts/tests/batch-delete.test.mjs`、`batch-queue.test.mjs`：创建请求体去 `{ limit: 20 }`（回归仍通过）。
- `scripts/tests/impl-entry-ui.test.mjs`：E7 去掉上限输入框交互、断言请求体无 limit、面板无 batchLimit；E11 残留的 `value="20"` 断言改为无 batchLimit 断言。
- `scripts/tests/batch-ui.test.mjs`：U6 去「上限输入」，增「无 batchLimit / 不回显上限」断言。
- `scripts/tests/next-batch-entry.test.mjs`：N5 改为「创建函数不含 limit」。
- `scripts/tests/planned-state.test.mjs`：S12 去掉 `#batchLimit` 交互残留。
- `scripts/tests/codex-model-api.test.mjs`：T1 「缺省上限必须保留」改为「不再补写 defaults.batchLimit」。

执行记录：改动前上述新断言确认跑红（Z02a/Z02d/S2/E7/U6/N5/Z06/serve 共 8 处红）；实现后单文件全绿；全量 `npm test` 87 个测试文件 0 失败（首轮偶发 impl-scope S1 / execution-verifier 翻转，复跑均稳定；S1 为既有偶发缺陷，已登记 BUG-20260908-007，与本改动无关）。


## REQ-20260908-020 重构批量流程和任务管理。
## 验收标准

- [ ] 任务模块重构为「批量完善 / 批量开发」两类任务子面板；两类均支持启动、查看当前处理详情、暂停/恢复后续领取、终止，且全程不需要离开任务模块。
- [ ] 处理模式仅子代理模式：两类任务只保留「主调度 + 每项一个子代理」的执行方式；Codex 后台自动派发入口（scheduler `codex exec` 路径）在看板中隐藏/下线，本需求交付内不依赖该路径。
- [ ] 子代理模式支持 zcode 与 codex 两种执行 Agent；两套主调度/子代理提示词按 Agent 差异化（CLI 约定、会话命名、执行口径），分别维护且互不混用。
- [ ] 设置模块可为批量完善、批量开发分别配置展示哪些 Agent；被隐藏的 Agent 不出现在对应任务启动选项与执行记录筛选中。
- [ ] 批量完善面向全部已接受单：每轮领取时实时读取全部已接受单作为候选，创建任务后新接受的单自动进入本轮处理范围（不再因创建时点冻结而被排除）。
- [ ] 每个已接受单在列表卡片与详情页显示「未完善 / 完善中 / 已完善」徽标；待接受 → 已接受时置「未完善」；子代理领取后置「完善中」；done 回执且文档变更核验通过后置「已完善」；fail 回执后回置「未完善」。
- [ ] 除「完善中」外，其他完善状态的已接受单均可驳回回待接受（入口不因本需求减少）；「完善中」的单驳回入口禁用并给出提示；任何单重新变为已接受时完善状态重置为「未完善」，直到下一轮批量完善处理。
- [ ] 批量开发沿用已计划（planned）实时串行队列（REQ-20260908-010 口径不回退）；未认领的已计划单可移出计划退回已接受，已认领（开发中）的单不可移出。
- [ ] 设置模块可按「任务类型 × Agent」四路分别配置子代理模型与智能水平；完善侧默认值为更高智能档，开发侧默认值为一般智能档（默认值可修改）。
- [ ] 终止操作有二次确认；终止后停止派发后续项、账本剩余项标记出局、任务转终止态并可在任务模块重新启动新任务；在途子代理的停止方式在界面上有明确提示。
- [ ] 当前处理详情实时显示：当前项单号 + 标题、开始时间、子代理会话标识、最近回执摘要与计数；执行记录列表沿用现有分页与搜索。
- [ ] 回归：claim/report 状态机、impl 互斥锁、回执协议（≤2KiB）、批次保留上限（REQ-20260906-023）等既有机制不受影响；`atb batch` / `atb refine` CLI 仍可正常使用。

# 测试用例 — REQ-20260908-020 重构批量流程和任务管理。

> **2026-09-08 深测纠正：下表原始勾选是开发阶段记录，不能视作当前全部通过。** 新增 D01～D12 实测 5 通过、7 失败；第 4、15、20/21、27 项存在已复现问题，第 9、18、29 项验证范围不足。具体用例、日志和 Bug 见 [深度测试报告](deep-test-report.md)。

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 用例为完善阶段草案，开发阶段按最终定案（含 design.md 待确认项）调整；结果列由开发阶段回填。

开发阶段定案（差异说明）：

- 用例 4/5：候选口径 = 已接受（accepted）且完善状态 ≠ 已完善；文档完整性启发式只用于展示缺失原因，不再过滤候选。
- 用例 15：两类任务（完善/开发）均按执行 Agent（zcode / codex）生成差异化主调度提示词，批次账本落盘 `agent` 字段可区分；codex 后台执行路径（服务端逐项 `codex exec`）保留代码但不再暴露入口。
- 用例 16-19：Agent 展示与四路模型档位落在新的「批量任务」设置（`docs/agent-team-board/tasks/settings.json`），设置模块提供配置区。
- 终止（abort）语义：`abortRequested`/`aborted` 标记 + 批次转 finished；剩余未领取项落 `skipped` 出局账；在途运行落 `interrupted`（reason 注明人工终止）；锁全部释放。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| 1 | 任务模块呈现「批量完善 / 批量开发」两类子面板；原「Zcode 批次 / Codex 自动派发 / 需求完善」三面板入口不复存在 | P0 | ✅ |
| 2 | 两类任务面板均含启动区、当前处理详情、操作区（暂停/恢复、终止）、执行记录四个区块；无进行中任务时显示启动区，运行中显示详情区 | P0 | ✅ |
| 3 | 任务模块与看板路由中不再出现 Codex 后台自动派发入口（scheduler exec 路径隐藏）；引用它的顶栏「模型配置待处理」跳转等无死链 | P0 | ✅ |
| 4 | 批量完善候选 = 全部已接受单：accepted 单进入候选；创建完善任务后新接受的单，在下一轮领取时被实时读取并处理 | P0 | ✅ |
| 5 | 待接受单、已计划单不出现在批量完善候选中 | P0 | ✅ |
| 6 | 单 A 待接受 → 人工接受：完善状态 = 未完善（列表徽标 + 详情徽标一致） | P0 | ✅ |
| 7 | 子代理领取单 A（refine next 预留成功）：徽标变完善中；done 回执且文档指纹变化核验通过后变已完善 | P0 | ✅ |
| 8 | 子代理 fail 回执：单 A 徽标回置未完善，可被下一轮重新领取 | P0 | ✅ |
| 9 | 已完善的单 A 被驳回回待接受，再次接受后徽标重置为未完善，直到下一轮批量完善处理 | P0 | ✅ |
| 10 | 完善中的单 A：详情页「驳回回待接受」按钮禁用且悬停有提示；CLI `atb status <ID> submitted` 同样被拒绝并提示 | P0 | ✅ |
| 11 | 未完善/已完善的已接受单可正常驳回回待接受（不因本需求减少既有能力，REQ-20260907-011 回归） | P0 | ✅ |
| 12 | 完善三态数据只落在执行账本（refine 索引），status.json 无新增字段；state-guard 拦截 Agent 直接改完善索引外文件不被绕过 | P0 | ✅ |
| 13 | 批量开发沿用已计划实时队列：置计划的单按最旧优先被逐项处理；执行中移入计划的新单可继续被领取（REQ-20260908-010 回归） | P0 | ✅ |
| 14 | 未认领的已计划单可移出计划退回已接受；已认领（开发中）的单移出计划被拒绝 | P0 | ✅ |
| 15 | 子代理模式可选 zcode / codex 执行 Agent；两套提示词内容按 Agent 差异化（CLI 约定、会话命名不同），快照落盘可区分 | P0 | ✅ |
| 16 | 设置中隐藏某 Agent 后：对应任务启动选项不出现；恢复展示后重新出现 | P1 | ✅ |
| 17 | Agent 展示配置按「批量完善 / 批量开发」分别生效，互不影响 | P1 | ✅ |
| 18 | 设置可按「任务类型 × Agent」四路分别保存模型与智能水平；保存后启动的新任务按配置生成提示词/参数 | P0 | ✅ |
| 19 | 完善侧默认模型档位为高智能、开发侧为一般智能（默认值可改，修改后持久化） | P1 | ✅ |
| 20 | 终止操作：二次确认弹窗；确认后停止派发，账本剩余未领取项标记出局，在途项标记人工终止的 interrupted，锁全部释放；任务转终止态 | P0 | ✅ |
| 21 | 终止后任务模块恢复启动区，可立即启动新任务且不残留旧锁 | P0 | ✅ |
| 22 | 终止提示文案包含「在途子代理需在对应会话人工停止」类指引 | P1 | ✅ |
| 23 | 暂停：点击后停止领取下一项、按钮变「恢复后续领取」；恢复后继续领取；在途执行不受影响（既有口径回归） | P0 | ✅ |
| 24 | 当前处理详情实时显示当前项单号 + 标题、开始时间、子代理会话标识、最近回执摘要与计数；无进行中项显示等待领取 | P1 | ✅ |
| 25 | 徽标与详情随轮询刷新（领取→完善中、回执→已完善在 UI 可见变化，无需手动刷新） | P1 | ✅ |
| 26 | 回归：claim/report 状态机、impl 互斥锁、回执 ≤2KiB、批次保留上限（REQ-20260906-023）不受影响；既有 refine/batch CLI（next/done/fail/release/check/summary/records/pause）全部可用 | P0 | ✅ |
| 27 | 并发保护：同一项目同时只允许一个进行中的完善任务与一个开发任务；重复创建幂等返回不新建 | P0 | ✅ |
| 28 | 双项目隔离：项目 A 的完善任务不影响项目 B 的候选与徽标（沿用多项目数据目录隔离） | P1 | ✅ |
| 29 | 服务重启恢复：重启后账本可读，在途预留按既有 interrupted 语义释放，完善中徽标回置未完善 | P1 | ✅ |
| 30 | UI 关键流程无死链：徽标点击跳任务模块批量完善面板；设置中模型块刷新/校验在新分区可用 | P2 | ✅ |


## REQ-20260908-021 完善需求时的 UI 设计要使用 html 进行可交互设计展示
## 验收标准

- [ ] `buildRefinePrompt` / `buildRefineWorkerPrompt` / `atb refine next` 输出与用法文案改为：涉及 UI 的需求完善时，界面展示须为条目目录下的可交互 html 演示（README 写清布局/交互/状态反馈并链接 `./ui-demo.html`），不再只写「README 内嵌 ASCII 线框 / 结构示意」；Bug 指引（现象/复现步骤/期望行为/验收说明）不变。
- [ ] worker 约束文案允许在条目目录创建约定的 ui-demo.html；其余禁令（业务源码 / status.json / claim/report / test-report.md / git commit）保持；refine 不占 impl.lock 行为不变。
- [ ] `analyzeItemDocs` 对涉及 UI 的需求：缺 ui-demo.html、文件为空/占位、或 README 界面展示节未链接该文件时，输出明确缺失原因；非 UI 需求与 Bug 判定回归不变；「本需求不涉及界面改动」兜底保留。
- [ ] `docsFingerprint` 覆盖 ui-demo.html（存在时纳入哈希）：只新增/修改演示文件的 done 回执能通过「真实变更」核验；三份 markdown 的指纹与 done 核验行为回归不变。
- [ ] 指引中写明演示文件质量门槛：单文件、内联资源、无外网依赖、无构建步骤、浏览器直接打开可交互，且覆盖界面布局 / 交互行为 / 状态反馈三要素。
- [ ] SKILL.md（数据规范、铁律 5、完善流程）与 commands/req.md 同步新口径，并写明创建阶段（可 ASCII）与完善阶段（须 html 演示）的差异。
- [ ] refine 相关测试（refine-store / refine-cli / refine-serve / refine-ui / tasks-refine）按新口径更新并全部通过；fake-codex 夹具输出语句（如涉及）同步。
- [ ] 存量兼容：已完善（refined）条目不回溯进入候选；已冻结批次候选 reasons 不重算；在途运行的领取/回执/指纹核验行为不变。

# 测试用例 — REQ-20260908-021 完善需求时的 UI 设计要使用 html 进行可交互设计展示

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S5a（回归） | UI 需求 README 无「界面展示」节 → 仍报「涉及 UI 需界面展示」（UI_KEYWORDS 词表逐词），无节时不报占位/演示原因 | P1 | ✅ |
| S6a | UI 需求「界面展示」节有实质内容但条目目录缺 ui-demo.html → 报「涉及 UI 缺 ui-demo.html 演示」 | P0 | ✅ |
| S6b | ui-demo.html 存在但为空/仅 HTML 注释占位 → 报「ui-demo.html 演示待补充」 | P0 | ✅ |
| S6c | README「界面展示」节正文未出现 ui-demo.html 链接 → 报「界面展示节未链接 ./ui-demo.html」 | P0 | ✅ |
| S6d | 节 + html + 链接齐备（ASCII 线框降为可选补充）→ complete，不再报界面展示相关原因 | P0 | ✅ |
| S6e（回归） | 节存在但空/「（待补充）」占位 → 仍报「界面展示待补充」，不叠加演示原因 | P1 | ✅ |
| S6f（回归） | 「本需求不涉及界面改动」误判兜底保留：节内声明非 UI 即视为有效内容，不做 html 三查 | P1 | ✅ |
| S6g（回归） | 非 UI 纯流程需求 / Bug：不引入任何 ui-demo.html 相关判定 | P1 | ✅ |
| S9a | docsFingerprint 纳入 ui-demo.html：只改演示文件（三份 markdown 不动）指纹即变化；缺失→存在的增删同样变化 | P0 | ✅ |
| S9b | worker 只新增/修改 ui-demo.html（markdown 不动）的 done 回执能通过「真实变更」核验记账 | P0 | ✅ |
| P1a | buildRefinePrompt / buildRefineWorkerPrompt 含 ui-demo.html 口径与质量门槛（单文件、内联 CSS/JS、无外网依赖、无构建步骤、浏览器直接打开可交互、覆盖布局/交互/状态反馈三要素），旧「ASCII 线框 / 结构示意」必需口径不再出现 | P0 | ✅ |
| P1b | 两处提示词约束文案允许「涉及 UI 可另建约定的 ui-demo.html」，其余禁令（业务源码 / status.json / claim/report / test-report.md / git commit / 保持 accepted / 待确认）逐项保留 | P0 | ✅ |
| CLI | `atb refine next` 下一步行与 REFINE_USAGE 用法文案同步新口径（含 ui-demo.html）；refine-serve 候选原因走新判定 | P1 | ✅ |
| S10（回归） | 存量兼容：已完善（refined）不回溯候选；已冻结批次原因快照不重算；在途领取/回执/指纹核验行为不变 | P1 | ✅ |


## REQ-20260908-022 支持就单一需求和 Agent 进行讨论的功能
## 验收标准

- [ ] 从需求详情抽屉可就该需求发起讨论：创建成功后线程归属该 REQ-ID，需求讨论区块即时显示（单号、状态、轮数、最近活动时间），无需人工接受。
- [ ] CLI 可创建需求绑定讨论（`--req` 类参数，具体命令以 design 定），`oncall list` 可按需求过滤，`oncall show` 可见归属需求。
- [ ] zcode 与 codex 两种模式派单，派单提示词均自动携带该需求 README / design / test-cases 全文与状态元信息，无需人工粘贴（以落盘提示词 / `oncall show` 输出核验）。
- [ ] 多轮追问按轮次追加展示、按单落位不串单；回答 Markdown 渲染、截图内联点击放大；追问将已回复单拉回待回复。
- [ ] 双向跳转可用：需求讨论区块 → 讨论抽屉；讨论抽屉归属 REQ-ID → 需求详情。
- [ ] 讨论不改变 REQ/BUG 状态机，不占 impl.lock，不进 /dev 选单；需求被删除或状态流转时讨论线程行为符合 design 定案（不崩坏、不串单）。
- [ ] 现有讨论单（无需求关联）创建、派单、追问、展示无回归；批量实施与批量完善功能不受影响。
- [ ] 现有看板 / 文件 / 派发 / oncall 相关测试无回归，新增能力按 TDD 补用例。

## 待确认

- 关联字段落位与目录结构：扩展讨论单（oncall/tickets/ASK-…/ticket.json 增关联字段）还是需求条目目录内新开讨论目录——design 阶段定。
- 一个需求同时存在多个讨论线程是否设上限（默认不设，待确认）。
- 需求绑定讨论是否纳入 oncall 批量派单范围（默认纳入，按需求过滤批量派单，待确认）。
- Bug 是否同样支持绑定讨论（本需求标题仅指需求，Bug 暂列范围外，待确认）。
- CLI 命令形态（`atb oncall new --req` 还是独立子命令）——design 阶段定。

# 测试用例 — REQ-20260908-022 支持就单一需求和 Agent 进行讨论的功能

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| R1 | store：createTicket 带 req 落 reqId；缺省 reqId=null（老单兼容）；非法格式 / 不存在 / Bug 编号拒绝 | P0 | ✅ |
| R2 | store：卡片与 listTickets 按 reqId 过滤（与状态过滤组合）；过滤无匹配返回空 | P0 | ✅ |
| R3 | 上下文：readTicketFull 带 req 元信息与三文档全文；需求删除后 missing 不崩；未绑定单不变 | P0 | ✅ |
| R4 | codex 提示词：buildOncallWorkerPrompt 注入归属需求节（元信息 + README/design/test-cases 全文）；未绑定单无该节 | P0 | ✅ |
| R5 | CLI：oncall new --req 创建；list --req 过滤且行内显示 [REQ-…]；show 文本含归属需求与文档上下文，--json 含 req | P0 | ✅ |
| R6 | serve：POST /api/oncall/ticket 带 req；GET /api/oncall/tickets?req= 过滤；board 卡片与详情带 reqId/req；非法 req 400 | P0 | ✅ |
| R7 | UI 静态契约：需求抽屉「需求讨论」区块与发起入口、统一弹窗关联需求输入；讨论卡片/抽屉归属徽标与双向跳转接缝（atb:open-req / ATBOncall.openDrawer） | P1 | ✅ |
| 回归 | oncall-store / oncall-cli / oncall-serve / oncall-dispatch / oncall-ui / oncall-isolation 既有用例不回归 | P0 | ✅ |


## REQ-20260908-025 完善文档指纹算法版本化，避免基线口径不一致导致误报
## 验收标准

- [ ] 指纹带版本：`docsFingerprint` 返回值自含算法版本标识；`batch.candidates[].baseline` 冻结时记录同一版本（refine-store.mjs 四处冻结点统一：创建 L438 / 吸收 L636 / 重排队 L655 / 领取 L715）。
- [ ] 按版本重算比对：三处比对点（`finishRefineRun` done 核验 refine-store.mjs L798、codex precheck server.mjs L882、codex settle server.mjs L960）改为按基线版本选择口径重算当前指纹后比对；用旧版本冻结的基线在算法升级后的代码里：未编辑 → 判定一致（precheck 不出局、zcode done 仍按「未检测到补全变更，不能记完成」拒绝），有编辑 → 判定不一致（可记完成）。
- [ ] 真人工编辑语义回归不变：同版本口径下领取后人工修改文档，codex precheck 仍以「冻结后文档已被人工编辑，基线失效」出局；zcode 领取后未改文档的 done 仍被拒绝（沿用现有文案）。
- [ ] 存量基线兼容有确定规则：对本次上线前已冻结的无版本裸 40 位 sha1 基线，实现并在 design.md 写明确定性兼容/迁移规则（如按已知历史口径逐一重算、任一匹配视为未编辑，或领取/结算前就地重冻结升级），保证发布本身不使任何存量未结束批次或在途运行新增误报出局。
- [ ] 算法演进纪律成文：指纹算法版本常量、升级登记要求（调整 DOC_FILES / 哈希构造必须 bump 版本并保留旧版本重算能力）、旧版本重算实现何时可废弃，落成书面策略（落点：refine-store.mjs 代码注释与/或 skills/agent-team-board/SKILL.md，具体落点待确认）；后续再演进算法时存量基线不再失效。
- [ ] 事故场景回归验证：以「旧版本口径冻结基线 → 算法升级 → 继续领取/回执」序列构造测试（可在测试内注册两个版本口径模拟），不再产生「冻结后文档已被人工编辑，基线失效」的误报 skipped。
- [ ] 测试与回归：scripts/tests/refine-store.test.mjs（S9 等指纹断言）、refine-claim-baseline.test.mjs 及 refine-serve / refine-cli / refine-ui / tasks-refine 涉及用例按版本化口径更新并全部通过；BUG-20260908-011（领取时重冻结）、REQ-20260908-021（ui-demo.html 计入指纹、只改演示文件可记完成）、BUG-20260908-010（重排队重冻结）等既有行为回归不变。

# 测试用例 — REQ-20260908-025 完善文档指纹算法版本化，避免基线口径不一致导致误报

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

新增测试文件：`scripts/tests/refine-fingerprint-version.test.mjs`（F1~F6，利用注册表真实 v1/v2 口径模拟事故序列）；既有 refine-store / refine-claim-baseline / refine-reaccept / refine-serve / refine-cli / refine-ui / tasks-refine 指纹相关用例作回归（形态兼容预期不改即绿）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| F1 | 指纹自带版本：`docsFingerprint` 返回 `v2:<40hex>` 形态；`docsFingerprintAt(dir, v)` 按版本口径返回裸哈希，未登记版本抛错 | P0 | ✅ |
| F2 | 四处冻结点统一记录版本：创建/吸收/重排队/领取落盘的 `candidates[].baseline` 均为 `v2:` 前缀形态（领取重冻结把存量裸基线就地升级） | P0 | ✅ |
| F3 | 按基线版本重算比对（事故主场景）：v1 口径冻结基线 → 算法演进为当前 v2 → 未编辑（含仅新增 v2 才纳入的 ui-demo.html）判定一致（done 仍拒绝），编辑 v1 覆盖文件判定不一致（done 可记） | P0 | ✅ |
| F4 | 存量裸哈希兼容：裸 v1 哈希 / 裸 v2 哈希基线在 v2 代码下未编辑均判一致（不误报出局），真编辑判不一致 | P0 | ✅ |
| F5 | 真人工编辑语义回归：同版本（v2）口径领取后人工改文档 → `docsUnchangedSince` 判已变更（precheck 出局方向、settle changed 方向）；非法形态基线判已变更；未登记版本前缀判已变更 | P0 | ✅ |
| F6 | 事故序列端到端：裸基线在途批次（模拟 RFB-20260908-010 场景）在版本化代码上领取 → 补全文档 → done 记账，全程无「冻结后文档已被人工编辑，基线失效」类 skipped | P0 | ✅ |

