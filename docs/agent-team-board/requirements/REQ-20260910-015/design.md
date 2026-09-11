# 设计 — REQ-20260910-015 创建需求或 bug，支持创建并接受

> 由 Agent 在 /dev 开发前补充，人可随时批注。

## 背景

创建与接受割裂为两个人工动作：`createItem()` 写死 `status: 'submitted'`，接受须再经
看板「✓」/「接受所选」或终端 `atb status <ID> accepted`。本设计把两步人工动作合一次，
并保持结果与分步路径完全等价、人工专属纪律不破。

## 方案

（技术选型、接口设计、影响面）

**待确认项定稿**：

1. 弹窗交互形态：独立按钮「创建并接受」（`#fSubmitAccept`，与 ui-demo.html 同口径）。
   底栏顺序「取消 | 创建并接受 | 创建」，样式新增 `.btn.accent`（主色描边次级强调，
   弱于实心 `.btn.primary` 的「创建」）；类型切到讨论（ask）时随 `syncNewFormFields()` 隐藏。
2. 命名定稿：CLI 开关 `--accept`（`atb new req|bug <标题> [--desc <描述>] --accept`）；
   `/api/new` 请求体可选字段 `accept`，**仅严格布尔 `true` 生效**（`"true"`、`1` 等一律按缺省处理），
   缺省行为与现状完全一致（落 submitted），旧客户端零影响。
3. 原子性失败策略：**整单拒绝 + 回滚删除条目目录**（对齐附件链路「任一非法整单拒绝、不留
   半写入条目目录」的先例）：接受环节（内存改状态 + `writeStatus` 原子写）抛错时 `rmSync`
   整个条目目录后原样抛出——要么条目完整落地为 accepted，要么什么都不留；
   单号计数器不回退（对齐 `deleteItem` 口径：单号全局唯一不复用）。refine 索引写失败不阻断
   （对齐 `setStatus` 现口径「索引写失败不阻断状态流转」）。
4. history 形态：**两条可追溯记录**——`null → submitted`（创建）与
   `submitted → accepted`（note「创建并接受」），与分步「先创建再人工接受」语义一致。

**分层改动**：

- `scripts/lib/core.mjs` `createItem()`：增加可选 `accept = false` 参数。全部校验、附件
  校验落盘、文档模板写完后，若 `accept`：内存置 `status: 'accepted'`、`pushHistory`
  （`submitted → accepted`，note「创建并接受」，操作者同 `by`）、`writeStatus`（失败回滚
  删目录）、`setRefineItemState(dataDir, id, 'unrefined', {})`（首次接受无 reaccepted 标记）。
  等价性由复用同一批原语保证（与 `setStatus` 进 accepted 的连带动作逐项对齐）。
- `scripts/atb.mjs`：`new` 子命令解析 `--accept`（布尔开关，`parseOpts` 天然支持）；
  USAGE 两行帮助文案补 `[--accept]`；成功输出区分「状态 submitted + 等待人工接受」与
  「已接受」两分支。
- `scripts/server.mjs` `/api/new`：`body.accept === true` 时透传 `core.createItem` 的
  `accept`，`by` 仍记 `'board'`；响应仍 201 返回完整 status（含 accepted）。
- `scripts/web/index.html` + `app.js` + `style.css`：底栏加 `#fSubmitAccept`
  （`type="button"`，点击走 `submitNew(..., { accept: true })`）；`syncNewFormFields()`
  ask 类型隐藏该按钮；`submitNew` 增 `accept` 参数（请求体 `accept: true`、toast
  「✓ 已创建 XX（已接受）」）；在途时「创建」「创建并接受」同时禁用、文案均变「创建中…」，
  收尾各自复位；失败保留表单与附件可重试（沿用现有 catch/finally）；带截图的服务能力
  预检（BUG-20260909-010）与标题校验两路径共用，自然生效。`openModal` 重置两按钮状态。
- `scripts/state-guard.mjs` Bash 拦截扩展（人工专属纪律）：
  - 规则(2) atb 段：tokens 含 `new` 且其后出现 `--accept`（裸开关或 `--accept=true`）→ 拦
    （引号拆词归一后判定，防 `--ac""cept` 绕过；`--accept=false` 为无效开关放行，对齐
    `--to=` 前缀口径）；提示文案沿用人工专属指引。
  - 规则(3) curl 段：命中 `/api/new` 且段内出现 JSON 形态 `"accept":true`（容忍引号/空白）
    或表单/查询形态 `accept=true` → 拦；`accept:false`、不带标记的旧调用不拦。
- 文档：条目 `ui-demo.html` 已按定稿口径演示，无需改动。

**影响面**：`createItem` 为 CLI 与 `/api/new` 共用入口，默认参数不变则两条旧路径零影响；
`setStatus`/状态机/`HUMAN_ONLY_TO` 不动；讨论单链路（`/api/discussion`）不经过
`createItem`，天然不受影响。

**开源选型（REQ-20260909-015）**：自研，理由——本需求是既有 Node 无依赖 CLI/服务内部的
参数透传与 UI 按钮扩展，无合适第三方库可复用（不引入新依赖、不复制开源源码，不创建 licenses.md）。

## 风险与边界

- 越权后门：若守卫不同步扩展，Agent 可借 `--accept` / `accept:true` 绕过人工专属纪律——
  已同步扩展两规则并有测试锚定（引号拆词、`--accept=true`、`"accept": true` 变体均覆盖）。
- 半成品：接受环节异常时回滚删除条目目录，不产生「状态 accepted 但无 refine 索引」之外的
  中间态（refine 索引失败本就容错，与分步接受同口径）。
- 误拦面：规则(2) 对「标题文本里出现 --accept 字样」会保守拦截（与既有 `status`+`accepted`
  token 判定同级误拦面，可改写标题规避）；规则(3) 仅在 `/api/new` 段内出现 accept=true
  形态才拦，普通创建不受影响。
- 兼容：`/api/new` 旧客户端（无 `accept` 字段）、CLI 旧用法、讨论单、截图附件、待接受
  编辑/删除/批量接受全部保持现状，由既有测试回归锚定。
