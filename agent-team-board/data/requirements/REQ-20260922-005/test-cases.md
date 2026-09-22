# 测试用例 — REQ-20260922-005 AI 总结 LICENSE.md 时，要弹框让用户选择开源协议，提供一个表格罗列主流开源协议的定义，官网网址和优劣

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试文件：`scripts/tests/req-20260922-005.test.mjs`（node:test 风格分层自研断言，与 req-20260922-002 同型）。

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| L1-1 | 协议目录形态：11 项主流协议（宽松→著佐权→公共域排序）；id 唯一且为 SPDX 标识；每项含 name / 官网 url（https）/ 中文 definition / 非空 pros / 非空 cons / copyleft 枚举（none/weak/strong） | 高 | ✅ |
| L1-2 | 标准文本：licenseTextOf 每项非空、以换行结尾、≤2 MiB（save 上限口径）；MIT 文本含 `<year> <copyright holders>` 占位符；未知 id 返回 null；重复读取一致 | 高 | ✅ |
| L1-3 | 目录视图：licenseCatalogView 条目数与顺序同目录、每条含 text 与全部元数据 | 中 | ✅ |
| L3-1 | GET /api/build/doc-licenses：200、licenses 数 = 目录数、MIT 条目 text 与 licenseTextOf 一致、元数据字段齐备 | 高 | ✅ |
| L3-2 | 端到端写入链路：LICENSE.md 未编写 → 以目录 MIT 标准文本 POST /api/build/docs/save → 200 且磁盘内容逐字节一致 → publish-plan 中 LICENSE.md 转 pending → review → reviewed（复用 002 白名单与状态机） | 高 | ✅ |
| L4-1 | renderLicenseModal：标题 / 说明（含「待审核」与占位符提示）/ 表头五列（协议、定义、官网、优势、劣势）/ 行单选 radio + 选中高亮 / 官网链接 target=_blank 且 data-i18n-skip / 协议名与 SPDX 标识 data-i18n-skip / 未选中时确认按钮 disabled /「暂不选择」按钮存在 | 高 | ✅ |
| L4-2 | startSummary 守卫（vm 行为接缝）：LICENSE.md unwritten → 打开弹框（pf.license.open）且不发起 docs-summary/start 请求、触发目录加载；LICENSE.md pending → 不弹框、直接发起 docs-summary/start | 高 | ✅ |
| L4-3 | confirmLicensePick：以选中条目 text POST /api/build/docs/save（file=LICENSE.md）→ 合并 docsFlow → 关闭弹框 → 继续发起 docs-summary/start；skipLicensePick：不写盘直接发起 docs-summary/start；closeLicensePicker：关闭且不发起 | 高 | ✅ |
| L4-4 | 弹框状态反馈：目录加载中（「正在加载协议目录…」）/ 加载失败（错误行 + 重试按钮，「暂不选择」仍可用）/ 写入中（确认按钮「写入中…」禁用） | 中 | ✅ |
| L4-5 | 挂载与绑定源码契约：render() 挂载 renderLicenseModal；bindCommon 绑定行选中 / 确认 / 暂不选择 / 关闭 / 重试；Esc 关闭；行为接缝导出 | 中 | ✅ |
| L6-1 | i18n 中英同步：弹框全部静态词条（标题 / 说明 / 表头 / 著佐权标注 / 按钮 / 加载态）与动态词条（写入成功 / 写入失败 / 目录读取失败 toast）登记 EN / EN_DYNAMIC；目录 11 项 definition / pros / cons 逐句命中 EN 词典；setLang('en') 往返不变形 | 高 | ✅ |
| 回归 | req-20260922-002（LICENSE 口径 B/C/E）、req-20260921-008/012（总结 / 翻译流水线）、i18n 全量与 npm test 全量不回归 | 高 | ✅ |
