# 设计与实施记录

## 方案总览（实施记录）

在既有构建（BLD）与发布（REL）模块之上新增**产品发布（PREL）**子模块：从已合并的版本计划一键生成
发布草稿并冻结，两个必备目标（Web App / 官网与文档）独立建模、独立回验；源码 main/dev 双分支
原子推送是必经前置步骤。开源选型：本期全部自研——只调用本机 `git` 与 Node 内建
`http`/`crypto`/`child_process`，无合适且必要的第三方库（引入 npm 依赖反而增加私有源码仓库的
安装面），不复制任何开源库源码。

### 新增文件

| 文件 | 职责 |
| --- | --- |
| `scripts/lib/product-release-store.mjs` | PREL 数据层：从 BLD 创建/冻结、预检结果与指纹、目标卡、互斥/幂等、重试/取消、恢复中断（纯数据，不碰 git/网络） |
| `scripts/lib/product-release-git.mjs` | 源码仓库 git 执行层（exec 注入）：远端解析、双分支头读取、条目包含性核验、额外提交归集、切 main 校验 HEAD、`--atomic` 双分支推送、远端 SHA 核验 |
| `scripts/lib/webapp-profile.mjs` | 冻结源码框架/构建/部署自动识别（package.json + 脚本 + 框架配置），产物目录、本机端口分配、版本探测规则；识别失败给诊断 |
| `scripts/lib/site-lang.mjs` | 官网语言选择：浏览器语言优先级（zh* → 中文，en* → 英文）、手动偏好、`auto` 跟随浏览器、无匹配回退英文 |
| `scripts/lib/site-materials.mjs` | 官网中英文材料清单（必备页面 × 双语）、完整性检查（缺失清单）、内容指纹 |
| `scripts/lib/product-release-pipeline.mjs` | 六阶段流水线执行器：sync-source → webapp-build → webapp-verify → site-materials → site-deploy → site-verify |

### 修改文件

- `scripts/lib/build-store.mjs`：`finishMerge` 增加可选 `mainSha` 入参落 `v.merge.mainSha`（新计划
  保存合并结果 main 头；旧计划无此字段时按 README 走「候选 + 额外提交」口径）。
- `scripts/lib/release-store.mjs`：`readModuleConfig` 透出/保存 `homepageRepoRoot`（官网仓库根目录
  一次配置，保存在发布模块 config.json，不硬编码目录）。
- `scripts/server.mjs`：新增 `/api/product-release/*` 路由（注册在 `/api/release` 之前，防前缀误吞）。
- `scripts/web/build.js`：merged 版本详情新增「创建发布 / 查看发布记录」（未合并禁用并说明前置条件）。
- `scripts/web/release.js`：发布模块新增「产品发布」二级页签：左 PREL 运行列表 / 右详情
  （冻结头 + Web App / 官网与文档两目标卡 + 概览/材料与差异/日志与证据/发布链接页签 +
  预检/预览发布计划/启动/重试/取消），官网根目录未配置空态引导设置。
- `scripts/web/index.html` / `scripts/web/app.js`：产品页签容器与激活接线。

## PREL 运行模型

```jsonc
{
  "id": "PREL-YYYYMMDD-NNN", "schemaVersion": 1,
  "productId": "<项目名>", "bldId": "BLD-…", "bldName": "…",
  "versionName": "<显示名，来自 BLD>", "version": "<发行版本号，用户核对>",
  "status": "draft|prechecking|running|waiting-manual|succeeded|failed|canceled",
  "frozen": {
    "version": "…", "mainSha": "…", "devSha": "…",
    "remote": "origin", "remoteUrl": "<脱敏>",
    "items": [{ "itemId": "REQ-…", "title": "…", "commit": "…" }],
    "extraCommits": [{ "hash": "…", "subject": "…", "author": "…", "date": "…" }],
    "homepage": { "repoRoot": "…", "branch": "main", "contentDir": "<repoRoot>/<项目名>/" }
  },
  "stages": [/* 六阶段，键见上 */],
  "targets": { "webapp": { "status": "…", "localUrl": "…" }, "site": { … } },
  "precheck": { "ranAt": "…", "ok": true, "checks": [{ "key": "…", "label": "…", "ok": true, "detail": "…" }], "fingerprint": "…" },
  "webappProfile": { /* 识别结果或诊断 */ },
  "evidence": [], "history": []
}
```

- 事实源 `<dataDir>/releases/product-runs/PREL-…/run.json` + `logs/*.log`（复用 REL 脱敏口径）。
- **整体完成判定**：`sync-source` done 且 webapp、site 两目标全部 done 才 `succeeded`；
  部分成功保持 `failed` 并保留各目标真实状态（Web App 已发布 / 官网已上线分开显示）。
- **互斥与幂等**：同产品存在活动运行（prechecking/running/waiting-manual）禁止创建（409 指向
  活动运行）；同 product+version 已有成功运行再创建 → 409 提示查看既有记录（幂等，不重复发版）。
- **取消/重试**：取消只把 pending/running 阶段置 canceled，已上线目标保留；重试从首个失败阶段
  接续，只补未完成操作（sync-source 重试先查询远端实际 ref）。
- **服务重启**：running/prechecking 标记 interrupted 可重试（复用 REL recoverInterrupted 口径，
  独立实现于 product-release-store.recoverInterrupted）。

## 冻结与预检失效

- 创建草稿即冻结：发行版本号、main/dev 分支头 SHA、远端（自动解析：`origin` 优先 → 唯一远端 →
  多远端无 origin 视为歧义阻塞）、条目快照（含每个 commit `merge-base --is-ancestor` 于 main 的
  核验）、额外提交（main 上不在任何计划条目 commit 祖先内、且非本 BLD `build: … 合并 …（BLD-…）`
  合并提交的提交，逐条带 hash/subject/author/date，不隐去合并带入的额外变更）、官网仓库/分支/
  内容子目录。
- `frozenInputFingerprint(dataDir, run)`：对 version/mainSha/devSha/remote/homepage 配置/材料指纹
  做 sha256；预检通过时落 `precheck.fingerprint`。启动（start）时重算比对：不一致 → 400
  `precheck-stale`，列出变化项（版本号 / main 前进 / dev 前进 / 远端变化 / 官网配置变化 /
  材料变化），要求重新预检；main 前进提供「重新冻结」（refreeze 用当前 main 头重新走冻结 +
  extraCommits 展示，不把旧 SHA 冒充当前 main）。
- 预检项（全部只读，不推送不上传不部署）：产品映射/项目名安全子目录校验、远端解析与可达
  （ls-remote + `push --dry-run --atomic main dev`）、双本地分支存在、工作区干净（看板数据目录
  除外，同 REL 口径）、官网配置有效（目录存在/git 仓库/目标分支有效/内容路径位于仓库内）、
  材料双语完整性、Web App 识别成功、版本冲突（同 product+version 无既有成功运行）。
- 项目名安全子目录：仅 `[A-Za-z0-9._-]+` 且不允许 `..`/绝对路径（README「项目名必须校验为安全
  子目录」）。

## sync-source（必经前置）

1. 工作区干净（不自动 add/commit/stash/丢弃）；main/dev 本地分支存在；main 未被其他 worktree
   占用（占用即阻塞说明，不强切）。
2. `git checkout main` → `rev-parse HEAD` 必须 === frozen.mainSha，否则 `plan-stale`（main 已前进，
   需重新冻结）。
3. 一次 `git push --atomic <remote> main dev`（远端不支持 atomic / 任一分支被拒 → 阻塞，不强推、
   不回退为可能仅成功一个分支的两次推送）。
4. `ls-remote` 核验远端 main/dev 均等于冻结 SHA；推送超时先查询远端再判定，不盲目重推；
   双分支一致才继续后续构建部署；执行后源码工作目录保持在 main。

## Web App 构建与本机部署

- 识别（webapp-profile）：优先 package.json——devDependencies/dependencies 含 vite/next/astro/
  nuxt/@vue/cli/react-scripts/svelte 等 → 框架判定 + `npm run build`（scripts.build 缺失时按框架
  缺省）；产物目录按框架缺省（vite→dist、next→.next、astro→dist、react-scripts→build 等），
  有框架配置文件时读取覆盖；无 package.json 但根有 index.html → 静态直服（无构建步骤，不强制
  `npm run build`/`dist/`）；两者皆无 → `detected:false` + 诊断（不猜执行、不转交用户手填）。
- 构建：临时 worktree 检出 frozen.mainSha（隔离目录，不碰用户工作区）执行安装+构建；静态直服
  项目跳过构建。记录实际版本（package.json version 或无）、源码 SHA、产物摘要（文件数+字节）。
- 部署回验：本机 127.0.0.1 自动分配空闲端口起内置静态服务，`GET /` 200 且命中版本标记
  （页面含版本号或 `<meta name="app-version">`）；失败记录真实日志，不伪报成功。

## 官网与文档（必备目标）

- 配置：官网仓库根目录存发布模块 config（设置一次，创建时自动带入、冻结时记录实际目标；
  变更使旧预检失效）。内容子目录 = `<官网仓库根>/<项目名>/`，目标分支默认 `main`。
- 材料必备页（双语 zh/en）：index（产品信息）、usage（访问/使用方式）、guide（指南/FAQ）、
  changelog（更新日志）+ 截图说明随页面携带；语言文件布局 `<contentDir>/zh/<page>.html` 与
  `<contentDir>/en/<page>.html`。缺任一必备译文 → 预检/材料阶段列出缺失页并阻塞；指纹变化使
  旧预检失效。
- 语言选择（site-lang）：默认按浏览器语言优先级匹配（`zh*` → zh，`en*` → en），无匹配回退 en；
  手动偏好（localStorage 语义，由生成页面承载）优先，「跟随浏览器」恢复 auto；存储不可用时
  切换仍当页生效。管线只核验两种语言页面/链接/切换入口存在与版本一致。
- 部署回验：官网仓库按同一识别器判定构建方式（无构建 → 直接服务内容目录）；分别回验 zh/en
  首页 200 + 版本标识 + Web App 入口链接存在；两语言均通过才标记官网目标完成；允许先上准备
  页，但新版 Web App 入口须在 Web App 回验成功后启用（材料一致性由指纹保证）。

## 结果核验与发布记录

- 详情分开显示「Web App 已发布」「官网已上线」；推送核验结果（远端 main/dev SHA）、产物摘要、
  端口/本机链接、执行日志、部署运行标识全部落 run.json（私有记录完整信息）；导出仅允许字段。
- 证据（evidence）与阶段日志复用 REL scrubSecrets 脱敏；私有仓库路径不进公开报告。

## 接口（/api/product-release/*，注册先于 /api/release）

```
GET  /state                          配置 + 运行列表 + 环境（isRepo/remotes/双分支/homepageConfigured）
POST /config                         保存官网仓库根目录（校验存在/是仓库/含 main 分支）
POST /from-build                     { bldId, version, versionName? } 从 merged BLD 创建+冻结（否则 400）
POST /run/:id/refreeze               main 前进后按当前 main 重新冻结
POST /run/:id/precheck               只读预检并落指纹
GET  /run/:id                        详情 + 日志
GET  /run/:id/plan                   计划预览（冻结输入 + 将更新仓库/分支 + 材料差异 + 本机环境）
POST /run/:id/start                  预检新鲜才启动（异步推进）
POST /run/:id/retry | /run/:id/cancel
```

## UI

- build.js：版本详情 merged 时 `[创建发布] [查看发布记录]`；创建弹层仅需核对发行版本号（预填），
  自动带入 BLD 信息；未 merged 禁用 + title 说明前置条件。
- release.js：模块内二级页签「发布流水线 | 产品发布」。产品页签左列表（产品/版本/来源 BLD/整体
  状态）右详情：冻结 SHA 与条目范围（额外提交醒目提示）→ 两目标卡 → 四页签（概览/材料与差异/
  日志与证据/发布链接）→ 操作区（预检 / 预览发布计划 / 启动 / 重试 / 取消后续）；预览计划弹层
  集中展示源码切 main、一起推送的 main/dev SHA 与远端、将更新的仓库/分支、产物与本机入口，
  启动即授权所展示计划；变更范围后启动被 stale 阻塞。官网根目录未配置 → 空态「前往设置」，
  保存后返回继续（草稿保留）。

## 边界与不做

- 不自动提交/暂存/丢弃未提交改动；不 force push；不改变仓库可见性；不推官网仓库（官网目标只
  在配置仓库内本机构建部署回验，不向其远端推送）。
- 不自动合并 dev 到 main；不从 dev 构建（构建只读冻结 main 源码）。
- 发布不改变关联 REQ/BUG 人工验收状态；来源 BLD 删除/改名不破坏发布快照（悬空时说明来源已删除）。
- 暂不扩展独立 Git 发布渠道、标签/Release、Electron/Apple 渠道（既有执行器不动）。
- 私有运营资料、博客、社区推广不在目标内。

## 实施过程记录

- finishMerge 记录 mainSha：`POST /api/build/version/merge` 在合并成功后 `rev-parse main` 回填
  （build-store 向后兼容：旧 version.json 无 merge.mainSha 字段按旧口径处理；其后
  REQ-20260914-007 管理记录提交可能再推进 main，merge.mainSha 为合并完成时刻值）。
- 测试见 test-cases.md，全部为可执行断言文件（scripts/tests/product-release-*、webapp-profile、
  site-lang、site-materials），真实临时 git 仓库 + bare 远端 + 静态 fixture 演练，
  不以文档生成代替上线验证；真实上线证据与测试演练分开（本单只交付演练证据，真实发布须人工
  按具体计划授权执行）。
- 实施中发现既有缺陷并已按规范登记：**BUG-20260915-013**（REL release-git local-precheck 对
  `git status --porcelain` 整段 stdout trim，首行「 M path」前导空格丢失导致看板目录内已跟踪
  修改被误判为脏而错误阻塞）。产品发布侧（product-release-git worktreeDirtyFiles）已按行解析
  规避，REL 侧修复留给该 Bug 单。
- 关键口径落定：core.initData 会把工作区切到 dev（REQ-20260911-009 工作流），产品发布执行时由
  sync-source 显式切回 main 并核对 HEAD —— 与「发布执行后源码工作目录保持在 main」一致；
  测试 fixture 均按真实工作流（dev 上开发、main 冻结发布）搭建。
- 材料口径：官网中英文材料是用户在官网仓库内容目录内准备的可编辑草稿，系统按清单核验完整性
  与指纹、缺失即阻塞并列出缺失页；系统不代写页面内容、不伪造材料（README「待确认」中的截图
  清单规则同样按「草稿标明待补材料，不生成虚假截图」处理）。
- 全量回归：`npm test` 257 个测试文件全部通过（含本单新增 8 个：store 10 用例、git 7、
  pipeline 5、serve 2 场景、ui 5、profile 4、lang 3、materials 4，共 40 项断言用例）。
