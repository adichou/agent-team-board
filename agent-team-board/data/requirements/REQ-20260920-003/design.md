# 设计 — REQ-20260920-003 构建和发布流程整改

> 由 Agent 在 /dev 开发前补充，人可随时批注。（开发实施已按本设计落地）

## 背景

原「构建」模块 = 版本计划（BLD 账本 + `git merge --no-ff` 逐条目合并）+ 分支浏览同步 + 产品发布
（BPUB / PREL 两套运行账本）。本单把模块表达为「发布」五步流程：版本计划 → 关联条目与提交 →
文档编写 → 合并入 main → 正式发布（推送主分支 + 官网同步检测），并解决「只发布所选范围」的
隔离问题（普通 merge 会把未选祖先带入 main）。

## 方案

分层落点（自底向上）：

1. **`scripts/lib/publish-flow.mjs`（新增，纯逻辑）**
   - `versionNumberOf`：计划编号后两段提取版本号（保留前导零）；
   - `publishDocFiles / docFileOf / readmeDocLinks`：八个已确认文档（四类 × zh/en）与 README 互链口径；
   - `buildDocWritingPrompt / buildSiteWritingPrompt`：技术写作角色 + 子代理流程的双提示词（带项目
     路径 / 计划号 / 版本号 / 关联范围 / 文档清单 / 写作约束；官网提示词在官网仓库执行、读已发布
     CHANGELOG/FEATURES、提交消息含完整计划号）；
   - `planIdTokenMatches`：完整计划号 + 标识边界匹配（`BLD-…-0010` 不冒充 `…-001`）；
   - `scanSiteCommitsForPlan`：官网时间窗扫描（提交者时间 ≥ 推送成功时间，含等号；起点缺失 →
     waiting；预算未读完 → scanning（不当未命中）；读完无命中 → missed；命中 → hit 带证据）；
   - `evaluateDocsState`：文档状态机（unwritten / uncommitted / committed / needs-rewrite，逐文件
     磁盘 hash 对提交记录比对，外部 IDE 修改可见）；
   - `publishScopeFingerprint`：条目 + 每条提交 + 八文档内容 hash 的范围指纹（旧提交标识不为新
     范围放行的判据）；`publishStepsState`：五步门禁求值。

2. **`scripts/lib/build-git.mjs`（扩展）**
   - `assertOnDev`：发布前置（合并 / 推送前均检查）——非 dev / detached 一律阻止，提示自行切回
     dev，不自动切分支、不经隔离执行绕过；
   - `analyzePublishIsolation`（只读）：逐条目列出「目标分支外、又不属所选集合」的祖先提交；同一
     commit 关联多条目 → 混合提交 blocked；
   - `mergeIsolatedIntoMain`：临时工作树内逐条目 `git cherry-pick -x` 重放（只带所选提交自身变更，
     不夹带未选祖先；`-x` 保留原始提交溯源）；冲突即 `--abort` 中止并报「隔离合并冲突或依赖未选
     变化」；返回 `replays`（original → replayed）作为证据；已在主分支的提交幂等跳过；
   - `pushMainBranch`：只推解析出的主分支（main 优先、仅 master 回退 master），不推 dev、不强推；
   - `siteMainLog / siteEvidenceReachable`：官网本地主分支提交读取（%cI 提交者时间、不 fetch）与
     证据可达性；
   - `commitPublishDocs`：`git add -- <八文档>` + `git diff --cached --quiet`（无变化 → noop 不空
     提交）+ `git commit -m … -- <八文档>`（pathspec 限定，不夹带业务源码或其他暂存内容）。

3. **`scripts/lib/build-store.mjs`（扩展）**：version.json 新增 `docs`（提交记录：逐文件 hash +
   范围指纹 + commitHash；范围变化 → `scopeStale` + `staleReason`，保留已写内容）与 `release`
   （`pushedAt / pushedSha / pushRemote` 推送起点——同基准重试不重置、基准变化重置官网证据；
   `site` 检测状态持久化）；`assertMergeDocsGate` 合并门禁；`saveMergeReplays` 重放证据落账
   （按 original 去重累积，重试分批不丢证据）。

4. **`scripts/server.mjs`**：新增接口——`GET /api/build/publish-plan`（五步装配：版本号 / 门禁 /
   文档状态 / 双提示词 / 影响分析 / 当前分支 / 发布状态）、`GET|POST /api/build/docs`（读 / 存，
   白名单限定）、`POST /api/build/docs/commit`、`POST /api/build/docs/open-ide`（TRAE CN / TRAE，
   未安装给手动路径）、`POST /api/build/release/push`、`POST /api/build/release/site-scan`
   （60 秒间隔 + force 立即检测；未配置 / 读取失败显示失败及原因；命中证据失效退回等待）。
   `/api/build/version/merge` 改为：assertOnDev → 文档门禁 → release 互斥 → 混合提交阻止 →
   隔离合并（重试只补未合并条目）→ replays 落账。

5. **发布检验适配重放证据**：`build-publish.mjs`（BPUB）与 `product-release-*`（PREL）的包含性
   检验认可「原始提交为祖先」或「记录的重放提交为祖先」；额外提交归集同时剔除重放提交
   （PREL 冻结快照新增 `frozen.replays`）。

6. **前端**：顶栏「构建」→「发布」；右侧详情改五步导航（`data-step`）：1 版本计划（信息编辑）、
   2 关联条目与提交（原关联列表）、3 文档编写（AI 写作提示词 + TRAE 入口 + 文档 / 语言选择 +
   编辑 / 预览 + 保存 + 提交文档到 Git + 状态与过期原因）、4 合并入 main（范围 + 隔离分析 +
   dev 前置提示 + 合并）、5 正式发布（推送主分支 → 官网 AI 写作提示词 → 同步检测：60 秒轮询 +
   立即检测，离开发布步 / 切版本 / 切页签 / 切项目即停止；常驻提示「每分钟检查官网本地主分支；
   匹配仅表示本地提交已同步，不代表已推送或网站已部署」）；产品发布记录（BUG-20260915-014）
   并入第 5 步下方；左列表卡片显示计划号 + 版本号 + 阶段。i18n 中英文同步（含新词条与更名）。

### 关键取舍

- **隔离方式选 cherry-pick 重放**（README 留白）：普通 merge 语义上必带祖先；cherry-pick 只重放
  所选提交自身 diff，满足「A 不随 B 入 main」。代价是原始 hash 不在 main——以 `merge.replays`
  证据链适配所有下游包含性检验（BPUB / PREL 均已改）。依赖未选变化时 cherry-pick 冲突即中止，
  对应验收「B 依赖 A … 明确阻止并列出原因」。
- **文档基准用内容 sha256**（`publishScopeFingerprint`）：条目 / 提交 / 文档内容任一变化都改变
  指纹，配合提交时点快照实现「旧快照不为新范围放行」；外部 IDE 修改由磁盘 hash 对记录比对暴露。
- **官网检测只读本地主分支**（人工确认口径）：不 fetch；窗口 = 提交者时间 ≥ pushedAt（含等号，
  用 %cI 降低变基旧作者日期漏检）；预算 200 条 / 轮，读不完 → scanning 不伪报未命中；起点缺失
  显示「缺少推送完成时间，待核对」，不用猜测值、不做全历史兜底。

**开源选型（REQ-20260909-015）**：自研——仅用 Node 内建（node:fs / node:child_process /
node:crypto）与既有依赖，无新增第三方库；无合适库的原因：核心为 git 流程编排与本仓库账本语义
耦合，成熟库（如 simple-git）仅封装 CLI 不解决隔离 / 证据 / 门禁语义，引入成本高于自研。

## 风险与边界

- cherry-pick 重放后 main 上 hash 与 dev 不同：已在合并结果与发布检验两侧留证据；后续如需
  「patch-id 等价」强化，可在 replays 上追加（当前未实现，不在本单验收内）。
- 时间窗依赖本机与提交时间正确：界面提供扫描起点 / 实际分支 / 未命中排查提示，不自动扩大范围。
- dev 前置对「只有 main 的仓库」是行为收紧（人工确认口径）；存量 BLD 计划无 docs 记录 → 合并
  被门禁拦截，需按五步流程补文档后合并（有意为之：文档完成是合并前置）。
