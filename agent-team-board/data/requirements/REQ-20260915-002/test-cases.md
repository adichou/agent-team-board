# 验证用例

对应 README 验收标准逐项落为可执行用例（node 脚本，npm test 自动聚合）。文件命名
`scripts/tests/product-release-*.test.mjs` 及配套 `webapp-profile` / `site-lang` /
`site-materials` 用例。全部使用临时 git 仓库 + bare 远端 + 静态 fixture 演练，不访问外网。

## A. 数据层 product-release-store（product-release-store.test.mjs）

- A1 从 merged BLD 创建：冻结记录 version/mainSha/devSha/远端/条目快照/官网目标；versionName 与
  version 分开；状态 draft；历史含 create。
- A2 未 merged（draft/merging/failed）创建 → AtbError，文案含前置条件。
- A3 同产品活动运行（prechecking/running/waiting-manual）再创建 → 冲突（含活动运行 ID）；
  同 product+version 已成功 → 幂等拒绝（指向既有运行）；不同 version 可再创建。
- A4 预检指纹：`frozenInputFingerprint` 覆盖 version/mainSha/devSha/remote/homepage/材料指纹；
  任一变化 → `assertPrecheckFresh` 抛 stale 并列出变化项；无预检记录 → 启动被拒。
- A5 取消：pending/running 阶段置 canceled、已 done 阶段与证据保留；整体 canceled 不误标成功。
- A6 重试：首个失败阶段及其后回 pending，已 done 阶段不动。
- A7 部分成功判定：webapp 目标 done、site 失败 → run.status=failed 且 targets 各自真实状态；
  两目标 + sync-source 全 done → succeeded。
- A8 服务重启恢复：running/prechecking 阶段标 interrupted 可重试。
- A9 来源 BLD 改名/删除：快照字段仍完整（bldName 保留冻结值），列表展示不依赖 BLD 存在。

## B. Git 执行层 product-release-git（product-release-git.test.mjs，真实临时仓库）

- B1 远端解析：origin 优先；无 origin 但唯一远端 → 唯一；多远端无 origin → 歧义报错列候选；
  无远端 → 报错。
- B2 条目包含性：每个计划条目 commit 是 main 祖先 → ok；有 commit 不在 main → 报错含条目号。
- B3 额外提交：main 上计划外直接提交与基线提交计入 extraCommits（含 hash/subject/author/date）；
  本 BLD 的 `build: …（BLD-…）` 合并提交不计入；他 BLD 合并提交计入。
- B4 切 main 校验：HEAD 等于冻结 SHA 才继续；main 前进 → stale 报错（不冒充、不自动改冻结）。
- B5 脏工作区 / dev 缺失 / main 被其他 worktree 占用 → 明确报错；不自动暂存/丢弃/强切。
- B6 原子推送：`push --atomic origin main dev` 后 bare 远端两分支 SHA === 冻结值；
  `verifyRemoteBranches` 核验一致；单分支不一致 → 报错不算完成。
- B7 非快进（远端 main 领先）→ 推送被拒报错，不 force，不回退成两次推送。

## C. Web App 自动识别 webapp-profile（webapp-profile.test.mjs）

- C1 vite 项目（package.json devDep vite + scripts.build）→ build 命令、产物 dist、需安装。
- C2 纯静态（根 index.html，无 package.json）→ 无构建步骤、直接服务根目录。
- C3 什么都缺 → detected:false + 诊断原因；不猜命令。
- C4 端口分配：返回可监听的空闲端口。

## D. 官网语言 site-lang（site-lang.test.mjs）

- D1 zh-CN/zh-TW/zh → zh；en-US/en-GB → en；ja/空/不可读 → 回退 en。
- D2 多语言优先级按序取第一个命中（['ja','zh-CN','en'] → zh）。
- D3 手动偏好 zh/en 优先于浏览器；'auto' 跟随浏览器。

## E. 官网材料 site-materials（site-materials.test.mjs）

- E1 双语必备页齐备 → 通过，指纹稳定（内容不变指纹不变）。
- E2 缺英文某页 → 列出缺失清单（语言+页面），不通过。
- E3 内容变化 → 指纹变化（旧预检失效口径）。
- E4 项目名子目录校验：含 `..`/路径分隔/空白 → 拒绝；正常项目名 → `<repo>/<项目名>/`。

## F. 流水线 product-release-pipeline（product-release-pipeline.test.mjs，临时仓库+静态 fixture）

- F1 全链路成功：merged BLD → 冻结 → 预检 → 启动 → sync-source 推送 bare 远端（main/dev 均等于
  冻结 SHA）→ Web App 静态构建/部署回验（本机 URL 200+版本）→ 官网双语材料部署回验 →
  run succeeded，targets 两卡 done，工作目录保持在 main。
- F2 官网缺英文材料 → site 阶段失败：run failed，webapp 目标保留 done（部分上线真实状态），
  补齐材料后 retry 只跑官网相关阶段 → succeeded。
- F3 main 在冻结后前进 → start 阻塞（stale 列变化项）；refreeze 后可启动。
- F4 取消后续阶段：已上线 webapp 保留，未执行阶段 canceled，不误报整体完成。
- F5 构建基于冻结 SHA：冻结后 dev 新提交不影响构建源码（产物来自 main SHA 的 worktree）。

## G. 服务接口 product-release-serve（product-release-serve.test.mjs）

- G1 /state 两态（未初始化 initialized:false）。
- G2 /config：无效路径/非 git 仓库/无 main 分支 → 400；合法路径保存后 /state 可见，旧预检失效。
- G3 /from-build：未合并 400 + 原因；合并成功创建 PREL（frozen 完整）。
- G4 /start 未预检或预检失效 → 400（stale 指明变化项）；预检通过后可启动。
- G5 /cancel 幂等；/retry 仅失败运行。
- G6 跨项目隔离：A 项目看不到 B 项目的 PREL。

## H. 前端契约与行为 product-release-ui（product-release-ui.test.mjs）

- H1 build.js：merged 版本详情渲染「创建发布」「查看发布记录」；未 merged 禁用并说明前置条件。
- H2 release.js：产品发布页签、两必备目标卡（Web App / 官网与文档）、冻结 SHA 与额外提交提示、
  操作按钮按状态渲染。
- H3 官网根目录未配置空态「前往设置」，保存后返回继续。
- H4 ui-demo.html 单文件可交互演示链接存在（README 界面展示节）。

## I. 构建模块联动（build-store.test.mjs 增补）

- I1 finishMerge 带 mainSha → v.merge.mainSha 落盘；不传保持兼容（null）。
- I2 /api/build/version/merge 合并成功后 version.json 含 merge.mainSha（真实 rev-parse 值）。

## 结果记录

实施阶段在 test-report.md 汇总真实执行结果（命令 + 覆盖数），演练证据与真实上线证据分开表述。
