# 测试用例 — REQ-20260916-004 构建发布官网目标适配 app-homepage-repo 新站点架构（Vite + Vue）

> TDD 流程：先在这里列出用例并跑红，再实现代码跑绿。
> 测试框架：node:test 风格自写断言（与既有 `scripts/tests/*.test.mjs` 同风格），`node scripts/tests/run-all.mjs` 全量回归。
> 夹具：临时目录内构造源码 git 仓库（static index.html，webapp 侧不变）与新架构官网 git 仓库
>（`src/data/apps.js`、`content/<id>/` 成对 md、`package.json` + build 脚本产出模拟 dist：壳 index.html 引用 assets，
> assets 内联 `/content/<id>/…` 路径串与 `id:'<id>'` 注册串，对应真实 Vite 构建的产物契约）。

## 预检「双语材料」新口径

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| P1 | 官网仓库已注册产品且 content 成对齐备（changelog/v<版本>.{zh,en}.md、docs 一对、faq、support）→ 预检「双语材料」通过 | 高 | 通过 |
| P2 | `src/data/apps.js` 未注册当前产品 → 预检失败，提示「未注册」并指明产品 id | 高 | 通过 |
| P3 | 缺 `changelog/v<版本>.en.md` 与 `faq.en.md` → 失败信息逐项列出缺失文件清单 | 高 | 通过 |
| P4 | `docs/` 只有单语文件（无同 slug 成对）→ 失败提示 docs 需中英成对（含示例文件名） | 高 | 通过 |
| P5 | 产品 id 默认取项目目录名：目录名与注册 id 不一致且无映射 → 预检失败 | 高 | 通过 |
| P6 | 设置 `productIds` 映射（项目目录名 → 官网 id）后同一仓库预检通过 | 高 | 通过 |
| P7 | 材料内容变更后旧预检指纹失效（materialFiles 进 inputs 指纹） | 中 | 通过 |

## 产品 id 映射设置

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| S1 | `saveProductId` 写入/清除映射并持久化；非法产品 id 被拒绝 | 高 | 通过 |
| S2 | `POST /api/build-publish/config` 带 `productId` 按当前项目写入映射；GET 回显 `projectProductId` | 中 | 通过 |

## site-deploy / site-verify 新架构

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| D1 | 全链路（创建→预检→计划→确认→执行）成功：官网阶段执行 npm install + build，`directories.site.path` 指向官网仓库 `dist`，site 目标 done | 高 | 通过 |
| D2 | dist 产物缺 `index.html` → site-deploy 失败并说明产物缺 index.html | 中 | 通过 |
| V1 | SPA fallback：未知路由（含 base 前缀的产品页/文档/更新/FAQ/支持、`/en` 镜像）经本机服务全部 200；changelog 内容校验发行版本（assets 含 `/content/<id>/changelog/v<版本>.{zh,en}.md`）；站内 assets 链接可达、外链 https 放行 | 高 | 通过 |
| V2 | 构造缺 changelog 版本条目的 dist → site-verify 失败，错误指明 changelog 版本缺失 | 高 | 通过 |
| V3 | dist 的 assets 链接 404 → site-verify 失败（站内链接可达校验生效） | 中 | 通过 |

## 迁移与回归

| # | 用例 | 优先级 | 结果 |
| -- | ---- | ------ | ---- |
| M1 | `build-publish-20260916-001.test.mjs` 官网夹具与断言迁移至新架构（无仓库根双语静态页残留），原有配置验证/运行隔离/Finder/防重复/全局改动失效断言保留并通过 | 高 | 通过 |
| M2 | webapp 目标行为不变：原子推送双分支、冻结构建、版本回验断言在迁移后仍通过 | 高 | 通过 |
| M3 | `scripts/tests/run-all.mjs` 全量回归无新增失败 | 高 | 通过（run-all.mjs 全量回归） |
