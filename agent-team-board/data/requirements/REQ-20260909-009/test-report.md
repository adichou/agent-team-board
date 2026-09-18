# 测试报告 — REQ-20260909-009 新建条目的描述支持截图

- 时间：2026-09-09T05:29:25.445Z
- 执行者：zcode-batch-021-2
- 测试框架：node:test 风格自研断言（vm 模拟 DOM + HTTP 集成）
- 覆盖率：87%

## 总结

新建需求/Bug 描述支持截图：附件白名单/8MB/防穿越/同名去重口径上收 core（saveItemAttachment/readItemAttachment/parseItemAttachments，张数上限9），createItem 先全量校验再落盘并在 README 描述/现象节末尾按顺序追加 ![截图](attachments/…) 引用；POST /api/new 携带 dataBase64 附件（沿用讨论单形态），新增 GET /api/item/:id/attachment/:name（白名单 MIME+nosniff+收敛 CSP+no-store+8MB）；前端弹窗截图区块（文件选择+⌘V 粘贴自动命名、即时校验、逐张移除、提交中禁用、失败保留），抽屉 README 相对图片 linkupDocImages 接管+点击放大复用 oncallLightbox+加载失败占位；editItem 兼容不丢图片行。新增 3 个测试文件（store S1-S7/serve V1-V4/ui U1-U7）+ drawer-tabs 桩更新，npm test 117 文件全绿

## 明细

（可粘贴命令输出、失败用例说明等）
