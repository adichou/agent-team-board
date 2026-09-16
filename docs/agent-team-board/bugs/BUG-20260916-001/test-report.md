# 测试报告 — BUG-20260916-001 发布能力不要复用原来的发布模块，请在构建模块中重新设计。另外设置模块中没有官网仓库目录的设置，请添加

- 时间：2026-09-16T02:23:29.774Z
- 执行者：zcode-dev-build-publish
- 测试框架：node:test（node:assert/strict 自研脚本 + 临时真实 Git 仓库）
- 覆盖率：未统计

## 总结

构建发布全链路独立：新存储 build-publish-store.mjs（全局官网配置+按项目隔离运行BPUB-*）、执行器 build-publish.mjs（五阶段/计划token确认/原子推送/本机回验/Finder注入式打开）、API build-publish-api.mjs+/api/build-publish/*路由；build.js发布页签迁移新API并常驻发布主按钮+发布目录区+Finder按钮；app.js设置新增全局官网仓库区（前往设置/返回发布保上下文）；修复clean误判（untracked折叠）；i18n补10词条；迁移5个回归套件断言。测试5/5通过+npm test全量260文件零失败。引入来源REQ-20260915-002（ae698d5首次把/api/product-release/*接入build.js，详见design.md）

## 明细

（可粘贴命令输出、失败用例说明等）
