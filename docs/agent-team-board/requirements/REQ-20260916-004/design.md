# 设计 — REQ-20260916-004 构建发布官网目标适配 app-homepage-repo 新站点架构（Vite + Vue）

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

app-homepage-repo 已重构为 Vite + Vue 站点（产品注册 `src/data/apps.js`、内容源 `content/<产品id>/` 中英成对 md、子路径 base `/app-homepage-repo/`、产物 `dist/`），而 `scripts/lib/build-publish.mjs` 仍按旧架构校验仓库根 `<产品id>/{zh,en}/*.html` 静态页并以其为回验根，BLD-20260914-001 预检「双语材料」必然失败。本单把预检、site-deploy、site-verify 三处迁移到新架构口径，webapp 目标与 validateRepo/全局设置保持不变。

## 现状与目标差异

| 维度 | 旧口径（现状） | 新口径（本单） |
| --- | --- | --- |
| 双语材料预检 | 仓库根 `<产品id>/{zh,en}/index\|usage\|guide\|changelog.html` 八个静态页 | `src/data/apps.js` 注册 + `content/<产品id>/` 中英成对 md |
| 官网产品 id | 项目目录名即仓库根子目录名 | 默认项目目录名；全局设置 `productIds` 可按项目覆盖映射 |
| site-deploy | 仅校验材料目录并记录为部署目录 | 官网仓库 `npm install` + `npm run build`，产物 `dist/` |
| site-verify | 静态服务材料目录，逐页抓 href | 静态服务 `dist/`（base 前缀映射 + SPA fallback），路由双语探测 + 构建产物内容校验 |
| 失败提示 | 笼统「缺少官网中英文 … 页面」 | 逐项列出未注册 / 缺失文件清单 |

## 方案

### build-publish-store.mjs

- 配置新增可选 `productIds`（对象：源码项目目录名 → 官网产品 id）；新增 `saveProductId(projectName, productId)`（校验产品 id 安全字符；空值或等于项目目录名时移除映射项）与 `resolveProductId(config, projectName)`。`saveConfig`/`validateRepo`/revision 语义不变（仅官网仓库根变更递增修订）。
- `steps` 阶段标签改为新语义：`site-deploy`＝官网构建与部署、`site-verify`＝官网本机回验。

### build-publish.mjs

- `contentDir(repoRoot, product)`：语义改为官网仓库内 `content/<产品id>/`，保留安全名校验。
- 新 `siteMaterials(repoRoot, productId, version)`（替代旧 `materials`）：
  - 读 `src/data/apps.js`，校验 `id: '<productId>'` 已注册，未注册计入错误；
  - 必备成对文件：`changelog/v<发行版本>.{zh,en}.md`（版本取发行版本，1.0.0 发行即 `v1.0.0`）、`faq.{zh,en}.md`、`support.{zh,en}.md`；
  - `docs/` 至少一对同 slug 的 `.zh.md`/`.en.md`（如 quick-start）；
  - 缺失项一次性收集进错误信息（「content/<id>/ 缺少：…」），任一错误即抛出；
  - 通过时返回 `{relative, hash}` 列表（进 inputs 指纹，内容变更使旧预检失效）。
- `inputs()`：`homepage={repoRoot,revision,productId,contentDir}`（productId 经 `resolveProductId`）；`materialFiles` 采集失败时把详细错误存入 `materialError`，预检「双语材料」项失败时直接抛出该明细，不再吞成笼统提示。
- `plan()` 第 3 步描述改为官网仓库构建（产物 dist）与本机回验。
- `serve(root, base)`：请求路径先剥离子路径 base（从官网仓库 `vite.config.js` 的 `base:` 解析，缺省 `/`），在 `dist/` 内定位文件（保留越界 realpath 防护）；文件不存在时回退 `dist/index.html`（SPA fallback，history 路由未知路径直达壳页）。
- `site-deploy` 阶段：`validateRepo` → 复跑 `siteMaterials`（部署时点材料仍齐）→ 在官网仓库执行 `npm install`、`npm run build` → 校验 `dist/index.html` 存在 → 记录 `directories.site={path:<repoRoot>/dist,repoRoot,base}`（产物目录 dist，供 Finder 打开与 UI 展示）。
- `site-verify` 阶段 `verifySite(url, productId, version, base)`（站点为 CSR SPA，静态壳不含内容，内容在构建期经 `import.meta.glob` 内联进 assets）：
  - 路由双语可导航：`['','/en'] × [产品页 /apps/<id>、文档 /apps/<id>/docs、更新 /apps/<id>/changelog、FAQ /apps/<id>/faq、支持 /support]` 全部 HTTP 200（语言切换 `LangSwitch` 为客户端按钮、静态 HTML 无 href，故「语言切换可用」以 zh↔/en 镜像路由可达为口径）；
  - 抓壳页 `href/src`：站内链接逐一回验可达（含 assets），`http(s)/mailto/tel` 外链放行；
  - 拼合本地 assets 文本：必须包含 `/content/<id>/changelog/v<版本>.zh.md` 与 `.en.md`（更新页含发行版本且双语成对、非回落）与产品注册串 `id:'<id>'`（产品页可渲染）；
  - 从 assets 提取 `content/<id>/docs/<slug>.zh.md` 的 slug 清单，逐 slug 回验 `/apps/<id>/docs/<slug>` 双语路由。
- webapp 三个阶段（sync-source / webapp-build / webapp-verify）、冻结与原子推送、版本回验逻辑不动。

### build-publish-api.mjs / web/app.js

- `POST /api/build-publish/config` 增加可选 `productId`：按键 `<basename(项目根)>` 写入 `productIds`；`GET` 响应附 `projectProductId`（当前项目解析后的产品 id）供设置页回显。
- 设置页「官网仓库」分区（app.js `homepageSettings`）增加「官网产品 id 映射」输入（留空＝默认项目目录名），提示文案同步新架构。

### 测试迁移（不留双轨）

- `build-publish-20260916-001.test.mjs`：E2E 官网侧由「仓库根双语静态页」夹具迁移为新架构夹具（临时 git 仓库含 `src/data/apps.js`、`content/<id>/` 成对 md、`package.json` build 脚本产出模拟 dist 壳与 assets），`directories.site.path` 断言改为 `dist`；配置/隔离/Finder/防重复断言保留。
- 新增 `build-publish-site-vite-20260916-004.test.mjs`：未注册/缺文件清单/docs 未配对提示、productIds 映射覆盖、config API 映射写入、site-verify 的 SPA fallback 与 changelog 版本校验（构造缺版本产物的 dist 使 site-verify 失败）。

**开源选型（REQ-20260909-015）**：本单不引入新开源库——预检/校验用 Node 内置 fs/http/crypto，官网构建依赖由官网仓库自身 `package.json` 承担（发布执行器只调 `npm install/run build`）；无合适可复用的轻量库能替代「构建产物契约校验」这一私有口径，引入成本高于自研，故不新增依赖，不建 licenses.md。

## 风险与边界

- 站点为纯 CSR SPA，静态回验无法执行 JS：以「路由 200 + 构建产物含内容路径串 + assets 可达」为可执行口径，已在验收标准中与用户对齐（「按站点实际可静态直达的入口校验」）。
- `changelog/v<发行版本>.md` 把需求示例的 `v1.0.0` 泛化为随发行版本走：发行 1.1.0 时须有 `changelog/v1.1.0.{zh,en}.md`，否则预检失败并列出缺失文件——这是「更新页包含发行版本号」可成立的前提。
- 官网仓库工作区分支不做强约束（与现状一致，`validateRepo` 只要求是含 main 分支的仓库根）；构建的是工作区当前检出内容。
- npm 命令沿用共享 `command()`（180s 超时、失败带 stderr 截断），与 webapp-build 同口径。
- 隐私/条款（privacy/terms）按改造要求不列入必备清单（架构支持、站点可选渲染）。
