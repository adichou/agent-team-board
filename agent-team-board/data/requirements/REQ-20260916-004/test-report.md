# 测试报告 — REQ-20260916-004 构建发布官网目标适配 app-homepage-repo 新站点架构（Vite + Vue）

- 时间：2026-09-16T04:04:07.859Z
- 执行者：zcode-site-vite-adapt
- 测试框架：node:assert 契约测试（scripts/tests，run-all 全量 261 文件）
- 覆盖率：未统计

## 总结

构建发布官网目标适配 app-homepage-repo 新站点架构（Vite + Vue）：①预检「双语材料」改为 src/data/apps.js 注册 + content/<产品id>/ 中英成对校验（changelog/v<发行版本>.{zh,en}.md 必备、docs 一对、faq、support），失败逐项列出未注册/缺失文件清单，materialError 随 inputs 指纹；②产品 id 默认取项目目录名，新增 productIds 覆盖映射（store.saveProductId/resolveProductId、/api/build-publish/config、设置页映射输入，新文案入 i18n 词典）；③site-deploy 在官网仓库执行 npm install + npm run build，产物目录记录 dist 并解析 vite base；④site-verify 静态服务 dist + SPA fallback（history 路由），zh↔/en 镜像路由可达（语言切换为客户端按钮的口径）+ 构建产物内容契约（changelog 双语含发行版本、产品注册串、docs slug 路由）+ 站内链接可达、外链 https 放行；⑤validateRepo 与 webapp 目标（原子推送/冻结构建/版本回验）行为不变。TDD：新增 build-publish-site-vite-20260916-004.test.mjs 12 例先红后绿；build-publish-20260916-001.test.mjs E2E 官网侧迁移新架构夹具（旧仓库根双语静态页断言无残留，5 例过）；run-all 全量 261 文件通过（唯一失败 i18n-coverage 已修复）。对真实 app-homepage-repo 只读抽查：agent-team-board（v1.0.0）材料齐备、预检可通过，base 解析为 /app-homepage-repo/。

## 明细

（可粘贴命令输出、失败用例说明等）
