# REQ-20260916-004 构建发布官网目标适配 app-homepage-repo 新站点架构（Vite + Vue）

- 状态：submitted（待人工接受）
- 创建：2026-09-16T03:17:52.033Z

## 背景

app-homepage-repo 已于 2026-09-16 重构（见 REQ-20260915-001）：站点实现为 Vite + Vue（myblog 架构），GitHub Pages 子路径部署（vite base `/app-homepage-repo/`，vue-router history 模式），`dist/` 为构建产物。产品注册在 `src/data/apps.js`（追加条目即生成产品页），文档内容源在 `content/<产品id>/`（中英成对 `.md`：`changelog/v<版本>.{zh,en}.md`、`docs/`、`faq.{zh,en}.md`、`support.{zh,en}.md`，另可选 privacy/terms）。

当前 `scripts/lib/build-publish.mjs` 仍按旧架构校验「仓库根 `<产品id>/{zh,en}/index|usage|guide|changelog.html`」静态页并以该目录为官网回验根，与新架构冲突，BLD-20260914-001 发布预检「双语材料」项因此必然失败。

## 改造要求

1. **预检「双语材料」改为新架构口径**：
   - 官网仓库 `src/data/apps.js` 已注册当前产品（产品 id 默认取源码项目目录名，允许设置覆盖映射）；
   - `content/<产品id>/` 下中英内容成对存在：`changelog/v<发行版本>.{zh,en}.md` 必备，`docs/`、`faq`、`support` 成对存在；
   - 校验失败时给出缺什么的具体提示（未注册 / 缺哪个文件，逐项列出）。
2. **site-deploy 阶段**：在官网仓库执行 `npm install` 与 `npm run build`，产物以 `dist/` 为准；不再要求仓库根静态产品页。
3. **site-verify 阶段**：静态服务 `dist/` 并做本机回验。注意 history 路由 + 子路径 base：服务端需将未知路径回退到 `dist/index.html`（SPA fallback）或按站点实际可静态直达的入口校验；校验产品页/文档/更新/FAQ/支持双语可导航、changelog 页包含发行版本号、语言切换可用、站内链接可达（外链 https 放行）。
4. 官网仓库根目录的 git 仓库与 main 分支校验（`validateRepo`）保持不变；全局共享的官网仓库设置不变。
5. 同步更新 `scripts/tests/` 中 build-publish 相关测试（含 build-publish-20260916-001.test.mjs 口径），旧「仓库根双语静态页」相关断言一并迁移，不留双轨。

## 实施备注（开发阶段补充）

- 方案与探索结论见 [design.md](./design.md)，用例与结果见 [test-cases.md](./test-cases.md)。
- 已实现：`siteMaterials` 新口径预检（缺失清单直达）、`productIds` 映射（store/API/设置页）、site-deploy 在官网仓库 `npm install && npm run build` 并记录产物目录 `dist`（含 vite base 解析）、site-verify 以「静态服务 dist + SPA fallback + zh↔/en 镜像路由 + 构建产物内容契约」回验。
- 测试：新增 `scripts/tests/build-publish-site-vite-20260916-004.test.mjs`（12 例），`build-publish-20260916-001.test.mjs` E2E 官网侧迁移至新架构夹具（5 例），全量回归见 test-report。

## 验收标准

- [ ] 在 app-homepage-repo 按新架构补齐 agent-team-board 内容后，BLD-20260914-001 的发布预检「双语材料」通过；site-deploy/site-verify 全绿且能指出产物目录 `dist`。
- [ ] 官网仓库未注册产品或缺中英内容时，预检失败信息明确指出缺失文件清单。
- [ ] 现有 webapp 目标（main/dev 原子推送、冻结构建、版本回验）行为不受影响。
- [ ] build-publish 测试全部迁移到新架构口径并通过，无旧「仓库根双语静态页」双轨断言。
- [ ] 本单改动按 TDD 流程经 `atb report` 自动收口提交到 dev。

## 关联

- 架构来源：REQ-20260915-001（app-homepage-repo 目录架构调整）
- 受影响发布单：BLD-20260914-001（其预检「双语材料」当前必然失败）
- 前序实现：BUG-20260916-001（build-publish 模块与全局官网仓库设置）
