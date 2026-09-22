# 设计 — REQ-20260922-005 AI 总结 LICENSE.md 时，要弹框让用户选择开源协议，提供一个表格罗列主流开源协议的定义，官网网址和优劣

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

REQ-20260922-002 已把 LICENSE.md 纳入发布文档清单（A1 单文件、口径 B 不进 AI 总结 /
翻译、口径 C 必选），但「选择哪种许可证、内容从哪来」留白——人工只能从零编写。
本单补上选择入口：AI 总结时点弹框选协议、表格罗列主流协议的定义 / 官网 / 优劣，
选中即写入标准文本。**不推翻 002 任何口径**：AI 不生成许可证文本，写入的是内置
SPDX 标准文本，其后照走人工「待审核 → 已审核」。

## 方案

### 一、触发点口径（需求标题「AI 总结 LICENSE.md 时」的落定）

002 口径 B 下 LICENSE 永不被 AI 总结，字面时点不存在。落定为**点击「AI 总结」按钮
的时点**（用户发起文档编写动作的起点）：

- LICENSE.md 状态 = `unwritten` → 拦截启动，弹「选择开源协议」框；
  - 选中并确认 → 写入 LICENSE.md → 关框 → 继续原 AI 总结启动（`doStartSummary`）；
  - 「暂不选择」→ 不写盘 → 关框 → 继续 AI 总结启动（LICENSE 本不在总结范围，不冲突）；
  - ✕ / Esc / 遮罩 → 关框，不启动（用户可再点「AI 总结」重试）。
- LICENSE.md 已编写（`pending` / `reviewed`）→ 不弹框，直接启动（现状行为不变）。

### 二、协议目录（服务端唯一事实源，`scripts/lib/license-catalog.mjs`）

- `LICENSE_CATALOG`：11 项主流协议，字段 `{ id(SPXD 标识), name, url(官网), copyleft
  ('none'|'weak'|'strong'), definition(中文定义), pros[](中文优势), cons[](中文劣势) }`，
  顺序：宽松（MIT、Apache-2.0、BSD-3-Clause、BSD-2-Clause、ISC）→
  著佐权（MPL-2.0 / LGPL-3.0 弱、GPL-3.0 / AGPL-3.0 强）→
  公共域风格（Unlicense、0BSD）。
- `licenseTextOf(id)`：读 `scripts/lib/license-texts/<SPDX-ID>.txt`（SPDX 权威标准文本，
  仓库内置静态数据；BSD 系文本的 SPDX match 变量已归一为 `<year> <owner>` 占位模板）；
  首读缓存，未知 id 返回 null。
- `licenseCatalogView()`：API 视图 = 元数据 + `text`（标准文本），供前端一次拉取。

### 三、API（`scripts/server.mjs`）

- `GET /api/build/doc-licenses?project=`：返回 `{ licenses: [...] }`（含 text）。
  静态目录数据，不依赖看板 / 版本状态；project 参数仅沿用模块统一寻址口径。
- 写入不新增接口：前端确认后 POST 既有 `/api/build/docs/save`
  （`{ id, file: 'LICENSE.md', content: 标准文本 }`）——白名单（002 已放行 LICENSE.md）、
  2 MiB 上限、merging 锁、响应带 docsFlow 全部复用，单一写盘通道不变。

### 四、前端（`scripts/web/build.js`）

- `startSummary()` 拆为守卫 + `doStartSummary()`：守卫取 `normalizeFlowEval` 的
  LICENSE.md（single 且非 custom）状态，`unwritten` 时 `pf.license = { open, sel, busy,
  loading, error, list, then: 'summary' }` 并异步 `loadDocLicenses()`；否则直接启动。
- `renderLicenseModal(v)`：与完结核对框同型模态；表格列 = 协议（name + SPDX id +
  宽松 / 著佐权 chip）/ 定义 / 官网（`<a target="_blank" rel="noreferrer">`，标识豁免）/
  优势 / 劣势；行单选（radio + 高亮）；底部「写入 LICENSE.md 并继续总结」（未选中
  disabled）+「暂不选择，继续 AI 总结」+ ✕ 关闭；说明行含占位符与「写入后转待审核、
  人工在审查中确认」提示。加载中 / 加载失败（重试）态齐备。
- `confirmLicensePick()`：POST docs/save → 合并响应 docsFlow → toast（含协议名）→
  关框 → `doStartSummary()`；失败 toast、弹框保留。`skipLicensePick()`：关框 →
  `doStartSummary()`。Esc / 遮罩点击关闭（不继续）。
- 渲染挂载进 `render()` 模态列；事件绑定进 `bindCommon`；`startSummary` /
  `confirmLicensePick` / `skipLicensePick` 入模块接缝供测试。
- 协议名 / SPDX id / URL 是标识：`data-i18n-skip`；定义 / 优劣是文案：走 i18n 词典。

### 五、文案（`scripts/web/i18n.js`，中英同步）

新增静态词条：弹框标题 / 说明 / 表头（协议、定义、官网、优势、劣势）/ 著佐权标注
（宽松、弱著佐权、强著佐权）/ 按钮（写入 LICENSE.md 并继续总结、暂不选择，继续 AI
总结、写入中…、正在加载协议目录…）/ 保存与审查提示句；动态词条（◇ 插值）：写入
成功 toast、目录读取失败 toast、重试按钮句。目录的 definition / pros / cons 逐句
登记 EN（键 = 中文原文全文）。

### 六、样式（`scripts/web/style.css`）

`.bld-license-modal`（复用 rel-modal 容器，max-width 960px）+ `.bld-license-table`
（横向可滚动 wrap、行选中高亮、chip 与优劣列表弱化呈现，深浅色随既有变量）。

### 七、不改动项

- `publish-flow.mjs` 全部口径（清单 / 状态机 / 门禁 / 提示词 / pathspec）零改动；
  002 / 003 既有测试零改动预期跑绿。
- AI 总结启动接口、独立锁、账本、轮询不变；审查对话框不变。

**开源选型（REQ-20260909-015）**：无合适库——候选 `spdx-license-list`（npm）为
CC-BY-4.0，不在 License 白名单，禁止引入；本单为静态数据（11 项协议元数据 + SPDX
权威标准文本）+ 一张表格弹框 + 一次既有通道写盘，无第三方库可复用。许可证文本本身
各 License 均明示允许逐字复制（SPDX 以此提供权威文本），属数据资料而非库源码，故
内嵌为 `scripts/lib/license-texts/*.txt` 并在模块头注明来源（SPDX license-list-data）。
不引入依赖、不创建 licenses.md。

## 风险与边界

- **许可证文本的法律边界**：内置文本是标准模板（含 `<year>` 等占位符），弹框明示
  「占位符需在审查时人工确认填写」，写入后仍需人工审核（002 口径），工具不做法律
  判断；GNU 家族（LGPL 基于 GPL）组合使用场景以官网指引为准，弹框提示「以官网为准」。
- **门禁时点**：弹框只在 `unwritten` 触发；`pending` / `reviewed` 下用户改协议 =
  审查对话框人工编辑（既有能力），本单不提供换协议快捷入口（避免绕过审查口径）。
- **目录体积**：11 项含 GNU 家族全文 ≈ 142 KB，一次性 GET（本机服务、弹框打开时才
  拉取），不进轮询。
- **后续协议增删**：改 `LICENSE_CATALOG` + texts 目录 + i18n 词条三处联动，测试锁定
  目录与词条一致性（L6）。
