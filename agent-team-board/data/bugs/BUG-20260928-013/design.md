# 设计 — BUG-20260928-013 发布流程删除官网 content/ 双语成对内容文件的强制检查

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260916-004（构建发布官网目标适配 app-homepage-repo 新站点架构（Vite + Vue）：定义「src/data/apps.js 注册 + content/<产品id>/ 中英成对 md」双语材料口径，预检缺失项一次性列入错误信息；`scripts/lib/build-publish.mjs` 的 `siteMaterials()` 与 `verifySite()` 据此实施）

## 根因分析

`scripts/lib/build-publish.mjs`：

- `siteMaterials()`（预检「双语材料」项与 site-deploy 阶段复用）无条件要求 `content/<产品id>/` 下存在 `changelog/v<版本>.{zh,en}.md`、`faq.{zh,en}.md`、`support.{zh,en}.md` 与 `docs/` 中英成对文档，缺失即拼入「缺少：…」错误并抛出，发布被阻断。
- `verifySite()`（site-verify 阶段）进一步要求构建产物内联 `/content/<产品id>/changelog/v<版本>.{zh,en}.md` 与 `docs/*.zh.md` 路径串，文件不存在时该回验同样必失败。

该口径是 REQ-20260916-004 按当时官网仓库结构设定的强制约定；本产品官网未按该结构提供这些文件（faq / support / docs 由站点自身承载），约定不再适用，需要按人工决策删除这类文件检查。

## 方案

- `siteMaterials()`：删除 changelog / faq / support / docs 文件的存在性检查与缺失报错；这些文件不再参与材料指纹（materialFiles）收集（文件不读、不 fingerprint）。`src/data/apps.js` 存在性与产品注册检查保留。
- `verifySite()`：删除产物中 changelog 条目路径与 docs 内容路径的内联检查；产品注册信息检查与 zh↔/en 镜像路由可达检查保留（docs slug 相关路由随删除项一并移除，faq / support / changangelog 路由可达保留）。
- 同步更新 `scripts/tests/build-publish-20260916-001.test.mjs`、`scripts/tests/build-publish-site-vite-20260916-004.test.mjs` 等相关用例为新口径（TDD：先改用例跑红，再实现跑绿）。

**开源选型（REQ-20260909-015）**：本单为既有自研代码的检查删除，不引入新依赖，不适用开源选型。

## 风险与边界

- 删除后发布流程不再校验官网双语内容文件的完备性：内容缺失只能由官网站点自身构建 / 人工发现。属于人工决策明确接受的口径（删除检查，而非缺失降级提示）。
- materialFiles 结构变化会影响既有发布 run 的冻结指纹：进行中的发布 run 需重新预检（本仓库当前无进行中发布；如受影响按「重新冻结」处理）。
- 仅删检查，不改官网仓库本身；apps.js 注册与路由可达回验仍生效，官网仓库结构性变更不在本单范围。
