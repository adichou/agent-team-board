# 设计 — BUG-20260908-017 Bug 单的说明完善如果设计 UI 部分也要提供 UI Demo

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

- 引入来源：REQ-20260908-021（引入「完善阶段 UI 演示」口径——界面展示节 + 条目目录内可交互
  `ui-demo.html` 演示三查，但实现与提示词均只限定 `type === 'requirement'`，bug 分支未同步；
  UI 关键词启发式最早由 REQ-20260908-015 引入，同样仅覆盖需求侧。refine 流程本身由
  REQ-20260907-003 引入，`atb list` 已核验三编号真实存在）

## 根因分析

`scripts/lib/refine-store.mjs` 的 `analyzeItemDocs` 中 UI 相关检查（REQ-20260908-015 的关键词启发式、
REQ-20260908-021 的演示三查）全部写在 `if (type === 'requirement')` 分支内；bug 分支只检查
现象 / 复现 / 期望 / 验收四节。同时 `buildRefinePrompt` / `buildRefineWorkerPrompt` 两处提示词、
`atb refine` 的 REFINE_USAGE 与 next 输出、看板 web 面板描述、SKILL.md 批量完善节的口径均为
「Bug 补现象/复现/期望/验收」，UI 演示口径（REQ-20260908-021）只写「涉及 UI 的需求」。
结果：现象为界面问题的 Bug 在完善批次补成纯文字即可回执 done、被记「已完善」，与
REQ-20260908-021 的意图（完善时的 UI 设计要用 html 可交互展示）不对齐。

## 方案（定案）

1. **共用检查（收敛实现）**：把需求侧的 UI 演示判定抽为 `uiDemoReasons(secs, probeText, dir)`
   助手，需求与 Bug 分支共用，判定分层与缺失原因文案与需求侧完全一致：
   - 启发式：探测文本命中 UI 关键词（复用 `UI_KEYWORDS` 词表，不改词）且无「界面展示」节 →
     `涉及 UI 需界面展示`；
   - 存在性：节存在但剥空行 /「（待补充）」占位后为空 → `界面展示待补充`；
   - 演示三查（节有实质内容且未声明不涉及界面改动时）：缺 `ui-demo.html` →
     `涉及 UI 缺 ui-demo.html 演示`；文件空 / 仅注释占位 → `ui-demo.html 演示待补充`；
     节未链接 → `界面展示节未链接 ./ui-demo.html`；
   - 兜底：节内写明「不涉及界面改动」即视为有效内容，不做三查（启发式误判保护，沿用 015）。
2. **Bug 侧探测文本（定案）**：以 `现象` 节 + `期望行为` 节合并文本为探测源——现象为界面问题、
   或期望行为描述了界面期望，二者任一命中关键词即视为涉及 UI；复现步骤仅描述操作路径，不参与探测，
   降低误报。
3. **Bug README 链接位置与节名（定案）**：与需求侧同构——新增 `## 界面展示` 节，正文链接
   `./ui-demo.html` 并保留文字说明；演示质量门槛复用 `UI_DEMO_QUALITY`（单文件、内联 CSS/JS、
   无外网依赖、无构建步骤、浏览器直接打开可交互）。
4. **演示内容形态（定案）**：提示词层面建议（不做成机器强制）——Bug 演示对照展示「缺陷现象」与
   「期望修复后状态」（如通过状态切换 / 开关对比），便于人工核对。
5. **口径同步**：`buildRefinePrompt` / `buildRefineWorkerPrompt` 两处提示词（Bug 半句后接 UI 口径、
   约束行「涉及 UI 的需求或 Bug 可另建约定的 ui-demo.html」）、`atb refine` REFINE_USAGE 与
   next 输出的 bug target、看板 `scripts/web/app.js` 批量完善面板描述、
   `skills/agent-team-board/SKILL.md` 批量完善节，统一为「涉及 UI 的 Bug 同样须提供 UI Demo」口径
   （插件缓存为指向本项目的符号链接，SKILL/worker-spec 无独立副本需同步；worker-spec 模板本身
   无 refine Bug 表述，无需改动）。
6. **不受影响面**：不涉及 UI 的 Bug 仍只检查四节；`docsFingerprint` 已覆盖 `ui-demo.html`
   （REQ-20260908-021），无需调整；缺失原因仍为展示口径（不过滤候选，REQ-20260908-020），
   bug 侧与需求侧行为保持一致。

## 风险与边界

- **启发式误报**：Bug 现象提到「按钮」等词但实为数据层缺陷时会被要求界面展示——保留
  「不涉及界面改动」兜底声明即可豁免；误报成本为多写一行兜底说明。
- **存量已完善 Bug**：完善三态为执行账本，历史已回执 done 的条目不重算、不回置，口径只影响
  后续领取的缺失原因展示（S10 回归确认冻结快照不重算）。
- **提示词长度**：两处提示词各增加约三行，仍远小于回执 / 核对 2 KiB 限制（提示词本身无该限制，
  check 协议不含提示词全文）。

## 实施记录

- `scripts/lib/refine-store.mjs`：新增 `uiDemoReasons` 助手（原需求侧内联判定迁移并参数化探测文本），
  requirement 分支改为调用（行为不变），bug 分支在四节检查后以 `现象`+`期望行为` 为探测文本调用；
  `buildRefinePrompt` / `buildRefineWorkerPrompt` 的 Bug 口径行与约束行同步。
- `scripts/atb.mjs`：REFINE_USAGE 完善口径段、`refine next` 的 bug target 同步（并加注
  BUG-20260908-017 出处）。
- `scripts/web/app.js`：批量完善面板描述同步。
- `skills/agent-team-board/SKILL.md`：批量完善节同步。
- 测试（`scripts/tests/refine-store.test.mjs`，TDD 先红后绿）：
  - 新增 S13：涉及 UI 的 Bug 全阶梯（无节启发式 / 占位节 / 演示三查 / 链接齐备判完整 /
    期望行为节命中同样触发 / 误判兜底）；
  - 改写 S4：非 UI Bug 四项判定不变、无界面展示原因；缺节 + 关键词时四节缺失与
    「涉及 UI 需界面展示」并存（原「Bug 侧不引入界面展示判定」断言即本 Bug 要修正的行为）；
  - R1 的 `fillBugDocs` 夹具改为非 UI 缺陷（原「按钮」措辞按新口径属 UI Bug，UI Bug 完整形态由 S13 覆盖）；
  - P1 增断言：两处提示词含「涉及 UI 的 Bug」「缺陷现象与期望修复后状态」，约束许可覆盖「需求或 Bug」。
- 验证：`node scripts/tests/refine-store.test.mjs` 全绿；`npm test` 95 个测试文件全部通过；
  临时项目端到端冒烟（UI 关键词 Bug → accept → refine create → refine next）：缺失原因输出
  「涉及 UI 需界面展示」，下一步提示含 Bug 侧 UI 演示口径。
