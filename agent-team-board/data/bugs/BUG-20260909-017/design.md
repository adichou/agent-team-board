# 设计 — BUG-20260909-017 批量完善的提示词中依然含有子代理模型配置的相关内容表述，应和批量开发一样保持一致。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 引入来源（源单）

本 Bug 由哪个需求 / Bug 引入？登记时可暂空或写「未定位」，修复阶段必须归因（三选一，禁止编造）：

- 引入来源：REQ-20260908-020（编号已经 `atb list` 核验存在）。
  排查过程：`子代理模型配置：…（来自设置「批量任务」，启动子代理时按此传递）。`固定提示词行
  由 REQ-20260908-020 的「任务类型 × Agent」四路子代理模型配置引入（生成处
  `scripts/lib/refine-store.mjs` buildRefinePrompt、`scripts/lib/batch.mjs` generatePrompt）。
  REQ-20260909-005 将默认口径改为「跟随主调度会话」但保留 manual 兼容分支，
  REQ-20260909-011 移除按 Agent 模型配置设置并将全部创建入口固定 `modelSource:'follow'`，
  两步均未清理：① 该时期之前创建的完善批次账本（RFB-20260908-008、010–015、
  RFB-20260909-016–022 共 14 个）冻结的 prompt 仍含旧行，且经面板提示词块 /「重新复制」/
  `refine create` 幂等回显持续透出；② 生成层 manual / 直传 model/level 兼容分支仍可再生成旧行。
  （REQ-20260909-005 / REQ-20260909-011 编号均已 `atb list` 核验存在。）

## 根因分析

1. **账本冻结 + 展示层原样透传**：完善批次创建时把当时生成的 prompt 整体冻结进
   `docs/agent-team-board/refine/batches/<批次>/batch.json`；面板数据链路
   `refineBatchPublicView`（refine-store.mjs）将 `b.prompt` 原样返回
   （/api/refine/current → `#refinePrompt` 提示词块与 `#refineRecopy` 复制源），
   CLI / 服务端 `refine create` 幂等返回在途批次时同样原样回显 `b.prompt`
   （atb.mjs refine create 分支、server.mjs /api/refine/create）。
   REQ-20260909-005/011 只改了「新建」口径，未处理「存量冻结文本」的展示。
2. **生成层残留兼容分支**：`buildRefinePrompt` / `generatePrompt` 仍保留
   `modelSource='manual'` 或直传 `model`/`level` 时生成同款旧行的三元分支
   （refine-store.mjs 约 364–368 行、batch.mjs 约 479–483 行）。当前创建入口已固定
   follow 不触发，但该文案指向的「设置 → 批量任务」按 Agent 模型配置入口已随
   REQ-20260909-011 移除——分支一旦被调用即输出指向不存在配置的误导文案。

## 方案

存量账本处置口径（README「期望行为」第 4 条待确认项，在此明确）：**不回写 / 不改写任何
存量账本文件（历史记录原样保留），展示 / 回显层按当前口径归一，生成层统一到单一口径**：

1. `scripts/lib/task-settings.mjs`：新增导出 `normalizePromptModelLine(prompt)`——
   将提示词中整行「子代理模型配置：…（来自设置「批量任务」，启动子代理时按此传递）。」
   替换为 `FOLLOW_SESSION_PROMPT_LINE`，其余行逐字不动；非字符串入参原样返回。
2. `scripts/lib/refine-store.mjs` `refineBatchPublicView`：`prompt` 字段经
   `normalizePromptModelLine` 输出——单点覆盖 /api/refine/current（面板提示词块、
   「重新复制」的复制源 state.refine.data.batch.prompt）、`atb refine summary/pause`
   的公开视图。
3. `scripts/atb.mjs` refine create 与 `scripts/server.mjs` /api/refine/create：
   返回与回显的 `prompt` 同样归一（幂等返回存量在途批次时不再透出旧行）。
4. 生成层统一（refine 与 develop 同口径）：
   `buildRefinePrompt` / `generatePrompt` 移除 manual / 直传固定行分支——凡携带模型
   入参（modelSource follow / manual，或兼容旧调用直传 model/level）一律注入
   `FOLLOW_SESSION_PROMPT_LINE`；均未传则不注入任何行（直连调用行为不变）。
   REQ-20260908-020 时代旧行自此不再可能被生成。
5. 契约测试：
   - 新增 `scripts/tests/bug-model-line-20260909-017.test.mjs`（生成统一 / 归一函数 /
     账本展示链路 / CLI 与服务端回显 / refine next·done·check 流程不回归）。
   - 同步翻转 `scripts/tests/model-follow-session-20260909-005.test.mjs` T5/T6 的
     manual 固定行断言为新契约（manual / 直传 → 跟随行），follow 与直连断言不动。

## 风险与边界

- **账本不回写**：直接读 `docs/agent-team-board/refine/batches/*/batch.json` 仍见旧行
  （历史原样，有意为之）；所有活跃透出入口（面板、复制、CLI/服务端回显）均已归一。
  验收说明第 2 条允许按本节声明的处置口径处理。
- **生成层契约变更**影响 model-follow-session T5/T6 的 manual 逐字断言（在本 Bug 期望
  行为范围内翻转，非静默放宽）；bare 直连（无模型信息不注入行）与 follow 输出逐字不变，
  agent-generic-20260909-011 G1 等直连断言不受影响。
- **开发侧展示未动**：`generatePrompt` follow 输出不变（验收第 4 条）；开发历史账本
  （batch-20260908-018、batch-20260909-019/020）旧行只存在于已结束批次文件内，
  队列头 / 新建批次均为新口径，不在本 Bug 现象范围内。
- `normalizePromptModelLine` 只匹配完整旧行（行首「子代理模型配置：」且含
  「来自设置「批量任务」」），不会误伤提示词其余文本；`refineBatchPublicView` 其余字段
  逐字不变，领取 / 回执 / 核对流程不经过 prompt 字段，行为不受影响。
