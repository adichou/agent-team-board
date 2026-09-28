# 设计 — BUG-20260928-003 发布文档提交流程不携带文档引用的本地图片，AI 翻译与 AI 校对不检查图片语种一致性

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

三个现象分别归因（编号均经 `atb list` 核验存在）：

- 现象 ①（文档提交不携带图片）：**REQ-20260920-003**（构建和发布流程整改——
  `/api/build/docs/commit` → `build-git.commitPublishDocs` 提交范围只由 .md 清单生成）；
  **BUG-20260927-001** 只修复了 Agent 手工提交/写入通道（state-guard），发布流程路径未覆盖。
- 现象 ②（AI 翻译不检查图片语种）：**REQ-20260921-012**（阶段二 AI 翻译提示词，
  `buildDocTranslatePrompt` 约束只覆盖链接互链与链接文本，无图片引用语种约束）。
- 现象 ③（AI 校对不检查图片语种）：**REQ-20260924-001**（AI 校对提示词，
  `buildDocProofreadPrompt` 检查项只覆盖错别字 / 行文规范 / 链接有效性，无图片语种检查）。

## 根因分析

1. `commitPublishDocs`（scripts/lib/build-git.mjs）的 pathspec 仅由语言集展开的 .md
   清单构成，文档正文引用的本地图片（如 `image/README/xxx.png`）既不进 `git add` 也不进
   `git commit` pathspec，发布提交后图片仍为未跟踪状态，仓库内文档悬空引用。
2. AI 翻译 / AI 校对均为提示词派发的子代理行为，提示词未含图片引用语种约束，子代理自然
   不检查、不提示。

## 方案

**开源选型（REQ-20260909-015）**：未引入开源库。图片引用静态解析为约 40 行正则 / 路径
归一纯函数，与 BUG-20260927-001 在 state-guard 的既有同口径实现保持一致，无成熟库需求
（无合适库的原因：逻辑极小且须与既有守卫口径逐条对齐）。

1. **文档提交携带本地图片**（`build-git.commitPublishDocs`）：提交前对**本次提交清单内的
   .md 文档**正文做静态解析，把引用的仓库内本地图片并入 `git add` 与 `git commit`
   pathspec。口径对齐 BUG-20260927-001：
   - 仅相对引用（带 scheme、`//`、`/`、`#` 开头一律不算；`decodeURIComponent` 容错）；
   - 图片扩展名白名单 png/jpe?g/gif/webp/svg/avif/ico/bmp/apng（大小写不敏感）；
   - 解析须落在项目根内（不逃逸）、顶层段不得是受保护源码目录（scripts/commands/skills/
     hooks/.zcode-plugin/.codex-plugin/assets）或 `agent-team-board/`（看板数据）；
   - 仅并入磁盘存在且未被 .gitignore 忽略的文件（`git check-ignore` 过滤，防 add 失败
     阻断整个发布提交）；
   - 返回值新增 `images` 清单；`files` / `hashes` 仍为 .md 文档（`recordDocsCommit` 对
     文件名有发布文档白名单校验，图片不得混入）；noop 判定的 diff 范围含图片（文档无变化
     但图片新增 / 修改时仍产生提交，保证破图入库）。
   - 提交仍为 pathspec 限定形态（`git commit -m … -- …`），不放松任何拦截口径；文档合并
     （cherry-pick 重放）自动携带同提交内图片，无需改动。
2. **AI 翻译图片语种对齐**（`publish-flow.buildDocTranslatePrompt` 翻译约束新增一条）：
   目标语言文档引用的本地图片按语种对齐——基准引用 `<name>.png`（默认语言图）时目标语言
   对应 `<name>_<lang>.png`（`<name>.png` 与 `<name>_en.png` 既有惯例）；翻译前先确认项目
   路径下对应语种图片是否存在，存在则改写引用、不存在则保持基准原引用（不阻塞、不强求）；
   不得虚构图片文件。
3. **AI 校对图片语种提示**（`publish-flow.buildDocProofreadPrompt` 校对约束新增一条）：
   逐一核查文档内本地图片引用的语种一致性——默认语言文档应引用默认语言图片（不带语种后缀），
   引用了其他语种图片（如 `xxx_en.png`）的必须按回执格式以问题形式显式提示（行号 + 引用
   路径 + 期望），交由用户确认处理；只读不改口径不变。

## 风险与边界

- 图片静态解析为正则近似（与 state-guard 同款正则），极端 Markdown 形态可能漏收；漏收的
  图片仍可走 Agent 手工通道（BUG-20260927-001 已放行文档+图片提交），不构成阻塞。
- 语言变体文档（README_en.md 等）虽不在 state-guard 豁免文档集合内，但属于发布提交清单，
  其引用的图片同样并入提交范围（提交范围 = 本次提交文档，比守卫写入侧口径宽是预期行为）。
- .gitignore 忽略的图片不强行 `-f` 入库（尊重用户忽略意图），发布后如破图由用户自查。
- `recordDocsCommit` / 范围指纹（scopeFp）仍只覆盖 .md 文档内容，图片变化不触发范围过期
  （图片无审核语义，超出本单范围）。
