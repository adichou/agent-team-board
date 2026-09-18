# REQ-20260916-005 如果 main 分支不存在则使用 master 分支，以兼容历史仓库

- 状态：submitted（待人工接受）
- 创建：2026-09-16T03:26:56.496Z

## 描述

### 背景

看板 Git 工作流把 `main` 作为唯一主分支硬编码在多个模块：

- `scripts/lib/git-flow.mjs`：`MAIN_BRANCH = 'main'`；`ensureDevWorkflow`（`atb init` / 设置页「启用 dev 工作流」入口）对非 git 项目 `git init -b main`，收尾 `ensureMainBranch` 在仓库已有提交且 `refs/heads/main` 缺失时于根提交上幂等补建本地 `main`（BUG-20260914-003 口径）。
- `scripts/lib/build-git.mjs` + `scripts/lib/build-store.mjs`：`TARGET_BRANCH = 'main'`；版本「合并入主分支」前置校验 `precheckMerge` 要求 `refs/heads/main` 存在（缺失直接报「main 分支不存在」）；`mergeCommitsIntoMain` 以 `main` 为合并目标；`syncRemote`（与远端同步）把 `main` 列入受控推送跳过名单。
- `scripts/lib/product-release-*.mjs` + `scripts/server.mjs` 发布冻结：冻结/启动/回验均读取 `main` 分支头（缺失报「本地分支缺失：main」），发布时 checkout `main` 并 `push --atomic <remote> main dev`。

对默认分支为 `master` 的历史仓库（`main` 从未存在），当前行为不兼容：

1. `atb init` / 启用 dev 工作流后，`ensureMainBranch` 在根提交上凭空补建一个本地 `main`——用户仓库多出一个与远端（`origin/master`）不对应的分支；后续版本合并、发布又都以这个补建的 `main` 为目标，与用户实际的 `master` 主干脱节。
2. 若 `main` 缺失（如用户手工删除补建分支），版本「合并入主分支」报「main 分支不存在」、发布冻结报「本地分支缺失：main」——主链路全部不可用。

### 需求口径

引入统一的主分支解析规则：**优先 `main`；本地 `main` 不存在而 `master` 存在时，以 `master` 作为主分支**。上述所有以 `main` 为硬前提的操作改为使用解析结果：

- **初始化 / dev 工作流**（`ensureDevWorkflow` / `ensureMainBranch`）：命中回退（仅 `master`）时不补建 `main`，dev 分支照常创建/切换。
- **版本合并**（`precheckMerge` / `mergeCommitsIntoMain` / `TARGET_BRANCH`）：合并目标按解析结果取 `main` 或 `master`。
- **发布流水线**（冻结、主分支头前进校验、checkout、`--atomic` 推送）：主分支名按解析结果取用，冻结 SHA 即解析后主分支的分支头。
- **与远端同步**（`syncRemote`）：受控推送跳过名单与解析出的主分支一致（回退 `master` 场景跳过 `master`）。

### 边界

- 仅以本地分支（`refs/heads/main` / `refs/heads/master`）判定，不读远端；`main` 与 `master` 并存时一律取 `main`（行为与现状一致，无回归）。
- 不重命名用户分支、不切换默认分支、不改远端配置；detached HEAD、非 git 仓库、两者皆不存在（维持现状：新项目 `git init -b main` / `ensureMainBranch` 补建口径）等既有行为不变。
- 官网仓库（homepageRepoRoot，app-homepage-repo）的「必须是具有 main 分支的 Git 仓库」校验不在本单范围（保持 REQ-20260916-004 口径，不回退）。

### 待确认

- 设置页「Git 工作流」分区是否需要展示解析后的主分支名（`branch-state` 增加主分支字段）；若展示则涉及界面文案，须中英同步（BUG-20260912-001）。
- 版本合并与发布流水线是否随本单首批交付，还是先落 Git 工作流/初始化部分——人工在「移入计划」时裁剪，验收标准按完整口径列出。

## 界面布局

界面影响面集中在设置页「Git 工作流」分区（`scripts/web/app.js` 的 `gitWorkflowAreaHtml`，结构保持不变）：

- 分区卡片（`cx-config.git-workflow`）：标题「Git 工作流」→ 工作流描述（dev + 主分支双分支协作说明）→（非 git 仓库时的初始化指引）→ 状态行（`ts-block`）→ 工具栏（「初始化 dev 分支」主按钮 + 就近状态文字 `role="status"`）。
- 状态行现状为两段：「当前分支：〈branch〉 · dev 分支：已存在/未创建」；本单在回退 `master` 场景下描述文案「〈main〉 分支承载版本构建，发布构建物」须随解析结果显示实际主分支名。状态行是否追加「主分支：〈main|master〉」字段见「待确认」，追加时在回退场景一并给出「main 不存在，已回退 master」提示。
- 版本合并、发布流水线、与远端同步的既有界面不动（本单只改其后端主分支解析，无新增页面或控件）。

## 交互行为

- 「初始化 dev 分支」（`/api/git/init-dev`）：点击 → 执行中按钮禁用并显示进行中文案 → 成功后就近反馈结果并刷新状态行；已在 dev 分支时按钮置灰显示「已在 dev 分支」。行为与现状一致，仅内部主分支解析随本单规则变化（回退场景不补建 `main`）。
- 回退 `master` 场景下，后续版本「合并入主分支」、发布等操作指向 `master`，界面各入口的确认与反馈文案中的分支名随之正确显示 `master`（不再出现「合并入 main」指向补建分支的误导）。
- 非 git 仓库：按钮禁用并保留现状指引文案，不出现可点击但必然失败的入口。

## 状态反馈

- **加载中**：进入设置页获取分支状态，分区显示「正在获取 Git 状态…」（`aria-busy`）。
- **加载失败**：显示「Git 状态加载失败：〈原因〉」错误条 + 「重试」按钮，重试成功回到正常态。
- **正常**：状态行如实展示当前分支、dev 分支（及待确认的主分支解析结果）；仅 `master` 场景描述与主分支名显示 `master`。
- **空态（非 git 仓库）**：当前分支显示「—（不是 git 仓库）」+ 初始化指引，操作按钮禁用。
- **初始化执行反馈**：进行中（按钮禁用 + 状态文字）→ 成功（就近提示，状态行刷新为已在 dev）→ 失败（提示原因，可重试，现状口径不变）。

## 界面展示

**可交互演示**：[./ui-demo.html](./ui-demo.html) —— 单文件 html（内联 CSS/JS）、无外网依赖、无构建步骤，浏览器直接打开即可交互。演示以设置页「Git 工作流」分区为载体，通过顶部「演示辅助」控制条切换：

- **行为模式对照**（核心）：「修复前（现状）」vs「修复后（期望）」——历史仓库（仅 `master`）场景下点「初始化 dev 分支」，修复前会在本地分支面板出现凭空补建的 `main`（红色标注，指向根提交）；修复后不补建，主分支解析为 `master`（绿色标注），描述文案与状态行随之正确。
- **仓库场景**：仅 `master`（历史仓库，本单核心场景）/ 仅 `main` / `main`+`master` 并存（main 优先）/ 非 git 仓库（空态）。
- **视图状态**：正常 / 加载中 / 加载失败（含「重试」恢复）。
- **主题**：跟随系统 / 浅色 / 深色切换。

> 演示页为本地模拟（无网络请求），用于评审界面与行为口径；「主分支」字段按「待确认」的可选展示呈现。

## 验收标准

> 按完整交付口径列出；若人工裁剪范围（见「待确认」），以裁剪后范围为准逐条核验。

- [ ] 主分支解析规则统一：优先 `main`，本地 `main` 不存在而 `master` 存在时解析为 `master`；`main` 存在的仓库全部既有行为不变（无回归）。
- [ ] 在仅有 `master` 分支的既有仓库执行 `atb init` 或设置页「启用 dev 工作流」：成功创建/切换 `dev`，且不再凭空补建 `main`（`git branch` 列表不出现新增 `main`）。
- [ ] 仅有 `master` 的仓库执行版本「合并入主分支」：合并目标解析为 `master`，`--no-ff` 合并成功且消息含版本与条目号；`main` 存在的仓库仍合并入 `main`。
- [ ] 仅有 `master` 的仓库走发布流水线：冻结主分支头取 `master` 分支头；发布时 checkout `master` 并以 `--atomic` 推送 `master` 与 `dev`；主分支头前进校验以 `master` 为准。
- [ ] 与远端同步在回退 `master` 场景跳过 `master`（受控推送名单与解析结果一致），`dev` 等其余分支照常推送。
- [ ] 官网仓库的 `main` 分支校验口径不变（不回退 `master`）。
- [ ] 回退 `master` 场景下设置页「Git 工作流」分区描述文案随解析结果正确显示（不再误导性写 main）；如采纳主分支字段展示，加载/空/失败等状态反馈与深浅色下均正常，文案中英同步（BUG-20260912-001）。
- [ ] 主分支解析覆盖三类夹具（仅 `master` / `main`+`master` 并存 / 两者皆无）的测试用例落在 `scripts/tests/`（先红后绿），`npm test` 全量通过。
- [ ] 本单改动按 TDD 流程经 `atb report` 自动收口提交到 dev。

## 关联

- REQ-20260911-009（dev 分支工作流与 `MAIN_BRANCH` 硬编码来源）
- BUG-20260914-003（`ensureMainBranch` 在根提交补建 `main` 的既有口径，本单在回退场景收敛该行为）
- REQ-20260915-002（发布冻结记录 `main` 分支头作为证据）
- REQ-20260916-004（官网仓库 main 校验口径，本单明确不覆盖）
