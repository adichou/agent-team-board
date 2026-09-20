# 测试报告 — REQ-20260918-001 README.md 按最新代码功能优化并支持中英文切换（新增 README.en.md）

- 时间：2026-09-18T20:09:47.060Z
- 执行者：zcode-batch-049-008
- 测试框架：node:assert 契约测试
- 覆盖率：7%

## 总结

README 按已落地能力更新并支持中英文切换：README.md 顶部加语言切换行、目录树补登 README.en.md 与仓库根 index.html 落地页（REQ-20260916-002）；lib 分组表纳入 migrate-layout/plugin-pack（REQ-20260916-007）；关键机制登记官网 Vite+Vue 适配（REQ-20260916-004：apps.js 注册+双语材料预检、site-deploy/site-verify、vite base）；web 表补齐样式与高亮资源；实测日期 2026-09-19、278 测试文件；新增 README.en.md 完整英文对照版（章节一一对应、无 CJK 残留）。契约测试扩 B 组 7 例先红（6 失败）后绿，A1-A6 保持；npm test 278 文件失败 0。

## 明细

（可粘贴命令输出、失败用例说明等）
