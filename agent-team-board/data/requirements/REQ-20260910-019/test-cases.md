# 测试用例 — REQ-20260910-019 营销与增长：项目档案、定位与定价版本管理

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | 未初始化项目读取营销状态返回 initialized:false（项目可正常打开），初始化后读取返回档案草稿：intro 取自项目 README 首个非标题段落、stage=exploring、revision=1、无证据、无当前定价 | P0 | 通过（marketing-store.test.mjs） |
| S2 | 重复初始化返回 400；未初始化看板的项目（无 dataDir）初始化返回 400 | P0 | 通过（marketing-store.test.mjs） |
| S3 | 保存定位与证据：字段与证据条目落盘、revision 递增；证据类型非法（不在 事实/假设/待确认 枚举）返回带字段名的错误 | P0 | 通过（marketing-store.test.mjs） |
| S4 | 预算 / 每周工时 / 候选价格非法（负数、非数字字符串）→ 带字段名的错误；null（未知）与合法正数通过 | P0 | 通过（marketing-store.test.mjs） |
| S5 | revision 过期保存 → 冲突错误（HTTP 409），旧 profile.json 字节不变（失败不损坏旧文件） | P0 | 通过（marketing-store.test.mjs + marketing-serve.test.mjs） |
| S6 | 定价保存两次产生 v1、v2，v1 文件内容不变（不可覆盖）；保存新版本不改变当前定价指针（候选不会自动成为当前） | P0 | 通过（marketing-store.test.mjs） |
| S7 | 定价校验：收费模式枚举；非免费模式缺币种 → 字段错误；订阅缺周期 → 字段错误 | P0 | 通过（marketing-store.test.mjs） |
| S8 | 显式设为当前方案成功更新指针；指向不存在版本 → 400 | P0 | 通过（marketing-store.test.mjs） |
| S9 | 同名不同路径两个项目各自保存互不串数据 | P0 | 通过（marketing-store.test.mjs） |
| S10 | profile.json 损坏读取报错（不静默重建）；单个 pricing 版本损坏时该版本标注 corrupt 只读、其余版本与档案照常 | P1 | 通过（marketing-store.test.mjs） |
| H1 | GET /api/marketing/state：未初始化营销 / 未初始化看板均返回 initialized:false 且 200；初始化后返回档案+版本列表+当前指针 | P0 | 通过（marketing-serve.test.mjs） |
| H2 | POST /api/marketing/init → 201 带档案；POST /api/marketing/profile 全链路保存并回读 | P0 | 通过（marketing-serve.test.mjs） |
| H3 | 服务端并发冲突：过期 revision → 409 {conflict:true}，随后用最新 revision 保存成功 | P0 | 通过（marketing-serve.test.mjs） |
| H4 | 服务端校验：非法金额 / 缺币种 / 缺订阅周期 → 400 且响应含 fields 定位字段 | P0 | 通过（marketing-serve.test.mjs） |
| H5 | 服务端定价版本链：保存 v1、v2 → set-current v1 → state.current=v1；再 set-current v2 成功；v1 内容不变 | P0 | 通过（marketing-serve.test.mjs） |
| H6 | 同名不同路径项目经 HTTP API 分别保存互不串数据 | P0 | 通过（marketing-serve.test.mjs） |
| H7 | 静态资源：/marketing.js 可访问；index.html 含营销页签与视图容器 | P1 | 通过（marketing-serve.test.mjs） |
| U1 | 骨架：模块导航「文件」与「设置」之间有「营销」页签；营销视图含四页签，后两页禁用并标注「暂不可用」 | P0 | 通过（marketing-ui.test.mjs） |
| U2 | app.js 契约：VIEWS 含 marketing；setView 切换 #marketingView；刷新快照含 marketing 节；#projectSel 切换前询问 hasUnsaved | P0 | 通过（marketing-ui.test.mjs） |
| U3 | 行为：未初始化渲染「建立营销档案」引导，点击后 POST /api/marketing/init 并进入表单（README 草稿明示来源） | P0 | 通过（marketing-ui.test.mjs） |
| U4 | 行为：编辑表单后 hasUnsaved()=true；保存成功后 false 并展示保存时间；409 冲突后本地草稿保留、重新载入更新 revision 后可再保存 | P0 | 通过（marketing-ui.test.mjs） |
| U5 | 行为：校验失败（非法金额/缺币种/缺订阅周期）字段级错误且表单内容不丢；保存中按钮禁用 | P0 | 通过（marketing-ui.test.mjs） |
| U6 | 行为：选择历史版本只读查看；「设为当前方案」显式 POST；保存新版本不改当前指针 | P0 | 通过（marketing-ui.test.mjs） |
| U7 | 未保存切换项目：确认弹窗提供 保存并切换 / 放弃 / 取消 三选项；取消回弹选择器不切换 | P0 | 通过（marketing-ui.test.mjs） |
| U8 | 样式：.marketing-view 容器样式存在；窄屏媒体查询上下排列；深浅色沿用 CSS 变量 | P1 | 通过（marketing-ui.test.mjs） |
