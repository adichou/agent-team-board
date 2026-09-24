# 设计 — REQ-20260924-004 整体审核界面的 AI 校对逐项增加修改按钮。

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

见 README「背景与现状」。四个「设计待确认点」在本文件定稿（README 已锁定行为目标与最低口径）：

1. issues 拆分口径 a / b；
2. 弹层关系（先关闭再打开 vs 两层叠放）；
3. 行级定位实现（textarea 无原生行定位）；
4. 「修改」是否顺带逐条「已处理」标记。

## 方案

### 定稿 1：issues 拆分取口径 a —— 提示词约束回执格式 + 前端按行拆分（账本结构不变）

- `buildDocProofreadPrompt`（scripts/lib/publish-flow.mjs）收紧回执格式约束：`--issues` 内
  **每条问题独立一行、行号开头**（形如 `第 12 行：原文「…」→ 建议「…」`；无行号的条目也独立
  成行，行首自标「（无行号）」），条与条换行分隔、不空行不连排。
- `docs-check-store` 账本结构不动（issues 仍是每文件一整段 ≤2000 字文本），`atb docscheck`
  CLI 不动——**既有 run 数据天然兼容**（旧整段回执按下面兜底展示）。
- 前端新增两个纯函数（scripts/web/build.js）：
  - `splitProofreadIssues(text)`：按换行拆分、trim、去空行；无换行的整段返回单条整段
    （**不丢内容**）；空文本返回空数组。
  - `parseIssueLineNo(text)`：行号解析——优先命中 `第 N 行` 形态，其次行首 `N. / N、 / N: / N： / L N:` 形态；解析不到返回 null（跳转兜底为仅打开编辑态，不算缺陷）。

### 定稿 2：弹层关系取「先关闭整体审查对话框再打开审查对话框」

一次一层（沿用现状遮罩与 Esc 归属），与 README 倾向及 ui-demo 示意一致。`editFromProofread`：
`finalize.busy`（确认完结请求进行中）不放行让位；其余情况先置 `pf.finalize = null` 再开审查
对话框。

### 定稿 3：行级定位 = 行号计算 selectionStart/End + scrollTop 估算 + 选区突出 + 短暂描边

`openReview` 参数化：`openReview(target)`，`target = { file, line }`——切到该文件所属类型
页签（含自定义文档 KEY），目标**默认语言文件**栏 `modes[file] = 'edit'`（其余栏保持预览态），
记录 `pf.review.pendingFocus = { file, line }`；无参调用行为与现状完全一致（README 页签 +
全栏预览态）。`loadReviewPair` 完成后由 `focusReviewIssue()` 一次性消费 pendingFocus：

- `textarea` 按行号累计偏移计算该行首尾 → `setSelectionRange(start, end)`（浏览器原生选区
  即原文片段突出）+ `focus()`；
- `scrollTop` 按 `getComputedStyle().lineHeight` 估算行高居中到该行附近；行号超界收敛末行；
- 短暂描边动画（CSS 类 `bld-review-focus-flash`，2 秒后移除）提示定位落点；
- 无行号 / 内容读取失败（空内容）/ 目标栏不在 DOM：只打开编辑态，不定位不报错（兜底口径）。

### 「已处理」标记：不做（最小口径）

修改后清单仍显示原校对结果，直至重新「AI 校对」启动新一轮按最新磁盘内容覆盖（docscheck
既有口径）；「修改」不改变 ①② 检查、`canFinalize` / `canCommit` 门禁与「确认完结」行为。

### 前端渲染（renderFinalizeModal ③ 项明细区）

fail 文件按文件分组（`li.bld-finalize-file` = 文件名 `<code>` + 嵌套
`ul.bld-finalize-issues`），每条问题一行：序号（①②…超过 20 条退数字）+ 回执原文
（`data-i18n-skip`，AI 回执内容不进界面词典）+ 「✎ 修改」按钮
（`data-proof-edit="文件名"`，解析到行号再加 `data-proof-line="N"`；`title` =
`文件名 · 第 N 行` 摘要）。整段拆不出多条时作一条展示、按钮按文件级跳转（无
data-proof-line）。修改按钮只出现在 done 且 fail 文件的逐条问题行——未运行 / 进行中 /
中断 / pass 文件均不出现。样式在 scripts/web/style.css 新增分组与问题行规则。

### 点击「修改」链路（editFromProofread）

关闭整体审查对话框 → `openReview({ file, line })` → 审查对话框切到对应页签、目标默认语言栏
编辑态、内容经既有 `loadReviewPair` 读取接口与缓存口径加载（读取中「正在读取文档内容…」/
失败 toast 与现状一致）→ `focusReviewIssue` 定位突出。编辑 / 保存 / 回退「已总结待审核」/
重新「通过审核」全部沿用现状，无新增接口、无数据源变化（纯前端改动，scripts/server.mjs 不动）。

### i18n（scripts/web/i18n.js）

- 按钮文案复用既有词条 `✎ 修改` → `✎ Edit`（裸「修改」在词典中是 diff 语义
  「Modified」，不可复用）；
- 新增动态键 `◇ · 第 ◇ 行` → `$1 · line $2`（按钮 title 摘要，文件名 / 行号为数据）；
- 回执原文 span 沿用 `data-i18n-skip`（既有口径）。

### 开源选型（REQ-20260909-015）

自研，无新增开源依赖：改动均为本项目既有前端（原生 DOM / 字符串处理）与既有提示词文案，
无可复用的成熟库场景（行号拆分 / textarea 行定位是数十行纯逻辑）。不创建 licenses.md。

## 风险与边界

- **不丢内容**：拆分只按行切分，条目文本逐字保留；拆分失败整段作一条。issues 内本身含
  换行的旧格式（如分号连排）也会按行拆——行为目标即「逐条成行」，可接受。
- **行号解析是启发式**：解析不到不算缺陷（README 最低口径），按钮退化为文件级跳转仍可用。
- **行高估算**：等宽 textarea 单行高即 `lineHeight`（软换行只影响个别行偏移，定位「行附近」
  已满足验收「滚动定位到对应行附近」）。
- **门禁零改动**：不触碰 `canFinalize` / `canCommit` / evaluateDocsFlow / 确认完结与完结回退。
- **既有测试兼容**：req-20260924-001 / 003 的 L4 断言（明细文本、文件名、顶层 3 行检查项、
  按钮保持）在新结构下保持命中；本单同步新增分层测试。
