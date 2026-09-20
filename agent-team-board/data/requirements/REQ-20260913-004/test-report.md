# 测试报告 — REQ-20260913-004 支持版本删除

- 时间：2026-09-14T00:42:47.336Z
- 执行者：zcode-batch-048-2
- 测试框架：node:test 风格自研断言（assert/strict + vm 假 DOM + http 集成）
- 覆盖率：9%

## 总结

版本删除三层落地：数据层 deleteVersion（整目录移除；merging 抛 BuildConflictError→409；找不到→400；draft/failed/merged 可删）；服务端 POST /api/build/version/delete（POST+JSON 对齐 batch/delete，409/400 透传）；前端卡片第三键「删除」（quiet 弱化、merging 禁用 title、mergeBusy 全局禁用）+ rel-modal 确认弹窗（标题带编号、名称/状态/关联单数、按状态差异化提示、取消/确认删除危险键、执行中禁用防重复）、成功 toast+刷新选中回落空态、失败 toast 版本保留可重试；i18n 补词条。新增 B9a-c/S11/N9a-d 用例先红后绿，npm test 216 文件全过。

## 明细

（可粘贴命令输出、失败用例说明等）
