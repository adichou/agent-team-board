# BUG-20260907-003 文件看板源码视图全损：buildCodeView 误返回布尔参数，所有代码文件无法查看

- 状态：submitted（待人工接受）
- 归属需求：无（独立 Bug）
- 创建：2026-09-07T09:00:50.628Z

## 现象

## 现象
文件看板打开任何非 md 文件（如 package.json、*.js），或对 md 文件点「源码」切换，内容区只显示：
⚠ Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'.

## 复现
真实看板（8888）或任意项目：文件模块 → 打开 package.json → 立即出现上述错误。沙盒与真实项目均复现。

## 根因
scripts/web/app.js buildCodeView()（约 650 行）最后 `return wrap;`——`wrap` 是布尔入参（自动换行开关），元素变量名是 `wrapEl`。返回布尔传给 viewer.appendChild() 即抛 TypeError，被 catch 后以 ⚠ 提示呈现。疑似 REQ-20260906-021 引入换行开关时改名遗漏。

## 影响
File Board 的源码查看、语法高亮、行号复制「路径:行号」、自动换行开关全部不可用（这些能力对应 REQ-20260906-002/007/010/021）。属文件模块核心功能整体失效。

## 复现步骤

1. 看板任意项目 → 文件模块 → 打开 package.json（或任意非 md 文件），内容区立即显示 ⚠ Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'。
2. 打开 md 文件后点「源码」切换 → 同样报错（源码视图与文件类型无关，均走 buildCodeView）。

## 期望行为

`buildCodeView()` 返回 `.file-code` 容器元素（`wrapEl`），viewer.appendChild 正常渲染：非 md 文件与 md 源码态均显示行号槽 + 语法高亮代码；行号复制「路径:行号」、自动换行开关（REQ-20260906-021）全部恢复可用。

## 处置说明（2026-09-07，worker zcode-batch-009-1）

- 修复：`scripts/web/app.js` `buildCodeView()` 末行 `return wrap;` → `return wrapEl;`（1 行）。`wrap` 是布尔入参（自动换行开关），容器元素变量名为 `wrapEl`，改后源码视图/高亮/行号复制/换行开关全部恢复。
- 回归：`scripts/tests/file-board.test.mjs` 新增 G1 用例——提取 buildCodeView 源码在 DOM stub 沙箱内真实执行，断言返回 `.file-code` 容器（wrap 态挂 wrap class、行号与内容行数 1:1），并加结构守卫禁止再出现裸 `return wrap;`。修复前跑红（结构守卫命中），修复后跑绿。
- 结果：file-board 25/25 用例通过；`node scripts/tests/run-all.mjs` 全量 65 个测试文件 0 失败（详见 test-report.md）。

## 关联（引入来源）

- 引入来源：REQ-20260906-021（源码视图自动换行，经 `atb list` 核验在册）——实施时将容器改名 `wrapEl` 并以 `wrap` 承载布尔入参，函数末行 `return wrap;` 改名遗漏，布尔传给 `viewer.appendChild()` 抛 TypeError 被 catch 后以 ⚠ 呈现。
