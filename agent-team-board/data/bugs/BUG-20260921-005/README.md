# BUG-20260921-005 AI 写作的提示词优化，不在提示词中带上大量的需求和 bug 单标题

- 状态：accepted（已接受）
- 归属：独立 Bug（引入来源见 design.md）
- 创建：2026-09-21T00:42:13.212Z

## 现象

发布文档「AI 总结」（REQ-20260921-008 前旧名「AI 写作」，下同）与「AI 翻译」提示词把版本关联的全部条目标题逐条内嵌进「关联范围」小节，条目多时提示词体量庞大：

1. 需求与 Bug 单标题全部内嵌——提示词应改为引导子代理自行读取相应条目文件，以简化提示词；
2. Bug 单标题对写作语境价值低——只需读取 REQ 类型条目，BUG 类型条目总结为「修复了若干 bug」即可。

### 已核实证据

- 生成逻辑在 `scripts/lib/publish-flow.mjs`：`buildDocSummaryPrompt`（约 160–161 行）与 `buildDocTranslatePrompt`（约 201–202 行）的「关联范围」循环均为 `- ${it.itemId}（commit ${短hash}）${it.title}`，逐条拼入编号 + commit 短 hash + 完整标题；标题上限 200 字（`scripts/lib/build-store.mjs` `normalizeItems` 对 `title` 做 `slice(0, 200)`）。
- 实测量级：版本 `BLD-20260920-001` 关联 341 条（REQ 165 / BUG 176），其提示词「关联范围」即 341 行标题。
- 透出出口共四处，均受影响：服务端 `POST /api/build/docs-summary/start`（`scripts/server.mjs` 约 2704 行）与 `POST /api/build/docs-translate/start`（约 2756 行）返回的 prompt；CLI `atb summary start`（`scripts/atb.mjs` 约 1228 行）与 `atb translate start`（约 1341 行）打印的提示词。
- 看板「构建与发布 → 文档编写」页将 prompt 渲染为只读 textarea 预览并提供「复制提示词」按钮（`scripts/web/build.js` 约 2823–2837 行），复制后交给 AI Agent 会话执行。
- 条目说明文件在项目内磁盘可达：`<项目根>/agent-team-board/data/requirements/<REQ-ID>/` 与 `<项目根>/agent-team-board/data/bugs/<BUG-ID>/`（`scripts/lib/core.mjs` 条目目录布局；提示词中已含项目路径），子代理按路径可自行读取，无需提示词内嵌标题。
- 条目类型可由编号前缀区分（`ITEM_ID_RE = /^(?:REQ|BUG)-\d{8}-\d{3,}$/`）。
- 「官网 AI 写作」提示词（`buildSiteWritingPrompt`）不携带条目清单，不在本 Bug 范围。

## 复现步骤

1. 在项目根执行 `node scripts/atb.mjs summary start --id BLD-20260920-001`（或在看板「构建与发布」进入该版本「文档编写」步骤，点击「AI 总结」）。
2. 查看返回提示词的「关联范围」小节。
3. 观察到 341 行 `- <REQ/BUG 编号>（commit <短hash>）<标题>` 逐条罗列：165 条需求标题与 176 条 Bug 标题全部内嵌，提示词被标题撑到非常大的体量。
4. 对 AI 翻译重复上述操作（`atb translate start --id BLD-20260920-001` 或「文档编写」页点击「AI 翻译」），其「关联范围」小节同样逐条内嵌标题。

## 期望行为

1. `buildDocSummaryPrompt` 与 `buildDocTranslatePrompt` 的「关联范围」不再逐条内嵌条目标题（REQ 与 BUG 标题均不内嵌）。
2. REQ 类型条目：提示词只保留编号（是否保留 commit 短 hash 待开发定），并给出条目文件路径规则（如 `<项目根>/agent-team-board/data/requirements/<REQ-ID>/`），引导子代理自行读取相应条目文件了解本版语境。
3. BUG 类型条目：不引导读取、不逐条罗列，统一汇总为一句「修复了若干 bug」（是否带具体条数、BUG 编号是否保留为不带标题的清单：待确认，开发前明确）。
4. 提示词其余要素保持既有口径不变：项目路径、发布计划号 / 版本号、执行编号、文档清单（按语言集展开）、atb summary / translate 逐文件回执指令、写作与翻译约束。
5. CLI（`atb summary start` / `atb translate start`）与看板「文档编写」页提示词预览、复制到剪贴板的内容同步呈现精简后的提示词；启动、进度回执与人工审查流程不受影响。

## 界面展示

本 Bug 现象非界面缺陷，但修复会改动「文档编写」页提示词预览框（只读 textarea）与剪贴板中的提示词内容，按 UI 变更口径提供演示：

- 界面布局：沿用「构建与发布 → 文档编写」页既有布局——三阶段进度、顶部操作按钮（「AI 总结」/「AI 翻译」）、点击后展开的「AI 总结提示词」预览框（summary + 只读 textarea + 「复制提示词」按钮）与统计信息；本修复不改布局，仅预览框内的提示词文本变化。
- 交互行为：点击「AI 总结」启动一轮总结（加载反馈后展开提示词预览并自动复制到剪贴板，可再点「复制提示词」）；演示提供「缺陷现象 / 修复后」切换开关，同屏对比同一预览框在修复前（关联范围逐条内嵌 341 行标题）与修复后（REQ 仅列编号并引导读取条目文件、BUG 汇总为一句）的提示词内容。
- 状态反馈：未点击前的空态（无预览框）、点击后的加载态（正在启动）、预览展开态、复制成功反馈；切换开关即时重渲染预览并更新提示词长度 / 关联范围行数统计。深浅色随系统自适应。
- [交互演示（ui-demo.html）](./ui-demo.html)：单文件可交互演示——切换「缺陷现象 / 修复后」对比提示词内容与体量统计，含启动加载、空态、复制反馈等状态。

## 验收说明

- [ ] `buildDocSummaryPrompt` / `buildDocTranslatePrompt` 生成的提示词不再包含任何逐条条目标题（REQ 与 BUG 均不内嵌标题）。
- [ ] REQ 条目在提示词中以编号 + 条目文件路径指引呈现，引导子代理自行读取 `agent-team-board/data/requirements/<REQ-ID>/` 下的说明文件；BUG 条目不逐条展开，按「修复了若干 bug」口径一句汇总。
- [ ] `atb summary start` / `atb translate start` 输出与看板「文档编写」页提示词预览一致精简；启动、复制、逐文件回执、人工审查流程行为不变。
- [ ] 提示词仍完整保留项目路径、计划号 / 版本号、执行编号、文档清单、回执指令与写作 / 翻译约束，既有工作流不受影响。
- [ ] 以大条目数版本（如 BLD-20260920-001，341 条）对比修复前后提示词字符数，确认显著缩短（量化阈值：待确认）。
- [ ] 开发阶段同步更新依赖「关联范围」逐条标题口径的既有 L1 提示词断言（`scripts/tests/req-20260920-003.test.mjs` L1-4、`req-20260921-008.test.mjs`、`req-20260921-010.test.mjs` L1-5、`req-20260921-012.test.mjs` L1-3）并回归通过。
- [ ] BUG 汇总是否带具体条数、BUG / REQ 编号是否保留为不带标题的清单等「待确认」项在开发前明确后再实施；本轮仅完善文档，未改代码、未声明修复完成。
