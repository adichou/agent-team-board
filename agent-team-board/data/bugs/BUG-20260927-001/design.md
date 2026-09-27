# 设计 — BUG-20260927-001 项目根目录的README.md 等文档所引用的图片在文档审核通过后也需要一并提交

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260918-002（编号经 `atb list` 核验真实存在）。该需求首建「插件根第一层发布文档」豁免口径（写入侧无锁可改根 README.md、提交侧 pathspec 逐个命中豁免发布文档单文件），口径只覆盖文档单文件本身，未为文档正文引用的本地图片留出提交与写入通道；REQ-20260923-001（同样经 `atb list` 核验）把该口径扩展为四类标准发布文档 + `v.customDocs` 自定义文档，延续了「精确到文档单文件、不含图片」的判定（`pathspecIsExemptRootDoc` → `isPluginRootExemptDoc`），悬空图片引用的缺口由此固化。被引用图片自此只能滞留工作区（`git ls-files image/` 为空）。

## 根因分析

`scripts/state-guard.mjs` 的两条豁免判定都「精确到插件根第一层发布文档单文件名」：

- 提交侧（通道②）：`pathspecIsExemptRootDoc` 要求 pathspec **逐个**是豁免发布文档（`isPluginRootExemptDoc`），`image/README/*.png` 不在豁免清单——pathspec 混入图片整条拒绝，单独提交图片同样拒绝。
- 写入侧：`realpathAncestralHitsPluginRoot` 只豁免 `docs/`、`agent-team-board/` 目录与第一层豁免文档单文件名，`image/` 前缀按源码保护拦截，无锁时替换/新增被引用图片也走不通。

即发布文档获得了「纯文档」待遇，而其正文引用的本地图片资源没有获得同等待遇，两处口径叠加导致图片无法入库、文档渲染破图。

## 方案

**开源选型（REQ-20260909-015）**：无合适开源库——本条目改动为守卫脚本内部的静态文本解析（Markdown/HTML 图片引用正则 + 路径归一，Node 内置能力即可），state-guard 需保持零外部依赖的确定性静态判定，引入 markdown 解析库（marked/remark 等）成本高于自研且无必要。未引入开源库，不创建 licenses.md。

**定夺口径：按既有引用路径静态解析放行**（README「期望行为」三选一中的第 1 种，白名单目录过宽、`v.customDocs` 登记图片清单需要人工维护且同样需静态核验，均不取）：

1. **被引用图片集合**：守卫从插件根第一层豁免发布文档（四类标准 + `v.customDocs` 并集，与既有 `exemptRootDocNames` 同源）的磁盘文件正文静态解析本地图片引用（Markdown `![alt](src "title")` 与 HTML `<img src>`），归一为插件根内相对 posix 路径。仅认相对路径（拒绝 `scheme://`、协议相对 `//`、绝对路径、锚点；percent-decode 后判定）；解析后必须落在插件根内、扩展名在图片白名单（png/jpg/jpeg/gif/webp/svg/avif/ico/bmp/apng）内，且排除受保护源码目录（scripts/commands/skills/hooks/.zcode-plugin/.codex-plugin/assets）与看板目录 `agent-team-board/`，杜绝借「文档引用」把源码/应用数据纳入图片通道。
2. **提交侧（通道②扩展）**：pathspec 逐个判定——豁免发布文档（既有）**或**被引用图片集合成员。两种形态均放行：「文档+图片同一提交」与「图片配套授权提交（仅图片）」（期望行为「同一提交或配套的授权提交」；ui-demo 中「仅图片」按此定夺为放行，因为集合本身即静态可核验）。不可核验形态拦截不变：magic 前缀 / glob 通配 pathspec、无 pathspec 裸提交、`-a`/`--amend`/`-F` 等、主题行不过 `validateCommitSubject`（「类型: 描述 单号」）依旧拦截。
3. **写入侧同步对齐**：`realpathAncestralHitsPluginRoot` 增加被引用图片集合成员豁免（目标已存在与目标不存在（新建）的祖先回溯两种形态都按全路径判定），与发布文档豁免同层级——被引用插图与文档同为纯资源，文档作者更新无需认领锁。保护面不弱化：集合外路径（如当前未被引用的 `image/README/1790092216439_en.png`、`image/` 目录本身、各源码目录）依旧拦截。
4. **语言变体不豁免**：`README_en.md` 等语言变体仍不在豁免之列（既有保守口径不变）；其引用的图片若同时被标准发布文档引用则自然入集合（当前 README_en.md 与 README.md 引用同一张图）。

## 风险与边界

- 集合以工作区文档内容为准（静态可核验的唯一事实源）：文档先提交、图片配套提交的顺序下，文档若已在库内引用该图，工作区文档与库内一致，判定正确；图片先行入库而文档尚未提交时，库内多一张未被引用的图，无害。
- 图片引用写入豁免与发布文档豁免同级，理论上可先在 README.md 写一条引用再向该路径写任意字节；风险与「无锁改写 README.md 本身」等价（发布文档口径既定），受保护源码目录与 `agent-team-board/` 不入集合，源码保护不弱化。
- `image/` 目录本身与集合外文件不受豁免：整目录删除、未引用图片替换仍需认领锁或人工操作。
- magic 前缀 / glob 通配 / 裸提交 / `--amend` 等不可核验形态对图片 pathspec 同样拦截，不因新通道放松。
